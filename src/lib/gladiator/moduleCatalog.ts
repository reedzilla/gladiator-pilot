import { ElmSession } from '../transport/elmSession';
import { EcuEndpoint, SgwState } from '../transport/types';

/**
 * 2021 Jeep Gladiator (JT) 3.0L V6 EcoDiesel Module Topology across CAN-C (500 kbps) & CAN-IHS (125 kbps).
 *
 * Grounded in wire captures from `2021 JT 3.0L EcoDiesel` (PCM 7E0->7E8, TCM 7E1->7E9, ABS 747->4C7)
 * and FCA PowerNet / CUSW asymmetric addressing (`-0x280`, `+1`, `620->504`, and `18DAxxF1` 29-bit).
 */
export const GLADIATOR_MODULES: readonly EcuEndpoint[] = [
  // ── CAN-C (OBD Pins 6 & 14 @ 500 kbps) ──
  {
    id: 'PCM',
    shortName: 'PCM (3.0D)',
    fullName: 'Powertrain Control Module — Bosch EDC17C69 / MD1 3.0L EcoDiesel',
    bus: 'CAN_C',
    bits: 11,
    txId: '7E0',
    rxId: '7E8',
    scheme: 'standard_plus8',
    category: 'powertrain',
    provenance: 'wire_verified_jt',
    notes: 'Primary EcoDiesel engine management, EGT, boost, rail pressure, DPF telemetry.',
  },
  {
    id: 'TCM',
    shortName: 'TCM (8HP75)',
    fullName: 'Transmission Control Module — ZF 8HP75 8-Speed Auto',
    bus: 'CAN_C',
    bits: 11,
    txId: '7E1',
    rxId: '7E9',
    scheme: 'standard_plus8',
    category: 'powertrain',
    provenance: 'wire_verified_jt',
    notes: '8HP75 shift points & fluid temperature.',
  },
  {
    id: 'ABS',
    shortName: 'ABS / ESC',
    fullName: 'Anti-Lock Brakes / Electronic Stability Control (-0x280)',
    bus: 'CAN_C',
    bits: 11,
    txId: '747',
    rxId: '4C7',
    scheme: 'fca_minus280',
    category: 'chassis',
    provenance: 'wire_verified_jt',
    notes: 'Wire-verified on 2021 JT 3.0L EcoDiesel at 747 -> 4C7! Requires ATCRA 4C7 & ATFCSH 747.',
  },
  {
    id: 'BCM_C',
    shortName: 'BCM (CAN-C)',
    fullName: 'Body Control Module — Powertrain / C-Bus Interface',
    bus: 'CAN_C',
    bits: 11,
    txId: '620',
    rxId: '504',
    scheme: 'fca_asymmetric',
    category: 'body',
    provenance: 'wire_verified_fca',
    notes: 'Holds central VehConfig (tire circumference, axle ratio, LED flags, TPMS, Aux switches).',
  },
  {
    id: 'BCM_29',
    shortName: 'BCM (29-bit)',
    fullName: 'Body Control Module — ISO 15765 29-bit Diagnostic Channel',
    bus: 'CAN_C',
    bits: 29,
    txId: '18DA40F1',
    rxId: '18DAF140',
    scheme: 'iso_29bit',
    category: 'body',
    provenance: 'jl_jt_architecture',
    notes: 'Alternate 29-bit UDS channel (`18DA40F1 -> 18DAF140`) used by FCA coding tools on JL/JT.',
  },
  {
    id: 'SGW',
    shortName: 'SGW',
    fullName: 'Security Gateway Module (+1 Offset)',
    bus: 'CAN_C',
    bits: 11,
    txId: '47E',
    rxId: '47F',
    scheme: 'fca_plus1',
    category: 'gateway',
    provenance: 'wire_verified_fca',
    notes: 'Answers on stock OBD port. Goes silent when unplugged for 12+8 bypass cable.',
  },
  {
    id: 'DTCM',
    shortName: 'DTCM (4x4)',
    fullName: 'Drivetrain / Transfer Case Control Module (-0x280)',
    bus: 'CAN_C',
    bits: 11,
    txId: '744',
    rxId: '4C4',
    scheme: 'fca_minus280',
    category: 'chassis',
    provenance: 'wire_verified_fca',
    notes: 'Command-Trac / Rock-Trac 4WD range & axle status.',
  },
  {
    id: 'EPS',
    shortName: 'EPS (EHPS)',
    fullName: 'Electro-Hydraulic Power Steering (-0x280)',
    bus: 'CAN_C',
    bits: 11,
    txId: '75A',
    rxId: '4DA',
    scheme: 'fca_minus280',
    category: 'chassis',
    provenance: 'wire_verified_fca',
    notes: 'Gladiator electro-hydraulic steering pump control.',
  },
  {
    id: 'SCCM',
    shortName: 'SCCM',
    fullName: 'Steering Column Control Module (-0x280)',
    bus: 'CAN_C',
    bits: 11,
    txId: '762',
    rxId: '4E2',
    scheme: 'fca_minus280',
    category: 'chassis',
    provenance: 'wire_verified_fca',
    notes: 'Steering wheel switches, stalks & steering angle.',
  },
  {
    id: 'ORC',
    shortName: 'ORC (SRS)',
    fullName: 'Occupant Restraint / Airbag Controller (-0x280)',
    bus: 'CAN_C',
    bits: 11,
    txId: '740',
    rxId: '4C0',
    scheme: 'fca_minus280',
    category: 'chassis',
    provenance: 'wire_verified_fca',
    notes: 'pitch/roll inertial sensors & SRS.',
  },

  // ── CAN-IHS (OBD Pins 3 & 11 @ 125 kbps via 12+8 Bypass + vLinker FD+) ──
  {
    id: 'IPC_IHS',
    shortName: 'IPC (Cluster)',
    fullName: 'Instrument Panel Cluster (CAN-IHS 125k)',
    bus: 'CAN_IHS',
    bits: 11,
    txId: '742',
    rxId: '4C2',
    scheme: 'fca_minus280',
    category: 'body',
    provenance: 'wire_verified_fca',
    notes: 'Cluster odometer (`22 01 0C`), splash screen & gauge telltales.',
  },
  {
    id: 'BCM_IHS',
    shortName: 'BCM (CAN-IHS)',
    fullName: 'Body Control Module — Interior Bus Interface (125k)',
    bus: 'CAN_IHS',
    bits: 11,
    txId: '620',
    rxId: '504',
    scheme: 'fca_asymmetric',
    category: 'body',
    provenance: 'jl_jt_architecture',
    notes: 'Interior network face of the BCM via Pins 3 & 11.',
  },
  {
    id: 'RADIO_IHS',
    shortName: 'Uconnect',
    fullName: 'Radio / Telematics Gateway (Uconnect)',
    bus: 'CAN_IHS',
    bits: 11,
    txId: '680',
    rxId: '510',
    scheme: 'fca_asymmetric',
    category: 'infotainment',
    provenance: 'jl_jt_architecture',
    notes: 'Off-Road Pages, camera triggers & audio config.',
  },
  {
    id: 'HVAC_IHS',
    shortName: 'HVAC',
    fullName: 'Heating, Ventilation & Air Conditioning (+1)',
    bus: 'CAN_IHS',
    bits: 11,
    txId: '788',
    rxId: '789',
    scheme: 'fca_plus1',
    category: 'body',
    provenance: 'wire_verified_fca',
  },
  {
    id: 'RFH_IHS',
    shortName: 'RF Hub',
    fullName: 'Radio Frequency Hub — Keyless / TPMS Receiver (-0x280)',
    bus: 'CAN_IHS',
    bits: 11,
    txId: '749',
    rxId: '4C9',
    scheme: 'fca_minus280',
    category: 'body',
    provenance: 'wire_verified_fca',
    notes: 'Receives FOBik & tire pressure sensor RF packets.',
  },
  {
    id: 'DDM_IHS',
    shortName: 'DDM (Driver Door)',
    fullName: 'Driver Door Module (-0x280)',
    bus: 'CAN_IHS',
    bits: 11,
    txId: '791',
    rxId: '511',
    scheme: 'fca_minus280',
    category: 'body',
    provenance: 'wire_verified_fca',
  },
  {
    id: 'PDM_IHS',
    shortName: 'PDM (Pass Door)',
    fullName: 'Passenger Door Module (-0x280)',
    bus: 'CAN_IHS',
    bits: 11,
    txId: '792',
    rxId: '512',
    scheme: 'fca_minus280',
    category: 'body',
    provenance: 'wire_verified_fca',
  },
];

export function findModuleById(id: string): EcuEndpoint {
  const found = GLADIATOR_MODULES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown Gladiator module ID: ${id}`);
  return found;
}

export interface SgwProbeResult {
  state: SgwState;
  sgwAnswered47E: boolean;
  extendedSessionAccepted: boolean;
  detail: string;
}

/**
 * Non-destructive SGW vs 12+8 Bypass detector:
 *  1. Queries SGW `47E -> 47F` with `3E 00` (TesterPresent). If `47F` answers, the factory SGW is physically plugged in!
 *  2. Tests `10 03` (Extended Diagnostic Session) on BCM (`620 -> 504`) or ABS (`747 -> 4C7`).
 *     - Behind the stock SGW, `10 03` is blocked (`7F 10 33` or `NO DATA`).
 *     - Behind a 12+8 SGW bypass cable, `47E` is silent (unplugged) and `10 03` returns `50 03 ...`!
 */
export async function detectSgwState(session: ElmSession): Promise<SgwProbeResult> {
  const sgwEcu = findModuleById('SGW');
  const bcmEcu = findModuleById('BCM_C');
  const absEcu = findModuleById('ABS');

  const sgwPing = await session.requestUds(sgwEcu, '3E00', 1200);
  const sgwAnswered47E = sgwPing.ok;

  // Test Extended Session on BCM first, fallback to ABS (747->4C7 wire-verified on 2021 JT 3.0D)
  let extResp = await session.requestUds(bcmEcu, '1003', 1500);
  if (!extResp.ok && !extResp.isNegativeResponse) {
    extResp = await session.requestUds(absEcu, '1003', 1500);
  }

  // Return module to Default Session (`10 01`) cleanly if `10 03` opened
  if (extResp.ok) {
    const target = extResp.responderId === '4C7' ? absEcu : bcmEcu;
    await session.requestUds(target, '1001', 1000).catch(() => undefined);
    return {
      state: 'bypass_active',
      sgwAnswered47E,
      extendedSessionAccepted: true,
      detail: '12+8 Bypass Active — Extended Session (0x10 03) open on CAN-C',
    };
  }

  return {
    state: 'sgw_inline_readonly',
    sgwAnswered47E,
    extendedSessionAccepted: false,
    detail: sgwAnswered47E
      ? 'SGW In-Line (47F active) — Read-Only Mode (0x22 / 0x19 / Mode 01 ready)'
      : `SGW Firewall Active (${extResp.errorReason || '0x10 03 blocked'}) — Read-Only Mode`,
  };
}
