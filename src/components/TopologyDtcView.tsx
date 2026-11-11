import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Download,
  Radar,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';
import { describeJeepDtc } from '../lib/gladiator/dtcDescriptions';
import {
  clearAllGladiatorDtcs,
  ModuleScanResult,
  scanAllGladiatorModules,
} from '../lib/gladiator/dtcEngine';
import { GLADIATOR_MODULES } from '../lib/gladiator/moduleCatalog';
import { EcuEndpoint } from '../lib/transport/types';
import { OfflineLinkBanner } from './OfflineLinkBanner';

const CATEGORY_LABELS: Record<EcuEndpoint['category'], string> = {
  powertrain: 'Powertrain (3.0L EcoDiesel & ZF 8HP75)',
  chassis: 'Chassis, Brakes, Steering & 4x4',
  body: 'Body, Cluster, Doors & Climate',
  infotainment: 'Uconnect Infotainment',
  gateway: 'Security Gateway',
};

export const TopologyDtcView: React.FC = () => {
  const { session, capabilities, sgwState, snifferRunning } = useGladiator();
  const [includeCanIhs, setIncludeCanIhs] = useState(true);
  const [showTechIds, setShowTechIds] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [results, setResults] = useState<ModuleScanResult[]>([]);
  const [clearSummary, setClearSummary] = useState<string | null>(null);

  const handleScanAll = async () => {
    if (!session) return;
    setScanning(true);
    setClearSummary(null);
    setProgressPct(5);
    try {
      const rows = await scanAllGladiatorModules(session, {
        includeCanIhs,
        onProgress: (curr, total, ecu) => {
          setProgressPct(Math.round((curr / total) * 100));
          setProgressText(`Checking ${ecu.shortName} (${curr} of ${total})...`);
        },
      });
      setResults(rows);
    } finally {
      setScanning(false);
      setProgressText(null);
      setProgressPct(0);
    }
  };

  const handleClearAll = async () => {
    if (!session) return;
    const onlineTargets = results.filter((r) => r.online).map((r) => r.ecu);
    if (onlineTargets.length === 0) return;

    setClearing(true);
    try {
      const report = await clearAllGladiatorDtcs(session, onlineTargets);
      const okCount = report.filter((r) => r.cleared).length;
      setClearSummary(`Cleared fault memory across ${okCount} of ${report.length} online modules.`);
      await handleScanAll();
    } finally {
      setClearing(false);
    }
  };

  const totalDtcs = results.reduce((acc, r) => acc + r.dtcs.length, 0);
  const onlineCount = results.filter((r) => r.online).length;

  const categories: Array<EcuEndpoint['category']> = [
    'powertrain',
    'chassis',
    'body',
    'infotainment',
    'gateway',
  ];

  return (
    <div className="space-y-5">
      <OfflineLinkBanner />

      {/* Top Action & Summary Hero */}
      <div className="uconnect-card rounded-2xl border border-slate-800/90 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Full-Vehicle Health Scan
            </h2>
            <p className="text-xs text-slate-400">
              Scans powertrain, ABS/4x4, body, cluster, climate, and radio modules across both Jeep networks
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleScanAll}
              disabled={!session || scanning || clearing || snifferRunning}
              className="flex min-h-[46px] items-center gap-2 rounded-xl border border-orange-500/60 bg-orange-500/20 px-5 py-2.5 text-xs font-bold text-orange-100 shadow-[0_0_20px_rgba(249,115,22,0.15)] transition hover:bg-orange-500/30 disabled:opacity-40"
            >
              <Radar className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning Truck...' : session ? 'Scan All Modules' : 'Connect to Scan'}
            </button>

            <button
              onClick={handleClearAll}
              disabled={
                scanning ||
                clearing ||
                onlineCount === 0 ||
                sgwState !== 'bypass_active' ||
                snifferRunning
              }
              title={
                sgwState !== 'bypass_active'
                  ? 'Plug in 12+8 SGW bypass cable to clear codes across all modules'
                  : 'Clear all stored & active fault codes'
              }
              className="flex min-h-[46px] items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/15 px-4 py-2.5 text-xs font-bold text-red-200 transition hover:bg-red-500/25 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              {sgwState === 'bypass_active' ? 'Clear All Faults' : 'Clear Faults (12+8 Needed)'}
            </button>

            {results.length > 0 && (
              <button
                onClick={() => {
                  const payload = JSON.stringify(
                    {
                      exportedAt: new Date().toISOString(),
                      onlineCount,
                      totalDtcs,
                      modules: results,
                    },
                    null,
                    2
                  );
                  const blob = new Blob([payload], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `gladiator-health-report-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex min-h-[46px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-800"
              >
                <Download className="h-4 w-4 text-sky-400" />
                Export Report
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        {scanning && (
          <div className="space-y-1.5">
            <div className="flex justify-between font-mono text-xs text-orange-300">
              <span>{progressText}</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-orange-500 transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Quick Options + KPI Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                checked={includeCanIhs}
                onChange={(e) => setIncludeCanIhs(e.target.checked)}
                className="h-4 w-4 accent-orange-500"
              />
              Include Interior Network (`CAN-IHS` via vLinker FD+)
            </label>

            <button
              onClick={() => setShowTechIds(!showTechIds)}
              className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
            >
              <Code2 className="h-3.5 w-3.5" />
              {showTechIds ? 'Hide CAN Hex IDs' : 'Show CAN Hex IDs'}
            </button>
          </div>

          {results.length > 0 && (
            <div className="flex items-center gap-4 font-mono">
              <span className="text-slate-400">
                Online: <strong className="text-emerald-400">{onlineCount}</strong>/{results.length}
              </span>
              <span className="text-slate-400">
                Faults:{' '}
                <strong className={totalDtcs > 0 ? 'text-amber-300' : 'text-emerald-400'}>
                  {totalDtcs}
                </strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {clearSummary && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-950/25 px-4 py-3 text-xs font-semibold text-emerald-200">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          {clearSummary}
        </div>
      )}

      {!capabilities?.supportsMsCanPins3And11 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-400">
          Connected adapter reaches Powertrain/Chassis (`CAN-C`). Switch to your{' '}
          <strong className="text-slate-200">vLinker FD+</strong> + 12+8 cable to also scan Interior
          modules (Cluster, Radio, Climate, Doors).
        </div>
      )}

      {/* Standby Architecture Map vs Scanned System Cards */}
      {results.length === 0 && !scanning ? (
        <div className="space-y-4">
          {categories.map((cat) => {
            const mods = GLADIATOR_MODULES.filter(
              (m) => m.category === cat && (includeCanIhs || m.bus === 'CAN_C')
            );
            if (mods.length === 0) return null;
            return (
              <div
                key={cat}
                className="uconnect-card rounded-2xl border border-slate-800/90 p-4 space-y-3"
              >
                <h3 className="text-xs font-bold uppercase tracking-wider text-orange-300">
                  {CATEGORY_LABELS[cat]}
                </h3>
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {mods.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3"
                    >
                      <div>
                        <div className="text-sm font-bold text-slate-200">{m.shortName}</div>
                        <div className="text-[11px] text-slate-500">{m.fullName}</div>
                        {showTechIds && (
                          <div className="mt-1 font-mono text-[10px] text-slate-500">
                            {m.bus} · {m.txId} → {m.rxId}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-700/80 bg-slate-900 px-2.5 py-0.5 font-mono text-[10px] text-slate-400">
                        {session ? 'READY' : m.bus === 'CAN_C' ? 'CAN-C' : '12+8 IHS'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => {
            const catRows = results.filter((r) => r.ecu.category === cat);
            if (catRows.length === 0) return null;
            return (
              <div
                key={cat}
                className="uconnect-card rounded-2xl border border-slate-800/90 p-4 space-y-3"
              >
                <h3 className="text-xs font-bold uppercase tracking-wider text-orange-300">
                  {CATEGORY_LABELS[cat]}
                </h3>

                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {catRows.map((row) => (
                    <div
                      key={row.ecu.id}
                      className={`rounded-xl border p-3.5 transition ${
                        row.dtcs.length > 0
                          ? 'border-amber-500/45 bg-amber-950/15'
                          : row.online
                            ? 'border-slate-800 bg-slate-950/65'
                            : 'border-slate-800/50 bg-slate-950/30 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            {row.online ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="h-4 w-4 text-slate-600 shrink-0" />
                            )}
                            <span className="text-sm font-bold text-slate-100">
                              {row.ecu.shortName}
                            </span>
                          </div>
                          <div className="mt-0.5 pl-6 text-[11px] text-slate-400">
                            {row.ecu.fullName}
                          </div>
                        </div>

                        {row.online ? (
                          row.dtcs.length > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                              <AlertTriangle className="h-3 w-3" />
                              {row.dtcs.length} {row.dtcs.length === 1 ? 'FAULT' : 'FAULTS'}
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                              CLEAN
                            </span>
                          )
                        ) : (
                          <span className="font-mono text-[10px] text-slate-500">
                            {row.skippedReason ? 'SKIPPED' : 'NOT PRESENT'}
                          </span>
                        )}
                      </div>

                      {row.dtcs.length > 0 && (
                        <div className="mt-2.5 space-y-2 pl-6">
                          {row.dtcs.map((d) => {
                            const info = describeJeepDtc(d.code);
                            return (
                              <div
                                key={d.code}
                                className="rounded-lg border border-amber-500/40 bg-amber-950/35 p-2.5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-mono text-xs font-extrabold text-amber-200">
                                    {d.code} · {d.active ? 'ACTIVE' : 'STORED'}
                                  </span>
                                  {info && (
                                    <span className="text-xs font-semibold text-slate-200">
                                      {info.title}
                                    </span>
                                  )}
                                </div>
                                {info?.stage2Note && (
                                  <div className="mt-1 text-[11px] text-orange-200/90">
                                    Tip: {info.stage2Note}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {(row.partNumber || showTechIds) && (
                        <div className="mt-2 flex flex-wrap gap-3 pl-6 font-mono text-[10px] text-slate-500">
                          {row.partNumber && <span>Mopar P/N: {row.partNumber}</span>}
                          {showTechIds && (
                            <span>
                              {row.ecu.bus} · {row.ecu.txId}→{row.ecu.rxId}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
