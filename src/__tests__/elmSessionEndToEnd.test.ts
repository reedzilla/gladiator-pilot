import { describe, expect, it } from 'vitest';
import { restoreSnapshotToEcu, writeDidVerified } from '../lib/gladiator/codingCalibrators';
import { scanDidRange } from '../lib/gladiator/didScanner';
import { clearAllGladiatorDtcs, scanAllGladiatorModules } from '../lib/gladiator/dtcEngine';
import { pollEcoDieselFastFrame } from '../lib/gladiator/ecodieselPids';
import { detectSgwState, findModuleById } from '../lib/gladiator/moduleCatalog';
import { ElmSession } from '../lib/transport/elmSession';
import { GladiatorSimTransport } from '../lib/transport/gladiatorSimTransport';

describe('End-to-End 2021 Gladiator 3.0L EcoDiesel Session (Stock OBD vs 12+8 SGW Bypass)', () => {
  it('reads EcoDiesel telemetry & harvests BCM DIDs on stock OBD while blocking writes, then unlocks dual-bus & 0x2E coding + restore behind 12+8 bypass', async () => {
    const sim = new GladiatorSimTransport({ sgwBypassInstalled: false, replyDelayMs: 0 });
    const session = new ElmSession(sim);

    const caps = await session.initialize();
    expect(caps.supportsMsCanPins3And11).toBe(true);

    // 1. Stock OBD-II Mode: SGW 47E->47F is present & blocks 10 03 / 2E
    const sgwInline = await detectSgwState(session);
    expect(sgwInline.state).toBe('sgw_inline_readonly');
    expect(sgwInline.sgwAnswered47E).toBe(true);

    // 2. EcoDiesel Live Cockpit works through stock OBD!
    const cockpit = await pollEcoDieselFastFrame(session, true);
    expect(cockpit.rpm).toBeGreaterThan(600);
    expect(cockpit.coolantF).toBe(196);
    expect(cockpit.oilTempF).toBe(205);
    expect(cockpit.transFluidF).toBe(180);
    expect(cockpit.dpfSootPct).toBe(34.5);
    expect(cockpit.egt1PreTurboF).toBe(509);
    expect(cockpit.odometerMi).toBeGreaterThan(51000);

    // 3. Stock-OBD BCM 0x22 DID Range Harvester works!
    const bcm = findModuleById('BCM_C');
    const harvested = await scanDidRange(session, bcm, 0x0130, 0x0132);
    expect(harvested.map((d) => d.didHex)).toEqual(['0130', '0131', '0132']);
    const factory0130 = harvested[0].valueHex;
    expect(factory0130).toBe('09 D5 01 75 25 25 00 01');

    // 4. Attempting 0x2E write while SGW is in-line fails cleanly with NRC 0x33
    const blockedWrite = await writeDidVerified(
      session,
      bcm,
      '0130',
      '0A 95 01 75 25 25 00 01'
    );
    expect(blockedWrite.ok).toBe(false);
    expect(blockedWrite.requiresSeedKey27).toBe(true);

    // 5. Plug in 12+8 SGW Bypass Cable!
    sim.sgwBypassInstalled = true;
    const sgwBypassed = await detectSgwState(session);
    expect(sgwBypassed.state).toBe('bypass_active');
    expect(sgwBypassed.sgwAnswered47E).toBe(false);

    // 6. Sweep both CAN-C (incl. ABS 747->4C7) and CAN-IHS (Pins 3 & 11 @ 125k)
    const topology = await scanAllGladiatorModules(session, { includeCanIhs: true });
    const absRow = topology.find((r) => r.ecu.id === 'ABS');
    const radioRow = topology.find((r) => r.ecu.id === 'RADIO_IHS');
    expect(absRow?.online).toBe(true);
    expect(absRow?.dtcs.length).toBe(1);
    expect(radioRow?.online).toBe(true);
    // Primary CAN-C must be restored after CAN-IHS sweep!
    expect(session.activeBus).toBe('CAN_C');

    // 7. Surgical 0x2E write of 35" Tire Circumference (0A 95) + automatic 0x22 read-back verification
    const writeOk = await writeDidVerified(
      session,
      bcm,
      '0130',
      '0A 95 01 75 1C 1C 00 01'
    );
    expect(writeOk.ok).toBe(true);
    expect(writeOk.readBackHex).toBe('0A 95 01 75 1C 1C 00 01');

    // 8. 1-Click Factory As-Built Restore reverts 0130 back to original stock bytes!
    const restoreRes = await restoreSnapshotToEcu(session, bcm, {
      createdAt: Date.now(),
      label: 'Factory Baseline',
      vin: '1C6JJTAM0ML000000',
      ecuId: bcm.id,
      ecuName: bcm.shortName,
      bus: bcm.bus,
      bits: bcm.bits,
      txId: bcm.txId,
      rxId: bcm.rxId,
      scheme: bcm.scheme,
      isFactoryBaseline: true,
      dids: { '0130': factory0130 },
    });
    expect(restoreRes).toHaveLength(1);
    expect(restoreRes[0].ok).toBe(true);
    expect(restoreRes[0].readBackHex).toBe(factory0130);

    // 9. Clear All Module DTCs across CAN-C & CAN-IHS
    const onlineEcus = topology.filter((r) => r.online).map((r) => r.ecu);
    const cleared = await clearAllGladiatorDtcs(session, onlineEcus);
    expect(cleared.every((c) => c.cleared)).toBe(true);

    await session.close();
  });
});
