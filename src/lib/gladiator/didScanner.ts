import { AsBuiltSnapshot } from '../storage/vaultDb';
import { ElmSession } from '../transport/elmSession';
import { bytesToHex, hexToBytes } from '../transport/isotp';
import { EcuEndpoint } from '../transport/types';

export interface DidScanPreset {
  id: string;
  label: string;
  startDid: number;
  endDid: number;
  description: string;
}

/**
 * Preset UDS 0x22 ReadDataByIdentifier ranges safe to scan Day 1 on the stock OBD-II port!
 */
export const DID_SCAN_PRESETS: readonly DidScanPreset[] = [
  {
    id: 'uds_identity',
    label: 'UDS Identity & Calibration (F180 – F19F)',
    startDid: 0xf180,
    endDid: 0xf19f,
    description: 'VIN, OEM Part #, SW ID, Supplier ID, Hardware #, System Name (32 DIDs, ~4s).',
  },
  {
    id: 'bcm_vehconfig_low',
    label: 'BCM VehConfig / CustConfig Primary (0100 – 0160)',
    startDid: 0x0100,
    endDid: 0x0160,
    description: 'Primary FCA body configuration & odometer registers (97 DIDs, ~12s).',
  },
  {
    id: 'stellantis_telemetry',
    label: 'Stellantis Extended Powertrain (1E00 – 1E40)',
    startDid: 0x1e00,
    endDid: 0x1e40,
    description: 'Includes 8HP75 Trans Temp (1E1C) & EcoDiesel DPF Soot % (1E30) (65 DIDs, ~8s).',
  },
  {
    id: 'fca_odo_calib',
    label: 'FCA Powertrain Accumulators (0400 – 0450)',
    startDid: 0x0400,
    endDid: 0x0450,
    description: 'Includes ECM Odometer (043B) and runtime counters (81 DIDs, ~10s).',
  },
];

export interface DidReadEntry {
  didHex: string;
  valueHex: string;
  byteLength: number;
  asciiPreview: string;
}

export function formatAsciiPreview(bytes: number[]): string {
  return bytes
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
    .join('');
}

/**
 * Sweep a range of UDS `0x22` DIDs on `ecu` (100% read-only; works through stock SGW!).
 */
export async function scanDidRange(
  session: ElmSession,
  ecu: EcuEndpoint,
  startDid: number,
  endDid: number,
  options: {
    signal?: AbortSignal;
    onProgress?: (didHex: string, index: number, total: number, hits: number) => void;
  } = {}
): Promise<DidReadEntry[]> {
  const lo = Math.max(0x0000, Math.min(startDid, endDid));
  const hi = Math.min(0xffff, Math.max(startDid, endDid));
  const total = hi - lo + 1;
  const entries: DidReadEntry[] = [];

  const execute = async () => {
    for (let did = lo; did <= hi; did++) {
      if (options.signal?.aborted) break;
      const didHex = did.toString(16).toUpperCase().padStart(4, '0');
      options.onProgress?.(didHex, did - lo + 1, total, entries.length);

      const resp = await session.requestUds(ecu, `22${didHex}`, 1100);
      if (
        resp.ok &&
        resp.bytes.length >= 4 &&
        resp.bytes[0] === 0x62 &&
        ((resp.bytes[1] << 8) | resp.bytes[2]) === did
      ) {
        const valueBytes = resp.bytes.slice(3);
        entries.push({
          didHex,
          valueHex: bytesToHex(valueBytes),
          byteLength: valueBytes.length,
          asciiPreview: formatAsciiPreview(valueBytes),
        });
      }
    }
  };

  if (ecu.bus === 'CAN_IHS' || ecu.bits === 29) {
    await session.withBusSafetyRestore(ecu.bus, ecu.bits, execute);
  } else {
    await execute();
  }

  return entries;
}

export interface BitChange {
  bit: number; // 7..0
  before: 0 | 1;
  after: 0 | 1;
}

export interface ByteDiff {
  byteIndex: number;
  beforeByte: number | null;
  afterByte: number | null;
  changedBits: BitChange[];
}

export interface DidSnapshotDiff {
  didHex: string;
  status: 'modified' | 'added' | 'removed';
  beforeHex: string;
  afterHex: string;
  byteDiffs: ByteDiff[];
}

/**
 * Compare two As-Built DID snapshots (e.g. Before vs After an Autel coding change)
 * to isolate the exact DID, byte offset, and bitmask (`b7..b0`) that flipped!
 */
export function diffSnapshots(
  before: Pick<AsBuiltSnapshot, 'dids'>,
  after: Pick<AsBuiltSnapshot, 'dids'>
): DidSnapshotDiff[] {
  const allDids = Array.from(
    new Set([...Object.keys(before.dids), ...Object.keys(after.dids)])
  ).sort();

  const diffs: DidSnapshotDiff[] = [];

  for (const didHex of allDids) {
    const bHex = before.dids[didHex] ?? '';
    const aHex = after.dids[didHex] ?? '';
    if (bHex === aHex) continue;

    if (!bHex) {
      diffs.push({ didHex, status: 'added', beforeHex: '', afterHex: aHex, byteDiffs: [] });
      continue;
    }
    if (!aHex) {
      diffs.push({ didHex, status: 'removed', beforeHex: bHex, afterHex: '', byteDiffs: [] });
      continue;
    }

    const bBytes = hexToBytes(bHex);
    const aBytes = hexToBytes(aHex);
    const maxLen = Math.max(bBytes.length, aBytes.length);
    const byteDiffs: ByteDiff[] = [];

    for (let i = 0; i < maxLen; i++) {
      const bb = i < bBytes.length ? bBytes[i] : null;
      const ab = i < aBytes.length ? aBytes[i] : null;
      if (bb === ab) continue;

      const changedBits: BitChange[] = [];
      if (bb !== null && ab !== null) {
        for (let bit = 7; bit >= 0; bit--) {
          const bBit = ((bb >> bit) & 1) as 0 | 1;
          const aBit = ((ab >> bit) & 1) as 0 | 1;
          if (bBit !== aBit) {
            changedBits.push({ bit, before: bBit, after: aBit });
          }
        }
      }
      byteDiffs.push({ byteIndex: i, beforeByte: bb, afterByte: ab, changedBits });
    }

    diffs.push({
      didHex,
      status: 'modified',
      beforeHex: bHex,
      afterHex: aHex,
      byteDiffs,
    });
  }

  return diffs;
}
