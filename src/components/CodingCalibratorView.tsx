import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Gauge,
  Lightbulb,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sliders,
  Timer,
  UploadCloud,
} from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';
import { playAlertChime } from '../lib/gladiator/telemetryLogger';
import {
  applySurgicalBitFlip,
  applySurgicalBytePatch,
  calculateTireCircumferenceFromDiameter,
  encodeAxleRatioHex16,
  GLADIATOR_AXLE_RATIOS,
  GLADIATOR_TIRE_PRESETS,
  restoreSnapshotToEcu,
} from '../lib/gladiator/codingCalibrators';
import { findModuleById, GLADIATOR_MODULES } from '../lib/gladiator/moduleCatalog';
import {
  autoBackupAndApplyDid,
  AuxComfortState,
  computeDrivetrainImpact,
  decodeComfortDid0132,
  decodeLightingDid0131,
  encodeComfortDid0132,
  encodeLightingDid0131,
  LightingConfigState,
} from '../lib/gladiator/modProfiles';
import { bytesToHex, hexToBytes } from '../lib/transport/isotp';
import { OfflineLinkBanner } from './OfflineLinkBanner';

interface RockerToggleProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

const RockerToggle: React.FC<RockerToggleProps> = ({ label, hint, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition ${
      checked
        ? 'border-orange-500/55 bg-orange-500/12 shadow-[inset_0_1px_0_rgba(249,115,22,0.2)]'
        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
    }`}
  >
    <div>
      <div className="text-xs font-bold text-slate-100">{label}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>
    </div>
    <div
      className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${
        checked ? 'bg-orange-500 justify-end' : 'bg-slate-800 justify-start'
      }`}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow" />
    </div>
  </button>
);

export const CodingCalibratorView: React.FC = () => {
  const {
    session,
    simTransport,
    sgwState,
    vin,
    batteryVolts,
    speedMph,
    snapshots,
    refreshVault,
    snifferRunning,
  } = useGladiator();

  // Tire, Axle & TPMS user-friendly controls
  const [diameterIn, setDiameterIn] = useState<number>(35.0);
  const [squatFactor, setSquatFactor] = useState<number>(0.97);
  const [axleRatio, setAxleRatio] = useState<number>(3.73);
  const [frontPsi, setFrontPsi] = useState<number>(37);
  const [rearPsi, setRearPsi] = useState<number>(37);

  // Lighting & Aux/Comfort state
  const [lighting, setLighting] = useState<LightingConfigState>({
    ledHeadlamps: false,
    ledFogLamps: true,
    fogDropOutDisable: false,
    ledFrontTurns: false,
    ledTailLamps: false,
    dedicatedDrl: true,
  });
  const [comfort, setComfort] = useState<AuxComfortState>({
    auxSwitchBankEnabled: false,
    seatbeltChimeDisabled: false,
  });

  // Feedback toast + busy state
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [sleepCountdownSec, setSleepCountdownSec] = useState<number | null>(null);

  useEffect(() => {
    if (sleepCountdownSec === null || sleepCountdownSec <= 0) return;
    const t = setTimeout(() => {
      const next = sleepCountdownSec - 1;
      setSleepCountdownSec(next);
      if (next === 0) playAlertChime(false);
    }, 1000);
    return () => clearTimeout(t);
  }, [sleepCountdownSec]);

  // Advanced Expert Hex Accordion state
  const [showExpertHex, setShowExpertHex] = useState(false);
  const [expertEcuId, setExpertEcuId] = useState('BCM_C');
  const [expertDid, setExpertDid] = useState('0130');
  const [expertHex, setExpertHex] = useState('');

  const bcmEcu = useMemo(() => findModuleById('BCM_C'), []);

  const tireCalc = useMemo(
    () => calculateTireCircumferenceFromDiameter(diameterIn, squatFactor),
    [diameterIn, squatFactor]
  );

  const drivetrainImpact = useMemo(
    () =>
      computeDrivetrainImpact({
        newEffectiveDiameterIn: tireCalc.effectiveDiameterIn,
        axleRatio,
      }),
    [axleRatio, tireCalc.effectiveDiameterIn]
  );

  // Sync current values from BCM when connected
  const syncLiveBcmConfig = useCallback(async () => {
    if (!session) return;
    try {
      const r0130 = await session.requestUds(bcmEcu, '220130', 1400);
      if (r0130.ok && r0130.bytes.length >= 9) {
        const b = r0130.bytes.slice(3);
        const rawRatio = ((b[2] << 8) | b[3]) / 100;
        if (rawRatio >= 3.0 && rawRatio <= 5.5) setAxleRatio(rawRatio);
        if (b[4] >= 12 && b[4] <= 70) setFrontPsi(b[4]);
        if (b[5] >= 12 && b[5] <= 70) setRearPsi(b[5]);
      }

      const r0131 = await session.requestUds(bcmEcu, '220131', 1400);
      if (r0131.ok && r0131.bytes.length >= 5) {
        setLighting(decodeLightingDid0131(bytesToHex(r0131.bytes.slice(3))));
      }

      const r0132 = await session.requestUds(bcmEcu, '220132', 1400);
      if (r0132.ok && r0132.bytes.length >= 7) {
        setComfort(decodeComfortDid0132(bytesToHex(r0132.bytes.slice(3))));
      }
    } catch {
      /* non-fatal on initial sync */
    }
  }, [bcmEcu, session]);

  useEffect(() => {
    syncLiveBcmConfig();
  }, [syncLiveBcmConfig]);

  const writeUnlocked =
    Boolean(session) &&
    sgwState === 'bypass_active' &&
    (batteryVolts === null || batteryVolts >= 12.0) &&
    (speedMph === null || speedMph <= 0.5) &&
    !snifferRunning;

  const lockReason = !session
    ? 'Connect dongle + 12+8 cable (or tap "Launch 12+8 Demo" above) to write mods'
    : sgwState !== 'bypass_active'
      ? simTransport
        ? 'Tap "Sim: Stock OBD" in top bar to switch to 12+8 Cable mode'
        : 'Plug in 12+8 SGW Bypass Cable to apply modifications'
      : batteryVolts !== null && batteryVolts < 12.0
        ? `Battery low (${batteryVolts.toFixed(1)}V < 12.0V KOEO)`
        : speedMph !== null && speedMph > 0.5
          ? 'Vehicle must be stationary (0 MPH)'
          : null;

  const bcmBaselineSnapshot =
    snapshots.find((s) => s.txId === bcmEcu.txId && s.isFactoryBaseline) ||
    snapshots.find((s) => s.txId === bcmEcu.txId);

  const handleApplyTireAndAxle = async () => {
    if (!session) return;
    setBusyCard('tire');
    setFeedback(null);
    try {
      const tireBytes = hexToBytes(tireCalc.hex16BigEndian);
      const axleBytes = hexToBytes(encodeAxleRatioHex16(axleRatio).hex16BigEndian);
      const res = await autoBackupAndApplyDid({
        session,
        ecu: bcmEcu,
        didHex: '0130',
        vin: vin || '1C6JJTAM0ML000000',
        existingSnapshots: snapshots,
        transform: (cur) => {
          let next = applySurgicalBytePatch(cur, 0, tireBytes);
          next = applySurgicalBytePatch(next, 2, axleBytes);
          return next;
        },
      });
      await refreshVault();
      setFeedback({ ok: res.ok, text: res.detail });
    } finally {
      setBusyCard(null);
    }
  };

  const handleApplyTpms = async () => {
    if (!session) return;
    setBusyCard('tpms');
    setFeedback(null);
    try {
      const res = await autoBackupAndApplyDid({
        session,
        ecu: bcmEcu,
        didHex: '0130',
        vin: vin || '1C6JJTAM0ML000000',
        existingSnapshots: snapshots,
        transform: (cur) => applySurgicalBytePatch(cur, 4, [frontPsi & 0xff, rearPsi & 0xff]),
      });
      await refreshVault();
      setFeedback({ ok: res.ok, text: res.detail });
    } finally {
      setBusyCard(null);
    }
  };

  const handleApplyLighting = async () => {
    if (!session) return;
    setBusyCard('lighting');
    setFeedback(null);
    try {
      const res = await autoBackupAndApplyDid({
        session,
        ecu: bcmEcu,
        didHex: '0131',
        vin: vin || '1C6JJTAM0ML000000',
        existingSnapshots: snapshots,
        transform: (cur) => encodeLightingDid0131(cur, lighting),
      });
      await refreshVault();
      setFeedback({ ok: res.ok, text: res.detail });
    } finally {
      setBusyCard(null);
    }
  };

  const handleApplyComfort = async () => {
    if (!session) return;
    setBusyCard('comfort');
    setFeedback(null);
    try {
      const res = await autoBackupAndApplyDid({
        session,
        ecu: bcmEcu,
        didHex: '0132',
        vin: vin || '1C6JJTAM0ML000000',
        existingSnapshots: snapshots,
        transform: (cur) => encodeComfortDid0132(cur, comfort),
      });
      await refreshVault();
      setFeedback({ ok: res.ok, text: res.detail });
    } finally {
      setBusyCard(null);
    }
  };

  const handleRestoreAllStock = async () => {
    if (!session || !bcmBaselineSnapshot) return;
    setBusyCard('restore');
    setFeedback(null);
    try {
      const bcmSnaps = snapshots.filter((s) => s.txId === bcmEcu.txId && s.isFactoryBaseline);
      const mergedDids: Record<string, string> = {};
      // Oldest factory baseline wins per DID
      for (const s of [...bcmSnaps].reverse()) {
        Object.assign(mergedDids, s.dids);
      }

      const outcomes = await restoreSnapshotToEcu(session, bcmEcu, {
        ...bcmBaselineSnapshot,
        dids: mergedDids,
      });

      await syncLiveBcmConfig();
      if (outcomes.length === 0) {
        setFeedback({
          ok: true,
          text: 'Truck already matches your saved Factory Stock configuration 100%.',
        });
      } else {
        const okCount = outcomes.filter((o) => o.ok).length;
        setFeedback({
          ok: okCount === outcomes.length,
          text: `Restored ${okCount} configuration block(s) back to Factory Stock!`,
        });
      }
    } finally {
      setBusyCard(null);
    }
  };

  // Expert Hex read/write helpers
  const handleExpertRead = async () => {
    if (!session) return;
    const ecu = findModuleById(expertEcuId);
    const r = await session.requestUds(ecu, `22${expertDid}`, 1600);
    if (r.ok && r.bytes.length >= 4) {
      setExpertHex(bytesToHex(r.bytes.slice(3)));
    } else {
      setFeedback({ ok: false, text: `Read 0x22 ${expertDid}: ${r.errorReason || 'No data'}` });
    }
  };

  const handleExpertWrite = async () => {
    if (!session) return;
    const ecu = findModuleById(expertEcuId);
    setBusyCard('expert');
    try {
      const res = await autoBackupAndApplyDid({
        session,
        ecu,
        didHex: expertDid,
        vin: vin || '1C6JJTAM0ML000000',
        existingSnapshots: snapshots,
        transform: () => expertHex,
      });
      await refreshVault();
      setFeedback({ ok: res.ok, text: res.detail });
    } finally {
      setBusyCard(null);
    }
  };

  // SVG scale for visual stock vs new tire circle
  const stockR = 34;
  const newR = Math.min(54, Math.max(28, Math.round((diameterIn / 31.46) * stockR)));

  return (
    <div className="space-y-5">
      <OfflineLinkBanner />

      {/* Top Safety & 1-Tap Stock Restore Bar */}
      <div className="uconnect-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800/90 px-5 py-4">
        <div className="flex items-center gap-3">
          <ShieldCheck
            className={`h-5 w-5 shrink-0 ${
              writeUnlocked ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
          <div>
            <div className="text-sm font-bold text-slate-100">
              {writeUnlocked
                ? 'Ready to Customize — Automatic Factory Backup Active'
                : 'Preview Mode — Calculators Active'}
            </div>
            <div className="text-xs text-slate-400">
              {lockReason ||
                'Original factory bytes are backed up automatically before every change and verified by read-back.'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSleepCountdownSec((s) => (s && s > 0 ? null : 60))}
            title="Start 60-second FCA BCM bus-sleep countdown so new tire/lighting settings latch cleanly"
            className="flex min-h-[44px] items-center gap-2 rounded-xl border border-orange-500/45 bg-orange-500/15 px-3.5 py-2 text-xs font-bold text-orange-200 transition hover:bg-orange-500/25"
          >
            <Timer className="h-4 w-4 text-orange-400" />
            {sleepCountdownSec !== null && sleepCountdownSec > 0
              ? `BCM Sleep: ${sleepCountdownSec}s`
              : '60s BCM Latch Timer'}
          </button>

          {bcmBaselineSnapshot && (
            <button
              onClick={handleRestoreAllStock}
              disabled={!writeUnlocked || busyCard !== null}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 py-2 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              {busyCard === 'restore' ? 'Restoring Stock...' : '1-Tap Restore All to Stock'}
            </button>
          )}
        </div>
      </div>

      {sleepCountdownSec !== null && (
        <div className="uconnect-card rounded-2xl border border-orange-500/50 bg-gradient-to-r from-orange-950/35 via-slate-900/90 to-slate-900/90 p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-orange-300">
              {sleepCountdownSec > 0
                ? `FCA BCM Bus-Sleep Reboot Procedure (${sleepCountdownSec}s remaining)`
                : '✅ 60s Bus Sleep Complete — Safe to Cycle Ignition ON!'}
            </div>
            <button
              onClick={() => setSleepCountdownSec(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Dismiss
            </button>
          </div>
          <div className="text-xs text-slate-300">
            1. Turn Ignition <strong>OFF</strong> · 2. Open &amp; close driver door once · 3. Wait for
            cluster screen blackout until timer reaches <strong>0s</strong> so ABS, TCM &amp; IPC latch
            the updated BCM configuration without fault codes.
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-orange-500 transition-all duration-700"
              style={{ width: `${((60 - sleepCountdownSec) / 60) * 100}%` }}
            />
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold ${
            feedback.ok
              ? 'border-emerald-500/40 bg-emerald-950/35 text-emerald-200'
              : 'border-amber-500/40 bg-amber-950/35 text-amber-200'
          }`}
        >
          <Check className="h-4 w-4 shrink-0" />
          {feedback.text}
        </div>
      )}

      {/* 2x2 Visual Mod Cards Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* CARD 1: Tire Size, Axle Gear & Speedo / 8HP75 Wizard */}
        <div className="uconnect-card flex flex-col justify-between rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-orange-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Tire Size &amp; Axle Gear Calibration
                </h3>
              </div>
              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-orange-300">
                {tireCalc.circumferenceMm} mm
              </span>
            </div>

            {/* Visual Concentric Tire Comparison + Impact Readouts */}
            <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
              <svg width="116" height="116" viewBox="0 0 120 120" className="shrink-0">
                {/* New Tire Circle */}
                <circle
                  cx="60"
                  cy="60"
                  r={newR}
                  fill="rgba(249,115,22,0.08)"
                  stroke="#f97316"
                  strokeWidth="4"
                />
                {/* Stock 31.5" Reference Circle */}
                <circle
                  cx="60"
                  cy="60"
                  r={stockR}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
                {/* 17" Wheel Hub */}
                <circle cx="60" cy="60" r="16" fill="#111827" stroke="#334155" strokeWidth="2" />
                <text
                  x="60"
                  y="64"
                  textAnchor="middle"
                  className="fill-slate-200 font-mono text-[10px] font-bold"
                >
                  {diameterIn.toFixed(1)}&quot;
                </text>
              </svg>

              <div className="space-y-1.5 text-xs">
                <div className="text-slate-400">
                  Uncalibrated Speedo at <strong className="text-slate-200">65 MPH</strong>:
                </div>
                <div className="font-mono text-base font-extrabold text-orange-300">
                  {drivetrainImpact.actualGpsMphAt65} MPH actual{' '}
                  <span className="text-xs font-normal text-slate-400">
                    ({drivetrainImpact.speedoDeltaMph >= 0 ? '+' : ''}
                    {drivetrainImpact.speedoDeltaMph} mph)
                  </span>
                </div>
                <div className="pt-1 text-slate-400">
                  70 MPH in 8th Gear (`8HP75`):{' '}
                  <strong
                    className={
                      drivetrainImpact.inEcoDieselSweetSpot
                        ? 'font-mono text-emerald-300'
                        : 'font-mono text-amber-300'
                    }
                  >
                    {drivetrainImpact.rpmAt70Mph8thGear} RPM
                  </strong>
                </div>
              </div>
            </div>

            {/* Quick Tire Buttons */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Select Tire Diameter
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Stock 31.5"', val: 31.46 },
                  { label: '33" Trail', val: 33.0 },
                  { label: '35" Mud/AT', val: 35.0 },
                  { label: '37" Crawl', val: 37.0 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setDiameterIn(preset.val)}
                    className={`min-h-[40px] rounded-lg border font-mono text-xs font-bold transition ${
                      Math.abs(diameterIn - preset.val) < 0.1
                        ? 'border-orange-500 bg-orange-500/25 text-orange-100'
                        : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Fine Diameter, Squat & Axle Gear Selectors */}
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Exact Size (in)</label>
                <input
                  type="number"
                  step="0.1"
                  value={diameterIn}
                  onChange={(e) => setDiameterIn(Number(e.target.value))}
                  className="min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 font-mono text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Squat Factor</label>
                <select
                  value={squatFactor}
                  onChange={(e) => setSquatFactor(Number(e.target.value))}
                  className="min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-900 px-2 font-mono text-xs text-slate-100"
                >
                  <option value={0.97}>97% (Sidewall Spec)</option>
                  <option value={1.0}>100% (Measured)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">Axle Ratio</label>
                <select
                  value={axleRatio}
                  onChange={(e) => setAxleRatio(Number(e.target.value))}
                  className="min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-900 px-2 font-mono text-xs text-slate-100"
                >
                  {GLADIATOR_AXLE_RATIOS.map((g) => (
                    <option key={g.ratio} value={g.ratio}>
                      {g.ratio.toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Extra Preset Dropdown */}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) setDiameterIn(Number(e.target.value));
              }}
              className="min-h-[38px] w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-400"
            >
              <option value="">Or choose exact sidewall metric preset (285/70R17, 315/70R17...)</option>
              {GLADIATOR_TIRE_PRESETS.map((p) => (
                <option key={p.label} value={p.diameterIn}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleApplyTireAndAxle}
            disabled={!writeUnlocked || busyCard !== null}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-orange-500/60 bg-orange-500/25 px-4 text-xs font-bold text-orange-100 transition hover:bg-orange-500/35 disabled:opacity-40"
          >
            <UploadCloud className="h-4 w-4" />
            {busyCard === 'tire'
              ? 'Applying Tire & Axle Calibration...'
              : `Apply ${diameterIn.toFixed(1)}" Tires & ${axleRatio.toFixed(2)} Gears`}
          </button>
        </div>

        {/* CARD 2: LED Conversion & Trail Lighting */}
        <div className="uconnect-card flex flex-col justify-between rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-orange-400" />
              <h3 className="text-sm font-bold text-slate-100">
                LED Conversion &amp; Trail Lighting
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <RockerToggle
                label="LED Headlights"
                hint="Stops PWM flicker & bulb-out alerts"
                checked={lighting.ledHeadlamps}
                onChange={(v) => setLighting({ ...lighting, ledHeadlamps: v })}
              />
              <RockerToggle
                label="LED Fog Lights"
                hint="Configures BCM for LED fog draw"
                checked={lighting.ledFogLamps}
                onChange={(v) => setLighting({ ...lighting, ledFogLamps: v })}
              />
              <RockerToggle
                label="Fogs ON w/ High Beams"
                hint="Disables high-beam fog drop-out!"
                checked={lighting.fogDropOutDisable}
                onChange={(v) => setLighting({ ...lighting, fogDropOutDisable: v })}
              />
              <RockerToggle
                label="LED Turn Signals"
                hint="Eliminates turn-signal hyperflash"
                checked={lighting.ledFrontTurns}
                onChange={(v) => setLighting({ ...lighting, ledFrontTurns: v })}
              />
              <RockerToggle
                label="LED Tail Lights"
                hint="Configures rear lamp current sense"
                checked={lighting.ledTailLamps}
                onChange={(v) => setLighting({ ...lighting, ledTailLamps: v })}
              />
              <RockerToggle
                label="Halo / Daytime Running"
                hint="Enables dedicated DRL signature"
                checked={lighting.dedicatedDrl}
                onChange={(v) => setLighting({ ...lighting, dedicatedDrl: v })}
              />
            </div>
          </div>

          <button
            onClick={handleApplyLighting}
            disabled={!writeUnlocked || busyCard !== null}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-orange-500/60 bg-orange-500/25 px-4 text-xs font-bold text-orange-100 transition hover:bg-orange-500/35 disabled:opacity-40"
          >
            <UploadCloud className="h-4 w-4" />
            {busyCard === 'lighting' ? 'Saving Lighting Setup...' : 'Apply Lighting Setup'}
          </button>
        </div>

        {/* CARD 3: Trail Air-Down TPMS Thresholds */}
        <div className="uconnect-card flex flex-col justify-between rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Compass className="h-4 w-4 text-orange-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Trail Air-Down TPMS Thresholds
                </h3>
              </div>
              <span className="font-mono text-xs font-bold text-sky-300">
                F {frontPsi} / R {rearPsi} PSI
              </span>
            </div>

            {/* Quick Terrain Presets */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Street 37', f: 37, r: 37 },
                { label: 'Overland 30', f: 30, r: 30 },
                { label: 'Sand 20', f: 20, r: 20 },
                { label: 'Crawl 15', f: 15, r: 15 },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => {
                    setFrontPsi(m.f);
                    setRearPsi(m.r);
                  }}
                  className={`min-h-[40px] rounded-lg border font-mono text-xs font-bold transition ${
                    frontPsi === m.f && rearPsi === m.r
                      ? 'border-sky-400 bg-sky-500/20 text-sky-100'
                      : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Sliders */}
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-300">Front Axle Alert Threshold</span>
                  <span className="font-mono font-bold text-sky-300">{frontPsi} PSI</span>
                </div>
                <input
                  type="range"
                  min={14}
                  max={50}
                  value={frontPsi}
                  onChange={(e) => setFrontPsi(Number(e.target.value))}
                  className="w-full accent-orange-500"
                />
              </div>

              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-300">Rear Axle Alert Threshold</span>
                  <span className="font-mono font-bold text-sky-300">{rearPsi} PSI</span>
                </div>
                <input
                  type="range"
                  min={14}
                  max={50}
                  value={rearPsi}
                  onChange={(e) => setRearPsi(Number(e.target.value))}
                  className="w-full accent-orange-500"
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleApplyTpms}
            disabled={!writeUnlocked || busyCard !== null}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-orange-500/60 bg-orange-500/25 px-4 text-xs font-bold text-orange-100 transition hover:bg-orange-500/35 disabled:opacity-40"
          >
            <UploadCloud className="h-4 w-4" />
            {busyCard === 'tpms'
              ? 'Updating TPMS Thresholds...'
              : `Apply ${frontPsi}/${rearPsi} PSI TPMS Thresholds`}
          </button>
        </div>

        {/* CARD 4: Aux Switch Bank & Cabin Convenience */}
        <div className="uconnect-card flex flex-col justify-between rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-orange-400" />
              <h3 className="text-sm font-bold text-slate-100">
                OEM Aux Switches &amp; Trail Convenience
              </h3>
            </div>

            <RockerToggle
              label="OEM 4-Switch Aux Bank (Uconnect Settings)"
              hint="Enables factory Aux 1–4 latching/momentary menu in Uconnect"
              checked={comfort.auxSwitchBankEnabled}
              onChange={(v) => setComfort({ ...comfort, auxSwitchBankEnabled: v })}
            />

            <RockerToggle
              label="Trail Seatbelt Chime Silence"
              hint="Mutes repetitive chime during low-speed off-road spotting (dash icon stays active)"
              checked={comfort.seatbeltChimeDisabled}
              onChange={(v) => setComfort({ ...comfort, seatbeltChimeDisabled: v })}
            />
          </div>

          <button
            onClick={handleApplyComfort}
            disabled={!writeUnlocked || busyCard !== null}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-orange-500/60 bg-orange-500/25 px-4 text-xs font-bold text-orange-100 transition hover:bg-orange-500/35 disabled:opacity-40"
          >
            <UploadCloud className="h-4 w-4" />
            {busyCard === 'comfort' ? 'Saving Convenience Setup...' : 'Apply Aux & Convenience Setup'}
          </button>
        </div>
      </div>

      {/* Tucked Away Accordion: Advanced Raw Hex & Bit Matrix for Power Users */}
      <div className="uconnect-card rounded-2xl border border-slate-800/90">
        <button
          onClick={() => setShowExpertHex(!showExpertHex)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-2.5">
            <Settings2 className="h-4 w-4 text-slate-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Advanced: Direct DID Hex &amp; Bit Matrix Editor
            </span>
          </div>
          {showExpertHex ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {showExpertHex && (
          <div className="border-t border-slate-800 p-5 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
              <select
                value={expertEcuId}
                onChange={(e) => setExpertEcuId(e.target.value)}
                className="min-h-[42px] rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100 sm:col-span-4"
              >
                {GLADIATOR_MODULES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.shortName} ({m.txId}→{m.rxId})
                  </option>
                ))}
              </select>
              <input
                value={expertDid}
                onChange={(e) => setExpertDid(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="DID (0130)"
                className="min-h-[42px] rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs font-bold text-orange-300 sm:col-span-2"
              />
              <input
                value={expertHex}
                onChange={(e) => setExpertHex(e.target.value.toUpperCase())}
                placeholder="Click Read 0x22 to load live bytes..."
                className="min-h-[42px] rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-slate-100 sm:col-span-4"
              />
              <div className="flex gap-2 sm:col-span-2">
                <button
                  onClick={handleExpertRead}
                  className="min-h-[42px] flex-1 rounded-lg border border-sky-500/40 bg-sky-500/15 font-mono text-xs font-bold text-sky-200"
                >
                  Read
                </button>
                <button
                  onClick={handleExpertWrite}
                  disabled={!writeUnlocked || !expertHex}
                  className="min-h-[42px] flex-1 rounded-lg border border-orange-500/50 bg-orange-500/20 font-mono text-xs font-bold text-orange-200 disabled:opacity-40"
                >
                  Write
                </button>
              </div>
            </div>

            {/* Interactive Bit Flipper when bytes are loaded */}
            {hexToBytes(expertHex).length > 0 && (
              <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                {hexToBytes(expertHex).map((bv, bIdx) => (
                  <div
                    key={bIdx}
                    className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs"
                  >
                    <span className="text-slate-400">
                      Byte[{bIdx}] = <strong className="text-slate-100">0x{bv.toString(16).toUpperCase().padStart(2, '0')}</strong>
                    </span>
                    <div className="flex gap-1">
                      {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => {
                        const on = ((bv >> bit) & 1) === 1;
                        return (
                          <button
                            key={bit}
                            type="button"
                            onClick={() =>
                              setExpertHex(applySurgicalBitFlip(expertHex, bIdx, bit, on ? 0 : 1))
                            }
                            className={`h-7 w-7 rounded border text-xs font-bold ${
                              on
                                ? 'border-orange-500/60 bg-orange-500/25 text-orange-200'
                                : 'border-slate-700 bg-slate-900 text-slate-500'
                            }`}
                          >
                            {on ? '1' : '0'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
