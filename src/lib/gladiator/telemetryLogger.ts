import { EcoDieselSnapshot } from './ecodieselPids';

export interface LoggedTelemetryRow extends EcoDieselSnapshot {
  gpsMph: number | null;
}

export function exportTelemetryCsv(rows: LoggedTelemetryRow[]): string {
  const header = [
    'iso_time',
    'elapsed_sec',
    'rpm',
    'obd_mph',
    'gps_mph',
    'boost_psi',
    'egt1_pre_turbo_f',
    'rail_pressure_psi',
    'engine_load_pct',
    'intake_iat_f',
    'coolant_f',
    'oil_temp_f',
    'trans_8hp75_f',
    'battery_volts',
    'dpf_soot_pct',
  ].join(',');

  if (rows.length === 0) return header + '\n';
  const t0 = rows[0].updatedAt;

  const lines = rows.map((r) => {
    const iso = new Date(r.updatedAt).toISOString();
    const elapsed = ((r.updatedAt - t0) / 1000).toFixed(2);
    const vals = [
      iso,
      elapsed,
      r.rpm ?? '',
      r.speedMph ?? '',
      r.gpsMph ?? '',
      r.boostPsi ?? '',
      r.egt1PreTurboF ?? '',
      r.railPressurePsi ?? '',
      r.engineLoadPct ?? '',
      r.intakeTempF ?? '',
      r.coolantF ?? '',
      r.oilTempF ?? '',
      r.transFluidF ?? '',
      r.batteryVolts ?? '',
      r.dpfSootPct ?? '',
    ];
    return vals.join(',');
  });

  return [header, ...lines].join('\n');
}

export interface Stage2AlertItem {
  id: string;
  severity: 'warn' | 'critical';
  message: string;
}

export function evaluateStage2Alerts(snap: EcoDieselSnapshot | null): Stage2AlertItem[] {
  if (!snap) return [];
  const alerts: Stage2AlertItem[] = [];

  if (snap.egt1PreTurboF !== null) {
    if (snap.egt1PreTurboF >= 1400) {
      alerts.push({
        id: 'egt1_crit',
        severity: 'critical',
        message: `CRITICAL EGT 1 (${snap.egt1PreTurboF}°F >= 1,400°F) — Lift throttle / downshift!`,
      });
    } else if (snap.egt1PreTurboF >= 1275) {
      alerts.push({
        id: 'egt1_warn',
        severity: 'warn',
        message: `High Pre-Turbo EGT 1 (${snap.egt1PreTurboF}°F) — Heavy grade/tow thermal load`,
      });
    }
  }

  if (snap.transFluidF !== null && snap.transFluidF >= 225) {
    alerts.push({
      id: 'tft_warn',
      severity: snap.transFluidF >= 238 ? 'critical' : 'warn',
      message: `8HP75 Trans Fluid Hot (${snap.transFluidF}°F)`,
    });
  }

  if (snap.coolantF !== null && snap.coolantF >= 228) {
    alerts.push({
      id: 'ect_warn',
      severity: snap.coolantF >= 242 ? 'critical' : 'warn',
      message: `3.0D Coolant Hot (${snap.coolantF}°F) — Consider Trail Box Fan Override`,
    });
  }

  if (snap.batteryVolts !== null && snap.batteryVolts < 11.8) {
    alerts.push({
      id: 'volt_warn',
      severity: 'warn',
      message: `Low Bus Voltage (${snap.batteryVolts.toFixed(1)}V < 11.8V)`,
    });
  }

  return alerts;
}

/**
 * Synthesize a brief crisp cabin alert beep via Web Audio API (zero external audio files needed).
 */
export function playAlertChime(critical = false): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = critical ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(critical ? 880 : 660, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (critical ? 0.28 : 0.16));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (critical ? 0.28 : 0.16));
    setTimeout(() => ctx.close().catch(() => undefined), 400);
  } catch {
    // Audio blocked prior to user gesture — safe to ignore
  }
}
