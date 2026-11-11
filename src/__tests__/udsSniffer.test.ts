import { describe, expect, it } from 'vitest';
import {
  buildMacroFromSniffedTransaction,
  PassiveUdsSnifferEngine,
} from '../lib/gladiator/udsSniffer';

describe('Passive Y-Splitter UDS Sniffer & Macro Promoter', () => {
  it('reassembles multi-frame BCM 0x2E write and promotes 0x2F with automatic ReturnControl release', () => {
    const engine = new PassiveUdsSnifferEngine();

    // Multi-frame write on BCM 620 -> 504
    const r1 = engine.ingestRawLine('620 10 09 2E 01 31 01 11 04', 'CAN_C');
    expect(r1.udsTransaction).toBeNull();
    const r2 = engine.ingestRawLine('504 30 00 00 00 00 00 00 00', 'CAN_C');
    expect(r2.frame?.annotation).toContain('Flow Control');
    const r3 = engine.ingestRawLine('620 21 01 00 00 00 00 00 00', 'CAN_C');

    expect(r3.udsTransaction).not.toBeNull();
    expect(r3.udsTransaction?.sid).toBe(0x2e);
    expect(r3.udsTransaction?.didOrRidHex).toBe('0131');
    expect(r3.udsTransaction?.promotableCategory).toBe('coding_2e');

    // Single-frame 0x2F IOControl actuation on BCM
    const io = engine.ingestRawLine('620 05 2F D1 20 03 01 00 00', 'CAN_C');
    expect(io.udsTransaction?.promotableCategory).toBe('live_2f');

    const macro = buildMacroFromSniffedTransaction(io.udsTransaction!, 'Fog Light Actuate');
    expect(macro.txId).toBe('620');
    expect(macro.rxId).toBe('504');
    expect(macro.stepsHex).toEqual(['10 03', '2F D1 20 03 01']);
    expect(macro.releaseStepsHex).toEqual(['2F D1 20 00']);
  });
});
