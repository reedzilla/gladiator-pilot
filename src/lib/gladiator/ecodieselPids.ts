import { ElmSession } from '../transport/elmSession';
import { findModuleById } from './moduleCatalog';

export interface TelemetryMetric {
  key: string;
  label: string;
  value: number | string | null;
  unit: string;
  provenance: 'SAE J1979' | 'Stellantis DID' | 'Pin 16 ATRV';
  warnHigh?: number;
  dangerHigh?: number;
  rawHex?: string;
}

export interface EcoDieselSnapshot {
  updatedAt: number;
  rpm: number | null;
  speedMph: number | null;
  boostPsi: number | null;
  intakeTempF: number | null;
  coolantF: number | null;
  oilTempF: number | null;
  transFluidF: number | null;
  egt1PreTurboF: number | null;
  egt2DocOutF: number | null;
  egt3DpfInF: number | null;
  egt4DpfOutF: number | null;
  dpfSootPct: number | null;
  dpfDiffPsi: number | null;
  regenActive: boolean | null;
  railPressurePsi: number | null;
  engineLoadPct: number | null;
  batteryVolts: number | null;
  odometerMi: number | null;
  odometerSource: string | null;
}

export const cToF = (c: number): number => Math.round((c * 9) / 5 + 32);

export function decodeMode01Rpm(bytes: number[]): number | null {
  if (bytes.length < 4 || bytes[0] !== 0x41 || bytes[1] !== 0x0c) return null;
  return Math.round(((bytes[2] << 8) | bytes[3]) / 4);
}

export function decodeMode01SpeedMph(bytes: number[]): number | null {
  if (bytes.length < 3 || bytes[0] !== 0x41 || bytes[1] !== 0x0d) return null;
  return Math.round(bytes[2] * 0.621371 * 10) / 10;
}

export function decodeMode01TempF(bytes: number[], expectedPid: number): number | null {
  if (bytes.length < 3 || bytes[0] !== 0x41 || bytes[1] !== expectedPid) return null;
  return cToF(bytes[2] - 40);
}

export function decodeMode01BoostPsi(bytes: number[], baroKpa = 101.3): number | null {
  if (bytes.length < 3 || bytes[0] !== 0x41 || bytes[1] !== 0x0b) return null;
  const gaugeKpa = bytes[2] - baroKpa;
  return Math.round(gaugeKpa * 0.145038 * 10) / 10;
}

/**
 * SAE J1979 PID 0x70: 2-Byte Diesel Boost Pressure Control (0.03125 kPa/bit).
 * Essential for Stage 2 EcoDiesel tunes where boost exceeds 010B's 255 kPa (+22.3 PSI) ceiling.
 */
export function decodeMode01HighRangeBoostPsi(bytes: number[], baroKpa = 101.3): number | null {
  if (bytes.length < 7 || bytes[0] !== 0x41 || bytes[1] !== 0x70) return null;
  const mask = bytes[2];
  if ((mask & 0x02) === 0) return null; // Actual Boost Pressure Sensor A not marked valid
  const raw = (bytes[5] << 8) | bytes[6];
  if (raw === 0 || raw === 0xffff) return null;
  const absKpa = raw * 0.03125;
  const gaugePsi = (absKpa - baroKpa) * 0.145038;
  return gaugePsi > -14 && gaugePsi < 80 ? Math.round(gaugePsi * 10) / 10 : null;
}

export function decodeMode01RailPressurePsi(bytes: number[]): number | null {
  if (bytes.length < 4 || bytes[0] !== 0x41 || bytes[1] !== 0x23) return null;
  const kpa = ((bytes[2] << 8) | bytes[3]) * 10;
  return Math.round(kpa * 0.145038);
}

export function decodeMode01LoadPct(bytes: number[]): number | null {
  if (bytes.length < 3 || bytes[0] !== 0x41 || bytes[1] !== 0x04) return null;
  return Math.round((bytes[2] * 100) / 255);
}

export function decodeMode01Voltage(bytes: number[]): number | null {
  if (bytes.length < 4 || bytes[0] !== 0x41 || bytes[1] !== 0x42) return null;
  const v = ((bytes[2] << 8) | bytes[3]) / 1000;
  return v >= 6 && v <= 30 ? Math.round(v * 100) / 100 : null;
}

/**
 * SAE J1979 PID 0x78: Exhaust Gas Temperature Bank 1 (Sensors 1..4)
 * Byte A bitmask: bit0=EGT1, bit1=EGT2, bit2=EGT3, bit3=EGT4. Each sensor = 2 bytes, `(raw * 0.1 - 40) °C`.
 */
export function decodeMode01EgtBank1F(bytes: number[]): {
  egt1: number | null;
  egt2: number | null;
  egt3: number | null;
  egt4: number | null;
} {
  const empty = { egt1: null, egt2: null, egt3: null, egt4: null };
  if (bytes.length < 5 || bytes[0] !== 0x41 || bytes[1] !== 0x78) return empty;
  const mask = bytes[2];
  const decodeAt = (idx: number): number | null => {
    if (bytes.length < idx + 2) return null;
    const raw = (bytes[idx] << 8) | bytes[idx + 1];
    // Filter open-circuit / unplugged sensor sentinels on Stage 2 race pipes
    if (raw === 0xffff || raw === 0xfffe || raw === 0x0000) return null;
    const f = cToF(raw * 0.1 - 40);
    return f > -35 && f < 2050 ? f : null;
  };
  return {
    egt1: mask & 0x01 ? decodeAt(3) : null,
    egt2: mask & 0x02 ? decodeAt(5) : null,
    egt3: mask & 0x04 ? decodeAt(7) : null,
    egt4: mask & 0x08 ? decodeAt(9) : null,
  };
}

export function decodeMode01DpfDiffPsi(bytes: number[]): number | null {
  if (bytes.length < 5 || bytes[0] !== 0x41 || bytes[1] !== 0x7a) return null;
  const raw = (bytes[3] << 8) | bytes[4];
  const kpa = raw * 0.01;
  return Math.round(kpa * 0.145038 * 100) / 100;
}

export function decodeMode01RegenActive(bytes: number[]): boolean | null {
  if (bytes.length < 4 || bytes[0] !== 0x41 || bytes[1] !== 0x8b) return null;
  // Byte B bit0/bit1 indicate active regeneration state per SAE J1979 PID 8B
  return (bytes[3] & 0x03) !== 0;
}

export function decodeStellantisTransTempF(bytes: number[]): number | null {
  if (bytes.length < 4 || bytes[0] !== 0x62 || bytes[1] !== 0x1e || bytes[2] !== 0x1c) return null;
  return cToF(bytes[3] - 40);
}

export function decodeStellantisDpfSootPct(bytes: number[]): number | null {
  if (bytes.length < 4 || bytes[0] !== 0x62 || bytes[1] !== 0x1e || bytes[2] !== 0x30) return null;
  return Math.round(bytes[3] * 0.5 * 10) / 10;
}

/**
 * Poll a complete EcoDiesel & 8HP75 telemetry frame on CAN-C (works Day 1 on stock OBD port!).
 */
export async function pollEcoDieselFastFrame(
  session: ElmSession,
  includeSlowDids = true,
  stage2DeleteMode = false
): Promise<EcoDieselSnapshot> {
  const pcm = findModuleById('PCM');
  const tcm = findModuleById('TCM');

  const askPcm = (hex: string) => session.requestUds(pcm, hex, 1400);

  const rpmR = await askPcm('010C');
  const spdR = await askPcm('010D');
  const boostR = await askPcm('010B');
  // Query 2-byte Diesel Boost (0170) in Stage 2 mode or whenever 010B nears its 255 kPa ceiling
  const boost70R =
    stage2DeleteMode || (boostR.ok && boostR.bytes.length >= 3 && boostR.bytes[2] >= 245)
      ? await askPcm('0170')
      : null;
  const iatR = await askPcm('010F');
  const ectR = await askPcm('0105');
  const oilR = await askPcm('015C');
  const loadR = await askPcm('0104');
  const railR = await askPcm('0123');
  const voltR = await askPcm('0142');
  const egtR = await askPcm('0178');
  // Skip deleted aftertreatment PIDs in Stage 2 Delete mode for ~30% faster gauge refresh
  const dpfP = stage2DeleteMode ? null : await askPcm('017A');
  const regR = stage2DeleteMode ? null : await askPcm('018B');

  let batteryVolts = voltR.ok ? decodeMode01Voltage(voltR.bytes) : null;
  if (batteryVolts === null) {
    batteryVolts = await session.readPin16Voltage();
  }

  let transFluidF: number | null = null;
  let dpfSootPct: number | null = null;
  let odometerMi: number | null = null;
  let odometerSource: string | null = null;

  if (includeSlowDids) {
    if (!stage2DeleteMode) {
      const sootR = await askPcm('221E30');
      if (sootR.ok) dpfSootPct = decodeStellantisDpfSootPct(sootR.bytes);
    }

    let tftR = await session.requestUds(tcm, '221E1C', 1300);
    if (!tftR.ok) tftR = await askPcm('221E1C');
    if (tftR.ok) transFluidF = decodeStellantisTransTempF(tftR.bytes);

    // Odometer cascade: SAE 01A6 -> IPC 22010C -> ECM 22043B (labeled transparently)
    const odoA6 = await askPcm('01A6');
    if (odoA6.ok && odoA6.bytes.length >= 6 && odoA6.bytes[0] === 0x41 && odoA6.bytes[1] === 0xa6) {
      const rawKm10 =
        ((odoA6.bytes[2] << 24) >>> 0) +
        (odoA6.bytes[3] << 16) +
        (odoA6.bytes[4] << 8) +
        odoA6.bytes[5];
      odometerMi = Math.round(rawKm10 * 0.1 * 0.621371 * 10) / 10;
      odometerSource = 'SAE 01A6';
    } else {
      const odo043B = await askPcm('22043B');
      if (odo043B.ok && odo043B.bytes.length >= 5) {
        const raw = (odo043B.bytes[3] << 8) | odo043B.bytes[4];
        odometerMi = Math.round(raw * 8.192 * 10) / 10;
        odometerSource = 'FCA ECM 043B (±8.2 mi res)';
      }
    }
  }

  const egts = egtR.ok
    ? decodeMode01EgtBank1F(egtR.bytes)
    : { egt1: null, egt2: null, egt3: null, egt4: null };

  const highBoost = boost70R?.ok ? decodeMode01HighRangeBoostPsi(boost70R.bytes) : null;
  const stdBoost = boostR.ok ? decodeMode01BoostPsi(boostR.bytes) : null;

  return {
    updatedAt: Date.now(),
    rpm: rpmR.ok ? decodeMode01Rpm(rpmR.bytes) : null,
    speedMph: spdR.ok ? decodeMode01SpeedMph(spdR.bytes) : null,
    boostPsi: highBoost ?? stdBoost,
    intakeTempF: iatR.ok ? decodeMode01TempF(iatR.bytes, 0x0f) : null,
    coolantF: ectR.ok ? decodeMode01TempF(ectR.bytes, 0x05) : null,
    oilTempF: oilR.ok ? decodeMode01TempF(oilR.bytes, 0x5c) : null,
    transFluidF,
    egt1PreTurboF: egts.egt1,
    egt2DocOutF: egts.egt2,
    egt3DpfInF: egts.egt3,
    egt4DpfOutF: egts.egt4,
    dpfSootPct,
    dpfDiffPsi: dpfP?.ok ? decodeMode01DpfDiffPsi(dpfP.bytes) : null,
    regenActive: regR?.ok ? decodeMode01RegenActive(regR.bytes) : null,
    railPressurePsi: railR.ok ? decodeMode01RailPressurePsi(railR.bytes) : null,
    engineLoadPct: loadR.ok ? decodeMode01LoadPct(loadR.bytes) : null,
    batteryVolts,
    odometerMi,
    odometerSource,
  };
}
