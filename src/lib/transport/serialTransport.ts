import { RawTransport } from './types';

const CANDIDATE_BAUD_RATES = [115200, 38400, 500000, 9600, 57600] as const;

/**
 * Web Serial transport supporting:
 *  - Vgate vLinker FD+ over Windows Bluetooth Classic SPP COM port
 *  - OBDLink EX / SX / USB ELM327 / STN interfaces
 */
export class SerialTransport implements RawTransport {
  public readonly kind = 'serial' as const;
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private activeBaud = 115200;
  private reading = false;
  private dataListeners = new Set<(chunk: string) => void>();
  private disconnectListeners = new Set<() => void>();
  private decoder = new TextDecoder('utf-8');
  private encoder = new TextEncoder();

  public get deviceName(): string {
    return `Serial COM @ ${this.activeBaud} baud`;
  }

  public get isConnected(): boolean {
    return Boolean(this.port && this.writer && this.reading);
  }

  public async connect(): Promise<void> {
    if (!navigator.serial) {
      throw new Error('Web Serial is unavailable in this browser. Use desktop Chrome or Edge.');
    }

    const port = await navigator.serial.requestPort();
    this.port = port;

    let connectedBaud: number | null = null;
    for (const baudRate of CANDIDATE_BAUD_RATES) {
      try {
        await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        this.activeBaud = baudRate;
        this.startReadLoop();
        if (!port.writable) throw new Error('Serial port is not writable.');
        this.writer = port.writable.getWriter();

        const probeOk = await this.probePrompt(950);
        if (probeOk) {
          // Brief settle window so any trailing CR/LF after '>' never leaks into ATZ
          await new Promise((r) => setTimeout(r, 35));
          connectedBaud = baudRate;
          break;
        }
        await this.closeStreamsOnly();
        await port.close();
      } catch {
        try {
          await this.closeStreamsOnly();
          await port.close();
        } catch {
          /* ignore */
        }
      }
    }

    if (!connectedBaud) {
      this.port = null;
      throw new Error(
        'Opened serial port, but adapter did not answer ATI/ATZ across 115200 / 38400 / 500000 / 9600 / 57600 baud.'
      );
    }
  }

  private async probePrompt(timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let buf = '';
      const timer = setTimeout(() => {
        unsub();
        resolve(false);
      }, timeoutMs);

      const unsub = this.onData((chunk) => {
        buf += chunk;
        // Wait for the full '>' prompt terminator so a late '>' never desyncs ElmSession's FIFO queue
        if (buf.includes('>') && /ELM|STN|vLinker|OK|\?/i.test(buf)) {
          clearTimeout(timer);
          unsub();
          resolve(true);
        }
      });

      this.write('ATI').catch(() => {
        clearTimeout(timer);
        unsub();
        resolve(false);
      });
    });
  }

  private startReadLoop(): void {
    if (!this.port?.readable) return;
    this.reading = true;
    const reader = this.port.readable.getReader();
    this.reader = reader;

    (async () => {
      try {
        while (this.reading) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            const text = this.decoder.decode(value, { stream: true });
            if (text) {
              for (const cb of this.dataListeners) cb(text);
            }
          }
        }
      } catch {
        if (this.reading) {
          this.reading = false;
          for (const cb of this.disconnectListeners) cb();
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    })();
  }

  private async closeStreamsOnly(): Promise<void> {
    this.reading = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* ignore */
      }
      this.reader = null;
    }
    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch {
        /* ignore */
      }
      this.writer = null;
    }
  }

  public async disconnect(): Promise<void> {
    await this.closeStreamsOnly();
    if (this.port) {
      try {
        await this.port.close();
      } catch {
        /* ignore */
      }
      this.port = null;
    }
  }

  public async write(command: string): Promise<void> {
    if (!this.writer) throw new Error('Serial port is not connected.');
    const payload = command.endsWith('\r') ? command : `${command}\r`;
    await this.writer.write(this.encoder.encode(payload));
  }

  public onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }
}
