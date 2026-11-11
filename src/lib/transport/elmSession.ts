import { assembleIsoTpResponse, UdsResponse } from './isotp';
import {
  AdapterCapabilities,
  AddressingBits,
  BusTarget,
  EcuEndpoint,
  RawTransport,
  TerminalLogEntry,
} from './types';
import {
  buildBusSwitchSequence,
  buildPrimaryBusRestoreSequence,
  detectAdapterCapabilities,
} from './vlinkerBusSwitch';

export interface ElmSessionEvents {
  onLog?: (entry: TerminalLogEntry) => void;
  onMonitorFrame?: (rawLine: string, bus: BusTarget) => void;
  onBusChange?: (bus: BusTarget) => void;
  onDisconnect?: () => void;
}

/**
 * ElmSession — Deterministic FIFO Command Coordinator & UDS / Mode 01 Dispatcher
 *
 * Key FCA / Jeep JT guarantees:
 *  1. Strict FIFO command mutex (`queueTail`) so cockpit polling, DID sweeps, and manual commands never collide.
 *  2. Post-timeout RX drain window (`250 ms`) so late ECU frames never contaminate the next command.
 *  3. Explicit `ATCRA <rxId>` receive filtering + `ATFCSH <txId>` / `ATFCSD 300000` / `ATFCSM 1` flow-control
 *     routing for asymmetric FCA modules (`747 -> 4C7` ABS, `742 -> 4C2` IPC, `620 -> 504` BCM, `47E -> 47F` SGW).
 *  4. Guaranteed `try ... finally` primary bus (`CAN_C` 500 kbps) restoration around `CAN_IHS` (125 kbps) excursions.
 */
export class ElmSession {
  public capabilities: AdapterCapabilities | null = null;
  public activeBus: BusTarget = 'CAN_C';
  private activeBits: AddressingBits = 11;
  private currentTxId: string | null = null;
  private currentRxId: string | null = null;
  private isMonitoring = false;

  private queueTail: Promise<unknown> = Promise.resolve();
  private rxQuietUntil = 0;
  private readonly RX_QUIET_MS = 250;

  private rxBuffer = '';
  private pendingPromptResolve: ((raw: string) => void) | null = null;
  private unsubData: (() => void) | null = null;
  private unsubDisconnect: (() => void) | null = null;

  constructor(
    public readonly transport: RawTransport,
    private readonly events: ElmSessionEvents = {}
  ) {}

  public get isConnected(): boolean {
    return this.transport.isConnected;
  }

  public get monitoring(): boolean {
    return this.isMonitoring;
  }

  private emitLog(direction: TerminalLogEntry['direction'], text: string, bus = this.activeBus): void {
    this.events.onLog?.({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      direction,
      bus,
      text,
    });
  }

  public async initialize(): Promise<AdapterCapabilities> {
    if (!this.transport.isConnected) {
      await this.transport.connect();
    }

    this.unsubData = this.transport.onData((chunk) => this.handleIncomingChunk(chunk));
    this.unsubDisconnect = this.transport.onDisconnect(() => {
      this.isMonitoring = false;
      this.emitLog('warn', 'Adapter link disconnected.');
      this.events.onDisconnect?.();
    });

    this.emitLog('info', `Opening ${this.transport.deviceName}...`);

    // Reset & clean ELM framing: Echo OFF, Linefeeds OFF, Spaces OFF, Headers ON, Adaptive Timing 1
    await this.sendCommand('ATZ', 2500);
    await this.sendCommand('ATE0', 1000);
    await this.sendCommand('ATL0', 1000);
    await this.sendCommand('ATS0', 1000);
    await this.sendCommand('ATH1', 1000);
    await this.sendCommand('ATCAF1', 1000);
    await this.sendCommand('ATCFC1', 1000);
    await this.sendCommand('ATAT1', 1000);
    // Generous UDS timeout (~204 ms = 0x32 * 4 ms) so BCM multi-block reads don't clip
    await this.sendCommand('ATST 32', 1000);

    const caps = await detectAdapterCapabilities(
      (cmd, t) => this.sendCommand(cmd, t),
      this.transport.kind,
      this.transport.deviceName
    );
    this.capabilities = caps;

    // Set initial bus to CAN-C (500 kbps, 11-bit, Pins 6 & 14)
    await this.switchBus('CAN_C', 11, true);

    this.emitLog(
      'info',
      `Ready: ${caps.chipFamily} (${caps.atiBanner}) · MS-CAN/CAN-IHS Pins 3&11: ${
        caps.supportsMsCanPins3And11 ? 'SUPPORTED' : 'NO (Pins 6&14 only)'
      }`
    );

    return caps;
  }

  public async close(): Promise<void> {
    if (this.isMonitoring) {
      await this.stopPassiveMonitor().catch(() => undefined);
    }
    this.unsubData?.();
    this.unsubDisconnect?.();
    await this.transport.disconnect();
  }

  private handleIncomingChunk(chunk: string): void {
    if (this.isMonitoring) {
      this.rxBuffer += chunk;
      const lines = this.rxBuffer.split(/[\r\n]+/);
      this.rxBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const clean = line.replace(/>/g, '').trim();
        if (clean) {
          this.events.onMonitorFrame?.(clean, this.activeBus);
        }
        if (line.includes('>') && this.pendingPromptResolve) {
          const resolve = this.pendingPromptResolve;
          this.pendingPromptResolve = null;
          resolve(clean);
        }
      }
      return;
    }

    this.rxBuffer += chunk;
    if (this.rxBuffer.includes('>') && this.pendingPromptResolve) {
      const full = this.rxBuffer;
      this.rxBuffer = '';
      const resolve = this.pendingPromptResolve;
      this.pendingPromptResolve = null;
      resolve(full);
    }
  }

  /**
   * Serialized raw AT / ST / hex command execution.
   */
  public sendCommand(command: string, timeoutMs = 2000): Promise<string> {
    const run = async (): Promise<string> => {
      if (this.isMonitoring) {
        await this.stopPassiveMonitor();
      }

      const waitDrain = this.rxQuietUntil - Date.now();
      if (waitDrain > 0) {
        await new Promise((r) => setTimeout(r, waitDrain));
      }

      const trimmedCmd = command.trim();
      this.rxBuffer = '';
      this.emitLog('tx', trimmedCmd);

      const response = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingPromptResolve = null;
          const partial = this.rxBuffer;
          this.rxBuffer = '';
          this.rxQuietUntil = Date.now() + this.RX_QUIET_MS;
          if (partial.trim()) {
            resolve(partial);
          } else {
            reject(new Error(`Timeout (${timeoutMs} ms) waiting for prompt on "${trimmedCmd}"`));
          }
        }, timeoutMs);

        this.pendingPromptResolve = (raw) => {
          clearTimeout(timer);
          resolve(raw);
        };

        this.transport.write(trimmedCmd).catch((err) => {
          clearTimeout(timer);
          this.pendingPromptResolve = null;
          reject(err);
        });
      });

      const cleaned = response.replace(/>/g, '').trim();
      this.emitLog('rx', cleaned || '(empty)');
      return cleaned;
    };

    const next = this.queueTail.then(run, run);
    this.queueTail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Switch physical CAN bus (`CAN_C` 500k Pins 6/14 vs `CAN_IHS` 125k Pins 3/11) and 11/29-bit mode.
   */
  public async switchBus(bus: BusTarget, bits: AddressingBits = 11, force = false): Promise<void> {
    if (!force && this.activeBus === bus && this.activeBits === bits) return;
    if (!this.capabilities) {
      throw new Error('Adapter capabilities not initialized.');
    }

    const cmds = buildBusSwitchSequence(bus, bits, this.capabilities);
    for (const cmd of cmds) {
      const resp = await this.sendCommand(cmd, 2000);
      if (resp === '?' || /\bERROR\b/i.test(resp)) {
        throw new Error(`Adapter rejected bus switch command "${cmd}" -> "${resp}"`);
      }
    }

    // Re-assert framing after protocol change (ATSP / STP resets header/filter state on some chips)
    await this.sendCommand('ATH1', 1000);
    await this.sendCommand('ATS0', 1000);
    await this.sendCommand('ATCAF1', 1000);
    await this.sendCommand('ATCFC1', 1000);

    this.activeBus = bus;
    this.activeBits = bits;
    this.currentTxId = null;
    this.currentRxId = null;
    this.events.onBusChange?.(bus);
  }

  /**
   * Execute work on `CAN_IHS` (or 29-bit) and ALWAYS restore primary `CAN_C` 11-bit in `finally`.
   */
  public async withBusSafetyRestore<T>(
    targetBus: BusTarget,
    bits: AddressingBits,
    fn: () => Promise<T>
  ): Promise<T> {
    const needRestore = targetBus !== 'CAN_C' || bits !== 11;
    try {
      await this.switchBus(targetBus, bits);
      return await fn();
    } finally {
      if (needRestore && this.capabilities && this.transport.isConnected) {
        try {
          for (const cmd of buildPrimaryBusRestoreSequence(this.capabilities)) {
            await this.sendCommand(cmd, 1500);
          }
          await this.sendCommand('ATH1', 1000);
          await this.sendCommand('ATS0', 1000);
          this.activeBus = 'CAN_C';
          this.activeBits = 11;
          this.currentTxId = null;
          this.currentRxId = null;
          this.events.onBusChange?.('CAN_C');
        } catch (err) {
          this.emitLog('error', `Primary CAN-C restore warning: ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Target a specific Gladiator ECU endpoint, configuring `ATSH`, `ATCRA`, and asymmetric ISO-TP Flow Control (`ATFCSH`).
   */
  public async targetEndpoint(ecu: EcuEndpoint): Promise<void> {
    if (this.activeBus !== ecu.bus || this.activeBits !== ecu.bits) {
      await this.switchBus(ecu.bus, ecu.bits);
    }

    if (this.currentTxId === ecu.txId && this.currentRxId === ecu.rxId) {
      return;
    }

    if (ecu.bits === 29) {
      const cleanTx = ecu.txId.replace(/\s+/g, '').toUpperCase();
      const cleanRx = ecu.rxId.replace(/\s+/g, '').toUpperCase();
      const cp = cleanTx.slice(0, 2);
      const sh = cleanTx.slice(2);
      await this.sendCommand(`ATCP ${cp}`, 1000);
      await this.sendCommand(`ATSH ${sh}`, 1000);
      await this.sendCommand(`ATCRA ${cleanRx}`, 1000);
      await this.sendCommand('ATFCSM 0', 1000);
    } else {
      const cleanTx = ecu.txId.replace(/\s+/g, '').toUpperCase();
      const cleanRx = ecu.rxId.replace(/\s+/g, '').toUpperCase();
      await this.sendCommand(`ATSH ${cleanTx}`, 1000);
      await this.sendCommand(`ATCRA ${cleanRx}`, 1000);

      // CRITICAL FCA FIX: Asymmetric modules (747->4C7 ABS, 742->4C2 IPC, 620->504 BCM, 47E->47F SGW)
      // require explicit Flow Control TX header (`ATFCSH <txId>`) so multi-frame DID reads (>7 bytes)
      // don't send Flow Control (`30 00 00`) to `rxId - 8`!
      if (ecu.scheme !== 'standard_plus8') {
        await this.sendCommand(`ATFCSH ${cleanTx}`, 1000);
        await this.sendCommand('ATFCSD 300000', 1000);
        await this.sendCommand('ATFCSM 1', 1000);
      } else {
        await this.sendCommand('ATFCSM 0', 1000);
      }
    }

    this.currentTxId = ecu.txId;
    this.currentRxId = ecu.rxId;
  }

  /**
   * Send a UDS / Mode 01 request (hex string e.g. `"22 F1 90"` or `"01 0C"`) to `ecu` and assemble ISO-TP reply.
   * Pass `expectedSingleFrameCount = 1` ONLY on guaranteed 1-frame Mode 01 PIDs so ELM327/STN returns immediately
   * after the first CAN frame instead of waiting `ATST` (~200 ms) for additional responders!
   */
  public async requestUds(
    ecu: EcuEndpoint,
    hexPayload: string,
    timeoutMs = 2500,
    expectedSingleFrameCount?: 1
  ): Promise<UdsResponse> {
    await this.targetEndpoint(ecu);
    const cleanHex = hexPayload.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    const wireCmd = expectedSingleFrameCount === 1 ? `${cleanHex} 1` : cleanHex;
    const raw = await this.sendCommand(wireCmd, timeoutMs);
    return assembleIsoTpResponse(raw, {
      expectedRxId: ecu.rxId.toUpperCase(),
      expectedBits: ecu.bits,
    });
  }

  /**
   * Query standard SAE J1979 Mode 01 / Mode 09 broadcast (`7DF` -> `7E8`/`7E9`) on CAN-C.
   */
  public async requestObdBroadcast(hexCmd: string, timeoutMs = 1800): Promise<UdsResponse> {
    if (this.activeBus !== 'CAN_C' || this.activeBits !== 11) {
      await this.switchBus('CAN_C', 11);
    }
    if (this.currentTxId !== '7DF' || this.currentRxId !== 'ALL') {
      await this.sendCommand('ATFCSM 0', 1000);
      await this.sendCommand('ATCRA', 1000);
      await this.sendCommand('ATSH 7DF', 1000);
      this.currentTxId = '7DF';
      this.currentRxId = 'ALL';
    }
    const cleanHex = hexCmd.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    const raw = await this.sendCommand(cleanHex, timeoutMs);
    return assembleIsoTpResponse(raw, { expectedBits: 11 });
  }

  /**
   * Read battery voltage from Pin 16 (`ATRV`), bounded to realistic 6.0V – 30.0V range.
   */
  public async readPin16Voltage(): Promise<number | null> {
    try {
      const raw = await this.sendCommand('ATRV', 1200);
      const m = raw.match(/(\d{1,2}\.\d{1,2})/);
      if (!m) return null;
      const v = parseFloat(m[1]);
      return v >= 6.0 && v <= 30.0 ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Start passive CAN / UDS Y-Splitter Monitor (`STMA` on STN/vLinker, `ATMA` on ELM327).
   */
  public async startPassiveMonitor(bus: BusTarget, filterCanId?: string): Promise<void> {
    await this.switchBus(bus, 11);
    await this.sendCommand('ATH1', 1000);
    await this.sendCommand('ATS1', 1000); // Spaces ON makes passive frame parsing unambiguous
    if (filterCanId && /^[0-9A-Fa-f]{3}$/.test(filterCanId.trim())) {
      await this.sendCommand(`ATCRA ${filterCanId.trim().toUpperCase()}`, 1000);
    } else {
      await this.sendCommand('ATCRA', 1000);
    }

    const monitorCmd = this.capabilities?.supportsMsCanPins3And11 ? 'STMA' : 'ATMA';
    this.rxBuffer = '';
    this.isMonitoring = true;
    this.emitLog('info', `Started passive monitor (${monitorCmd}) on ${bus}.`);
    await this.transport.write(monitorCmd);
  }

  /**
   * Stop passive `ATMA` / `STMA` stream cleanly and restore `ATS0` + `ATCRA`.
   */
  public async stopPassiveMonitor(): Promise<void> {
    if (!this.isMonitoring) return;
    this.isMonitoring = false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPromptResolve = null;
        resolve();
      }, 800);
      this.pendingPromptResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      // Any single character aborts ATMA / STMA on ELM327 & STN
      this.transport.write('X').catch(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.rxBuffer = '';
    this.currentTxId = null;
    this.currentRxId = null;
    await this.sendCommand('ATS0', 1000).catch(() => undefined);
    await this.sendCommand('ATCRA', 1000).catch(() => undefined);
    this.emitLog('info', 'Stopped passive monitor.');
  }
}
