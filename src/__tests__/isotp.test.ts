import { describe, expect, it } from 'vitest';
import { assembleIsoTpResponse, bytesToHex, hexToBytes } from '../lib/transport/isotp';

describe('ISO-TP Multi-Frame Assembler & FCA Asymmetric Filtering', () => {
  it('reassembles unspaced single-frame reply from FCA asymmetric ABS 747 -> 4C7', () => {
    const res = assembleIsoTpResponse('4C7037F1033', { expectedRxId: '4C7', expectedBits: 11 });
    expect(res.ok).toBe(false);
    expect(res.isNegativeResponse).toBe(true);
    expect(res.responderId).toBe('4C7');
    expect(res.rejectedSid).toBe(0x10);
    expect(res.nrc).toBe(0x33);
  });

  it('reassembles multi-frame VIN (FF + 2 CF) on BCM 620 -> 504', () => {
    const raw = [
      '504101462F190314336',
      '504214A4A54414D304D',
      '504224C303030303030',
    ].join('\r');

    const res = assembleIsoTpResponse(raw, { expectedRxId: '504', expectedBits: 11 });
    expect(res.ok).toBe(true);
    expect(res.responderId).toBe('504');
    expect(res.bytes.slice(0, 3)).toEqual([0x62, 0xf1, 0x90]);
    const vin = res.bytes
      .slice(3)
      .map((b) => String.fromCharCode(b))
      .join('');
    expect(vin).toBe('1C6JJTAM0ML000000');
  });

  it('skips intermediate UDS 0x78 ResponsePending (RCRRP) when followed by 0x6E positive write ack', () => {
    const raw = ['504 03 7F 2E 78 00 00 00 00', '504 03 6E 01 30 00 00 00 00'].join('\r');
    const res = assembleIsoTpResponse(raw, { expectedRxId: '504', expectedBits: 11 });
    expect(res.ok).toBe(true);
    expect(res.responsePendingSeen).toBe(true);
    expect(res.bytes).toEqual([0x6e, 0x01, 0x30]);
  });

  it('handles 29-bit extended ISO-TP responses (18DAF140)', () => {
    const raw = '18DAF1400562043B186B0000';
    const res = assembleIsoTpResponse(raw, { expectedRxId: '18DAF140', expectedBits: 29 });
    expect(res.ok).toBe(true);
    expect(res.responderId).toBe('18DAF140');
    expect(bytesToHex(res.bytes)).toBe('62 04 3B 18 6B');
    expect(hexToBytes('62 04 3B')).toEqual([0x62, 0x04, 0x3b]);
  });
});
