import React, { useState } from 'react';
import {
  Activity,
  BookmarkPlus,
  Download,
  Play,
  Plus,
  Radio,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';
import { findModuleById, GLADIATOR_MODULES } from '../lib/gladiator/moduleCatalog';
import {
  buildMacroFromSniffedTransaction,
  DecodedUdsTransaction,
  exportSnifferFramesCsv,
} from '../lib/gladiator/udsSniffer';
import { SavedUdsMacro, vaultDb } from '../lib/storage/vaultDb';
import { BusTarget, EcuEndpoint } from '../lib/transport/types';

export const LiveControlsSnifferView: React.FC = () => {
  const {
    session,
    capabilities,
    sgwState,
    macros,
    refreshVault,
    snifferRunning,
    snifferFrames,
    udsTransactions,
    startSniffer,
    stopSniffer,
    clearSniffer,
  } = useGladiator();

  // Sniffer controls
  const [sniffBus, setSniffBus] = useState<BusTarget>('CAN_C');
  const [filterCanId, setFilterCanId] = useState('');
  const [showBroadcasts, setShowBroadcasts] = useState(false);

  // Custom Macro Builder state
  const [macroName, setMacroName] = useState('');
  const [macroCategory, setMacroCategory] = useState<SavedUdsMacro['category']>('routine_31');
  const [macroEcuId, setMacroEcuId] = useState('ABS');
  const [macroStepsText, setMacroStepsText] = useState('10 03\n31 01 F0 01');
  const [macroReleaseText, setMacroReleaseText] = useState('');
  const [execLog, setExecLog] = useState<string | null>(null);
  const [runningMacro, setRunningMacro] = useState(false);

  const handleSaveCustomMacro = async () => {
    if (!macroName.trim()) return;
    const ecu = findModuleById(macroEcuId);
    const stepsHex = macroStepsText
      .split(/[\r\n,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (stepsHex.length === 0) return;

    const releaseStepsHex = macroReleaseText
      .split(/[\r\n,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    await vaultDb.macros.add({
      createdAt: Date.now(),
      name: macroName.trim(),
      category: macroCategory,
      bus: ecu.bus,
      bits: ecu.bits,
      txId: ecu.txId,
      rxId: ecu.rxId,
      scheme: ecu.scheme,
      stepsHex,
      releaseStepsHex: releaseStepsHex.length > 0 ? releaseStepsHex : undefined,
      provenance: 'user_defined',
    });
    setMacroName('');
    await refreshVault();
  };

  const executeStepsOnMacro = async (macro: SavedUdsMacro, useRelease = false) => {
    if (!session) return;
    const steps = useRelease ? macro.releaseStepsHex : macro.stepsHex;
    if (!steps || steps.length === 0) return;

    const syntheticEndpoint: EcuEndpoint = {
      id: `MACRO_${macro.id}`,
      shortName: macro.name,
      fullName: macro.name,
      bus: macro.bus,
      bits: macro.bits,
      txId: macro.txId,
      rxId: macro.rxId,
      scheme: macro.scheme,
      category: 'body',
      provenance: 'jl_jt_architecture',
    };

    setRunningMacro(true);
    setExecLog(null);
    try {
      const run = async () => {
        const logs: string[] = [];
        for (const step of steps) {
          const resp = await session.requestUds(syntheticEndpoint, step, 2500);
          logs.push(`${step} → ${resp.ok ? resp.hex : resp.errorReason || 'NO DATA'}`);
          if (!resp.ok) break;
        }
        return logs.join('  |  ');
      };

      const summary =
        macro.bus === 'CAN_IHS' || macro.bits === 29
          ? await session.withBusSafetyRestore(macro.bus, macro.bits, run)
          : await run();

      setExecLog(`${macro.name}: ${summary}`);
    } finally {
      setRunningMacro(false);
    }
  };

  const handlePromoteCapture = async (tx: DecodedUdsTransaction) => {
    const built = buildMacroFromSniffedTransaction(tx);
    await vaultDb.macros.add(built);
    await refreshVault();
    setExecLog(`Promoted "${built.name}" into Saved 1-Click Macros!`);
  };

  const handleExportCsv = () => {
    const csv = exportSnifferFramesCsv(snifferFrames);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gladiator-sniffer-${sniffBus.toLowerCase()}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleFrames = showBroadcasts
    ? snifferFrames
    : snifferFrames.filter((f) => f.isDiagnostic);

  return (
    <div className="space-y-6">
      {/* Top Section: Y-Splitter Passive CAN / UDS Sniffer */}
      <div className="rounded-xl border border-slate-800 bg-[#10141c] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Radio className={`h-5 w-5 ${snifferRunning ? 'animate-pulse text-emerald-400' : 'text-orange-400'}`} />
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                Y-Splitter Passive CAN / UDS Sniffer (`STMA` / `ATMA`)
              </h2>
              <p className="text-xs text-slate-400">
                Plug shop Autel + vLinker FD+ into an OBD Y-splitter to capture exact 0x27 / 0x2E / 0x2F / 0x31 sequences &amp; promote to 1-click buttons
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sniffBus}
              disabled={snifferRunning}
              onChange={(e) => setSniffBus(e.target.value as BusTarget)}
              className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100"
            >
              <option value="CAN_C">CAN-C (Pins 6/14 · 500k)</option>
              <option value="CAN_IHS" disabled={!capabilities?.supportsMsCanPins3And11}>
                CAN-IHS (Pins 3/11 · 125k)
              </option>
            </select>

            <input
              value={filterCanId}
              disabled={snifferRunning}
              onChange={(e) => setFilterCanId(e.target.value.toUpperCase().slice(0, 3))}
              placeholder="CRA (opt)"
              title="Optional 3-hex CAN ID hardware filter (e.g. 620 or 504)"
              className="min-h-[44px] w-24 rounded-lg border border-slate-700 bg-slate-900 px-2.5 font-mono text-xs text-slate-100"
            />

            {snifferRunning ? (
              <button
                onClick={stopSniffer}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/20 px-4 text-xs font-bold text-red-200"
              >
                <Square className="h-4 w-4" />
                Stop Sniffer
              </button>
            ) : (
              <button
                onClick={() => startSniffer(sniffBus, filterCanId)}
                disabled={!session}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-4 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
              >
                <Play className="h-4 w-4" />
                Start Passive Capture
              </button>
            )}

            <button
              onClick={handleExportCsv}
              disabled={snifferFrames.length === 0}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>

            <button
              onClick={clearSniffer}
              disabled={snifferFrames.length === 0}
              className="flex min-h-[44px] items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Decoded Reassembled UDS Transactions */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-2">
            <div className="font-mono text-[11px] font-bold uppercase text-orange-300">
              Decoded Multi-Frame UDS Transactions ({udsTransactions.length})
            </div>
            <div className="h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2 space-y-1.5">
              {udsTransactions.length === 0 ? (
                <div className="flex h-full items-center justify-center font-mono text-xs text-slate-500">
                  Start capture (or test in 3.0D Bench Sim!) to decode UDS 0x10 / 0x22 / 0x27 / 0x2E / 0x31 traffic.
                </div>
              ) : (
                udsTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-2 rounded border border-slate-800/90 bg-slate-900/70 px-3 py-2 font-mono text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            tx.direction === 'request'
                              ? 'bg-orange-500/20 text-orange-300'
                              : 'bg-emerald-500/20 text-emerald-300'
                          }`}
                        >
                          {tx.direction === 'request' ? 'REQ' : 'RSP'} {tx.canId}
                        </span>
                        <span className="font-semibold text-slate-200">{tx.pairedEcuName}</span>
                        <span className="text-[11px] text-slate-400">{tx.serviceLabel}</span>
                      </div>
                      <div className="mt-1 truncate text-slate-300">{tx.summary}</div>
                    </div>

                    {tx.promotableCategory && (
                      <button
                        onClick={() => handlePromoteCapture(tx)}
                        title="Save this captured UDS command as a 1-click button"
                        className="flex shrink-0 items-center gap-1 rounded-md border border-orange-500/50 bg-orange-500/20 px-2.5 py-1.5 text-[11px] font-bold text-orange-200 hover:bg-orange-500/30"
                      >
                        <BookmarkPlus className="h-3.5 w-3.5" />
                        Save Macro
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Raw CAN Frames */}
          <div className="lg:col-span-5 space-y-2">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="font-bold uppercase text-slate-400">
                Raw Frames ({visibleFrames.length})
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-slate-400">
                <input
                  type="checkbox"
                  checked={showBroadcasts}
                  onChange={(e) => setShowBroadcasts(e.target.checked)}
                  className="accent-orange-500"
                />
                Show 0x102/0x202 Broadcasts
              </label>
            </div>
            <div className="h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2 font-mono text-[11px] space-y-1">
              {visibleFrames.map((f) => (
                <div key={f.index} className="flex items-center justify-between gap-2 text-slate-300">
                  <span>
                    <strong className={f.isDiagnostic ? 'text-emerald-400' : 'text-sky-400'}>
                      {f.canId}
                    </strong>{' '}
                    {f.dataHex}
                  </span>
                  <span className="truncate text-[10px] text-slate-500">{f.annotation}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Saved 1-Click Live Controls / Routines (0x2F / 0x31 / 0x2E) + Custom Builder */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#10141c] p-4 lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-orange-400" />
              <h3 className="text-sm font-bold text-slate-100">
                Saved Live Controls &amp; Service Routines ({macros.length})
              </h3>
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              {sgwState === 'bypass_active' ? '12+8 Bypass Ready' : 'Requires 12+8 Bypass to Transmit'}
            </span>
          </div>

          {execLog && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-3 py-2 font-mono text-xs text-sky-200">
              {execLog}
            </div>
          )}

          {macros.length === 0 ? (
            <p className="font-mono text-xs text-slate-500 py-6">
              No saved macros yet. Capture any Autel actuation/routine in the Sniffer above and click &ldquo;Save Macro&rdquo;, or add a custom UDS sequence on the right.
            </p>
          ) : (
            <div className="space-y-2.5">
              {macros.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-100">{m.name}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-orange-300">
                        {m.provenance === 'sniffer_captured' ? 'WIRE CAPTURED' : 'CUSTOM UDS'}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">
                      {m.bus} ({m.txId}→{m.rxId}) · {m.stepsHex.join(' → ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => executeStepsOnMacro(m, false)}
                      disabled={
                        !session || runningMacro || sgwState !== 'bypass_active' || snifferRunning
                      }
                      className="flex min-h-[40px] items-center gap-1 rounded-lg border border-orange-500/50 bg-orange-500/20 px-3 text-xs font-bold text-orange-200 hover:bg-orange-500/30 disabled:opacity-40"
                    >
                      <Activity className="h-3.5 w-3.5" />
                      Run
                    </button>
                    {m.releaseStepsHex && (
                      <button
                        onClick={() => executeStepsOnMacro(m, true)}
                        disabled={
                          !session || runningMacro || sgwState !== 'bypass_active' || snifferRunning
                        }
                        className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                      >
                        Release (0x00)
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (m.id) {
                          await vaultDb.macros.delete(m.id);
                          await refreshVault();
                        }
                      }}
                      className="rounded p-2 text-slate-500 hover:bg-red-500/15 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Manual UDS Sequence Builder */}
        <div className="rounded-xl border border-slate-800 bg-[#10141c] p-4 lg:col-span-5 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Create Custom UDS 0x2F / 0x31 Routine Button
          </h3>

          <input
            value={macroName}
            onChange={(e) => setMacroName(e.target.value)}
            placeholder="Button Label (e.g. ABS Tire Init Routine)"
            className="min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100"
          />

          <div className="grid grid-cols-2 gap-2">
            <select
              value={macroEcuId}
              onChange={(e) => setMacroEcuId(e.target.value)}
              className="min-h-[42px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 font-mono text-xs text-slate-100"
            >
              {GLADIATOR_MODULES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shortName} ({m.txId})
                </option>
              ))}
            </select>

            <select
              value={macroCategory}
              onChange={(e) => setMacroCategory(e.target.value as SavedUdsMacro['category'])}
              className="min-h-[42px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 font-mono text-xs text-slate-100"
            >
              <option value="routine_31">0x31 RoutineControl</option>
              <option value="live_2f">0x2F IOControl</option>
              <option value="coding_2e">0x2E WriteDID</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block font-mono text-[11px] text-slate-400">
              UDS Hex Steps (one per line)
            </label>
            <textarea
              rows={3}
              value={macroStepsText}
              onChange={(e) => setMacroStepsText(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-100"
            />
          </div>

          <div>
            <label className="mb-1 block font-mono text-[11px] text-slate-400">
              Optional Release Step (for 0x2F ReturnControlToECU)
            </label>
            <input
              value={macroReleaseText}
              onChange={(e) => setMacroReleaseText(e.target.value)}
              placeholder="e.g. 2F D1 20 00"
              className="min-h-[40px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-slate-100"
            />
          </div>

          <button
            onClick={handleSaveCustomMacro}
            disabled={!macroName.trim()}
            className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-orange-500/50 bg-orange-500/20 px-4 text-xs font-bold text-orange-200 hover:bg-orange-500/30 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Save to Macro Deck
          </button>
        </div>
      </div>
    </div>
  );
};
