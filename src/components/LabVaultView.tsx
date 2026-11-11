import React, { useState } from 'react';
import { Archive, Radio } from 'lucide-react';
import { LiveControlsSnifferView } from './LiveControlsSnifferView';
import { OfflineLinkBanner } from './OfflineLinkBanner';
import { VaultDidExplorerView } from './VaultDidExplorerView';

export const LabVaultView: React.FC = () => {
  const [section, setSection] = useState<'vault' | 'sniffer'>('vault');

  return (
    <div className="space-y-5">
      <OfflineLinkBanner />
      {/* Sub-Navigation Pills */}
      <div className="uconnect-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800/90 p-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSection('vault')}
            className={`flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
              section === 'vault'
                ? 'bg-orange-500/20 text-orange-200 border border-orange-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Archive className="h-4 w-4" />
            Factory Backups &amp; Snapshot Diff
          </button>

          <button
            onClick={() => setSection('sniffer')}
            className={`flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
              section === 'sniffer'
                ? 'bg-orange-500/20 text-orange-200 border border-orange-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="h-4 w-4" />
            Autel Y-Splitter Learner &amp; Sniffer
          </button>
        </div>

        <span className="px-2 font-mono text-[11px] text-slate-400">
          Shop R&amp;D Tools · Works on Stock OBD or 12+8
        </span>
      </div>

      {section === 'vault' ? <VaultDidExplorerView /> : <LiveControlsSnifferView />}
    </div>
  );
};
