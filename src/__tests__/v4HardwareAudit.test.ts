import { describe, expect, it } from 'vitest';
import { BLE_DONGLE_PROFILES } from '../lib/transport/bleTransport';
import { ElmSession } from '../lib/transport/elmSession';
import { GladiatorSimTransport } from '../lib/transport/gladiatorSimTransport';
import { detectSgwState, resolveActiveBcm } from '../lib/gladiator/moduleCatalog';
import { writeDidVerified } from '../lib/gladiator/codingCalibrators';
import {
  buildMacroFromSniffedTransaction,
  PassiveUdsSnifferEngine,
} from '../lib/gladiator/udsSniffer';

describe('V4 Physical Hardware Protocol Audit', () => {
  it('registers Vgate vLinker FD+ BLE 0x18F0 (2AF0/2AF1) alongside Veepeak FFF0 & ISSC UARTs', () => {
    const vgate18f0 = BLE_DONGLE_PROFILES.find(
      (p) => p.service === '000018f0-0000-1000-8000-00805f9b34fb'
    );
    expect(vgate18f0).toBeDefined();
    expect(vgate18f0?.rx).toBe('00002af0-0000-1000-8000-00805f9b34fb');
    expect(vgate18f0?.tx).toBe('00002af1-0000-1000-8000-00805f9b34fb');

    const veepeakFff0 = BLE_DONGLE_PROFILES.find(
      (p) => p.service === '0000fff0-0000-1000-8000-00805f9b34fb'
    );
    expect(veepeakFff0).toBeDefined();
  });

  it('re-asserts ATAL across init and STP bus switches so >7-byte 0x2E BCM writes never hit DATA ERROR', async () => {
    const sim = new GladiatorSimTransport({ sgwBypassInstalled: true, replyDelayMs: 0 });
    const txLog: string[] = [];
    const session = new ElmSession(sim, {
      onLog: (e) => {
        if (e.direction === 'tx') txLog.push(e.text);
      },
    });

    await session.initialize();
    expect(txLog).toContain('ATAL');

    // Switch to CAN-IHS and back via withBusSafetyRestore, then perform an 11-byte (>7B) 0x2E write!
    await session.withBusSafetyRestore('CAN_IHS', 11, async () => {
      await session.sendCommand('ATI');
    });

    const bcm = await resolveActiveBcm(session);
    expect(bcm.id).toBe('BCM_C');

    // 2E (1B) + 0130 (2B) + 8 data bytes = 11 bytes total (>7-byte Single Frame limit!)
    const outcome = await writeDidVerified(session, bcm, '0130', '0A 89 01 C8 20 20 00 01');
    expect(outcome.ok).toBe(true);
    expect(outcome.readBackHex).toBe('0A 89 01 C8 20 20 00 01');

    await session.close();
  });

  it('auto-falls back to 29-bit BCM_29 (18DA40F1 -> 18DAF140) when 11-bit 620 is silent and restores CAN_C 11-bit', async () => {
    const sim = new GladiatorSimTransport({
      sgwBypassInstalled: true,
      bcm29OnlyMode: true,
      replyDelayMs: 0,
    });
    const session = new ElmSession(sim);
    await session.initialize();

    const activeBcm = await resolveActiveBcm(session);
    expect(activeBcm.id).toBe('BCM_29');
    expect(activeBcm.bits).toBe(29);
    expect(activeBcm.txId).toBe('18DA40F1');
    expect(activeBcm.rxId).toBe('18DAF140');
    // Must leave primary bus on CAN_C 11-bit after probing 29-bit BCM!
    expect(session.activeBus).toBe('CAN_C');

    const sgw = await detectSgwState(session, activeBcm);
    expect(sgw.state).toBe('bypass_active');

    // Multi-frame >7-byte 0x2E write + 0x22 read-back over 29-bit BCM_29!
    const wr = await writeDidVerified(session, activeBcm, '0130', '0B 04 01 E8 1E 1E 00 01');
    expect(wr.ok).toBe(true);
    expect(wr.readBackHex).toBe('0B 04 01 E8 1E 1E 00 01');

    await session.close();
  });

  it('decodes 29-bit ISO 15765-4 Y-Splitter sniffer frames and infers 18DAF1xx reply header on promotion', () => {
    const sniffer = new PassiveUdsSnifferEngine();
    const step1 = sniffer.ingestRawLine('18DA40F1 05 2F D1 20 03 01 00 00', 'CAN_C', 1000);
    expect(step1.udsTransaction).not.toBeNull();
    expect(step1.udsTransaction?.direction).toBe('request');
    expect(step1.udsTransaction?.promotableCategory).toBe('live_2f');

    const macro = buildMacroFromSniffedTransaction(step1.udsTransaction!, '29-Bit Camp Light');
    expect(macro.bits).toBe(29);
    expect(macro.txId).toBe('18DA40F1');
    expect(macro.rxId).toBe('18DAF140');
    expect(macro.scheme).toBe('iso_29bit');
    expect(macro.releaseStepsHex).toEqual(['2F D1 20 00']);
  });
});
