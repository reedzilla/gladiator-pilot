import { bytesToHex, hexToBytes } from './isotp';
import { BusTarget, RawTransport } from './types';

export interface SimulatorOptions {
  /** Toggle whether the factory SGW is in-line (stock OBD port) or bypassed via 12+8 cable */
  sgwBypassInstalled: boolean;
  /** Vehicle speed in mph (set >0 to test safety lockout gates) */
  vehicleSpeedMph?: number;
  /** Battery voltage (set <12.0V to test low-voltage coding lockout) */
  batteryVolts?: number;
  /** Artificial reply latency in ms (default 4ms; pass 0 in tests for microtask speed) */
  replyDelayMs?: number;
}

/**
 * High-fidelity bench simulator modeled after a 2021 Jeep Gladiator 3.0L EcoDiesel
 * (`1C6JJTAM0ML000000`), implementing real ISO-TP SF/FF+CF framing, asymmetric FCA offsets
 * (`747->4C7`, `742->4C2`, `620->504`, `47E->47F`), `STP 33`/`53` dual-bus switching,
 * and SGW firewall enforcement.
 */
export class GladiatorSimTransport implements RawTransport {
  public readonly kind = 'simulator' as const;
  private connected = false;
  private dataListeners = new Set<(chunk: string) => void>();
  private disconnectListeners = new Set<() => void>();

  private activeStpPreset = '33'; // 33=CAN_C 11b, 34=CAN_C 29b, 53=CAN_IHS 11b, 54=CAN_IHS 29b
  private spacesOn = false;
  private headersOn = true;
  private currentTx = '7DF';
  private currentCp = '18';
  private currentCra: string | null = null;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;

  public sgwBypassInstalled: boolean;
  public vehicleSpeedMph: number;
  public batteryVolts: number;
  private replyDelayMs: number;

  // Persistent simulated BCM / ECU DID store (allows real 0x22 scan, 0x2E write, diff, and Factory Restore testing)
  private didStore = new Map<string, number[]>();
  // Simulated DTC store keyed by module TX ID
  private dtcStore = new Map<string, Array<[number, number, number]>>();

  private readonly VIN_BYTES = Array.from('1C6JJTAM0ML000000').map((c) => c.charCodeAt(0));

  constructor(opts: SimulatorOptions = { sgwBypassInstalled: false }) {
    this.sgwBypassInstalled = opts.sgwBypassInstalled;
    this.vehicleSpeedMph = opts.vehicleSpeedMph ?? 0;
    this.batteryVolts = opts.batteryVolts ?? 12.6;
    this.replyDelayMs = opts.replyDelayMs ?? 4;
    this.seedDefaultState();
  }

  private seedDefaultState(): void {
    // Standard identity DIDs
    this.didStore.set('F190', [...this.VIN_BYTES]);
    this.didStore.set('F187', Array.from('68509214AC').map((c) => c.charCodeAt(0))); // OEM Part #
    this.didStore.set('F188', Array.from('68509215AE').map((c) => c.charCodeAt(0))); // SW ID
    this.didStore.set('F197', Array.from('JT_BCM_30D').map((c) => c.charCodeAt(0)));

    // Simulated BCM VehConfig blocks (readable through stock OBD via 0x22; writable via 0x2E behind 12+8 bypass):
    // 0130: Tire & Axle Calibration Block (Bytes 0-1: Tire Circumference mm = 2517mm [0x09D5] stock 245/75R17 ~31.5",
    //       Bytes 2-3: Axle Ratio * 100 = 373 [0x0175] = 3.73, Byte 4: Front TPMS PSI = 37 [0x25], Byte 5: Rear TPMS PSI = 37 [0x25])
    this.didStore.set('0130', [0x09, 0xd5, 0x01, 0x75, 0x25, 0x25, 0x00, 0x01]);

    // 0131: Exterior Lighting Config Block (Bitflags for LED Headlamps, LED Fogs, LED Turns, LED Tails, Fog Drop-Out Disable, DRL)
    this.didStore.set('0131', [0x00, 0x10, 0x04, 0x01, 0x00, 0x00]);

    // 0132: Comfort / Trail / Aux Switch Bank Block (Aux 1-4 Latching/Momentary, Belt Chime, Splash Screen)
    this.didStore.set('0132', [0x00, 0x03, 0x01, 0x00, 0x02, 0x00]);

    // DE01..DE03: FCA PowerNet PROXI / Vehicle Configuration 1-3 Mirrors
    this.didStore.set('DE01', [0x09, 0xd5, 0x01, 0x75, 0x25, 0x25, 0x01, 0x00]);
    this.didStore.set('DE02', [0x00, 0x10, 0x04, 0x01, 0x00, 0x00]);

    // D112: 4-Corner Live TPMS Sensor Pressures (FL, FR, RL, RR in PSI: 37, 37, 36, 37)
    this.didStore.set('D112', [37, 37, 36, 37]);

    // Seed sample non-critical DTCs so All-Module Scan & Clear can be tested end-to-end
    this.dtcStore.set('747', [[0x40, 0x22, 0x28]]); // C0022-28 Brake Booster Solenoid (stored)
    this.dtcStore.set('620', [[0x96, 0x2c, 0x08]]); // B162C-08 Left Low Beam Circuit (e.g. after LED swap!)
    this.dtcStore.set('680', [[0xd1, 0x10, 0x08]]); // U1110-08 Lost Vehicle Speed Message (CAN-IHS Radio)
  }

  public get deviceName(): string {
    return this.sgwBypassInstalled
      ? 'Sim: vLinker FD+ (12+8 Bypass Active)'
      : 'Sim: vLinker FD+ (Stock OBD / SGW In-Line)';
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public get activeBus(): BusTarget {
    return this.activeStpPreset === '53' || this.activeStpPreset === '54' ? 'CAN_IHS' : 'CAN_C';
  }

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.stopMonitorStream();
    this.connected = false;
    for (const cb of this.disconnectListeners) cb();
  }

  public onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private emitReply(lines: string[]): void {
    const body = lines.join('\r') + '\r>';
    if (this.replyDelayMs <= 0) {
      queueMicrotask(() => {
        if (!this.connected) return;
        for (const cb of this.dataListeners) cb(body);
      });
      return;
    }
    setTimeout(() => {
      if (!this.connected) return;
      for (const cb of this.dataListeners) cb(body);
    }, this.replyDelayMs);
  }

  private stopMonitorStream(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  public async write(rawCmd: string): Promise<void> {
    if (!this.connected) throw new Error('Simulator disconnected.');
    const cmd = rawCmd.replace(/[\r\n]+/g, '').trim().toUpperCase();

    // If passive monitor is active, any character stops it and prints STOPPED >
    if (this.monitorTimer) {
      this.stopMonitorStream();
      this.emitReply(['STOPPED']);
      return;
    }

    // AT / ST adapter configuration commands
    if (cmd === 'ATZ') {
      this.spacesOn = false;
      this.headersOn = true;
      this.activeStpPreset = '33';
      this.emitReply(['ELM327 v2.3']);
      return;
    }
    if (cmd === 'ATI') {
      this.emitReply(['ELM327 v2.3']);
      return;
    }
    if (cmd === 'AT@1') {
      this.emitReply(['VGATE VLINKER FD+']);
      return;
    }
    if (cmd === 'STI') {
      this.emitReply(['STN2120 v5.6.5']);
      return;
    }
    if (cmd === 'VTI') {
      this.emitReply(['vLinker FD+ V-LINK01 v2.2.88']);
      return;
    }
    if (cmd === 'ATRV') {
      this.emitReply([`${this.batteryVolts.toFixed(1)}V`]);
      return;
    }
    if (cmd === 'ATS0') {
      this.spacesOn = false;
      this.emitReply(['OK']);
      return;
    }
    if (cmd === 'ATS1') {
      this.spacesOn = true;
      this.emitReply(['OK']);
      return;
    }
    if (cmd === 'ATH0') {
      this.headersOn = false;
      this.emitReply(['OK']);
      return;
    }
    if (cmd === 'ATH1') {
      this.headersOn = true;
      this.emitReply(['OK']);
      return;
    }
    if (cmd === 'STPR') {
      this.emitReply([this.activeStpPreset]);
      return;
    }
    if (cmd.startsWith('STP ')) {
      const p = cmd.slice(4).trim();
      if (['33', '34', '53', '54'].includes(p)) {
        this.activeStpPreset = p;
        this.emitReply(['OK']);
      } else {
        this.emitReply(['?']);
      }
      return;
    }
    if (cmd === 'STPRS') {
      const desc =
        this.activeStpPreset === '53'
          ? 'ISO 15765, 125kbps, 11B, MS-CAN'
          : this.activeStpPreset === '54'
            ? 'ISO 15765, 125kbps, 29B, MS-CAN'
            : this.activeStpPreset === '34'
              ? 'ISO 15765, 500kbps, 29B, HS-CAN'
              : 'ISO 15765, 500kbps, 11B, HS-CAN';
      this.emitReply([desc]);
      return;
    }
    if (cmd === 'STPO' || cmd === 'STPC') {
      this.emitReply(['OK']);
      return;
    }
    if (cmd.startsWith('ATCP')) {
      this.currentCp = cmd.replace('ATCP', '').trim() || '18';
      this.emitReply(['OK']);
      return;
    }
    if (cmd.startsWith('ATSH')) {
      const sh = cmd.replace('ATSH', '').replace(/\s+/g, '');
      this.currentTx = sh.length === 6 ? `${this.currentCp}${sh}` : sh;
      this.emitReply(['OK']);
      return;
    }
    if (cmd.startsWith('ATCRA')) {
      const cra = cmd.replace('ATCRA', '').replace(/\s+/g, '');
      this.currentCra = cra || null;
      this.emitReply(['OK']);
      return;
    }
    if (
      cmd === 'ATE0' ||
      cmd === 'ATL0' ||
      cmd === 'ATCAF1' ||
      cmd === 'ATCFC1' ||
      cmd === 'ATAT1' ||
      cmd.startsWith('ATST') ||
      cmd.startsWith('ATSP') ||
      cmd.startsWith('ATFCS')
    ) {
      this.emitReply(['OK']);
      return;
    }

    // Passive Monitor (`STMA` / `ATMA`): emit realistic periodic CAN + synthetic Autel UDS capture frames!
    if (cmd === 'STMA' || cmd === 'ATMA') {
      let step = 0;
      const sampleSequence =
        this.activeBus === 'CAN_C'
          ? [
              '102 00 84 00 10 00 00 00 1F', // FCA Steering Angle broadcast (CAN-C)
              '202 00 00 00 00 00 00 00 00', // FCA Wheel Speeds broadcast (CAN-C)
              '620 02 10 03 00 00 00 00 00', // Tester -> BCM Extended Diagnostic Session
              '504 06 50 03 00 32 01 F4 00', // BCM -> Tester Session Accepted
              '620 03 22 01 31 00 00 00 00', // Tester -> BCM Read Lighting Config DID 0131
              '504 10 09 62 01 31 00 10 04', // BCM -> Tester First Frame
              '620 30 00 00 00 00 00 00 00', // Tester -> BCM Flow Control
              '504 21 01 00 00 00 00 00 00', // BCM -> Tester Consecutive Frame
              '620 10 09 2E 01 31 01 11 04', // Tester -> BCM Write LED Headlamps + Fog Drop-Out Disable
              '504 30 00 00 00 00 00 00 00', // BCM -> Tester Flow Control
              '620 21 01 00 00 00 00 00 00', // Tester -> BCM Consecutive Frame
              '504 03 6E 01 31 00 00 00 00', // BCM -> Tester Positive Write Response!
              '747 04 31 01 F0 01 00 00 00', // Tester -> ABS Tire/ESC Init Routine
              '4C7 04 71 01 F0 01 00 00 00', // ABS -> Tester Routine Complete!
            ]
          : [
              '2D3 04 25 25 26 25 00 00 00', // Interior TPMS / Body status frame (CAN-IHS)
              '680 03 22 F1 90 00 00 00 00', // Tester -> Uconnect Radio Read VIN
              '510 10 14 62 F1 90 31 43 36', // Radio -> Tester First Frame
              '680 30 00 00 00 00 00 00 00',
              '510 21 4A 4A 54 41 4D 30 4D',
              '510 22 4C 30 30 30 30 30 30',
            ];

      this.monitorTimer = setInterval(() => {
        if (!this.connected) return;
        const line = sampleSequence[step % sampleSequence.length];
        step++;
        for (const cb of this.dataListeners) cb(line + '\r');
      }, 220);
      return;
    }

    // Handle OBD / UDS hex payload (strip optional ELM327 trailing frame-count hint like "010C 1")
    const hexOnly = cmd.replace(/\s+[1-9]$/, '');
    const reqBytes = hexToBytes(hexOnly);
    if (reqBytes.length === 0) {
      this.emitReply(['?']);
      return;
    }

    const frames = this.simulateVehicleResponse(reqBytes);
    if (!frames || frames.length === 0) {
      this.emitReply(['NO DATA']);
    } else {
      this.emitReply(frames);
    }
  }

  private formatIsoTpFrames(rxCanId: string, payload: number[]): string[] {
    const sep = this.spacesOn ? ' ' : '';
    const hdr = this.headersOn ? rxCanId + sep : '';

    if (payload.length <= 7) {
      const sf = [payload.length, ...payload];
      while (sf.length < 8) sf.push(0x00);
      return [hdr + bytesToHex(sf, sep)];
    }

    const totalLen = payload.length;
    const ff = [0x10 | ((totalLen >> 8) & 0x0f), totalLen & 0xff, ...payload.slice(0, 6)];
    const lines = [hdr + bytesToHex(ff, sep)];
    let offset = 6;
    let seq = 1;
    while (offset < totalLen) {
      const chunk = payload.slice(offset, offset + 7);
      while (chunk.length < 7) chunk.push(0x00);
      lines.push(hdr + bytesToHex([0x20 | (seq & 0x0f), ...chunk], sep));
      offset += 7;
      seq = (seq + 1) & 0x0f;
    }
    return lines;
  }

  private resolveResponderId(tx: string): { rx: string; bus: BusTarget } | null {
    // Stock OBD port (SGW In-Line) has NO physical wiring to Pins 3 & 11 (CAN-IHS)!
    if (!this.sgwBypassInstalled && this.activeBus === 'CAN_IHS') {
      return null;
    }

    const mapCanC: Record<string, string> = {
      '7DF': '7E8',
      '7E0': '7E8', // PCM (3.0L EcoDiesel)
      '7E1': '7E9', // TCM (ZF 8HP75)
      '747': '4C7', // ABS / ESC (wire-verified on 2021 JT 3.0L EcoDiesel!)
      '620': '504', // BCM (CAN-C interface)
      '744': '4C4', // DTCM (Transfer Case)
      '75A': '4DA', // EPS (Electric Power Steering)
      '762': '4E2', // SCCM (Steering Column Control Module)
      '740': '4C0', // ORC (Airbag / Occupant Restraint)
      '18DA10F1': '18DAF110', // PCM 29-bit
      '18DA18F1': '18DAF118', // TCM 29-bit
      '18DA40F1': '18DAF140', // BCM 29-bit
    };

    // SGW at 47E -> 47F answers ONLY when SGW is plugged in! When 12+8 bypass unplugs SGW, 47E goes silent.
    if (!this.sgwBypassInstalled) {
      mapCanC['47E'] = '47F';
      // Note: With SGW in-line, SGW routes read-only IPC 742->4C2 queries over CAN-C
      mapCanC['742'] = '4C2';
    }

    const mapCanIhs: Record<string, string> = {
      '620': '504', // BCM interior side
      '742': '4C2', // IPC (Instrument Panel Cluster)
      '680': '510', // Uconnect Radio / TGW
      '788': '789', // HVAC (+1 offset)
      '749': '4C9', // RFH (Radio Frequency Hub)
      '791': '511', // DDM (Driver Door Module)
      '792': '512', // PDM (Passenger Door Module)
    };

    if (this.activeBus === 'CAN_C' && mapCanC[tx]) {
      return { rx: mapCanC[tx], bus: 'CAN_C' };
    }
    if (this.activeBus === 'CAN_IHS' && mapCanIhs[tx]) {
      return { rx: mapCanIhs[tx], bus: 'CAN_IHS' };
    }
    return null;
  }

  private simulateVehicleResponse(req: number[]): string[] | null {
    const resolved = this.resolveResponderId(this.currentTx);
    if (!resolved) return null;
    if (this.currentCra && this.currentCra !== resolved.rx) {
      return null;
    }

    const sid = req[0];
    const t = Date.now() / 1000;

    // ── SAE Mode 01 (Live EcoDiesel Telemetry) ──
    if (sid === 0x01 && req.length >= 2) {
      const pid = req[1];
      switch (pid) {
        case 0x00:
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x00, 0xbe, 0x3f, 0xa8, 0x13]);
        case 0x04: // Engine Load ~24%
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x04, 62]);
        case 0x05: // Coolant Temp ~91°C (196°F) -> 91 + 40 = 131
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x05, 131]);
        case 0x0b: {
          // MAP kPa: gentle turbo spool breathing so radial Boost dial comes alive
          const mapKpa = Math.round(118 + Math.sin(t * 0.9) * 18);
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x0b, mapKpa]);
        }
        case 0x0c: {
          // RPM * 4: gentle breathing around EcoDiesel idle / light throttle
          const rpm4 = Math.round((780 + Math.sin(t * 1.1) * 140) * 4);
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x0c, (rpm4 >> 8) & 0xff, rpm4 & 0xff]);
        }
        case 0x0d: {
          // Speed km/h
          const kmh = Math.round(this.vehicleSpeedMph * 1.60934);
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x0d, kmh & 0xff]);
        }
        case 0x0f: // Intake Air / Intercooler Charge Temp ~34°C (93°F) -> 34 + 40 = 74
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x0f, 74]);
        case 0x10: // MAF g/s * 100 -> 11.4 g/s
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x10, 0x04, 0x74]);
        case 0x70: {
          // SAE J1979 2-Byte Diesel Boost Pressure Control (0.03125 kPa/bit -> supports >22.3 PSI Stage 2 boost!)
          const absKpa = 122 + Math.sin(t * 0.9) * 24;
          const raw70 = Math.round(absKpa / 0.03125);
          return this.formatIsoTpFrames(resolved.rx, [
            0x41,
            0x70,
            0x03, // Sensor A Commanded + Actual supported
            (raw70 >> 8) & 0xff,
            raw70 & 0xff,
            (raw70 >> 8) & 0xff,
            raw70 & 0xff,
            0x00,
            0x00,
            0x00,
            0x00,
            0x01,
          ]);
        }
        case 0x23: {
          // Diesel Common Rail Fuel Pressure (10 kPa / bit): ~29,500 kPa (~4,278 PSI at idle) -> 2950 = 0x0B86
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x23, 0x0b, 0x86]);
        }
        case 0x42: {
          // Control Module Voltage (0.001 V / bit)
          const mv = Math.round(this.batteryVolts * 1000);
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x42, (mv >> 8) & 0xff, mv & 0xff]);
        }
        case 0x46: // Ambient Temp 22°C (71.6°F) -> 62
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x46, 62]);
        case 0x5c: // Engine Oil Temp 96°C (204.8°F) -> 136
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x5c, 136]);
        case 0x78: {
          // Exhaust Gas Temp Bank 1 (Sensors 1-4): mask 0x0F, (val * 0.1 - 40) °C
          // EGT1 (Pre-Turbo) = 265°C (3050 = 0x0BEA), EGT2 (DOC Out) = 240°C (2800 = 0x0AF0),
          // EGT3 (DPF In) = 232°C (2720 = 0x0AA0), EGT4 (DPF Out) = 215°C (2550 = 0x09F6)
          return this.formatIsoTpFrames(resolved.rx, [
            0x41, 0x78, 0x0f, 0x0b, 0xea, 0x0a, 0xf0, 0x0a, 0xa0, 0x09, 0xf6,
          ]);
        }
        case 0x7a: {
          // DPF Differential Pressure: byte A=0x01 (Sensor 1 supported), B/C signed or 0.01 kPa -> 0x00 0x78 = 1.20 kPa (0.17 psi)
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x7a, 0x01, 0x00, 0x78]);
        }
        case 0x8b: {
          // Diesel Aftertreatment Status: Passive/Normal (Regen = OFF)
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0x8b, 0x03, 0x00, 0x00, 0x00, 0x00]);
        }
        case 0xa6: {
          // SAE Odometer (0.1 km / bit): 824,150 = 82,415.0 km (~51,210.3 mi) -> 0x000C9356
          return this.formatIsoTpFrames(resolved.rx, [0x41, 0xa6, 0x00, 0x0c, 0x93, 0x56]);
        }
        default:
          return null;
      }
    }

    // ── SAE Mode 09 (VIN) ──
    if (sid === 0x09 && req[1] === 0x02) {
      return this.formatIsoTpFrames(resolved.rx, [0x49, 0x02, 0x01, ...this.VIN_BYTES]);
    }

    // ── SAE Mode 03 (Emission DTCs) ──
    if (sid === 0x03) {
      return this.formatIsoTpFrames(resolved.rx, [0x43, 0x00]);
    }

    // ── SAE Mode 04 (Clear Emission DTCs — blocked by SGW if in-line!) ──
    if (sid === 0x04) {
      if (!this.sgwBypassInstalled) {
        return this.formatIsoTpFrames(resolved.rx, [0x7f, 0x04, 0x33]);
      }
      return this.formatIsoTpFrames(resolved.rx, [0x44]);
    }

    // ── UDS 0x3E TesterPresent ──
    if (sid === 0x3e) {
      return this.formatIsoTpFrames(resolved.rx, [0x7e, req[1] ?? 0x00]);
    }

    // ── UDS 0x10 DiagnosticSessionControl ──
    if (sid === 0x10) {
      const sub = req[1] ?? 0x01;
      if (sub === 0x01) {
        return this.formatIsoTpFrames(resolved.rx, [0x50, 0x01, 0x00, 0x32, 0x01, 0xf4]);
      }
      // Extended Session (10 03) is blocked by SGW when in-line (except on SGW 47E itself)
      if (!this.sgwBypassInstalled && this.currentTx !== '47E') {
        return this.formatIsoTpFrames(resolved.rx, [0x7f, 0x10, 0x33]);
      }
      return this.formatIsoTpFrames(resolved.rx, [0x50, sub, 0x00, 0x32, 0x01, 0xf4]);
    }

    // ── UDS 0x19 ReadDTCInformation (Works through stock OBD port!) ──
    if (sid === 0x19) {
      const dtcs = this.dtcStore.get(this.currentTx) ?? [];
      const payload: number[] = [0x59, req[1] ?? 0x02, 0xff];
      for (const [b1, b2, b3] of dtcs) {
        payload.push(b1, b2, b3, 0x28);
      }
      return this.formatIsoTpFrames(resolved.rx, payload);
    }

    // ── UDS 0x14 ClearDiagnosticInformation (Requires 12+8 SGW Bypass!) ──
    if (sid === 0x14) {
      if (!this.sgwBypassInstalled) {
        return this.formatIsoTpFrames(resolved.rx, [0x7f, 0x14, 0x33]);
      }
      this.dtcStore.set(this.currentTx, []);
      return this.formatIsoTpFrames(resolved.rx, [0x54]);
    }

    // ── UDS 0x22 ReadDataByIdentifier (Works Day 1 through stock OBD port!) ──
    if (sid === 0x22 && req.length >= 3) {
      const didHex = bytesToHex([req[1], req[2]], '');

      // Stellantis Extended Telemetry DIDs
      if (didHex === '1E1C') {
        // 8HP75 Transmission Fluid Temp: 82°C (179.6°F) -> 82 + 40 = 122 (0x7A)
        return this.formatIsoTpFrames(resolved.rx, [0x62, 0x1e, 0x1c, 122]);
      }
      if (didHex === '1E30') {
        // EcoDiesel DPF Soot Load %: 34.5% -> 69 * 0.5 = 34.5 (0x45)
        return this.formatIsoTpFrames(resolved.rx, [0x62, 0x1e, 0x30, 69]);
      }
      if (didHex === '043B') {
        // FCA ECM Odometer (8.192 mi/bit): 6251 * 8.192 = 51,208.2 mi -> 0x186B
        return this.formatIsoTpFrames(resolved.rx, [0x62, 0x04, 0x3b, 0x18, 0x6b]);
      }
      if (didHex === '010C' && (this.currentTx === '742' || this.currentTx === '620')) {
        // FCA IPC Odometer (0.1 km/bit, 24-bit): 824,150 = 82,415.0 km (51,210.3 mi) -> 0x0C9356
        return this.formatIsoTpFrames(resolved.rx, [0x62, 0x01, 0x0c, 0x0c, 0x93, 0x56]);
      }

      const stored = this.didStore.get(didHex);
      if (stored) {
        return this.formatIsoTpFrames(resolved.rx, [0x62, req[1], req[2], ...stored]);
      }
      return this.formatIsoTpFrames(resolved.rx, [0x7f, 0x22, 0x31]);
    }

    // ── UDS 0x2E WriteDataByIdentifier (Requires 12+8 SGW Bypass!) ──
    if (sid === 0x2e && req.length >= 4) {
      if (!this.sgwBypassInstalled) {
        return this.formatIsoTpFrames(resolved.rx, [0x7f, 0x2e, 0x33]);
      }
      const didHex = bytesToHex([req[1], req[2]], '');
      const valueBytes = req.slice(3);
      this.didStore.set(didHex, valueBytes);
      return this.formatIsoTpFrames(resolved.rx, [0x6e, req[1], req[2]]);
    }

    // ── UDS 0x2F InputOutputControlByIdentifier & 0x31 RoutineControl ──
    if (sid === 0x2f || sid === 0x31) {
      if (!this.sgwBypassInstalled) {
        return this.formatIsoTpFrames(resolved.rx, [0x7f, sid, 0x33]);
      }
      return this.formatIsoTpFrames(resolved.rx, [sid + 0x40, ...req.slice(1, 4)]);
    }

    return this.formatIsoTpFrames(resolved.rx, [0x7f, sid, 0x11]);
  }
}
