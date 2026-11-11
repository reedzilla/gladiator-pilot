import React, { useEffect, useState } from 'react';
import { Compass, Crosshair, SlidersHorizontal } from 'lucide-react';

export const OffRoadClinometer: React.FC = () => {
  const [rawPitch, setRawPitch] = useState<number>(0);
  const [rawRoll, setRawRoll] = useState<number>(0);
  const [zeroPitch, setZeroPitch] = useState<number>(0);
  const [zeroRoll, setZeroRoll] = useState<number>(0);
  const [sensorActive, setSensorActive] = useState<boolean>(false);
  const [showBenchSliders, setShowBenchSliders] = useState<boolean>(false);

  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta === null && e.gamma === null) return;
      setSensorActive(true);
      setRawPitch(Math.round((e.beta ?? 0) * 10) / 10);
      setRawRoll(Math.round((e.gamma ?? 0) * 10) / 10);
    };

    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, []);

  const requestGyroPermission = async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res === 'granted') setSensorActive(true);
      } catch {
        // Ignore if declined
      }
    }
  };

  const pitchDeg = Math.max(-45, Math.min(45, Math.round(rawPitch - zeroPitch)));
  const rollDeg = Math.max(-45, Math.min(45, Math.round(rawRoll - zeroRoll)));
  const gradePct = Math.round(Math.tan((Math.abs(pitchDeg) * Math.PI) / 180) * 100);

  const rollDanger = Math.abs(rollDeg) >= 28;
  const rollWarn = Math.abs(rollDeg) >= 20;

  return (
    <div className="uconnect-card rounded-2xl border border-slate-800/90 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-orange-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Uconnect Pitch &amp; Roll Inclinometer
          </h3>
          <span className="rounded border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 font-mono text-[10px] text-slate-400">
            {sensorActive ? 'MEMS GYRO LIVE' : 'DASH LEVEL'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!sensorActive &&
            typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
              .requestPermission === 'function' && (
              <button
                onClick={requestGyroPermission}
                className="rounded-lg border border-orange-500/45 bg-orange-500/15 px-2.5 py-1 text-[11px] font-bold text-orange-200"
              >
                Enable Phone Gyro
              </button>
            )}

          <button
            onClick={() => {
              setZeroPitch(rawPitch);
              setZeroRoll(rawRoll);
            }}
            title="Zero out your dash phone mount angle so current attitude reads 0° Pitch / 0° Roll"
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1 text-[11px] font-bold text-slate-200 hover:bg-slate-700"
          >
            <Crosshair className="h-3.5 w-3.5 text-orange-400" />
            Zero Dash Mount
          </button>

          <button
            onClick={() => setShowBenchSliders((s) => !s)}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Test Tilt
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Side Pitch Inclinometer */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800/90 bg-slate-950/70 p-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Pitch (Climb / Descent)
            </div>
            <div className="mt-1 font-mono text-3xl font-extrabold text-slate-100">
              {Math.abs(pitchDeg)}°{' '}
              <span className="text-xs font-bold text-orange-300">
                {pitchDeg > 1 ? 'NOSE UP' : pitchDeg < -1 ? 'NOSE DOWN' : 'LEVEL'}
              </span>
            </div>
            <div className="mt-1 font-mono text-xs text-slate-400">
              Slope Grade: <strong className="text-slate-200">{gradePct}%</strong>
            </div>
          </div>

          {/* Rotating Side Gladiator JT Silhouette */}
          <svg viewBox="0 0 130 86" className="h-20 w-32 shrink-0">
            <circle
              cx="65"
              cy="43"
              r="38"
              fill="#0a0e14"
              stroke="#1e293b"
              strokeWidth="2"
              strokeDasharray="3 3"
            />
            <line x1="18" y1="43" x2="112" y2="43" stroke="#334155" strokeWidth="1" />
            <g transform={`rotate(${-pitchDeg} 65 43)`}>
              {/* Ground Horizon under tires */}
              <line x1="22" y1="56" x2="108" y2="56" stroke="#f97316" strokeWidth="1.8" />
              {/* JT Pickup Body + Bed */}
              <path
                d="M30 48 L34 38 L50 38 L57 29 L78 29 L78 39 L100 39 L100 48 Z"
                fill="#1e293b"
                stroke="#f97316"
                strokeWidth="1.6"
              />
              {/* Front & Rear 35" Tires */}
              <circle cx="43" cy="50" r="6.5" fill="#090c10" stroke="#e2e8f0" strokeWidth="2" />
              <circle cx="88" cy="50" r="6.5" fill="#090c10" stroke="#e2e8f0" strokeWidth="2" />
            </g>
          </svg>
        </div>

        {/* Rear Roll / Camber Inclinometer */}
        <div
          className={`flex items-center justify-between gap-4 rounded-xl border p-4 ${
            rollDanger
              ? 'border-red-500/60 bg-red-950/25'
              : rollWarn
                ? 'border-amber-500/50 bg-amber-950/20'
                : 'border-slate-800/90 bg-slate-950/70'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Roll (Side Camber)
            </div>
            <div
              className={`mt-1 font-mono text-3xl font-extrabold ${
                rollDanger ? 'text-red-400' : rollWarn ? 'text-amber-300' : 'text-slate-100'
              }`}
            >
              {Math.abs(rollDeg)}°{' '}
              <span className="text-xs font-bold text-sky-300">
                {rollDeg > 1 ? 'RIGHT' : rollDeg < -1 ? 'LEFT' : 'LEVEL'}
              </span>
            </div>
            <div className="mt-1 font-mono text-xs text-slate-400">
              {rollDanger
                ? '⚠️ SIDE-SLOPE ROLLOVER RISK'
                : rollWarn
                  ? 'Caution · High Off-Camber'
                  : 'Safe Track Stability'}
            </div>
          </div>

          {/* Rotating Rear Gladiator Axle/Cab Silhouette */}
          <svg viewBox="0 0 130 86" className="h-20 w-32 shrink-0">
            <circle
              cx="65"
              cy="43"
              r="38"
              fill="#0a0e14"
              stroke="#1e293b"
              strokeWidth="2"
              strokeDasharray="3 3"
            />
            <line x1="18" y1="43" x2="112" y2="43" stroke="#334155" strokeWidth="1" />
            <g transform={`rotate(${rollDeg} 65 43)`}>
              <line x1="25" y1="58" x2="105" y2="58" stroke="#38bdf8" strokeWidth="1.8" />
              {/* Rear Cab + Bed Tailgate */}
              <rect
                x="45"
                y="26"
                width="40"
                height="22"
                rx="3"
                fill="#1e293b"
                stroke="#38bdf8"
                strokeWidth="1.6"
              />
              {/* Dana 44 Wide-Track Rear Tires */}
              <rect x="39" y="42" width="8" height="15" rx="2" fill="#e2e8f0" />
              <rect x="83" y="42" width="8" height="15" rx="2" fill="#e2e8f0" />
              {/* Pumpkin / Diff */}
              <circle cx="65" cy="50" r="4" fill="#f97316" />
            </g>
          </svg>
        </div>
      </div>

      {showBenchSliders && (
        <div className="grid grid-cols-1 gap-3 border-t border-slate-800/80 pt-3 sm:grid-cols-2">
          <div>
            <div className="flex justify-between font-mono text-[11px] text-slate-400">
              <span>Simulate Pitch</span>
              <span>{rawPitch}°</span>
            </div>
            <input
              type="range"
              min={-35}
              max={35}
              value={rawPitch}
              onChange={(e) => {
                setZeroPitch(0);
                setRawPitch(parseInt(e.target.value, 10));
              }}
              className="w-full accent-orange-500"
            />
          </div>
          <div>
            <div className="flex justify-between font-mono text-[11px] text-slate-400">
              <span>Simulate Roll</span>
              <span>{rawRoll}°</span>
            </div>
            <input
              type="range"
              min={-35}
              max={35}
              value={rawRoll}
              onChange={(e) => {
                setZeroRoll(0);
                setRawRoll(parseInt(e.target.value, 10));
              }}
              className="w-full accent-sky-500"
            />
          </div>
        </div>
      )}
    </div>
  );
};
