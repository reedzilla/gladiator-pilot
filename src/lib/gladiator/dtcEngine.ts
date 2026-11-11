import { ElmSession } from '../transport/elmSession';
import { EcuEndpoint } from '../transport/types';
import { GLADIATOR_MODULES } from './moduleCatalog';

export interface DecodedDtc {
  code: string;
  ftbHex: string;
  statusByte: number;
  active: boolean;
  stored: boolean;
}

export interface ModuleScanResult {
  ecu: EcuEndpoint;
  online: boolean;
  skippedReason?: string;
  partNumber?: string;
  softwareId?: string;
  vin?: string;
  dtcs: DecodedDtc[];
}

const DTC_PREFIX = ['P', 'C', 'B', 'U'] as const;

export function decodeUds1902Dtcs(bytes: number[]): DecodedDtc[] {
  // Positive response to `19 02 AF`: `59 02 <availabilityMask> [DTC_Hi DTC_Mid DTC_FTB Status]...`
  if (bytes.length < 3 || bytes[0] !== 0x59 || bytes[1] !== 0x02) return [];
  const list: DecodedDtc[] = [];
  for (let i = 3; i + 3 < bytes.length; i += 4) {
    const hi = bytes[i];
    const mid = bytes[i + 1];
    const ftb = bytes[i + 2];
    const status = bytes[i + 3];
    if (hi === 0 && mid === 0 && ftb === 0) continue;

    const prefix = DTC_PREFIX[(hi >> 6) & 0x03];
    const d1 = ((hi >> 4) & 0x03).toString(10);
    const d2 = (hi & 0x0f).toString(16).toUpperCase();
    const d3 = ((mid >> 4) & 0x0f).toString(16).toUpperCase();
    const d4 = (mid & 0x0f).toString(16).toUpperCase();
    const ftbHex = ftb.toString(16).toUpperCase().padStart(2, '0');

    list.push({
      code: `${prefix}${d1}${d2}${d3}${d4}-${ftbHex}`,
      ftbHex,
      statusByte: status,
      active: (status & 0x01) !== 0,
      stored: (status & 0x08) !== 0,
    });
  }
  return list;
}

function decodeAsciiDid(bytes: number[]): string | undefined {
  if (bytes.length <= 3 || bytes[0] !== 0x62) return undefined;
  const ascii = bytes
    .slice(3)
    .filter((b) => b >= 0x20 && b <= 0x7e)
    .map((b) => String.fromCharCode(b))
    .join('')
    .trim();
  return ascii || undefined;
}

/**
 * Sweep Gladiator modules across CAN-C (500 kbps) and — when vLinker FD+ + 12+8 bypass are present —
 * CAN-IHS (125 kbps on Pins 3 & 11), returning live presence, OEM Part #, SW ID, and UDS 0x19 DTCs.
 */
export async function scanAllGladiatorModules(
  session: ElmSession,
  options: {
    includeCanIhs: boolean;
    onProgress?: (current: number, total: number, ecu: EcuEndpoint) => void;
  }
): Promise<ModuleScanResult[]> {
  const results: ModuleScanResult[] = [];
  const total = GLADIATOR_MODULES.length;
  let idx = 0;

  const canCModules = GLADIATOR_MODULES.filter((m) => m.bus === 'CAN_C');
  const canIhsModules = GLADIATOR_MODULES.filter((m) => m.bus === 'CAN_IHS');

  const probeOne = async (ecu: EcuEndpoint): Promise<ModuleScanResult> => {
    const ping = await session.requestUds(ecu, '3E00', 900);
    let online = ping.ok || ping.isNegativeResponse;

    let partNumber: string | undefined;
    let softwareId: string | undefined;
    let vin: string | undefined;
    let dtcs: DecodedDtc[] = [];

    // Some FCA modules ignore 3E00 in default session but answer 22 F1 87 or 19 02 AF directly
    const partResp = await session.requestUds(ecu, '22F187', 1000);
    if (partResp.ok) {
      online = true;
      partNumber = decodeAsciiDid(partResp.bytes);
    }

    if (online) {
      const swResp = await session.requestUds(ecu, '22F188', 1000);
      if (swResp.ok) softwareId = decodeAsciiDid(swResp.bytes);

      const vinResp = await session.requestUds(ecu, '22F190', 1000);
      if (vinResp.ok) vin = decodeAsciiDid(vinResp.bytes);

      const dtcResp = await session.requestUds(ecu, '1902AF', 1500);
      if (dtcResp.ok) {
        dtcs = decodeUds1902Dtcs(dtcResp.bytes);
      }
    }

    return { ecu, online, partNumber, softwareId, vin, dtcs };
  };

  for (const ecu of canCModules) {
    idx++;
    options.onProgress?.(idx, total, ecu);
    if (ecu.bits === 29) {
      const res = await session.withBusSafetyRestore('CAN_C', 29, () => probeOne(ecu));
      results.push(res);
    } else {
      results.push(await probeOne(ecu));
    }
  }

  const canIhsTargetList: EcuEndpoint[] = [];
  for (const ecu of canIhsModules) {
    if (!options.includeCanIhs) {
      idx++;
      options.onProgress?.(idx, total, ecu);
      results.push({
        ecu,
        online: false,
        skippedReason: 'Skipped (CAN-IHS disabled)',
        dtcs: [],
      });
    } else if (!session.capabilities?.supportsMsCanPins3And11) {
      idx++;
      options.onProgress?.(idx, total, ecu);
      results.push({
        ecu,
        online: false,
        skippedReason: 'Requires vLinker FD+ (Pins 3 & 11 MS-CAN hardware)',
        dtcs: [],
      });
    } else {
      canIhsTargetList.push(ecu);
    }
  }

  // Batch all CAN-IHS (Pins 3 & 11 @ 125 kbps) probes into ONE STP 53 excursion with guaranteed finally restore!
  if (canIhsTargetList.length > 0) {
    await session.withBusSafetyRestore('CAN_IHS', 11, async () => {
      for (const ecu of canIhsTargetList) {
        idx++;
        options.onProgress?.(idx, total, ecu);
        results.push(await probeOne(ecu));
      }
    });
  }

  return results;
}

/**
 * Clear DTCs (`14 FF FF FF`) across all online modules on CAN-C & CAN-IHS.
 * Requires 12+8 SGW Bypass (otherwise SGW rejects `0x14` with NRC `0x33`).
 */
export async function clearAllGladiatorDtcs(
  session: ElmSession,
  targets: EcuEndpoint[]
): Promise<Array<{ ecu: EcuEndpoint; cleared: boolean; detail: string }>> {
  const report: Array<{ ecu: EcuEndpoint; cleared: boolean; detail: string }> = [];

  const runClearOne = async (ecu: EcuEndpoint) => {
    const resp = await session.requestUds(ecu, '14FFFFFF', 2200);
    if (resp.ok && resp.bytes[0] === 0x54) {
      return { ecu, cleared: true, detail: 'Cleared (0x54)' };
    }
    return {
      ecu,
      cleared: false,
      detail: resp.errorReason || 'Rejected',
    };
  };

  const canC11 = targets.filter((t) => t.bus === 'CAN_C' && t.bits === 11);
  const canC29 = targets.filter((t) => t.bus === 'CAN_C' && t.bits === 29);
  const canIhs = targets.filter((t) => t.bus === 'CAN_IHS');

  for (const ecu of canC11) {
    report.push(await runClearOne(ecu));
  }

  if (canC29.length > 0) {
    await session.withBusSafetyRestore('CAN_C', 29, async () => {
      for (const ecu of canC29) {
        report.push(await runClearOne(ecu));
      }
    });
  }

  if (canIhs.length > 0) {
    await session.withBusSafetyRestore('CAN_IHS', 11, async () => {
      for (const ecu of canIhs) {
        report.push(await runClearOne(ecu));
      }
    });
  }

  return report;
}
