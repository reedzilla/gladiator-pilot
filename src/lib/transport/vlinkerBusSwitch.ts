import { AdapterCapabilities, AddressingBits, BusTarget, TransportKind } from './types';

/**
 * STN / Vgate V-LINK01 Protocol Preset Numbers (verified against STN FRPM & Vgate vLinker FD+ manual):
 *  - 33: HS-CAN (OBD Pins 6 & 14), ISO 15765, 500 kbps, 11-bit ID, DLC=8  -> Gladiator CAN-C (11-bit)
 *  - 34: HS-CAN (OBD Pins 6 & 14), ISO 15765, 500 kbps, 29-bit ID, DLC=8  -> Gladiator CAN-C (29-bit)
 *  - 53: MS-CAN (OBD Pins 3 & 11), ISO 15765, 125 kbps, 11-bit ID, DLC=8  -> Gladiator CAN-IHS (11-bit)
 *  - 54: MS-CAN (OBD Pins 3 & 11), ISO 15765, 125 kbps, 29-bit ID, DLC=8  -> Gladiator CAN-IHS (29-bit)
 */
export const VLINKER_STP_PRESETS: Record<BusTarget, Record<AddressingBits, string>> = {
  CAN_C: {
    11: '33',
    29: '34',
  },
  CAN_IHS: {
    11: '53',
    29: '54',
  },
};

export function isCommandRejected(resp: string | null | undefined): boolean {
  if (!resp) return true;
  const clean = resp.replace(/>/g, '').trim();
  if (!clean) return true;
  return clean === '?' || /\bERROR\b/i.test(clean);
}

/**
 * Probe connected dongle using config-only queries (zero CAN frames transmitted on the vehicle bus).
 * Explicitly detects Vgate vLinker FD+ (`V-LINK01` / `MIC3322` / `vLinker`) as well as `STNxxxx`
 * and verifies Pins 3 & 11 (`STP 53` + `STPRS`) support before unlocking `CAN-IHS`.
 */
export async function detectAdapterCapabilities(
  sendRaw: (cmd: string, timeoutMs?: number) => Promise<string>,
  transport: TransportKind,
  deviceName: string
): Promise<AdapterCapabilities> {
  if (transport === 'simulator') {
    return {
      transport,
      deviceName,
      atiBanner: 'ELM327 v2.3 (Gladiator Pilot Simulator)',
      stiBanner: 'STN2120 v5.6.5',
      vtiBanner: 'vLinker FD+ V-LINK01 v2.2.88',
      at1Banner: 'VGATE VLINKER FD+',
      chipFamily: 'SIMULATOR',
      supportsMsCanPins3And11: true,
      isotpBufferBytes: 2048,
    };
  }

  const clean = (s: string) => s.replace(/[\r\n>]+/g, ' ').trim();

  let atiBanner = 'Unknown ELM327';
  let at1Banner: string | null = null;
  let stiBanner: string | null = null;
  let vtiBanner: string | null = null;

  try {
    const ati = await sendRaw('ATI', 1200);
    if (!isCommandRejected(ati)) atiBanner = clean(ati);
  } catch {
    /* ignore */
  }

  try {
    const at1 = await sendRaw('AT@1', 1000);
    if (!isCommandRejected(at1)) at1Banner = clean(at1);
  } catch {
    /* ignore */
  }

  try {
    const sti = await sendRaw('STI', 1000);
    if (!isCommandRejected(sti)) stiBanner = clean(sti);
  } catch {
    /* ignore */
  }

  try {
    const vti = await sendRaw('VTI', 1000);
    if (!isCommandRejected(vti)) vtiBanner = clean(vti);
  } catch {
    /* ignore */
  }

  const combinedIdentity = [deviceName, atiBanner, at1Banner, stiBanner, vtiBanner]
    .filter(Boolean)
    .join(' ');

  let chipFamily: AdapterCapabilities['chipFamily'] = 'ELM327';
  if (/vLinker|V-LINK|MIC33\d\d|VGATE/i.test(combinedIdentity) && (stiBanner || vtiBanner)) {
    chipFamily = 'V-LINK01';
  } else if (stiBanner && /STN\d{3,4}/i.test(stiBanner)) {
    chipFamily = 'STN';
  } else if (/vLinker/i.test(combinedIdentity)) {
    chipFamily = 'V-LINK01';
  }

  // Side-effect-free verification of STN `STP 53` (MS-CAN / CAN-IHS 125 kbps on Pins 3 & 11).
  // `STP` selects the protocol preset in RAM WITHOUT opening the transceiver channel (`STPO` opens it),
  // so `STPR` -> `STP 53` -> `STPRS` -> `STP 33` puts ZERO frames onto the Jeep's CAN bus.
  let supportsMsCanPins3And11 = false;
  try {
    const stpr = await sendRaw('STPR', 1000);
    if (!isCommandRejected(stpr)) {
      const savedMatch = clean(stpr).match(/\b([0-9A-F]{1,2})\b/i);
      const savedPreset = savedMatch ? savedMatch[1] : '33';

      const set53 = await sendRaw('STP 53', 1000);
      const stprs = await sendRaw('STPRS', 1000);
      if (!isCommandRejected(set53) && !isCommandRejected(stprs) && /125|MS|ISO\s*15765/i.test(stprs)) {
        supportsMsCanPins3And11 = true;
        if (chipFamily === 'ELM327') chipFamily = 'STN';
      }

      // Restore previous preset (defaulting to HS-CAN 11-bit 500k preset 33 if auto '0' was unset)
      const restorePreset = /^[0-9]{2}$/.test(savedPreset) ? savedPreset : '33';
      await sendRaw(`STP ${restorePreset}`, 1000);
    }
  } catch {
    supportsMsCanPins3And11 = false;
  }

  const isotpBufferBytes =
    chipFamily === 'V-LINK01' || chipFamily === 'STN' ? 2048 : 256;

  return {
    transport,
    deviceName,
    atiBanner,
    stiBanner,
    vtiBanner,
    at1Banner,
    chipFamily,
    supportsMsCanPins3And11,
    isotpBufferBytes,
  };
}

/**
 * Build the deterministic command sequence to switch physical CAN bus and addressing width.
 * Throws if `CAN_IHS` (Pins 3 & 11 @ 125 kbps) is requested on a single-bus adapter like Veepeak BLE.
 */
export function buildBusSwitchSequence(
  bus: BusTarget,
  bits: AddressingBits,
  capabilities: Pick<AdapterCapabilities, 'supportsMsCanPins3And11' | 'chipFamily'>
): string[] {
  if (bus === 'CAN_IHS' && !capabilities.supportsMsCanPins3And11) {
    throw new Error(
      'CAN-IHS (Pins 3 & 11 @ 125 kbps) requires Vgate vLinker FD+ or STN adapter — current dongle only wires Pins 6 & 14.'
    );
  }

  if (capabilities.supportsMsCanPins3And11) {
    const preset = VLINKER_STP_PRESETS[bus][bits];
    // Close active channel -> select STP preset -> verify preset status -> open channel
    return ['STPC', `STP ${preset}`, 'STPRS', 'STPO'];
  }

  // Standard ELM327 (e.g. Veepeak BLE v2.2 on Pins 6 & 14 CAN-C only)
  return [bits === 29 ? 'ATSP 7' : 'ATSP 6'];
}

/**
 * Build guaranteed restore commands to return the adapter to primary CAN-C (500 kbps, 11-bit).
 */
export function buildPrimaryBusRestoreSequence(
  capabilities: Pick<AdapterCapabilities, 'supportsMsCanPins3And11'>
): string[] {
  if (capabilities.supportsMsCanPins3And11) {
    return ['STPC', 'STP 33', 'STPRS', 'STPO', 'ATFCSM 0', 'ATCRA'];
  }
  return ['ATSP 6', 'ATFCSM 0', 'ATCRA'];
}
