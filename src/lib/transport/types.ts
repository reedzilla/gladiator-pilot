export type TransportKind = 'ble' | 'serial' | 'simulator';

/**
 * Physical CAN networks on the 2021 Jeep Gladiator (JT):
 * - CAN_C:   OBD Pins 6 & 14 @ 500 kbps (Powertrain, ABS 747->4C7, TCM 8HP75, EPS, Transfer Case, BCM C-side)
 * - CAN_IHS: OBD Pins 3 & 11 @ 125 kbps via 12+8 SGW Bypass + vLinker FD+ (BCM IHS-side, IPC, Radio, HVAC, RFH, Doors)
 */
export type BusTarget = 'CAN_C' | 'CAN_IHS';

export type AddressingBits = 11 | 29;

export type SgwState =
  | 'unknown'
  | 'sgw_inline_readonly' // Stock OBD-II port: 0x22 reads & Mode 01 work; 0x10 03 / 0x2E / 0x14 blocked by SGW
  | 'bypass_active';      // 12+8 bypass cable connected: direct bus access, 0x10 03 accepted

export interface AdapterCapabilities {
  transport: TransportKind;
  deviceName: string;
  atiBanner: string;
  stiBanner: string | null;
  vtiBanner: string | null;
  at1Banner: string | null;
  chipFamily: 'V-LINK01' | 'STN' | 'ELM327' | 'SIMULATOR';
  /** True when STPR + STP 53 + STPRS succeeds (vLinker FD+ / OBDLink MX+ / EX) */
  supportsMsCanPins3And11: boolean;
  /** Byte buffer depth (2048 on V-LINK01 / STN, ~256 on ELM327 clones) */
  isotpBufferBytes: number;
}

export interface RawTransport {
  readonly kind: TransportKind;
  readonly deviceName: string;
  readonly isConnected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Write raw ASCII command (without CR; caller or transport appends \r) */
  write(data: string): Promise<void>;
  /** Subscribe to incoming ASCII chunks from the adapter */
  onData(listener: (chunk: string) => void): () => void;
  onDisconnect(listener: () => void): () => void;
}

export interface TerminalLogEntry {
  id: string;
  timestamp: number;
  direction: 'tx' | 'rx' | 'info' | 'warn' | 'error';
  bus?: BusTarget;
  text: string;
}

export interface EcuEndpoint {
  id: string;
  shortName: string;
  fullName: string;
  bus: BusTarget;
  bits: AddressingBits;
  /** 11-bit hex (e.g. '747', '7E0', '620') or 29-bit hex (e.g. '18DA40F1') */
  txId: string;
  /** Expected responder CAN ID (e.g. '4C7', '7E8', '504', '18DAF140') */
  rxId: string;
  scheme: 'standard_plus8' | 'fca_minus280' | 'fca_plus1' | 'fca_asymmetric' | 'iso_29bit';
  category: 'powertrain' | 'chassis' | 'body' | 'infotainment' | 'gateway';
  /**Provenance note for engineering honesty */
  provenance: 'wire_verified_jt' | 'wire_verified_fca' | 'jl_jt_architecture';
  notes?: string;
}
