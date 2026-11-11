import { SavedUdsMacro } from '../storage/vaultDb';
import { bytesToHex, parseAdapterFrameLine, UDS_NRC_DESCRIPTIONS } from '../transport/isotp';
import { BusTarget, EcuEndpoint } from '../transport/types';
import { GLADIATOR_MODULES } from './moduleCatalog';

export interface SniffedCanFrame {
  index: number;
  timestampMs: number;
  bus: BusTarget;
  canId: string;
  dataBytes: number[];
  dataHex: string;
  isDiagnostic: boolean;
  annotation: string;
}

export interface DecodedUdsTransaction {
  id: string;
  timestampMs: number;
  bus: BusTarget;
  direction: 'request' | 'response';
  canId: string;
  pairedEcuName: string;
  sid: number;
  serviceLabel: string;
  didOrRidHex?: string;
  payloadBytes: number[];
  payloadHex: string;
  summary: string;
  promotableCategory?: SavedUdsMacro['category'];
}

const KNOWN_DIAG_CAN_IDS = new Set([
  '7DF',
  '7E0',
  '7E8',
  '7E1',
  '7E9',
  '747',
  '4C7',
  '620',
  '504',
  '47E',
  '47F',
  '742',
  '4C2',
  '744',
  '4C4',
  '75A',
  '4DA',
  '762',
  '4E2',
  '740',
  '4C0',
  '680',
  '510',
  '788',
  '789',
  '749',
  '4C9',
  '791',
  '511',
  '792',
  '512',
]);

function lookupModuleByCanId(canId: string): { ecu?: EcuEndpoint; direction: 'request' | 'response' } {
  const byTx = GLADIATOR_MODULES.find((m) => m.txId.toUpperCase() === canId);
  if (byTx) return { ecu: byTx, direction: 'request' };
  const byRx = GLADIATOR_MODULES.find((m) => m.rxId.toUpperCase() === canId);
  if (byRx) return { ecu: byRx, direction: 'response' };
  if (canId === '7DF') return { direction: 'request' };
  // ISO 15765-4 29-bit physical addressing (`18DA<TA><SA>`, tester = F1..FD):
  if (canId.length === 8 && /^18DA/i.test(canId)) {
    const ta = canId.slice(4, 6).toUpperCase();
    if (/^F[1-9A-D]$/.test(ta)) return { direction: 'response' };
    return { direction: 'request' };
  }
  // Standard 7E0..7E7 vs 7E8..7EF heuristic
  const n = parseInt(canId, 16);
  if (n >= 0x7e8 && n <= 0x7ef) return { direction: 'response' };
  return { direction: 'request' };
}

function annotateBroadcastFrame(canId: string, bytes: number[]): string {
  // Chrysler / Jeep JL/JT CAN-C reference frames (opendbc / community)
  if (canId === '102' && bytes.length >= 3) {
    return 'Broadcast: Steering Wheel Angle / Rate (0x102)';
  }
  if (canId === '202') {
    return 'Broadcast: Wheel Speeds (0x202)';
  }
  if (canId === '2D3') {
    return 'Broadcast: TPMS / Body Tire Pressures (0x2D3)';
  }
  return 'Periodic CAN Broadcast';
}

function describeUdsPayload(
  payload: number[],
  direction: 'request' | 'response'
): {
  sid: number;
  serviceLabel: string;
  didOrRidHex?: string;
  summary: string;
  promotableCategory?: SavedUdsMacro['category'];
} {
  const sid = payload[0];

  if (sid === 0x10 && payload.length >= 2) {
    const sub = payload[1].toString(16).toUpperCase().padStart(2, '0');
    return {
      sid,
      serviceLabel: 'DiagnosticSessionControl (0x10)',
      summary: `Enter Session 0x${sub} (${payload[1] === 3 ? 'Extended' : payload[1] === 1 ? 'Default' : 'Custom'})`,
    };
  }
  if (sid === 0x50 && payload.length >= 2) {
    return {
      sid,
      serviceLabel: 'Session Accepted (0x50)',
      summary: `Positive Session 0x${payload[1].toString(16).toUpperCase().padStart(2, '0')} Ready`,
    };
  }
  if (sid === 0x27 && payload.length >= 2) {
    const isSeedReq = payload[1] % 2 === 1;
    return {
      sid,
      serviceLabel: 'SecurityAccess (0x27)',
      summary: isSeedReq
        ? `Request Seed (Level 0x${payload[1].toString(16).toUpperCase().padStart(2, '0')})`
        : `Send Key (${bytesToHex(payload.slice(2))})`,
    };
  }
  if (sid === 0x67 && payload.length >= 2) {
    const isSeedReply = payload[1] % 2 === 1;
    return {
      sid,
      serviceLabel: 'SecurityAccess Reply (0x67)',
      summary: isSeedReply
        ? `Seed Issued: ${bytesToHex(payload.slice(2))}`
        : 'Security Unlocked!',
    };
  }
  if (sid === 0x22 && payload.length >= 3) {
    const did = bytesToHex([payload[1], payload[2]], '');
    return {
      sid,
      serviceLabel: 'ReadDataByIdentifier (0x22)',
      didOrRidHex: did,
      summary: `Read DID 0x${did}`,
    };
  }
  if (sid === 0x62 && payload.length >= 3) {
    const did = bytesToHex([payload[1], payload[2]], '');
    return {
      sid,
      serviceLabel: 'Read DID Reply (0x62)',
      didOrRidHex: did,
      summary: `DID 0x${did} = ${bytesToHex(payload.slice(3))} (${payload.length - 3}B)`,
    };
  }
  if (sid === 0x2e && payload.length >= 4) {
    const did = bytesToHex([payload[1], payload[2]], '');
    return {
      sid,
      serviceLabel: 'WriteDataByIdentifier (0x2E)',
      didOrRidHex: did,
      summary: `WRITE DID 0x${did} <= ${bytesToHex(payload.slice(3))}`,
      promotableCategory: direction === 'request' ? 'coding_2e' : undefined,
    };
  }
  if (sid === 0x6e && payload.length >= 3) {
    const did = bytesToHex([payload[1], payload[2]], '');
    return {
      sid,
      serviceLabel: 'Write DID Ack (0x6E)',
      didOrRidHex: did,
      summary: `DID 0x${did} Write Confirmed!`,
    };
  }
  if (sid === 0x2f && payload.length >= 4) {
    const did = bytesToHex([payload[1], payload[2]], '');
    return {
      sid,
      serviceLabel: 'IOControlByIdentifier (0x2F)',
      didOrRidHex: did,
      summary: `Actuate 0x${did} (ctrl=0x${payload[3].toString(16).toUpperCase().padStart(2, '0')}) ${bytesToHex(payload.slice(4))}`,
      promotableCategory: direction === 'request' ? 'live_2f' : undefined,
    };
  }
  if (sid === 0x31 && payload.length >= 4) {
    const rid = bytesToHex([payload[2], payload[3]], '');
    return {
      sid,
      serviceLabel: 'RoutineControl (0x31)',
      didOrRidHex: rid,
      summary: `Routine 0x${rid} (sub=0x${payload[1].toString(16).toUpperCase().padStart(2, '0')}) ${bytesToHex(payload.slice(4))}`,
      promotableCategory: direction === 'request' ? 'routine_31' : undefined,
    };
  }
  if (sid === 0x71 && payload.length >= 4) {
    const rid = bytesToHex([payload[2], payload[3]], '');
    return {
      sid,
      serviceLabel: 'Routine Reply (0x71)',
      didOrRidHex: rid,
      summary: `Routine 0x${rid} Positive Reply (${bytesToHex(payload.slice(4)) || 'OK'})`,
    };
  }
  if (sid === 0x7f && payload.length >= 3) {
    const nrc = payload[2];
    return {
      sid,
      serviceLabel: 'Negative Response (0x7F)',
      summary: `Rejected SID 0x${payload[1].toString(16).toUpperCase()} -> NRC 0x${nrc
        .toString(16)
        .toUpperCase()
        .padStart(2, '0')} (${UDS_NRC_DESCRIPTIONS[nrc] || 'NRC'})`,
    };
  }

  return {
    sid,
    serviceLabel: `UDS 0x${sid.toString(16).toUpperCase().padStart(2, '0')}`,
    summary: bytesToHex(payload),
  };
}

/**
 * Stateful Passive ISO-TP & UDS Reassembler for Y-Splitter CAN captures (`STMA` / `ATMA`).
 * Watches raw bus frames and emits both per-frame annotations and reassembled multi-frame UDS transactions!
 */
export class PassiveUdsSnifferEngine {
  private frameCounter = 0;
  private multiFrameBuffers = new Map<string, { targetLen: number; bytes: number[] }>();

  public ingestRawLine(
    rawLine: string,
    bus: BusTarget,
    timestampMs = Date.now()
  ): {
    frame: SniffedCanFrame | null;
    udsTransaction: DecodedUdsTransaction | null;
  } {
    const parsed = parseAdapterFrameLine(rawLine);
    if (!parsed || !parsed.canId || parsed.dataBytes.length === 0) {
      return { frame: null, udsTransaction: null };
    }

    const canId = parsed.canId.toUpperCase();
    const d = parsed.dataBytes;
    const isDiag = KNOWN_DIAG_CAN_IDS.has(canId) || /^(18DA|18DB)/.test(canId);

    this.frameCounter++;
    let frameAnnotation = isDiag ? 'ISO-TP / Diagnostic' : annotateBroadcastFrame(canId, d);
    let completedPayload: number[] | null = null;

    if (isDiag) {
      const pci = (d[0] >> 4) & 0x0f;
      if (pci === 0x0) {
        const len = d[0] & 0x0f;
        if (len > 0 && len <= d.length - 1) {
          completedPayload = d.slice(1, 1 + len);
          frameAnnotation = `ISO-TP SF (${len}B)`;
        }
      } else if (pci === 0x1 && d.length >= 3) {
        const targetLen = ((d[0] & 0x0f) << 8) | d[1];
        this.multiFrameBuffers.set(canId, { targetLen, bytes: d.slice(2) });
        frameAnnotation = `ISO-TP FF (${targetLen}B total)`;
      } else if (pci === 0x2) {
        const state = this.multiFrameBuffers.get(canId);
        frameAnnotation = `ISO-TP CF #${d[0] & 0x0f}`;
        if (state) {
          state.bytes.push(...d.slice(1));
          if (state.bytes.length >= state.targetLen) {
            completedPayload = state.bytes.slice(0, state.targetLen);
            this.multiFrameBuffers.delete(canId);
          }
        }
      } else if (pci === 0x3) {
        frameAnnotation = 'ISO-TP Flow Control (CTS)';
      }
    }

    let udsTransaction: DecodedUdsTransaction | null = null;
    if (completedPayload && completedPayload.length > 0) {
      const { ecu, direction } = lookupModuleByCanId(canId);
      const desc = describeUdsPayload(completedPayload, direction);
      frameAnnotation = desc.summary;
      udsTransaction = {
        id: `uds-${this.frameCounter}-${timestampMs}`,
        timestampMs,
        bus,
        direction,
        canId,
        pairedEcuName: ecu?.shortName || `ECU ${canId}`,
        sid: desc.sid,
        serviceLabel: desc.serviceLabel,
        didOrRidHex: desc.didOrRidHex,
        payloadBytes: completedPayload,
        payloadHex: bytesToHex(completedPayload),
        summary: desc.summary,
        promotableCategory: desc.promotableCategory,
      };
    }

    const frame: SniffedCanFrame = {
      index: this.frameCounter,
      timestampMs,
      bus,
      canId,
      dataBytes: d,
      dataHex: bytesToHex(d),
      isDiagnostic: isDiag,
      annotation: frameAnnotation,
    };

    return { frame, udsTransaction };
  }

  public reset(): void {
    this.frameCounter = 0;
    this.multiFrameBuffers.clear();
  }
}

/**
 * Promote a captured UDS `0x2E` / `0x2F` / `0x31` request from the Y-Splitter Sniffer into a reusable 1-click macro!
 */
export function buildMacroFromSniffedTransaction(
  tx: DecodedUdsTransaction,
  customName?: string
): Omit<SavedUdsMacro, 'id'> {
  const ecu = GLADIATOR_MODULES.find(
    (m) => m.txId.toUpperCase() === tx.canId && m.bus === tx.bus
  );
  const category = tx.promotableCategory || 'routine_31';

  // For 0x2F IOControl (`2F HH LL 03 ...`), automatically build a `2F HH LL 00` ReturnControlToECU release step!
  let releaseStepsHex: string[] | undefined;
  if (tx.sid === 0x2f && tx.payloadBytes.length >= 4) {
    releaseStepsHex = [bytesToHex([0x2f, tx.payloadBytes[1], tx.payloadBytes[2], 0x00])];
  }

  const is29Bit = tx.canId.length === 8;
  const inferred29Rx =
    is29Bit && /^18DA[0-9A-F]{4}$/i.test(tx.canId)
      ? `18DA${tx.canId.slice(6, 8)}${tx.canId.slice(4, 6)}`.toUpperCase()
      : '18DAF140';

  return {
    createdAt: Date.now(),
    name:
      customName?.trim() ||
      `${ecu?.shortName || tx.canId}: ${tx.summary.slice(0, 44)}`,
    category,
    bus: tx.bus,
    bits: is29Bit ? 29 : 11,
    txId: ecu?.txId || tx.canId,
    rxId: ecu?.rxId || (is29Bit ? inferred29Rx : '504'),
    scheme: ecu?.scheme || (is29Bit ? 'iso_29bit' : 'fca_asymmetric'),
    stepsHex: ['10 03', tx.payloadHex],
    releaseStepsHex,
    provenance: 'sniffer_captured',
    notes: `Captured live on ${tx.bus} at ${new Date(tx.timestampMs).toLocaleTimeString()}`,
  };
}

export function exportSnifferFramesCsv(frames: readonly SniffedCanFrame[]): string {
  const header = 'Index,TimestampISO,Bus,CAN_ID,DataHex,Diagnostic,Annotation';
  const rows = frames.map((f) =>
    [
      f.index,
      new Date(f.timestampMs).toISOString(),
      f.bus,
      f.canId,
      `"${f.dataHex}"`,
      f.isDiagnostic ? 'YES' : 'NO',
      `"${f.annotation.replace(/"/g, '""')}"`,
    ].join(',')
  );
  return [header, ...rows].join('\n');
}
