import { describe, expect, it } from 'vitest';
import { describeJeepDtc } from '../lib/gladiator/dtcDescriptions';
import { EcoDieselSnapshot, pollEcoDieselFastFrame } from '../lib/gladiator/ecodieselPids';
import { evaluateStage2Alerts, exportTelemetryCsv } from '../lib/gladiator/telemetryLogger';
import { ElmSession } from '../lib/transport/elmSession';
import { GladiatorSimTransport } from '../lib/transport/gladiatorSimTransport';

describe('V3 Apex Overland & Stage 2 EcoDiesel Upgrades', () => {
  it('polls fast-loop & thermal-loop with ELM single-frame hint (" 1") in Stage 2 mode', async () => {
    const txLog: string[] = [];
    const sim = new GladiatorSimTransport({ sgwBypassInstalled: true, replyDelayMs: 0 });
    const session = new ElmSession(sim, {
      onLog: (e) => {
        if (e.direction === 'tx') txLog.push(e.text);
      },
    });
    await session.initialize();

    // Fast tick with slow thermal DIDs enabled
    const fullSnap = await pollEcoDieselFastFrame(session, true, true);
    expect(fullSnap.rpm).toBeGreaterThan(600);
    expect(fullSnap.boostPsi).not.toBeNull();
    expect(fullSnap.egt1PreTurboF).toBeGreaterThan(400);
    expect(fullSnap.intakeTempF).toBe(93);
    expect(fullSnap.dpfSootPct).toBeNull(); // Skipped in Stage 2 Delete mode!

    // Verify ELM single-frame fast-return hint ("010C 1") was emitted
    expect(txLog).toContain('010C 1');
    expect(txLog).toContain('0123 1');
    // Multi-frame 0170 and 0178 must NOT use " 1" single-frame truncation!
    expect(txLog).toContain('0170');
    expect(txLog).toContain('0178');
    expect(txLog).not.toContain('0170 1');
    expect(txLog).not.toContain('0178 1');

    await session.close();
  });

  it('evaluates Stage 2 thermal/voltage alerts and exports valid CSV telemetry', () => {
    const mockSnap: EcoDieselSnapshot = {
      updatedAt: 1700000000000,
      rpm: 2450,
      speedMph: 68.5,
      boostPsi: 33.4,
      intakeTempF: 112,
      coolantF: 210,
      oilTempF: 224,
      transFluidF: 229,
      egt1PreTurboF: 1415,
      egt2DocOutF: null,
      egt3DpfInF: null,
      egt4DpfOutF: null,
      dpfSootPct: null,
      dpfDiffPsi: null,
      regenActive: null,
      railPressurePsi: 26800,
      engineLoadPct: 88,
      batteryVolts: 11.6,
      odometerMi: 41200,
      odometerSource: 'SAE 01A6',
    };

    const alerts = evaluateStage2Alerts(mockSnap);
    expect(alerts.some((a) => a.id === 'egt1_crit' && a.severity === 'critical')).toBe(true);
    expect(alerts.some((a) => a.id === 'tft_warn')).toBe(true);
    expect(alerts.some((a) => a.id === 'volt_warn')).toBe(true);

    const csv = exportTelemetryCsv([{ ...mockSnap, gpsMph: 68.6 }]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('egt1_pre_turbo_f,rail_pressure_psi');
    expect(lines[1]).toContain('2450,68.5,68.6,33.4,1415,26800');
  });

  it('maps Jeep JT & 3.0L EcoDiesel DTCs to plain-English explanations & Stage 2 hints', () => {
    const cp4 = describeJeepDtc('P0087-00');
    expect(cp4?.title).toContain('Fuel Rail');
    expect(cp4?.stage2Note).toContain('CP4.2');

    const led = describeJeepDtc('B162C-08');
    expect(led?.stage2Note).toContain('LED Headlamps');
  });
});
