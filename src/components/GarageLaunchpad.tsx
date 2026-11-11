import React, { useState } from 'react';
import {
  Bluetooth,
  Cable,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  LockOpen,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';

export const GarageLaunchpad: React.FC = () => {
  const { connecting, connectBle, connectSerial, connectSimulator } = useGladiator();
  const [showBypassGuide, setShowBypassGuide] = useState(false);

  return (
    <div className="space-y-6">
      {/* Hero Jeep JT 7-Slot Grille Banner */}
      <div className="uconnect-card relative overflow-hidden rounded-2xl border border-slate-800/90 p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-orange-500/10 blur-3xl" />

        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between">
          <div className="space-y-2 text-center md:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-300">
              <Sparkles className="h-3.5 w-3.5" />
              2021 Jeep Gladiator JT · 3.0L V6 EcoDiesel · Zero VIN Lock
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
              Select How You Want to Connect
            </h2>
            <p className="max-w-xl text-sm text-slate-400">
              Live EcoDiesel gauges, DPF soot/regen tracking, fault scans, and factory backups work
              today on your stock OBD port. Plug in your 12+8 cable to unlock full Truck Mods &amp; Trail Box.
            </p>
          </div>

          {/* Iconic 7-Slot Jeep Grille + Halo LED SVG */}
          <svg
            viewBox="0 0 260 92"
            className="h-20 w-56 shrink-0 drop-shadow-[0_0_24px_rgba(249,115,22,0.22)]"
            fill="none"
          >
            <rect
              x="6"
              y="8"
              width="248"
              height="76"
              rx="18"
              fill="#0d1219"
              stroke="#273142"
              strokeWidth="2.5"
            />
            {/* Left Halo Headlamp */}
            <circle cx="38" cy="44" r="19" fill="#090c10" stroke="#f97316" strokeWidth="3" />
            <circle cx="38" cy="44" r="11" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 3" />
            {/* 7 Grille Slots */}
            {[74, 92, 110, 128, 146, 164, 182].map((x) => (
              <rect
                key={x}
                x={x}
                y="20"
                width="10"
                height="52"
                rx="5"
                fill="#07090d"
                stroke="#334155"
                strokeWidth="1.5"
              />
            ))}
            {/* Right Halo Headlamp */}
            <circle cx="222" cy="44" r="19" fill="#090c10" stroke="#f97316" strokeWidth="3" />
            <circle cx="222" cy="44" r="11" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
        </div>

        {/* 3 Big One-Tap Connection Cards */}
        <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Card 1: Wireless BLE */}
          <button
            onClick={connectBle}
            disabled={connecting}
            className="group flex flex-col justify-between rounded-xl border border-orange-500/40 bg-gradient-to-b from-orange-500/15 to-slate-950/80 p-5 text-left transition hover:border-orange-400 hover:from-orange-500/25 disabled:opacity-50"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-orange-500/40 bg-orange-500/20 text-orange-300">
                  <Bluetooth className="h-5 w-5" />
                </div>
                <span className="rounded-md bg-orange-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-orange-200">
                  CAB WIRELESS
                </span>
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-100">
                Connect Bluetooth LE
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Best for <strong className="text-slate-200">Veepeak BLE</strong> or{' '}
                <strong className="text-slate-200">vLinker FD+ BLE</strong>. Starts live EcoDiesel
                gauges immediately.
              </p>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-orange-500/20 pt-3 font-mono text-xs font-bold text-orange-300">
              <span>{connecting ? 'Pairing...' : 'Tap to Pair Dongle'}</span>
              <span className="transition group-hover:translate-x-1">→</span>
            </div>
          </button>

          {/* Card 2: Bluetooth Classic SPP / USB Serial */}
          <button
            onClick={connectSerial}
            disabled={connecting}
            className="group flex flex-col justify-between rounded-xl border border-sky-500/35 bg-gradient-to-b from-sky-500/12 to-slate-950/80 p-5 text-left transition hover:border-sky-400 hover:from-sky-500/20 disabled:opacity-50"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-sky-500/40 bg-sky-500/20 text-sky-300">
                  <Cable className="h-5 w-5" />
                </div>
                <span className="rounded-md bg-sky-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-200">
                  FASTEST CODING
                </span>
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-100">
                Connect Serial / BT Classic
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Use on Windows laptop for <strong className="text-slate-200">vLinker FD+</strong>{' '}
                paired over Bluetooth Classic COM port or USB adapters.
              </p>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-sky-500/20 pt-3 font-mono text-xs font-bold text-sky-300">
              <span>{connecting ? 'Opening Port...' : 'Select COM Port'}</span>
              <span className="transition group-hover:translate-x-1">→</span>
            </div>
          </button>

          {/* Card 3: Interactive 3.0D Demo Truck */}
          <div className="flex flex-col justify-between rounded-xl border border-emerald-500/35 bg-gradient-to-b from-emerald-500/12 to-slate-950/80 p-5">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-300">
                  <Cpu className="h-5 w-5" />
                </div>
                <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
                  TEST AT DESK
                </span>
              </div>
              <h3 className="mt-4 text-base font-bold text-slate-100">
                Interactive 3.0D Demo Truck
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Try the live Uconnect gauges, DPF flow diagram, 35&quot; tire &amp; LED mods, and
                1-click factory restore right now.
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 border-t border-emerald-500/20 pt-3">
              <button
                onClick={() => connectSimulator(false)}
                disabled={connecting}
                className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 font-mono text-[11px] font-bold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
              >
                Stock OBD Sim
              </button>
              <button
                onClick={() => connectSimulator(true)}
                disabled={connecting}
                className="min-h-[40px] rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-2.5 py-1.5 font-mono text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-500/30"
              >
                12+8 Unlocked Sim
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Visual Guide: Stock OBD Today vs 12+8 Bypass Cable */}
      <div className="uconnect-card rounded-2xl border border-slate-800/90">
        <button
          onClick={() => setShowBypassGuide(!showBypassGuide)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <LockOpen className="h-4 w-4 text-orange-400" />
            <span className="text-sm font-bold text-slate-200">
              Hardware Quick Guide: What Works Today vs. With the 12+8 SGW Bypass Cable
            </span>
          </div>
          {showBypassGuide ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {showBypassGuide && (
          <div className="grid grid-cols-1 gap-4 border-t border-slate-800 p-5 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-300">
                <ShieldCheck className="h-4 w-4" />
                Today — Stock OBD-II Port (No Cable Needed)
              </div>
              <ul className="space-y-1.5 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  Live 3.0L EcoDiesel Radial Gauges, 8HP75 Trans Temp &amp; 4x EGTs
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  DPF Soot Load % &amp; Active Regeneration Alert
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  Read Powertrain, ABS (`747→4C7`) &amp; BCM Faults + Back Up Stock Config
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  Y-Splitter Passive Sniffer alongside your shop Autel
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-orange-500/30 bg-orange-950/10 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-300">
                <LockOpen className="h-4 w-4" />
                With 12+8 SGW Bypass + vLinker FD+
              </div>
              <p className="text-xs text-slate-400">
                Behind the driver&apos;s knee panel (left of steering column, behind the headlight
                switch), unplug the <strong>12-pin (`CAN-C`)</strong> and{' '}
                <strong>8-pin (`CAN-IHS`)</strong> plugs from the SGW box into your 12+8 adapter:
              </p>
              <ul className="space-y-1.5 text-xs text-slate-200">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                  1-Click Tire Size, Axle Gear Ratio, LED Lighting &amp; Trail TPMS Coding
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                  Full Dual-Bus Scan &amp; Clear across all 17 `CAN-C` + `CAN-IHS` modules
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                  Trail Box Live Rocker Switches &amp; 1-Tap Factory Restore (Zero VIN Lock)
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
