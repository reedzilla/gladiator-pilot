import React, { useState } from 'react';
import { FlaskConical, Gauge, ShieldAlert, Sliders, Zap } from 'lucide-react';
import { CockpitView } from './components/CockpitView';
import { CodingCalibratorView } from './components/CodingCalibratorView';
import { HeaderStatusStrip } from './components/HeaderStatusStrip';
import { LabVaultView } from './components/LabVaultView';
import { RawTerminalDrawer } from './components/RawTerminalDrawer';
import { TopologyDtcView } from './components/TopologyDtcView';
import { TrailBoxView } from './components/TrailBoxView';
import { GladiatorProvider, useGladiator } from './context/GladiatorContext';

type TabId = 'cockpit' | 'health' | 'mods' | 'trailbox' | 'lab';

const TABS: Array<{
  id: TabId;
  label: string;
  shortLabel: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'cockpit', label: 'Off-Road Gauges', shortLabel: 'Gauges', icon: Gauge },
  { id: 'health', label: 'Health Scan', shortLabel: 'Scan', icon: ShieldAlert },
  { id: 'mods', label: 'Truck Mods', shortLabel: 'Mods', icon: Sliders },
  { id: 'trailbox', label: 'Trail Box', shortLabel: 'Trail Box', icon: Zap },
  { id: 'lab', label: 'Backups & Lab', shortLabel: 'Lab', icon: FlaskConical },
];

const ShellContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('cockpit');
  const { nightTrailMode } = useGladiator();

  return (
    <div
      className={`topo-bg min-h-screen text-slate-100 pb-24 md:pb-16 ${
        nightTrailMode ? 'night-trail-mode' : ''
      }`}
    >
      <HeaderStatusStrip />

      {/* Desktop / Tablet Uconnect Top Tab Bar */}
      <nav className="hidden border-b border-slate-800/80 bg-[#0b0e14]/90 backdrop-blur md:block">
        <div className="mx-auto flex max-w-7xl gap-2 px-4 py-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition ${
                  isActive
                    ? 'border-orange-500/60 bg-gradient-to-b from-orange-500/25 to-orange-950/30 text-orange-100 shadow-[0_0_16px_rgba(249,115,22,0.16)]'
                    : 'border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-orange-400' : ''}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl px-4 py-5">
        {activeTab === 'cockpit' && <CockpitView />}
        {activeTab === 'health' && <TopologyDtcView />}
        {activeTab === 'mods' && <CodingCalibratorView />}
        {activeTab === 'trailbox' && <TrailBoxView />}
        {activeTab === 'lab' && <LabVaultView />}
      </main>

      {/* Mobile Cab Thumb Dock (Fixed Bottom Navigation) */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="uconnect-bezel fixed inset-x-0 bottom-0 z-30 border-t border-slate-800/90 px-2 pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] md:hidden"
      >
        <div className="grid grid-cols-5 gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold transition ${
                  isActive
                    ? 'bg-orange-500/20 text-orange-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-orange-400' : ''}`} />
                <span>{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <RawTerminalDrawer />
    </div>
  );
};

export const App: React.FC = () => (
  <GladiatorProvider>
    <ShellContent />
  </GladiatorProvider>
);

export default App;
