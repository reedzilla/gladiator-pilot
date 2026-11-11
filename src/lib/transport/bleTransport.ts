import { RawTransport } from './types';

export interface BleGattProfile {
  name: string;
  service: string;
  tx: string;
  rx: string;
}

/**
 * Battle-tested BLE GATT service profiles covering:
 *  - Vgate vLinker FD+ / MC+ BLE (`18F0` -> `2AF0`/`2AF1`, `E7810A71`, & `49535343`)
 *  - Veepeak OBDCheck BLE (`FFF0`) & BLE+ (`49535343` ISSC)
 *  - Nordic UART (`6E400001`) & HM-10 (`FFE0`)
 */
export const BLE_DONGLE_PROFILES: readonly BleGattProfile[] = [
  {
    name: '18F0 UART (Vgate vLinker FD+ / MC+ BLE)',
    service: '000018f0-0000-1000-8000-00805f9b34fb',
    tx: '00002af1-0000-1000-8000-00805f9b34fb',
    rx: '00002af0-0000-1000-8000-00805f9b34fb',
  },
  {
    name: 'FFF0 UART (Veepeak BLE / Vgate)',
    service: '0000fff0-0000-1000-8000-00805f9b34fb',
    tx: '0000fff2-0000-1000-8000-00805f9b34fb',
    rx: '0000fff1-0000-1000-8000-00805f9b34fb',
  },
  {
    name: 'ISSC Transparent UART (Veepeak BLE+ / vLinker BLE)',
    service: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    tx: '49535343-8841-43f4-a8d4-ecbe34729bb3',
    rx: '49535343-1e4d-4bd9-ba61-23c647249616',
  },
  {
    name: 'E7810A71 UART (vLinker FD+ / STN BLE)',
    service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    tx: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
    rx: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  },
  {
    name: 'FFE0 UART (ELM327 BLE)',
    service: '0000ffe0-0000-1000-8000-00805f9b34fb',
    tx: '0000ffe1-0000-1000-8000-00805f9b34fb',
    rx: '0000ffe1-0000-1000-8000-00805f9b34fb',
  },
  {
    name: 'Nordic NUS UART',
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  },
];

const ALL_BLE_SERVICES = BLE_DONGLE_PROFILES.map((p) => p.service);
const BLE_CHUNK_BYTES = 20;

export class BleTransport implements RawTransport {
  public readonly kind = 'ble' as const;
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private dataListeners = new Set<(chunk: string) => void>();
  private disconnectListeners = new Set<() => void>();
  private decoder = new TextDecoder('utf-8');
  private encoder = new TextEncoder();

  public get deviceName(): string {
    return this.device?.name || 'BLE OBD Adapter';
  }

  public get isConnected(): boolean {
    return Boolean(this.server?.connected && this.txChar);
  }

  public async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error(
        'Web Bluetooth is unavailable in this browser. Use Chrome or Edge over localhost or HTTPS.'
      );
    }

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ALL_BLE_SERVICES,
    });

    this.device = device;
    device.addEventListener('gattserverdisconnected', this.handleGattDisconnected);

    if (!device.gatt) {
      throw new Error('Selected Bluetooth device does not expose a GATT server.');
    }

    const server = await device.gatt.connect();
    this.server = server;

    let matchedProfile: BleGattProfile | null = null;
    for (const profile of BLE_DONGLE_PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.service);
        const rx = await service.getCharacteristic(profile.rx);
        const tx =
          profile.tx === profile.rx
            ? rx
            : await service.getCharacteristic(profile.tx);

        await rx.startNotifications();
        rx.addEventListener('characteristicvaluechanged', this.handleValueChanged);
        this.rxChar = rx;
        this.txChar = tx;
        matchedProfile = profile;
        break;
      } catch {
        // Try next GATT profile
      }
    }

    if (!matchedProfile || !this.txChar) {
      server.disconnect();
      throw new Error(
        `Connected to "${device.name || 'device'}", but none of the ${BLE_DONGLE_PROFILES.length} OBD UART GATT services were found. ` +
          'Note: If pairing vLinker FD+ via Bluetooth Classic 3.0 on Windows, choose "USB / BT Serial COM" instead of BLE.'
      );
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.rxChar) {
        this.rxChar.removeEventListener('characteristicvaluechanged', this.handleValueChanged);
        try {
          await this.rxChar.stopNotifications();
        } catch {
          /* ignore */
        }
      }
      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this.handleGattDisconnected);
      }
      if (this.server?.connected) {
        this.server.disconnect();
      }
    } finally {
      this.txChar = null;
      this.rxChar = null;
      this.server = null;
    }
  }

  public async write(command: string): Promise<void> {
    if (!this.txChar || !this.server?.connected) {
      throw new Error('BLE adapter is not connected.');
    }
    const payload = command.endsWith('\r') ? command : `${command}\r`;
    const bytes = this.encoder.encode(payload);

    for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK_BYTES) {
      const slice = bytes.slice(offset, offset + BLE_CHUNK_BYTES);
      if (
        this.txChar.properties.writeWithoutResponse &&
        typeof this.txChar.writeValueWithoutResponse === 'function'
      ) {
        await this.txChar.writeValueWithoutResponse(slice);
      } else if (typeof this.txChar.writeValueWithResponse === 'function') {
        await this.txChar.writeValueWithResponse(slice);
      } else {
        await this.txChar.writeValue(slice);
      }
      if (offset + BLE_CHUNK_BYTES < bytes.length) {
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  }

  public onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private handleValueChanged = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null;
    if (!target?.value) return;
    const text = this.decoder.decode(target.value, { stream: true });
    if (!text) return;
    for (const cb of this.dataListeners) cb(text);
  };

  private handleGattDisconnected = () => {
    this.txChar = null;
    this.rxChar = null;
    for (const cb of this.disconnectListeners) cb();
  };
}
