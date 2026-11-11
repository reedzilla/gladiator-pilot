import { AsBuiltSnapshot, vaultDb } from '../storage/vaultDb';
import { ElmSession } from '../transport/elmSession';
import { bytesToHex, hexToBytes } from '../transport/isotp';
import { EcuEndpoint } from '../transport/types';
import {
  applySurgicalBitFlip,
  applySurgicalBytePatch,
  writeDidVerified,
} from './codingCalibrators';

/**
 * ZF 8HP75 Gear Ratios on the 2021 Gladiator 3.0L EcoDiesel:
 * 1st: 4.71, 2nd: 3.14, 3rd: 2.10, 4th: 1.67, 5th: 1.29, 6th: 1.00, 7th: 0.84, 8th: 0.67
 */
export const ZF_8HP75_EIGHTH_GEAR = 0.67;

/**
 * Calculate real GPS speed when speedometer reads `indicatedMph` prior to recalibration,
 * plus 70 MPH 8th-gear highway cruise RPM on the 3.0L EcoDiesel.
 */
export function computeDrivetrainImpact(params: {
  stockDiameterIn?: number;
  newEffectiveDiameterIn: number;
  axleRatio: number;
  indicatedMph?: number;
}): {
  actualGpsMphAt65: number;
  speedoDeltaMph: number;
  rpmAt70Mph8thGear: number;
  inEcoDieselSweetSpot: boolean;
} {
  const stockEffective = (params.stockDiameterIn ?? 31.46) * 0.97;
  const indicated = params.indicatedMph ?? 65;
  const ratio = params.newEffectiveDiameterIn / stockEffective;
  const actualGpsMphAt65 = Math.round(indicated * ratio * 10) / 10;
  const speedoDeltaMph = Math.round((actualGpsMphAt65 - indicated) * 10) / 10;

  // Engine RPM = (MPH * AxleRatio * TransGearRatio * 336.13) / EffectiveTireDiameterIn
  const rpmAt70Mph8thGear = Math.round(
    (70 * params.axleRatio * ZF_8HP75_EIGHTH_GEAR * 336.13) / params.newEffectiveDiameterIn
  );

  // 3.0L V6 EcoDiesel Gen 3 peak torque (442 lb-ft) starts at 1,400 RPM; optimal highway cruise is 1,550–2,050 RPM
  const inEcoDieselSweetSpot = rpmAt70Mph8thGear >= 1550 && rpmAt70Mph8thGear <= 2050;

  return {
    actualGpsMphAt65,
    speedoDeltaMph,
    rpmAt70Mph8thGear,
    inEcoDieselSweetSpot,
  };
}

export interface LightingConfigState {
  ledHeadlamps: boolean;
  ledFogLamps: boolean;
  fogDropOutDisable: boolean; // Keep fogs ON with high beams!
  ledFrontTurns: boolean;
  ledTailLamps: boolean;
  dedicatedDrl: boolean;
}

export function decodeLightingDid0131(hex: string): LightingConfigState {
  const b = hexToBytes(hex);
  const b0 = b[0] ?? 0;
  const b1 = b[1] ?? 0;
  return {
    ledHeadlamps: (b0 & 0x01) !== 0,
    ledFogLamps: (b0 & 0x02) !== 0,
    ledFrontTurns: (b0 & 0x04) !== 0,
    ledTailLamps: (b0 & 0x08) !== 0,
    fogDropOutDisable: (b1 & 0x01) !== 0,
    dedicatedDrl: (b1 & 0x10) !== 0,
  };
}

export function encodeLightingDid0131(originalHex: string, next: LightingConfigState): string {
  let h = originalHex;
  h = applySurgicalBitFlip(h, 0, 0, next.ledHeadlamps ? 1 : 0);
  h = applySurgicalBitFlip(h, 0, 1, next.ledFogLamps ? 1 : 0);
  h = applySurgicalBitFlip(h, 0, 2, next.ledFrontTurns ? 1 : 0);
  h = applySurgicalBitFlip(h, 0, 3, next.ledTailLamps ? 1 : 0);
  h = applySurgicalBitFlip(h, 1, 0, next.fogDropOutDisable ? 1 : 0);
  h = applySurgicalBitFlip(h, 1, 4, next.dedicatedDrl ? 1 : 0);
  return h;
}

export interface AuxComfortState {
  auxSwitchBankEnabled: boolean;
  seatbeltChimeDisabled: boolean;
}

export function decodeComfortDid0132(hex: string): AuxComfortState {
  const b = hexToBytes(hex);
  return {
    auxSwitchBankEnabled: ((b[0] ?? 0) & 0x01) !== 0,
    seatbeltChimeDisabled: ((b[3] ?? 0) & 0x01) !== 0,
  };
}

export function encodeComfortDid0132(originalHex: string, next: AuxComfortState): string {
  let h = originalHex;
  h = applySurgicalBitFlip(h, 0, 0, next.auxSwitchBankEnabled ? 1 : 0);
  h = applySurgicalBitFlip(h, 3, 0, next.seatbeltChimeDisabled ? 1 : 0);
  return h;
}

/**
 * Seamless 1-Click Safe Apply Pipeline:
 *  1. Reads current live bytes from `ecu` via `0x22 <DID>`
 *  2. Automatically saves original bytes to `vaultDb` as a Factory Baseline if no backup exists yet!
 *  3. Computes patched bytes using `transform(liveHex)`
 *  4. Writes via `0x2E` (`writeDidVerified`) and verifies `0x22` read-back!
 */
export async function autoBackupAndApplyDid(params: {
  session: ElmSession;
  ecu: EcuEndpoint;
  didHex: string;
  vin: string;
  existingSnapshots: AsBuiltSnapshot[];
  transform: (currentHex: string) => string;
}): Promise<{ ok: boolean; detail: string; newHex: string | null; autoBackedUp: boolean }> {
  const { session, ecu, vin, existingSnapshots, transform } = params;
  const cleanDid = params.didHex.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();

  // Step 1: Read current live bytes
  const readFn = () => session.requestUds(ecu, `22${cleanDid}`, 1800);
  const readResp =
    ecu.bus === 'CAN_IHS' || ecu.bits === 29
      ? await session.withBusSafetyRestore(ecu.bus, ecu.bits, readFn)
      : await readFn();

  if (!readResp.ok || readResp.bytes.length < 4 || readResp.bytes[0] !== 0x62) {
    return {
      ok: false,
      detail: `Could not read current DID 0x${cleanDid} on ${ecu.shortName}: ${
        readResp.errorReason || 'No response'
      }. Map this DID in R&D Lab first if your trim uses a different address.`,
      newHex: null,
      autoBackedUp: false,
    };
  }

  const currentHex = bytesToHex(readResp.bytes.slice(3));

  // Step 2: Invisible Auto-Backup if not already stored in Vault!
  const alreadySaved = existingSnapshots.some(
    (s) => s.txId === ecu.txId && Boolean(s.dids[cleanDid])
  );
  let autoBackedUp = false;
  if (!alreadySaved) {
    await vaultDb.snapshots.add({
      createdAt: Date.now(),
      label: `Auto-Saved Stock ${ecu.shortName} (0x${cleanDid})`,
      vin: vin || '1C6JJTAM0ML000000',
      ecuId: ecu.id,
      ecuName: ecu.shortName,
      bus: ecu.bus,
      bits: ecu.bits,
      txId: ecu.txId,
      rxId: ecu.rxId,
      scheme: ecu.scheme,
      isFactoryBaseline: true,
      dids: { [cleanDid]: currentHex },
    });
    autoBackedUp = true;
  }

  // Step 3: Compute surgical byte patch
  let targetHex: string;
  try {
    targetHex = transform(currentHex);
  } catch (err) {
    return {
      ok: false,
      detail: (err as Error).message,
      newHex: null,
      autoBackedUp,
    };
  }

  // Step 4: Write 0x2E + Verify 0x22 Read-Back
  const wr = await writeDidVerified(session, ecu, cleanDid, targetHex);
  return {
    ok: wr.ok,
    detail: autoBackedUp ? `Stock bytes backed up automatically · ${wr.detail}` : wr.detail,
    newHex: wr.readBackHex,
    autoBackedUp,
  };
}

export { applySurgicalBytePatch };
