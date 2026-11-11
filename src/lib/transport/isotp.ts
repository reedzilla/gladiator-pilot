/**
 * isotp.ts — Clean-room ISO 15765-2 (ISO-TP) Multi-Frame Assembler & UDS Reply Classifier
 *
 * Handles:
 *  - 11-bit headers (`7E8`, FCA `-0x280` `4C7`, SGW `+1` `47F`, BCM `504`)
 *  - 29-bit headers (`18DAF110`, `18DAF140`)
 *  - Spaces-off (`ATS0`) and spaces-on (`ATS1`) adapter output
 *  - Single Frame (`0N ...`), First Frame (`1N NN ...`) + Consecutive Frames (`21 ...`, `22 ...`, wrap `20 ...`)
 *  - ELM327 length-header responses when `ATH0` is active
 *  - UDS Negative Response `7F <SID> 78` (ResponsePending / RCRRP) skip when followed by final reply
 */

export interface ParsedCanLine {
  canId: string | null;
  dataBytes: number[];
  rawLine: string;
}

export interface UdsResponse {
  ok: boolean;
  responderId: string | null;
  /** Assembled UDS payload bytes (starting with positive SID e.g. 0x62 or 0x7F) */
  bytes: number[];
  hex: string;
  isNegativeResponse: boolean;
  rejectedSid?: number;
  nrc?: number;
  nrcName?: string;
  responsePendingSeen: boolean;
  rawLines: string[];
  errorReason?: string;
}

export const UDS_NRC_DESCRIPTIONS: Record<number, string> = {
  0x10: 'General Reject',
  0x11: 'Service Not Supported',
  0x12: 'Sub-Function Not Supported',
  0x13: 'Incorrect Message Length / Invalid Format',
  0x14: 'Response Too Long',
  0x21: 'Busy Repeat Request',
  0x22: 'Conditions Not Correct (check KOEO / 0 mph / gear)',
  0x24: 'Request Sequence Error',
  0x31: 'Request Out Of Range (DID/RID not supported on this trim)',
  0x33: 'Security Access Denied (SGW firewall or 0x27 Seed/Key required)',
  0x35: 'Invalid Key',
  0x36: 'Exceeded Number Of Attempts',
  0x37: 'Required Time Delay Not Expired',
  0x72: 'General Programming Failure',
  0x78: 'Request Correctly Received — Response Pending (RCRRP)',
  0x7e: 'Sub-Function Not Supported In Active Session (need 10 03)',
  0x7f: 'Service Not Supported In Active Session (need 10 03)',
};

const ADAPTER_CHATTER_RE =
  /^(SEARCHING\.{0,3}|NO DATA|STOPPED|BUFFER FULL|CAN ERROR|BUS INIT.*|UNABLE TO CONNECT|FB ERROR|DATA ERROR|ACT ALERT|LP ALERT|\?|OK|>)$/i;

export function bytesToHex(bytes: readonly number[], sep = ' '): string {
  return bytes.map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, '0')).join(sep);
}

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  if (clean.length % 2 !== 0) return [];
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Parse a single line from an ELM327 / STN / V-LINK01 response when ATH1 is enabled.
 * Supports both spaced ("4C7 03 7F 22 31") and unspaced ("4C7037F2231" or "18DAF1400662F190...")
 */
export function parseAdapterFrameLine(line: string, expectedBits?: 11 | 29): ParsedCanLine | null {
  const trimmed = line.replace(/>/g, '').trim();
  if (!trimmed || ADAPTER_CHATTER_RE.test(trimmed)) return null;
  // Ignore standalone ISO-TP byte-count lines like "014" (3 hex digits only, no payload)
  if (/^[0-9A-Fa-f]{3}$/.test(trimmed)) return null;
  // Ignore multi-frame colon lines handled separately if needed ("0: 62 F1 90 ...")
  if (/^[0-9A-Fa-f]:\s*/.test(trimmed)) {
    const afterColon = trimmed.replace(/^[0-9A-Fa-f]:\s*/, '');
    return { canId: null, dataBytes: hexToBytes(afterColon), rawLine: trimmed };
  }

  // Spaced tokens path
  if (trimmed.includes(' ')) {
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2 && /^[0-9A-Fa-f]{3}$/.test(tokens[0])) {
      const id = tokens[0].toUpperCase();
      const bytes = hexToBytes(tokens.slice(1).join(''));
      if (bytes.length > 0) return { canId: id, dataBytes: bytes, rawLine: trimmed };
    }
    if (tokens.length >= 2 && /^[0-9A-Fa-f]{8}$/.test(tokens[0])) {
      const id = tokens[0].toUpperCase();
      const bytes = hexToBytes(tokens.slice(1).join(''));
      if (bytes.length > 0) return { canId: id, dataBytes: bytes, rawLine: trimmed };
    }
    // Spaced 29-bit header (4 bytes: "18 DA F1 10 03 62 ...")
    if (
      tokens.length >= 5 &&
      tokens.slice(0, 4).every((t) => /^[0-9A-Fa-f]{2}$/.test(t)) &&
      (expectedBits === 29 || /^(18|14|0C)/i.test(tokens[0]))
    ) {
      const id = tokens.slice(0, 4).join('').toUpperCase();
      const bytes = hexToBytes(tokens.slice(4).join(''));
      if (bytes.length > 0) return { canId: id, dataBytes: bytes, rawLine: trimmed };
    }
    const rawBytes = hexToBytes(tokens.join(''));
    return rawBytes.length > 0 ? { canId: null, dataBytes: rawBytes, rawLine: trimmed } : null;
  }

  // Unspaced hex string (ATS0 + ATH1)
  if (!/^[0-9A-Fa-f]+$/.test(trimmed)) return null;

  // 11-bit CAN ID = 3 hex chars + 2..16 hex chars (1..8 data bytes) -> odd total length >= 5!
  if (trimmed.length >= 5 && trimmed.length <= 19 && trimmed.length % 2 === 1 && expectedBits !== 29) {
    return {
      canId: trimmed.slice(0, 3).toUpperCase(),
      dataBytes: hexToBytes(trimmed.slice(3)),
      rawLine: trimmed,
    };
  }

  // 29-bit CAN ID = 8 hex chars + 2..16 hex chars (1..8 data bytes) -> even length 10..24
  if (
    trimmed.length >= 10 &&
    trimmed.length <= 24 &&
    trimmed.length % 2 === 0 &&
    (expectedBits === 29 || /^(18DA|18DB|14DA)/i.test(trimmed))
  ) {
    return {
      canId: trimmed.slice(0, 8).toUpperCase(),
      dataBytes: hexToBytes(trimmed.slice(8)),
      rawLine: trimmed,
    };
  }

  // Headerless even-length hex (ATH0 fallback)
  if (trimmed.length >= 2 && trimmed.length % 2 === 0) {
    return { canId: null, dataBytes: hexToBytes(trimmed), rawLine: trimmed };
  }

  return null;
}

/**
 * Reassemble ISO-TP frames from raw ELM/STN output and classify the UDS payload.
 * Filters by `expectedRxId` when provided (vital for FCA asymmetric replies like 747 -> 4C7).
 */
export function assembleIsoTpResponse(
  rawText: string,
  options: { expectedRxId?: string; expectedBits?: 11 | 29 } = {}
): UdsResponse {
  const rawLines = rawText
    .split(/[\r\n]+/)
    .map((l) => l.replace(/>/g, '').trim())
    .filter(Boolean);

  if (rawLines.some((l) => /NO DATA/i.test(l)) && rawLines.length === 1) {
    return {
      ok: false,
      responderId: null,
      bytes: [],
      hex: '',
      isNegativeResponse: false,
      responsePendingSeen: false,
      rawLines,
      errorReason: 'NO DATA',
    };
  }

  if (rawLines.some((l) => /CAN ERROR|BUS INIT.*ERROR|UNABLE TO CONNECT|BUFFER FULL/i.test(l))) {
    const errLine = rawLines.find((l) => /CAN ERROR|BUS INIT|UNABLE TO CONNECT|BUFFER FULL/i.test(l));
    return {
      ok: false,
      responderId: null,
      bytes: [],
      hex: '',
      isNegativeResponse: false,
      responsePendingSeen: false,
      rawLines,
      errorReason: errLine || 'BUS ERROR',
    };
  }

  const normExpectedRx = options.expectedRxId?.toUpperCase() || null;
  const parsedFrames = rawLines
    .map((l) => parseAdapterFrameLine(l, options.expectedBits))
    .filter((f): f is ParsedCanLine => f !== null)
    .filter((f) => !normExpectedRx || !f.canId || f.canId === normExpectedRx);

  if (parsedFrames.length === 0) {
    return {
      ok: false,
      responderId: null,
      bytes: [],
      hex: '',
      isNegativeResponse: false,
      responsePendingSeen: false,
      rawLines,
      errorReason: rawLines.join(' | ') || 'EMPTY RESPONSE',
    };
  }

  // Group frames by responder CAN ID (or '__anon' if ATH0)
  const responderOrder: string[] = [];
  const byResponder = new Map<string, ParsedCanLine[]>();
  for (const frame of parsedFrames) {
    const key = frame.canId ?? '__anon';
    if (!byResponder.has(key)) {
      byResponder.set(key, []);
      responderOrder.push(key);
    }
    byResponder.get(key)!.push(frame);
  }

  const chosenKey = normExpectedRx && byResponder.has(normExpectedRx) ? normExpectedRx : responderOrder[0];
  const frames = byResponder.get(chosenKey)!;
  const responderId = chosenKey === '__anon' ? null : chosenKey;

  // Assemble candidate messages (an ECU may emit SF `03 7F 2E 78` followed by SF `03 6E ...` or FF+CF)
  const messages: number[][] = [];
  let pendingBuf: number[] | null = null;
  let pendingTargetLen = 0;
  let expectedSeq = 1;

  for (const frame of frames) {
    const d = frame.dataBytes;
    if (d.length === 0) continue;

    // Headerless colon-reassembled or direct payload fallback when ATH0 was active
    if (frame.canId === null && frame.rawLine.includes(':')) {
      if (!pendingBuf) pendingBuf = [];
      pendingBuf.push(...d);
      continue;
    }

    const pciType = (d[0] >> 4) & 0x0f;

    if (pciType === 0x0) {
      const sfLen = d[0] & 0x0f;
      if (sfLen > 0 && sfLen <= d.length - 1) {
        if (pendingBuf && pendingBuf.length > 0) {
          messages.push(pendingBuf.slice(0, pendingTargetLen || pendingBuf.length));
          pendingBuf = null;
        }
        messages.push(d.slice(1, 1 + sfLen));
        continue;
      }
      // ATH0 unframed single-line fallback (e.g. "62F190...")
      if (frame.canId === null) {
        messages.push(d);
      }
    } else if (pciType === 0x1 && d.length >= 3) {
      if (pendingBuf && pendingBuf.length > 0) {
        messages.push(pendingBuf.slice(0, pendingTargetLen || pendingBuf.length));
      }
      pendingTargetLen = ((d[0] & 0x0f) << 8) | d[1];
      pendingBuf = d.slice(2);
      expectedSeq = 1;
    } else if (pciType === 0x2 && pendingBuf !== null) {
      const seq = d[0] & 0x0f;
      // Accept strictly sequential or permissive if an adapter skipped echo
      if (seq === expectedSeq || pendingBuf.length < pendingTargetLen) {
        pendingBuf.push(...d.slice(1));
        expectedSeq = (seq + 1) & 0x0f;
        if (pendingBuf.length >= pendingTargetLen) {
          messages.push(pendingBuf.slice(0, pendingTargetLen));
          pendingBuf = null;
        }
      }
    } else if (frame.canId === null) {
      // Unframed ATH0 line (e.g., Mode 01 "41 0C 0F A0")
      messages.push(d);
    }
  }

  if (pendingBuf && pendingBuf.length > 0) {
    messages.push(pendingBuf.slice(0, pendingTargetLen || pendingBuf.length));
  }

  if (messages.length === 0) {
    return {
      ok: false,
      responderId,
      bytes: [],
      hex: '',
      isNegativeResponse: false,
      responsePendingSeen: false,
      rawLines,
      errorReason: 'UNPARSEABLE ISO-TP FRAME',
    };
  }

  // Filter out intermediate UDS 0x78 (ResponsePending) if a subsequent final message arrived
  let responsePendingSeen = false;
  const nonPending = messages.filter((m) => {
    if (m.length >= 3 && m[0] === 0x7f && m[2] === 0x78) {
      responsePendingSeen = true;
      return false;
    }
    return true;
  });

  const finalPayload = nonPending.length > 0 ? nonPending[nonPending.length - 1] : messages[messages.length - 1];
  const hex = bytesToHex(finalPayload);

  if (finalPayload[0] === 0x7f && finalPayload.length >= 3) {
    const rejectedSid = finalPayload[1];
    const nrc = finalPayload[2];
    const nrcName = UDS_NRC_DESCRIPTIONS[nrc] || `Unknown NRC (0x${nrc.toString(16).toUpperCase().padStart(2, '0')})`;
    return {
      ok: false,
      responderId,
      bytes: finalPayload,
      hex,
      isNegativeResponse: true,
      rejectedSid,
      nrc,
      nrcName,
      responsePendingSeen,
      rawLines,
      errorReason: `NRC 0x${nrc.toString(16).toUpperCase().padStart(2, '0')}: ${nrcName}`,
    };
  }

  return {
    ok: true,
    responderId,
    bytes: finalPayload,
    hex,
    isNegativeResponse: false,
    responsePendingSeen,
    rawLines,
  };
}
