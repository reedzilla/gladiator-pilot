import React from 'react';
import {
  Bluetooth,
  Cable,
  Cpu,
  Moon,
  Power,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Terminal,
  Zap,
} from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';

export const HeaderStatusStrip: React.FC = () => {
  const {
    session,
    simTransport,
    connecting,
    connectionError,
    capabilities,
    sgwState,
    vin,
    batteryVolts,
    connectBle,
    connectSerial,
    connectSimulator,
    setSimulatorBypass,
    disconnect,
    reprobeSgw,
    terminalOpen,
    setTerminalOpen,
    nightTrailMode,
    setNightTrailMode,
  } = useGladiator();

  return (
    <header className="uconnect-bezel sticky top-0 z-30 border-b border-slate-800/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        {/* Brand Emblem */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-500/50 bg-gradient-to-b from-orange-500/25 to-orange-950/40 font-mono text-xs font-extrabold text-orange-300 shadow-[0_0_16px_rgba(249,115,22,0.2)]">
            JT
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-extrabold tracking-wide text-slate-100 sm:text-base">
                GLADIATOR <span className="text-orange-400">OFF-ROAD PAGES</span>
              </h1>
              <span className="hidden rounded border border-slate-700/80 bg-slate-900/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300 sm:inline">
                3.0L ECODIESEL
              </span>
            </div>
            <div className="font-mono text-[11px] text-slate-400">
              {session
                ? `${capabilities?.deviceName || 'Connected'}${vin ? ` · ${vin}` : ''}`
                : 'Disconnected · Ready to Link'}
            </div>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Night Trail Amber Dimmer Toggle */}
          <button
            onClick={() => setNightTrailMode(!nightTrailMode)}
            title="Toggle Night Trail Amber Vision Mode"
            className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
              nightTrailMode
                ? 'border-amber-500/60 bg-amber-500/20 text-amber-200'
                : 'border-slate-700/80 bg-slate-900/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            {nightTrailMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{nightTrailMode ? 'Day UI' : 'Night'}</span>
          </button>

          {!session ? (
            <>
              <button
                onClick={connectBle}
                disabled={connecting}
                className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-orange-500/50 bg-orange-500/20 px-3 py-1.5 text-xs font-bold text-orange-200 hover:bg-orange-500/30 disabled:opacity-50"
              >
                <Bluetooth className="h-3.5 w-3.5" />
                BLE
              </button>
              <button
                onClick={connectSerial}
                disabled={connecting}
                className="hidden min-h-[38px] items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-bold text-sky-200 hover:bg-sky-500/25 disabled:opacity-50 sm:flex"
              >
                <Cable className="h-3.5 w-3.5" />
                Serial
              </button>
              <button
                onClick={() => connectSimulator(true)}
                disabled={connecting}
                className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                <Cpu className="h-3.5 w-3.5" />
                Demo Truck
              </button>
            </>
          ) : (
            <>
              {/* Simulator Instant Cable Mode Switcher */}
              {simTransport && (
                <button
                  onClick={() => setSimulatorBypass(!simTransport.sgwBypassInstalled)}
                  title="Switch simulated cable between Stock OBD Port and 12+8 SGW Bypass"
                  className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/15 px-2.5 py-1.5 text-xs font-bold text-purple-200 hover:bg-purple-500/25"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {simTransport.sgwBypassInstalled ? 'Sim: 12+8 Cable' : 'Sim: Stock OBD'}
                </button>
              )}

              {/* Plain-English Access Mode Pill */}
              <button
                onClick={reprobeSgw}
                title="Click to re-check vehicle access level"
                className={`flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                  sgwState === 'bypass_active'
                    ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                    : 'border-amber-500/45 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                }`}
              >
                {sgwState === 'bypass_active' ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Full Read / Write
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Gauges &amp; Scan Only
                  </>
                )}
              </button>

              {/* Battery Voltage Pill */}
              <span
                className={`flex min-h-[38px] items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono text-xs font-bold ${
                  batteryVolts !== null && batteryVolts < 12.0
                    ? 'border-red-500/40 bg-red-500/15 text-red-200'
                    : 'border-slate-700/80 bg-slate-900/90 text-emerald-300'
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                {batteryVolts !== null ? `${batteryVolts.toFixed(1)}V` : '—V'}
              </span>

              {/* Developer Hex Console Button */}
              <button
                onClick={() => setTerminalOpen(!terminalOpen)}
                title="Open Raw AT / UDS Hex Console"
                className={`flex min-h-[38px] items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono text-xs font-semibold transition ${
                  terminalOpen
                    ? 'border-orange-500/60 bg-orange-500/25 text-orange-200'
                    : 'border-slate-700/80 bg-slate-900/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
              </button>

              {/* Disconnect */}
              <button
                onClick={disconnect}
                title="Disconnect"
                className="flex min-h-[38px] items-center gap-1 rounded-lg border border-red-500/35 bg-red-500/15 px-2.5 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/25"
              >
                <Power className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {connectionError && (
        <div className="border-t border-red-500/30 bg-red-950/70 px-4 py-2 text-xs text-red-200">
          {connectionError}
        </div>
      )}
    </header>
  );
};
