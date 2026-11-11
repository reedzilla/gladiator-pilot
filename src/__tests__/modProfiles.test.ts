import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { findModuleById } from '../lib/gladiator/moduleCatalog';
import { writeDidVerified } from '../lib/gladiator/codingCalibrators';
import {
  decodeMode01EgtBank1F,
  decodeMode01HighRangeBoostPsi,
} from '../lib/gladiator/ecodieselPids';
import {
  autoBackupAndApplyDid,
  computeDrivetrainImpact,
  decodeLightingDid0131,
  encodeLightingDid0131,
} from '../lib/gladiator/modProfiles';
import { vaultDb } from '../lib/storage/vaultDb';
import { ElmSession } from '../lib/transport/elmSession';
import { GladiatorSimTransport } from '../lib/transport/gladiatorSimTransport';

describe('Uconnect V2 Mod Profiles, 8HP75 Drivetrain Impact & Auto-Backup Pipeline', () => {
  it('computes GPS speedo error and ZF 8HP75 8th-gear 70 MPH cruise RPM accurately', () => {
    // 35" tires (33.95" effective) on stock 3.73 EcoDiesel gears
    const stock373On35 = computeDrivetrainImpact({
      newEffectiveDiameterIn: 33.95,
      axleRatio: 3.73,
    });
    expect(stock373On35.actualGpsMphAt65).toBeGreaterThan(72.0);
    expect(stock373On35.speedoDeltaMph).toBeGreaterThan(7.0);
    expect(stock373On35.rpmAt70Mph8thGear).toBeGreaterThan(1700);
    expect(stock373On35.rpmAt70Mph8thGear).toBeLessThan(1800);
    expect(stock373On35.inEcoDieselSweetSpot).toBe(true);

    // 37" tires (35.89" effective) re-geared to 4.56 stays right in EcoDiesel sweet spot
    const regeared456On37 = computeDrivetrainImpact({
      newEffectiveDiameterIn: 35.89,
      axleRatio: 4.56,
    });
    expect(regeared456On37.inEcoDieselSweetSpot).toBe(true);
  });

  it('round-trips LED & Fog Drop-Out toggles in DID 0131 while preserving neighboring bytes', () => {
    const stock = '00 10 04 01 00 00';
    const decoded = decodeLightingDid0131(stock);
    expect(decoded.ledHeadlamps).toBe(false);
    expect(decoded.dedicatedDrl).toBe(true);

    const updatedHex = encodeLightingDid0131(stock, {
      ...decoded,
      ledHeadlamps: true,
      fogDropOutDisable: true,
    });
    // Bytes 2..5 ('04 01 00 00') must remain 100% untouched!
    expect(updatedHex.endsWith('04 01 00 00')).toBe(true);

    const redecoded = decodeLightingDid0131(updatedHex);
    expect(redecoded.ledHeadlamps).toBe(true);
    expect(redecoded.fogDropOutDisable).toBe(true);
    expect(redecoded.dedicatedDrl).toBe(true);
  });

  it('automatically backs up original stock DID bytes to Vault on first 1-click Apply', async () => {
    await vaultDb.snapshots.clear();
    const sim = new GladiatorSimTransport({ sgwBypassInstalled: true, replyDelayMs: 0 });
    const session = new ElmSession(sim);
    await session.initialize();

    const bcm = findModuleById('BCM_C');
    const res = await autoBackupAndApplyDid({
      session,
      ecu: bcm,
      didHex: '0131',
      vin: '1C6JJTAM0ML000000',
      existingSnapshots: [],
      transform: (cur) =>
        encodeLightingDid0131(cur, {
          ...decodeLightingDid0131(cur),
          ledHeadlamps: true,
          fogDropOutDisable: true,
        }),
    });

    expect(res.ok).toBe(true);
    expect(res.autoBackedUp).toBe(true);

    const savedSnaps = await vaultDb.snapshots.toArray();
    expect(savedSnaps).toHaveLength(1);
    // Saved snapshot must hold the ORIGINAL factory bytes ('00 10 04 01 00 00'), not the modified bytes!
    expect(savedSnaps[0].dids['0131']).toBe('00 10 04 01 00 00');

    await session.close();
  });

  it('hard-locks Stage 2 Tuned PCM (7E0) against accidental 0x2E writes', async () => {
    const sim = new GladiatorSimTransport({ sgwBypassInstalled: true, replyDelayMs: 0 });
    const session = new ElmSession(sim);
    await session.initialize();

    const pcm = findModuleById('PCM');
    const res = await writeDidVerified(session, pcm, '0130', '0A 9E');
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('Stage 2 ECM Tune-Lock Active');

    await session.close();
  });

  it('decodes Stage 2 high-range 2-byte diesel boost (>22.3 PSI) & filters open-circuit EGT probes', () => {
    // 322 kPa absolute (~32.0 PSI gauge boost): 322 / 0.03125 = 10304 = 0x2840
    const boostPsi = decodeMode01HighRangeBoostPsi([
      0x41, 0x70, 0x03, 0x28, 0x40, 0x28, 0x40, 0x00, 0x00, 0x00, 0x00, 0x01,
    ]);
    expect(boostPsi).toBeGreaterThan(31.5);
    expect(boostPsi).toBeLessThan(32.5);

    // EGT1 connected at 315°C (~599°F -> raw 3550 = 0x0DDE), EGT2/3/4 unplugged on race pipe (0xFFFF, 0x0000)
    const egts = decodeMode01EgtBank1F([
      0x41, 0x78, 0x0f, 0x0d, 0xde, 0xff, 0xff, 0x00, 0x00, 0xff, 0xfe,
    ]);
    expect(egts.egt1).toBe(599);
    expect(egts.egt2).toBeNull();
    expect(egts.egt3).toBeNull();
    expect(egts.egt4).toBeNull();
  });
});
