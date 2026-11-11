import React from 'react';
import { Bluetooth, Cable, Cpu, WifiOff } from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';

export const OfflineLinkBanner: React.FC = () => {
  const { session, connecting, connectBle, connectSerial, connectSimulator } = useGladiator();
  if (session) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-500/35 bg-gradient-to-r from-orange-950/30 via-slate-900/90 to-slate-900/90 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <WifiOff className="h-4 w-4 shrink-0 text-orange-400" />
        <div className="text-xs text-slate-200">
          <strong className="text-orange-200">Offline Preview Mode</strong> — Browse modules &amp;
          calculators freely, or link your adapter / demo truck to run live commands.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={connectBle}
          disabled={connecting}
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-orange-500/50 bg-orange-500/20 px-3 py-1.5 text-xs font-bold text-orange-100 hover:bg-orange-500/30 disabled:opacity-50"
        >
          <Bluetooth className="h-3.5 w-3.5" />
          Connect BLE
        </button>
        <button
          onClick={connectSerial}
          disabled={connecting}
          className="hidden min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-bold text-sky-200 hover:bg-sky-500/25 disabled:opacity-50 sm:flex"
        >
          <Cable className="h-3.5 w-3.5" />
          Serial COM
        </button>
        <button
          onClick={() => connectSimulator(true)}
          disabled={connecting}
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          <Cpu className="h-3.5 w-3.5" />
          Launch 12+8 Demo
        </button>
      </div>
    </div>
  );
};
