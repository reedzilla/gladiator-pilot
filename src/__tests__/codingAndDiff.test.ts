import { describe, expect, it } from 'vitest';
import {
  applySurgicalBitFlip,
  applySurgicalBytePatch,
  calculateTireCircumferenceFromDiameter,
  encodeAxleRatioHex16,
  evaluateWritePreflight,
  metricTireToDiameterIn,
} from '../lib/gladiator/codingCalibrators';
import { diffSnapshots } from '../lib/gladiator/didScanner';

describe('Tire/Axle Calculators, Surgical Bit Patcher & Write Safety Gates', () => {
  it('computes accurate tire circumference in mm & hex16 for 35" tires', () => {
    const calc = calculateTireCircumferenceFromDiameter(35.0, 0.97);
    // 35 * 0.97 = 33.95 in * 25.4 * pi = 2709 mm (0x0A95)
    expect(calc.effectiveDiameterIn).toBe(33.95);
    expect(calc.circumferenceMm).toBe(2709);
    expect(calc.hex16BigEndian).toBe('0A 95');

    const d315 = metricTireToDiameterIn(315, 70, 17);
    expect(d315).toBeGreaterThan(34.3);
    expect(d315).toBeLessThan(34.4);

    const g456 = encodeAxleRatioHex16(4.56);
    expect(g456.scaledInt).toBe(456);
    expect(g456.hex16BigEndian).toBe('01 C8');
  });

  it('patches single bits and byte slices without altering neighboring bytes', () => {
    const orig = '09 D5 01 75 25 25 00 01';
    const patchedTire = applySurgicalBytePatch(orig, 0, [0x0a, 0x95]);
    expect(patchedTire).toBe('0A 95 01 75 25 25 00 01');

    // Flip bit 4 of byte 6 to 1, leaving byte 7 (0x01) untouched
    const bitFlipped = applySurgicalBitFlip(patchedTire, 6, 4, 1);
    expect(bitFlipped).toBe('0A 95 01 75 25 25 10 01');

    const diffs = diffSnapshots(
      { dids: { '0130': orig } },
      { dids: { '0130': bitFlipped } }
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0].byteDiffs.map((b) => b.byteIndex)).toEqual([0, 1, 6]);
    expect(diffs[0].byteDiffs[2].changedBits).toEqual([{ bit: 4, before: 0, after: 1 }]);
  });

  it('enforces all 5 mechanical write preflight gates', () => {
    const blockedSgw = evaluateWritePreflight({
      connected: true,
      sgwState: 'sgw_inline_readonly',
      batteryVolts: 12.6,
      speedMph: 0,
      hasAsBuiltBackupForDid: true,
    });
    expect(blockedSgw.canWrite).toBe(false);
    expect(blockedSgw.blockerSummary).toContain('12+8 SGW Bypass');

    const blockedLowVolts = evaluateWritePreflight({
      connected: true,
      sgwState: 'bypass_active',
      batteryVolts: 11.7,
      speedMph: 0,
      hasAsBuiltBackupForDid: true,
    });
    expect(blockedLowVolts.canWrite).toBe(false);

    const blockedNoBackup = evaluateWritePreflight({
      connected: true,
      sgwState: 'bypass_active',
      batteryVolts: 12.5,
      speedMph: 0,
      hasAsBuiltBackupForDid: false,
    });
    expect(blockedNoBackup.canWrite).toBe(false);

    const ready = evaluateWritePreflight({
      connected: true,
      sgwState: 'bypass_active',
      batteryVolts: 12.5,
      speedMph: 0,
      hasAsBuiltBackupForDid: true,
    });
    expect(ready.canWrite).toBe(true);
  });
});
