import { describe, expect, it } from 'vitest';
import {
  buildBusSwitchSequence,
  buildPrimaryBusRestoreSequence,
  detectAdapterCapabilities,
} from '../lib/transport/vlinkerBusSwitch';

describe('Vgate vLinker FD+ (V-LINK01) vs Veepeak BLE Detection & STP 53 Switching', () => {
  it('recognizes vLinker FD+ via VTI + STPR/STP 53/STPRS without transmitting on the bus', async () => {
    const sent: string[] = [];
    const mockSend = async (cmd: string): Promise<string> => {
      sent.push(cmd);
      switch (cmd) {
        case 'ATI':
          return 'ELM327 v2.2';
        case 'AT@1':
          return 'VGATE VLINKER FD+';
        case 'STI':
          return '?'; // V-LINK01 may reject STI or omit STNxxxx while answering VTI + STP!
        case 'VTI':
          return 'vLinker FD+ V-LINK01 v2.2.88';
        case 'STPR':
          return '33';
        case 'STP 53':
          return 'OK';
        case 'STPRS':
          return 'ISO 15765, 125kbps, 11B, MS-CAN';
        case 'STP 33':
          return 'OK';
        default:
          return '?';
      }
    };

    const caps = await detectAdapterCapabilities(mockSend, 'ble', 'vLinker FD+');
    expect(caps.chipFamily).toBe('V-LINK01');
    expect(caps.supportsMsCanPins3And11).toBe(true);
    expect(caps.isotpBufferBytes).toBe(2048);
    // Must NEVER send STPO or STPX during capability detection
    expect(sent).not.toContain('STPO');

    expect(buildBusSwitchSequence('CAN_IHS', 11, caps)).toEqual([
      'STPC',
      'STP 53',
      'STPRS',
      'STPO',
    ]);
    expect(buildBusSwitchSequence('CAN_C', 29, caps)).toEqual([
      'STPC',
      'STP 34',
      'STPRS',
      'STPO',
    ]);
    expect(buildPrimaryBusRestoreSequence(caps)).toContain('STP 33');
  });

  it('classifies Veepeak BLE v2.2 as CAN-C only and blocks CAN-IHS switch cleanly', async () => {
    const mockVeepeak = async (cmd: string): Promise<string> => {
      if (cmd === 'ATI') return 'ELM327 v2.2';
      if (cmd === 'AT@1') return 'OBDII to RS232 Interpreter';
      return '?';
    };

    const caps = await detectAdapterCapabilities(mockVeepeak, 'ble', 'VEEPEAK');
    expect(caps.chipFamily).toBe('ELM327');
    expect(caps.supportsMsCanPins3And11).toBe(false);
    expect(buildBusSwitchSequence('CAN_C', 11, caps)).toEqual(['ATSP 6']);
    expect(() => buildBusSwitchSequence('CAN_IHS', 11, caps)).toThrow(/Pins 3 & 11/);
  });
});
