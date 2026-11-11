export interface JeepDtcInfo {
  title: string;
  stage2Note?: string;
}

const JEEP_JT_DTC_TABLE: Record<string, JeepDtcInfo> = {
  P0087: {
    title: 'Fuel Rail / System Pressure — Too Low',
    stage2Note: 'Check fuel filter restriction & Bosch CP4.2 high-pressure pump health immediately.',
  },
  P0088: {
    title: 'Fuel Rail / System Pressure — Too High',
    stage2Note: 'Inspect rail pressure regulator / metering unit.',
  },
  P0101: {
    title: 'Mass Air Flow (MAF) Sensor Performance',
    stage2Note: 'Clean MAF sensor or check oiled aftermarket intake filter.',
  },
  P0234: {
    title: 'Turbocharger Overboost Condition',
    stage2Note: 'Check VGT vanes / boost actuator linkage under full Stage 2 fueling.',
  },
  P0299: {
    title: 'Turbocharger Underboost Condition',
    stage2Note: 'Inspect intercooler charge pipes & silicone boots for boost leaks at 30+ PSI.',
  },
  P0401: {
    title: 'EGR "A" Flow Insufficient Detected',
    stage2Note: 'Normal historical code prior to Stage 2 delete; safe to clear if Stage 2 ECM is active.',
  },
  P0402: { title: 'EGR Flow Excessive Detected' },
  P0671: { title: 'Cylinder 1 Glow Plug Circuit / Open' },
  P0672: { title: 'Cylinder 2 Glow Plug Circuit / Open' },
  P0673: { title: 'Cylinder 3 Glow Plug Circuit / Open' },
  P0674: { title: 'Cylinder 4 Glow Plug Circuit / Open' },
  P0675: { title: 'Cylinder 5 Glow Plug Circuit / Open' },
  P0676: { title: 'Cylinder 6 Glow Plug Circuit / Open' },
  P2002: {
    title: 'DPF Efficiency Below Threshold (Bank 1)',
    stage2Note: 'Masked by Stage 2 delete tune.',
  },
  P2463: {
    title: 'DPF Restriction — Soot Accumulation',
    stage2Note: 'Masked by Stage 2 delete tune.',
  },
  U010E: {
    title: 'Lost Communication with Reductant (DEF) Control Module',
    stage2Note: 'Expected passive shadow code if DEF/SCR module is unplugged on Stage 2 delete.',
  },
  U029D: {
    title: 'Lost Communication with NOx Sensor "A"',
    stage2Note: 'Expected passive shadow code when upstream NOx module is unplugged.',
  },
  U029E: {
    title: 'Lost Communication with NOx Sensor "B"',
    stage2Note: 'Expected passive shadow code when downstream NOx module is unplugged.',
  },
  U0140: { title: 'Lost Communication with Body Control Module (BCM)' },
  U1110: { title: 'Lost Vehicle Speed Message on Interior CAN-IHS' },
  U1504: { title: 'Implausible Message Data Length Received from Steering Angle Sensor' },
  C0022: { title: 'Brake Booster Solenoid Performance / Vacuum Sensor' },
  C121A: {
    title: 'Steering Angle Sensor Not Initialized',
    stage2Note: 'Turn wheel full lock-to-lock, or run ABS Tire Size Re-Learn after tire calibration.',
  },
  C2200: { title: 'Anti-Lock Brake Module Internal / Configuration Mismatch' },
  C107C: { title: 'Brake Pedal Switch Signal Circuit' },
  B1042: { title: 'Front / Cabin HVAC Damper Position Calibration Needed' },
  B162C: {
    title: 'Left Low Beam Control Circuit High (Aftermarket LED Swap Detected)',
    stage2Note: 'Enable "LED Headlamps" in Truck Mods -> Lighting to eliminate LED PWM fault.',
  },
  B162B: {
    title: 'Left Low Beam Control Circuit High / Open (LED Bulb-Out Sense)',
    stage2Note: 'Enable "LED Headlamps" in Truck Mods -> Lighting to eliminate LED PWM fault.',
  },
  B162F: {
    title: 'Right Low Beam Control Circuit High / Open (LED Bulb-Out Sense)',
    stage2Note: 'Enable "LED Headlamps" in Truck Mods -> Lighting.',
  },
  B1633: {
    title: 'Left Front Turn Signal Circuit High (LED Hyperflash)',
    stage2Note: 'Enable "LED Front Turn Signals" in Truck Mods -> Lighting.',
  },
  B1637: {
    title: 'Right Front Turn Signal Circuit High (LED Hyperflash)',
    stage2Note: 'Enable "LED Front Turn Signals" in Truck Mods -> Lighting.',
  },
  B1643: {
    title: 'Rear Turn / Tail Lamp LED Sense Fault',
    stage2Note: 'Enable "LED Tail Lamps" in Truck Mods -> Lighting.',
  },
};

export function describeJeepDtc(fullCode: string): JeepDtcInfo | null {
  const base = fullCode.split('-')[0].toUpperCase();
  return JEEP_JT_DTC_TABLE[base] ?? null;
}
