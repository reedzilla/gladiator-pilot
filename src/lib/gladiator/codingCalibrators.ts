import { AsBuiltSnapshot } from '../storage/vaultDb';
import { ElmSession } from '../transport/elmSession';
import { bytesToHex, hexToBytes } from '../transport/isotp';
import { EcuEndpoint, SgwState } from '../transport/types';

export interface TireCalcResult {
  nominalDiameterIn: number;
  effectiveDiameterIn: number;
  circumferenceMm: number;
  revsPerMile: number;
  hex16BigEndian: string; // e.g. "0A 89"
}

export const GLADIATOR_TIRE_PRESETS = [
  { label: 'Stock Sport 245/75R17 (31.5")', diameterIn: 31.46 },
  { label: 'Overland 255/70R18 (32.1")', diameterIn: 32.06 },
  { label: 'Willys / Rubicon 285/70R17 (32.8")', diameterIn: 32.71 },
  { label: '33x12.50R17 Trail', diameterIn: 33.0 },
  { label: '315/70R17 (34.4")', diameterIn: 34.36 },
  { label: '35x12.50R17', diameterIn: 35.0 },
  { label: '37x12.50R17', diameterIn: 37.0 },
  { label: '40x13.50R17', diameterIn: 40.0 },
] as const;

export const GLADIATOR_AXLE_RATIOS = [
  { label: '3.73 (Stock 3.0L EcoDiesel)', ratio: 3.73 },
  { label: '4.10 (Rubicon / Max Tow)', ratio: 4.1 },
  { label: '4.56 Regear (35"–37" EcoDiesel sweet spot)', ratio: 4.56 },
  { label: '4.88 Regear', ratio: 4.88 },
  { label: '5.13 Regear', ratio: 5.13 },
] as const;

/**
 * Compute tire circumference in millimeters from metric (`285/70R17`), flotation (`35`), or measured height.
 * @param squatFactor Default `0.97` accounts for ~3% loaded sidewall squat under the EcoDiesel's curb weight; pass `1.0` if inputting actual chalk-test / loaded diameter.
 */
export function calculateTireCircumferenceFromDiameter(
  nominalDiameterIn: number,
  squatFactor = 0.97
): TireCalcResult {
  const clampedDia = Math.max(24, Math.min(46, nominalDiameterIn));
  const clampedSquat = Math.max(0.9, Math.min(1.02, squatFactor));
  const effectiveDiameterIn = Math.round(clampedDia * clampedSquat * 100) / 100;
  const circumferenceMm = Math.round(effectiveDiameterIn * 25.4 * Math.PI);
  const revsPerMile = Math.round((63360 / (effectiveDiameterIn * Math.PI)) * 10) / 10;
  const hi = (circumferenceMm >> 8) & 0xff;
  const lo = circumferenceMm & 0xff;

  return {
    nominalDiameterIn: Math.round(clampedDia * 100) / 100,
    effectiveDiameterIn,
    circumferenceMm,
    revsPerMile,
    hex16BigEndian: bytesToHex([hi, lo]),
  };
}

export function metricTireToDiameterIn(widthMm: number, aspectPct: number, rimIn: number): number {
  const sidewallIn = (widthMm * (aspectPct / 100)) / 25.4;
  return rimIn + 2 * sidewallIn;
}

export function encodeAxleRatioHex16(ratio: number): { scaledInt: number; hex16BigEndian: string } {
  const scaledInt = Math.round(ratio * 100);
  return {
    scaledInt,
    hex16BigEndian: bytesToHex([(scaledInt >> 8) & 0xff, scaledInt & 0xff]),
  };
}

/**
 * Surgically patch specific bytes in an existing DID hex buffer without altering neighboring bytes.
 */
export function applySurgicalBytePatch(
  originalDidHex: string,
  byteOffset: number,
  patchBytes: readonly number[]
): string {
  const buf = hexToBytes(originalDidHex);
  if (byteOffset < 0 || byteOffset + patchBytes.length > buf.length) {
    throw new Error(
      `Patch at byte ${byteOffset} (${patchBytes.length}B) exceeds DID buffer length (${buf.length}B).`
    );
  }
  for (let i = 0; i < patchBytes.length; i++) {
    buf[byteOffset + i] = patchBytes[i] & 0xff;
  }
  return bytesToHex(buf);
}

/**
 * Surgically flip a single bit (`bitIndex` 0..7) at `byteOffset` in a DID hex buffer.
 */
export function applySurgicalBitFlip(
  originalDidHex: string,
  byteOffset: number,
  bitIndex: number,
  bitValue: 0 | 1
): string {
  const buf = hexToBytes(originalDidHex);
  if (byteOffset < 0 || byteOffset >= buf.length) {
    throw new Error(`Byte offset ${byteOffset} out of range (0..${buf.length - 1}).`);
  }
  if (bitIndex < 0 || bitIndex > 7) {
    throw new Error(`Bit index ${bitIndex} must be 0..7.`);
  }
  if (bitValue === 1) {
    buf[byteOffset] |= 1 << bitIndex;
  } else {
    buf[byteOffset] &= ~(1 << bitIndex) & 0xff;
  }
  return bytesToHex(buf);
}

export interface WritePreflightStatus {
  canWrite: boolean;
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
  }>;
  blockerSummary: string | null;
}

export function evaluateWritePreflight(params: {
  connected: boolean;
  sgwState: SgwState;
  batteryVolts: number | null;
  speedMph: number | null;
  hasAsBuiltBackupForDid: boolean;
}): WritePreflightStatus {
  const checks = [
    {
      id: 'conn',
      label: 'Adapter Connected',
      passed: params.connected,
    },
    {
      id: 'sgw',
      label: '12+8 SGW Bypass Active',
      passed: params.sgwState === 'bypass_active',
    },
    {
      id: 'volts',
      label: `KOEO >= 12.0V (${params.batteryVolts !== null ? `${params.batteryVolts.toFixed(1)}V` : '—'})`,
      passed: params.batteryVolts !== null && params.batteryVolts >= 12.0,
    },
    {
      id: 'speed',
      label: `0 MPH Stationary (${params.speedMph !== null ? `${params.speedMph} mph` : '0 mph'})`,
      passed: params.speedMph === null || params.speedMph <= 0.5,
    },
    {
      id: 'backup',
      label: 'DID Saved in As-Built Vault',
      passed: params.hasAsBuiltBackupForDid,
    },
  ];

  const failed = checks.filter((c) => !c.passed);
  return {
    canWrite: failed.length === 0,
    checks,
    blockerSummary: failed.length > 0 ? failed.map((f) => f.label).join(' · ') : null,
  };
}

export interface WriteDidOutcome {
  ok: boolean;
  didHex: string;
  writtenHex: string;
  readBackHex: string | null;
  requiresSeedKey27: boolean;
  detail: string;
}

/**
 * Execute a surgical `0x2E` WriteDataByIdentifier sequence with `0x10 03` Extended Session
 * and mandatory `0x22` read-back byte verification.
 */
export async function writeDidVerified(
  session: ElmSession,
  ecu: EcuEndpoint,
  didHex: string,
  targetDataHex: string,
  protectTunedPcm = true
): Promise<WriteDidOutcome> {
  const cleanDid = didHex.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (cleanDid.length !== 4) {
    throw new Error(`DID must be 4 hex chars (got "${didHex}").`);
  }
  const targetBytes = hexToBytes(targetDataHex);
  if (targetBytes.length === 0) {
    throw new Error('Target payload cannot be empty.');
  }

  // Stage 2 EcoDiesel ECM Tune-Lock: never send 0x2E writes to PCM (7E0)
  if (protectTunedPcm && ecu.id === 'PCM') {
    return {
      ok: false,
      didHex: cleanDid,
      writtenHex: bytesToHex(targetBytes),
      readBackHex: null,
      requiresSeedKey27: false,
      detail:
        'Stage 2 ECM Tune-Lock Active: PCM (7E0) is strictly Read-Only to protect your Stage 2 EcoDiesel calibration. Tire/Gear/LED/TPMS mods write safely to BCM (620).',
    };
  }

  const run = async (): Promise<WriteDidOutcome> => {
    // Step 1: Enter Extended Diagnostic Session (0x10 03)
    const ext = await session.requestUds(ecu, '1003', 1800);
    if (!ext.ok) {
      return {
        ok: false,
        didHex: cleanDid,
        writtenHex: bytesToHex(targetBytes),
        readBackHex: null,
        requiresSeedKey27: ext.nrc === 0x33,
        detail: `Session 10 03 rejected: ${ext.errorReason || 'No response'}`,
      };
    }

    // Step 2: Send 0x2E <DID> <DATA>
    const writePayload = `2E${cleanDid}${bytesToHex(targetBytes, '')}`;
    const wr = await session.requestUds(ecu, writePayload, 3000);
    if (!wr.ok || wr.bytes[0] !== 0x6e) {
      const seedNeeded = wr.nrc === 0x33;
      return {
        ok: false,
        didHex: cleanDid,
        writtenHex: bytesToHex(targetBytes),
        readBackHex: null,
        requiresSeedKey27: seedNeeded,
        detail: seedNeeded
          ? `BCM returned NRC 0x33 on DID ${cleanDid} — local 0x27 Seed/Key unlock required (capture handshake on Y-Splitter Sniffer tab).`
          : `Write 0x2E rejected: ${wr.errorReason || 'No 0x6E ack'}`,
      };
    }

    // Step 3: Mandatory 0x22 Read-Back Verification
    const rb = await session.requestUds(ecu, `22${cleanDid}`, 2000);
    const readBackBytes = rb.ok && rb.bytes.length >= 3 ? rb.bytes.slice(3) : null;
    const readBackHex = readBackBytes ? bytesToHex(readBackBytes) : null;
    const expectedHex = bytesToHex(targetBytes);

    if (readBackHex !== expectedHex) {
      return {
        ok: false,
        didHex: cleanDid,
        writtenHex: expectedHex,
        readBackHex,
        requiresSeedKey27: false,
        detail: `Write acked (0x6E), but 0x22 read-back (${readBackHex ?? 'none'}) differed from written bytes (${expectedHex}).`,
      };
    }

    return {
      ok: true,
      didHex: cleanDid,
      writtenHex: expectedHex,
      readBackHex,
      requiresSeedKey27: false,
      detail: `Verified: 0x6E ${cleanDid} acked & 0x22 read-back matches 100%.`,
    };
  };

  if (ecu.bus === 'CAN_IHS' || ecu.bits === 29) {
    return session.withBusSafetyRestore(ecu.bus, ecu.bits, run);
  }
  return run();
}

/**
 * 1-Click Factory As-Built Restore (VIN-free replacement for Tazer's "Unmarry"):
 * Reads current ECU DIDs, compares against `snapshot`, and writes back ONLY the DIDs that differ!
 */
export async function restoreSnapshotToEcu(
  session: ElmSession,
  ecu: EcuEndpoint,
  snapshot: AsBuiltSnapshot,
  skipReadOnlyIdentity = true
): Promise<Array<WriteDidOutcome>> {
  const outcomes: WriteDidOutcome[] = [];

  for (const [didHex, originalHex] of Object.entries(snapshot.dids)) {
    // Skip standard read-only identity DIDs (F180..F19F) during restore
    const didNum = parseInt(didHex, 16);
    if (skipReadOnlyIdentity && didNum >= 0xf180 && didNum <= 0xf19f) continue;

    // Check current bytes first so we only write DIDs that actually changed
    const current = await session.requestUds(ecu, `22${didHex}`, 1500);
    if (current.ok && current.bytes.length >= 4) {
      const currentHex = bytesToHex(current.bytes.slice(3));
      if (currentHex === originalHex) {
        continue; // Already matches factory snapshot!
      }
    }

    const res = await writeDidVerified(session, ecu, didHex, originalHex);
    outcomes.push(res);
  }

  return outcomes;
}
