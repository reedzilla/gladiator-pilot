import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CircleDot,
  Download,
  Eye,
  Flame,
  Lock,
  Navigation,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Thermometer,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';
import { useWakeLock } from '../hooks/useWakeLock';
import { EcoDieselSnapshot, pollEcoDieselFastFrame } from '../lib/gladiator/ecodieselPids';
import {
  evaluateStage2Alerts,
  exportTelemetryCsv,
  LoggedTelemetryRow,
  playAlertChime,
} from '../lib/gladiator/telemetryLogger';
import { GarageLaunchpad } from './GarageLaunchpad';
import { OffRoadClinometer } from './OffRoadClinometer';

const MiniSparkline: React.FC<{ values: number[]; color: string }> = ({ values, color }) => {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values
    .map((v, idx) => {
      const x = (idx / (values.length - 1)) * 120;
      const y = 24 - ((v - min) / span) * 20 - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 120 24" className="mt-1.5 h-6 w-full overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
};

interface RadialDialProps {
  label: string;
  value: number | null;
  min: number;
  max: number;
  unit: string;
  decimals?: number;
  accent?: 'orange' | 'sky' | 'emerald';
  warnThreshold?: number;
  subLabel?: string;
  onBadgeClick?: () => void;
}

const RadialDial: React.FC<RadialDialProps> = ({
  label,
  value,
  min,
  max,
  unit,
  decimals = 0,
  accent = 'orange',
  warnThreshold,
  subLabel,
  onBadgeClick,
}) => {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  // 240-degree sweep (2/3 of full circle)
  const arcLength = circumference * (240 / 360);
  const clamped = value === null ? min : Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min || 1);
  const filledLength = arcLength * pct;

  const isWarn = warnThreshold !== undefined && value !== null && value >= warnThreshold;

  const strokeColor = isWarn
    ? '#f59e0b'
    : accent === 'sky'
      ? '#38bdf8'
      : accent === 'emerald'
        ? '#34d399'
        : '#f97316';

  return (
    <div className="uconnect-card relative flex flex-col items-center justify-between rounded-2xl border border-slate-800/90 p-5">
      <div className="flex w-full items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
          {label}
        </span>
        {subLabel && (
          <button
            type="button"
            onClick={onBadgeClick}
            disabled={!onBadgeClick}
            className={`rounded-md border border-slate-700/80 bg-slate-900/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-300 ${
              onBadgeClick ? 'cursor-pointer hover:border-orange-500/50 hover:text-orange-200' : ''
            }`}
          >
            {subLabel}
          </button>
        )}
      </div>

      <div className="relative my-2 flex items-center justify-center">
        <svg width="156" height="136" viewBox="0 0 156 146" className="overflow-visible">
          {/* Background Track (rotated 150 deg so 240-deg arc sits symmetrically at top) */}
          <circle
            cx="78"
            cy="78"
            r={radius}
            fill="none"
            stroke="#1e2634"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            transform="rotate(150 78 78)"
          />
          {/* Active Swept Arc */}
          <circle
            cx="78"
            cy="78"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.5, filledLength)} ${circumference}`}
            transform="rotate(150 78 78)"
            style={{
              transition: 'stroke-dasharray 260ms ease-out, stroke 200ms ease',
              filter: `drop-shadow(0 0 8px ${strokeColor}55)`,
            }}
          />
        </svg>

        {/* Center Digital Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
          <span className="font-mono text-3xl font-extrabold tracking-tight text-slate-100">
            {value !== null ? value.toFixed(decimals) : '—'}
          </span>
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-slate-400">
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
};

interface ThermalBarProps {
  label: string;
  tempF: number | null;
  normalMin: number;
  warnTemp: number;
  dangerTemp: number;
  maxScale?: number;
}

const ThermalBar: React.FC<ThermalBarProps> = ({
  label,
  tempF,
  normalMin,
  warnTemp,
  dangerTemp,
  maxScale = 270,
}) => {
  const minScale = 100;
  const pct =
    tempF === null
      ? 0
      : Math.max(2, Math.min(100, ((tempF - minScale) / (maxScale - minScale)) * 100));

  const status =
    tempF === null
      ? { text: 'WAIT', color: 'text-slate-500', fill: 'bg-slate-600' }
      : tempF >= dangerTemp
        ? { text: 'HOT', color: 'text-red-400', fill: 'bg-red-500' }
        : tempF >= warnTemp
          ? { text: 'WARM / TOW', color: 'text-amber-300', fill: 'bg-amber-400' }
          : tempF < normalMin
            ? { text: 'WARMING', color: 'text-sky-300', fill: 'bg-sky-400' }
            : { text: 'OPTIMAL', color: 'text-emerald-300', fill: 'bg-emerald-400' };

  return (
    <div className="rounded-xl border border-slate-800/90 bg-slate-950/65 p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-200">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[10px] font-bold ${status.color}`}>
            {status.text}
          </span>
          <span className="font-mono text-lg font-extrabold text-slate-100">
            {tempF !== null ? `${tempF}°F` : '—'}
          </span>
        </div>
      </div>

      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-300 ${status.fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between font-mono text-[10px] text-slate-500">
        <span>{minScale}°F</span>
        <span>Opt {normalMin}°+</span>
        <span className="text-amber-400/70">Warn {warnTemp}°</span>
        <span className="text-red-400/70">{dangerTemp}°F</span>
      </div>
    </div>
  );
};

export const CockpitView: React.FC = () => {
  const { session, snifferRunning, updateLiveVitals, stage2DeleteMode, setStage2DeleteMode } =
    useGladiator();
  const [data, setData] = useState<EcoDieselSnapshot | null>(null);
  const [polling, setPolling] = useState(true);
  const [peakBoost, setPeakBoost] = useState<number>(0);
  const [peakEgt1, setPeakEgt1] = useState<number>(0);
  const [pollError, setPollError] = useState<string | null>(null);

  // Rolling 60-sample sparkline buffers
  const [egtHistory, setEgtHistory] = useState<number[]>([]);
  const [railHistory, setRailHistory] = useState<number[]>([]);
  const [iatHistory, setIatHistory] = useState<number[]>([]);

  // Black-Box Flight Recorder (CSV)
  const [recording, setRecording] = useState(false);
  const [recordedRows, setRecordedRows] = useState<LoggedTelemetryRow[]>([]);
  const recordingRef = useRef(false);

  // Live Phone GPS Speedo Cross-Check
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsMph, setGpsMph] = useState<number | null>(null);
  const gpsMphRef = useRef<number | null>(null);

  // Stage 2 Audible Chime Mute
  const [audioAlertsOn, setAudioAlertsOn] = useState(true);
  const lastChimeAtRef = useRef<number>(0);

  const awakeLocked = useWakeLock(Boolean(session && polling));

  const loopActiveRef = useRef(false);
  const cycleCountRef = useRef(0);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    if (!gpsEnabled || !('geolocation' in navigator)) {
      setGpsMph(null);
      gpsMphRef.current = null;
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos.coords.speed !== null && pos.coords.speed >= 0) {
          const mph = Math.round(pos.coords.speed * 2.23694 * 10) / 10;
          setGpsMph(mph);
          gpsMphRef.current = mph;
        }
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [gpsEnabled]);

  const sampleOnce = useCallback(
    async (withSlowDids = true) => {
      if (!session) return;
      const snap = await pollEcoDieselFastFrame(session, withSlowDids, stage2DeleteMode);
      let mergedSnap: EcoDieselSnapshot = snap;

      setData((prev) => {
        mergedSnap = {
          ...snap,
          intakeTempF: snap.intakeTempF ?? prev?.intakeTempF ?? null,
          coolantF: snap.coolantF ?? prev?.coolantF ?? null,
          oilTempF: snap.oilTempF ?? prev?.oilTempF ?? null,
          batteryVolts: snap.batteryVolts ?? prev?.batteryVolts ?? null,
          transFluidF: snap.transFluidF ?? prev?.transFluidF ?? null,
          dpfSootPct: snap.dpfSootPct ?? prev?.dpfSootPct ?? null,
          dpfDiffPsi: snap.dpfDiffPsi ?? prev?.dpfDiffPsi ?? null,
          regenActive: snap.regenActive ?? prev?.regenActive ?? null,
          odometerMi: snap.odometerMi ?? prev?.odometerMi ?? null,
          odometerSource: snap.odometerSource ?? prev?.odometerSource ?? null,
        };
        return mergedSnap;
      });

      if (snap.boostPsi !== null && snap.boostPsi > peakBoost) {
        setPeakBoost(snap.boostPsi);
      }
      if (snap.egt1PreTurboF !== null) {
        if (snap.egt1PreTurboF > peakEgt1) setPeakEgt1(snap.egt1PreTurboF);
        setEgtHistory((h) => (h.length >= 60 ? [...h.slice(-59), snap.egt1PreTurboF!] : [...h, snap.egt1PreTurboF!]));
      }
      if (snap.railPressurePsi !== null) {
        setRailHistory((h) => (h.length >= 60 ? [...h.slice(-59), snap.railPressurePsi!] : [...h, snap.railPressurePsi!]));
      }
      if (mergedSnap.intakeTempF !== null) {
        setIatHistory((h) => (h.length >= 60 ? [...h.slice(-59), mergedSnap.intakeTempF!] : [...h, mergedSnap.intakeTempF!]));
      }

      if (recordingRef.current) {
        const row: LoggedTelemetryRow = { ...mergedSnap, gpsMph: gpsMphRef.current };
        setRecordedRows((prev) => (prev.length >= 18000 ? [...prev.slice(-17999), row] : [...prev, row]));
      }

      const activeAlerts = evaluateStage2Alerts(mergedSnap);
      if (audioAlertsOn && activeAlerts.length > 0 && Date.now() - lastChimeAtRef.current > 8000) {
        lastChimeAtRef.current = Date.now();
        playAlertChime(activeAlerts.some((a) => a.severity === 'critical'));
      }

      updateLiveVitals(mergedSnap.batteryVolts, snap.speedMph);
    },
    [audioAlertsOn, peakBoost, peakEgt1, session, stage2DeleteMode, updateLiveVitals]
  );

  // Auto-start live gauges as soon as truck / demo connects!
  useEffect(() => {
    if (session) {
      setPolling(true);
    } else {
      setData(null);
      setPeakBoost(0);
      setPeakEgt1(0);
      setEgtHistory([]);
      setRailHistory([]);
      setIatHistory([]);
    }
  }, [session]);

  useEffect(() => {
    if (!polling || !session || snifferRunning) {
      loopActiveRef.current = false;
      return;
    }

    loopActiveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

      const tick = async () => {
      if (!loopActiveRef.current || !session) return;
      try {
        const includeSlow = cycleCountRef.current % 4 === 0;
        cycleCountRef.current++;
        await sampleOnce(includeSlow);
        setPollError(null);
      } catch (err) {
        setPollError((err as Error).message);
      }
      if (loopActiveRef.current) {
        timer = setTimeout(tick, 200);
      }
    };

    tick();
    return () => {
      loopActiveRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [polling, sampleOnce, session, snifferRunning]);

  // Show Guided Garage Launchpad instead of a dead dash when disconnected!
  if (!session) {
    return <GarageLaunchpad />;
  }

  const soot = data?.dpfSootPct ?? 0;
  const activeAlerts = evaluateStage2Alerts(data);

  const handleDownloadCsv = () => {
    if (recordedRows.length === 0) return;
    const csv = exportTelemetryCsv(recordedRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gladiator-3.0D-flightlog-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const gpsDelta =
    gpsMph !== null && data?.speedMph !== null && data?.speedMph !== undefined
      ? Math.round((gpsMph - data.speedMph) * 10) / 10
      : null;

  return (
    <div className="space-y-5">
      {/* Compact Live Cluster Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-900/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              polling ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400'
            }`}
          />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
            {polling ? 'Live 3.0D Fast-Loop' : 'Telemetry Paused'}
          </span>
          {awakeLocked && (
            <span
              title="Screen Wake Lock active — display will not dim while driving"
              className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300"
            >
              <Eye className="h-3 w-3" />
              WAKE
            </span>
          )}
          {data?.odometerMi && (
            <span className="hidden font-mono text-xs text-slate-400 sm:inline">
              · {data.odometerMi.toLocaleString()} mi
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setStage2DeleteMode(!stage2DeleteMode)}
            title="Switch between Stage 2 Deleted ECM profile (high-range boost + EGT1 pyrometer, skips deleted DPF polls) and Stock DPF profile"
            className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold transition ${
              stage2DeleteMode
                ? 'border-orange-500/50 bg-orange-500/15 text-orange-200 hover:bg-orange-500/25'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Lock className="h-3.5 w-3.5 text-orange-300" />
            {stage2DeleteMode ? 'STAGE 2 DELETE · ECM LOCKED' : 'STOCK DPF PROFILE'}
          </button>

          {/* GPS Speedo Cross-Check Toggle */}
          <button
            onClick={() => setGpsEnabled((g) => !g)}
            title="Cross-check Gladiator OBD speedometer against live Phone GPS speed"
            className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold transition ${
              gpsEnabled
                ? 'border-emerald-500/55 bg-emerald-500/20 text-emerald-200'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Navigation className="h-3.5 w-3.5" />
            GPS
          </button>

          {/* Black-Box Flight Recorder (Banks iDash style CSV log) */}
          <button
            onClick={() => setRecording((r) => !r)}
            title="Record timestamped pull / tow telemetry log to CSV"
            className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold transition ${
              recording
                ? 'animate-pulse border-red-500/70 bg-red-500/25 text-red-200'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <CircleDot className="h-3.5 w-3.5 text-red-400" />
            {recording ? `REC (${recordedRows.length})` : 'REC'}
          </button>

          {recordedRows.length > 0 && (
            <button
              onClick={handleDownloadCsv}
              title="Download recorded CSV data log"
              className="flex min-h-[38px] items-center gap-1 rounded-lg border border-sky-500/45 bg-sky-500/15 px-2.5 py-1.5 font-mono text-[11px] font-bold text-sky-200 hover:bg-sky-500/25"
            >
              <Download className="h-3.5 w-3.5" />
              CSV ({recordedRows.length})
            </button>
          )}

          {/* Audible Thermal Chime Mute Toggle */}
          <button
            onClick={() => setAudioAlertsOn((a) => !a)}
            title="Toggle audible cabin alert chime for high EGT / Trans / Coolant"
            className="flex min-h-[38px] items-center rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-slate-300 hover:bg-slate-700"
          >
            {audioAlertsOn ? <Volume2 className="h-3.5 w-3.5 text-orange-300" /> : <VolumeX className="h-3.5 w-3.5 text-slate-500" />}
          </button>

          <button
            onClick={() => setPolling((p) => !p)}
            disabled={snifferRunning}
            className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            {polling ? (
              <>
                <Pause className="h-3.5 w-3.5 text-amber-300" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 text-emerald-300" />
                Resume
              </>
            )}
          </button>
          {!polling && (
            <button
              onClick={() => sampleOnce(true)}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sample
            </button>
          )}
        </div>
      </div>

      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          {activeAlerts.map((al) => (
            <div
              key={al.id}
              className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs font-bold ${
                al.severity === 'critical'
                  ? 'animate-pulse border-red-500 bg-red-950/60 text-red-100'
                  : 'border-amber-500/50 bg-amber-950/40 text-amber-100'
              }`}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{al.message}</span>
            </div>
          ))}
        </div>
      )}

      {pollError && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-2.5 text-xs text-red-200">
          {pollError}
        </div>
      )}

      {/* Row 1: 3 Hero Uconnect Radial Arc Dials */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <RadialDial
          label="Engine Speed"
          value={data?.rpm ?? null}
          min={0}
          max={4800}
          unit="RPM"
          accent="orange"
          warnThreshold={4000}
          subLabel={`Load ${data?.engineLoadPct ?? '—'}%`}
        />

        <RadialDial
          label={stage2DeleteMode ? 'Stage 2 Turbo Boost' : 'Turbocharger Boost'}
          value={data?.boostPsi ?? null}
          min={-5}
          max={stage2DeleteMode ? 42 : 30}
          decimals={1}
          unit="PSI"
          accent="sky"
          warnThreshold={stage2DeleteMode ? 35 : 26}
          subLabel={`Peak +${peakBoost.toFixed(1)} ↺`}
          onBadgeClick={() => setPeakBoost(0)}
        />

        <RadialDial
          label="Ground Speed"
          value={data?.speedMph ?? null}
          min={0}
          max={100}
          unit="MPH"
          accent="emerald"
          subLabel={
            gpsEnabled
              ? gpsMph !== null
                ? `GPS ${gpsMph} (${gpsDelta && gpsDelta > 0 ? `+${gpsDelta}` : gpsDelta ?? 0})`
                : 'GPS Acquiring...'
              : data?.railPressurePsi
                ? `Rail ${(data.railPressurePsi / 1000).toFixed(1)}k PSI`
                : 'Tap GPS to Verify'
          }
          onBadgeClick={() => setGpsEnabled((g) => !g)}
        />
      </div>

      {/* Row 2: Drivetrain Fluid Temperatures (Uconnect Zone Bars) */}
      <div className="uconnect-card rounded-2xl border border-slate-800/90 p-5 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-orange-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Drivetrain Thermal Management (3.0D + ZF 8HP75)
            </h3>
          </div>
          {(peakBoost > 0 || peakEgt1 > 0) && (
            <button
              onClick={() => {
                setPeakBoost(0);
                setPeakEgt1(0);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
            >
              <RotateCcw className="h-3 w-3" />
              Reset Peaks
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ThermalBar
            label="Engine Coolant"
            tempF={data?.coolantF ?? null}
            normalMin={180}
            warnTemp={225}
            dangerTemp={242}
          />
          <ThermalBar
            label="3.0D Engine Oil"
            tempF={data?.oilTempF ?? null}
            normalMin={185}
            warnTemp={240}
            dangerTemp={258}
          />
          <ThermalBar
            label="ZF 8HP75 Transmission"
            tempF={data?.transFluidF ?? null}
            normalMin={155}
            warnTemp={215}
            dangerTemp={235}
          />
        </div>
      </div>

      {/* Row 3: Stage 2 Pyrometer & Fueling Deck OR Stock DPF Flow Pipeline */}
      {stage2DeleteMode ? (
        <div className="uconnect-card rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Stage 2 3.0D Pyrometer, Charge-Air &amp; High-Pressure Fuel Deck
              </h3>
            </div>

            <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] font-bold text-emerald-300">
              PCM 7E0 WRITE-LOCKED (TUNE SAFE) · DPF/SCR/EGR OFF
            </span>
          </div>

          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-12">
            {/* Hero Pre-Turbo EGT 1 Pyrometer */}
            <div className="flex flex-col justify-between rounded-xl border border-orange-500/35 bg-gradient-to-r from-orange-950/25 via-slate-950/80 to-slate-950/80 p-4 lg:col-span-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-orange-300">
                    Pre-Turbo Manifold Pyrometer (EGT 1)
                  </div>
                  <div className="mt-1 font-mono text-3xl font-extrabold text-slate-100">
                    {data?.egt1PreTurboF !== null && data?.egt1PreTurboF !== undefined
                      ? `${data.egt1PreTurboF}°F`
                      : '—'}
                  </div>
                </div>
                <span className="rounded-md border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 font-mono text-xs text-amber-200">
                  Peak {peakEgt1 > 0 ? `${peakEgt1}°F` : '—'}
                </span>
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      (data?.egt1PreTurboF ?? 0) >= 1375
                        ? 'bg-red-500'
                        : (data?.egt1PreTurboF ?? 0) >= 1200
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(5, (((data?.egt1PreTurboF ?? 300) - 250) / (1550 - 250)) * 100)
                      )}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between font-mono text-[10px] text-slate-400">
                  <span>Cruise &lt;1,150°F</span>
                  <span className="text-amber-300/80">Grade/Tow 1,250°F</span>
                  <span className="text-red-400/80">Limit 1,400°F+</span>
                </div>
                <MiniSparkline values={egtHistory} color="#fb923c" />
              </div>
            </div>

            {/* Common Rail Fuel Pressure (CP4.2 / Rail Monitor) */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-4 lg:col-span-3">
              <span className="text-[11px] font-semibold uppercase text-slate-400">
                Common Rail Fuel PSI
              </span>
              <div className="my-2 font-mono text-2xl font-extrabold text-sky-300">
                {data?.railPressurePsi !== null && data?.railPressurePsi !== undefined
                  ? `${data.railPressurePsi.toLocaleString()} PSI`
                  : '—'}
              </div>
              <MiniSparkline values={railHistory} color="#38bdf8" />
              <span className="font-mono text-[10px] text-slate-500">
                Bosch High-Pressure Rail (0123)
              </span>
            </div>

            {/* Intercooler Charge-Air Temp (IAT) */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-4 lg:col-span-3">
              <span className="text-[11px] font-semibold uppercase text-slate-400">
                Charge-Air (IAT)
              </span>
              <div className="my-2 font-mono text-2xl font-extrabold text-emerald-300">
                {data?.intakeTempF !== null && data?.intakeTempF !== undefined
                  ? `${data.intakeTempF}°F`
                  : '—'}
              </div>
              <MiniSparkline values={iatHistory} color="#34d399" />
              <span className="font-mono text-[10px] text-slate-500">
                Intercooler Manifold Out (010F)
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="uconnect-card rounded-2xl border border-slate-800/90 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                EcoDiesel Aftertreatment &amp; DPF Flow Pipeline
              </h3>
            </div>

            <span
              className={`rounded-full border px-3 py-1 font-mono text-xs font-bold ${
                data?.regenActive
                  ? 'animate-pulse border-orange-400 bg-orange-500/25 text-orange-200'
                  : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {data?.regenActive ? '🔥 ACTIVE DPF REGEN RUNNING' : 'DPF REGEN: IDLE / NORMAL'}
            </span>
          </div>

          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-12">
            {/* Stage 1: Pre-Turbo EGT1 */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 lg:col-span-2">
              <span className="text-[11px] font-semibold uppercase text-slate-400">
                1 · Turbo In
              </span>
              <div className="my-2 font-mono text-2xl font-extrabold text-orange-300">
                {data?.egt1PreTurboF !== null && data?.egt1PreTurboF !== undefined
                  ? `${data.egt1PreTurboF}°F`
                  : '—'}
              </div>
              <span className="font-mono text-[10px] text-slate-500">EGT Sensor 1</span>
            </div>

            {/* Stage 2: DOC Catalyst Out EGT2 */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 lg:col-span-2">
              <span className="text-[11px] font-semibold uppercase text-slate-400">
                2 · Catalyst
              </span>
              <div className="my-2 font-mono text-2xl font-extrabold text-amber-200">
                {data?.egt2DocOutF !== null && data?.egt2DocOutF !== undefined
                  ? `${data.egt2DocOutF}°F`
                  : '—'}
              </div>
              <span className="font-mono text-[10px] text-slate-500">DOC Out (EGT 2)</span>
            </div>

            {/* Stage 3: Centerpiece DPF Soot % + Diff Pressure + EGT3 */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-orange-500/35 bg-gradient-to-r from-orange-950/20 via-slate-950/80 to-slate-950/80 p-4 lg:col-span-6">
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-orange-300">
                  3 · Diesel Particulate Filter (DPF)
                </div>
                <div className="font-mono text-3xl font-extrabold text-slate-100">
                  {data?.dpfSootPct !== null && data?.dpfSootPct !== undefined
                    ? `${data.dpfSootPct}%`
                    : '—%'}{' '}
                  <span className="text-xs font-semibold text-slate-400">Soot Load</span>
                </div>
                <div className="flex flex-wrap gap-3 pt-1 font-mono text-xs text-slate-300">
                  <span>
                    Inlet (EGT 3):{' '}
                    <strong className="text-amber-200">
                      {data?.egt3DpfInF !== null && data?.egt3DpfInF !== undefined
                        ? `${data.egt3DpfInF}°F`
                        : '—'}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    Backpressure:{' '}
                    <strong className="text-sky-300">
                      {data?.dpfDiffPsi !== null && data?.dpfDiffPsi !== undefined
                        ? `${data.dpfDiffPsi} PSI`
                        : '—'}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Visual Soot Fill Bar */}
              <div className="w-full sm:w-36 space-y-1">
                <div className="flex justify-between font-mono text-[10px] text-slate-400">
                  <span>0% Clean</span>
                  <span>80% Regen</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      soot >= 80 ? 'bg-red-500' : soot >= 60 ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(4, soot))}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Stage 4: Tailpipe Out EGT4 */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 lg:col-span-2">
              <span className="text-[11px] font-semibold uppercase text-slate-400">
                4 · Tailpipe
              </span>
              <div className="my-2 font-mono text-2xl font-extrabold text-sky-200">
                {data?.egt4DpfOutF !== null && data?.egt4DpfOutF !== undefined
                  ? `${data.egt4DpfOutF}°F`
                  : '—'}
              </div>
              <span className="font-mono text-[10px] text-slate-500">DPF Out (EGT 4)</span>
            </div>
          </div>
        </div>
      )}

      {/* Row 4: Uconnect Pitch & Roll Off-Road Inclinometer */}
      <OffRoadClinometer />
    </div>
  );
};
