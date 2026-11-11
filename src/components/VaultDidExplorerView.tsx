import React, { useRef, useState } from 'react';
import {
  Archive,
  Download,
  GitCompare,
  Save,
  Search,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';
import {
  DID_SCAN_PRESETS,
  DidReadEntry,
  diffSnapshots,
  scanDidRange,
} from '../lib/gladiator/didScanner';
import { findModuleById, GLADIATOR_MODULES } from '../lib/gladiator/moduleCatalog';
import { exportVaultJson, importVaultJson, vaultDb } from '../lib/storage/vaultDb';

export const VaultDidExplorerView: React.FC = () => {
  const { session, vin, snapshots, refreshVault, snifferRunning } = useGladiator();

  const [selectedEcuId, setSelectedEcuId] = useState('BCM_C');
  const [startHex, setStartHex] = useState('0100');
  const [endHex, setEndHex] = useState('0140');
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [entries, setEntries] = useState<DidReadEntry[]>([]);
  const [snapshotLabel, setSnapshotLabel] = useState('Stock Factory Baseline');
  const [markFactory, setMarkFactory] = useState(true);

  const [diffBeforeId, setDiffBeforeId] = useState<number | ''>('');
  const [diffAfterId, setDiffAfterId] = useState<number | ''>('');
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyPreset = (presetId: string) => {
    const p = DID_SCAN_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setStartHex(p.startDid.toString(16).toUpperCase().padStart(4, '0'));
    setEndHex(p.endDid.toString(16).toUpperCase().padStart(4, '0'));
  };

  const handleRunScan = async () => {
    if (!session) return;
    const ecu = findModuleById(selectedEcuId);
    const s = parseInt(startHex, 16);
    const e = parseInt(endHex, 16);
    if (Number.isNaN(s) || Number.isNaN(e)) return;

    const ac = new AbortController();
    abortRef.current = ac;
    setScanning(true);
    setEntries([]);

    try {
      const found = await scanDidRange(session, ecu, s, e, {
        signal: ac.signal,
        onProgress: (didHex, idx, total, hits) => {
          setScanStatus(`Reading 0x22 ${didHex} (${idx}/${total}) · ${hits} readable DIDs found`);
        },
      });
      setEntries(found);
      setScanStatus(`Scan finished: ${found.length} readable DIDs on ${ecu.shortName}`);
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  };

  const handleSaveSnapshot = async () => {
    if (entries.length === 0) return;
    const ecu = findModuleById(selectedEcuId);
    const didMap: Record<string, string> = {};
    for (const item of entries) {
      didMap[item.didHex] = item.valueHex;
    }

    await vaultDb.snapshots.add({
      createdAt: Date.now(),
      label: snapshotLabel.trim() || `${ecu.shortName} Snapshot`,
      vin: vin || '1C6JJTAM0ML000000',
      ecuId: ecu.id,
      ecuName: ecu.shortName,
      bus: ecu.bus,
      bits: ecu.bits,
      txId: ecu.txId,
      rxId: ecu.rxId,
      scheme: ecu.scheme,
      isFactoryBaseline: markFactory,
      dids: didMap,
    });

    await refreshVault();
    setScanStatus(`Saved "${snapshotLabel}" (${entries.length} DIDs) to local As-Built Vault.`);
  };

  const handleExportVault = async () => {
    const json = await exportVaultJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gladiator-asbuilt-vault-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importVaultJson(text);
      await refreshVault();
      setImportNotice(`Imported ${res.snapshotsAdded} snapshots & ${res.macrosAdded} macros.`);
    } catch (err) {
      setImportNotice(`Import failed: ${(err as Error).message}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleDeleteSnapshot = async (id?: number) => {
    if (!id) return;
    await vaultDb.snapshots.delete(id);
    await refreshVault();
  };

  const snapBefore = snapshots.find((s) => s.id === diffBeforeId);
  const snapAfter = snapshots.find((s) => s.id === diffAfterId);
  const diffs = snapBefore && snapAfter ? diffSnapshots(snapBefore, snapAfter) : [];

  return (
    <div className="space-y-6">
      {/* Section 1: Stock-OBD-Safe 0x22 DID Range Harvester */}
      <div className="rounded-xl border border-slate-800 bg-[#10141c] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Archive className="h-5 w-5 text-orange-400" />
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                UDS 0x22 DID Harvester &amp; Immutable As-Built Vault
              </h2>
              <p className="text-xs text-slate-400">
                100% Read-Only — Back up your Gladiator&apos;s factory BCM, PCM &amp; ABS DIDs today on the stock OBD port
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportVault}
              className="flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5" />
              Export Vault JSON
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <Upload className="h-3.5 w-3.5" />
              Import JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>
        </div>

        {importNotice && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-3 py-2 font-mono text-xs text-sky-200">
            {importNotice}
          </div>
        )}

        {/* Controls Row */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="mb-1 block font-mono text-[11px] uppercase text-slate-400">
              Target Module
            </label>
            <select
              value={selectedEcuId}
              onChange={(e) => setSelectedEcuId(e.target.value)}
              className="min-h-[46px] w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100"
            >
              {GLADIATOR_MODULES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shortName} ({m.txId}→{m.rxId} · {m.bus})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="mb-1 block font-mono text-[11px] uppercase text-slate-400">
              Quick Range Preset
            </label>
            <select
              onChange={(e) => applyPreset(e.target.value)}
              defaultValue="bcm_vehconfig_low"
              className="min-h-[46px] w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100"
            >
              {DID_SCAN_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2 md:col-span-2">
            <div>
              <label className="mb-1 block font-mono text-[11px] uppercase text-slate-400">
                Start DID
              </label>
              <input
                value={startHex}
                onChange={(e) => setStartHex(e.target.value.toUpperCase().slice(0, 4))}
                className="min-h-[46px] w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] uppercase text-slate-400">
                End DID
              </label>
              <input
                value={endHex}
                onChange={(e) => setEndHex(e.target.value.toUpperCase().slice(0, 4))}
                className="min-h-[46px] w-full rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          <div className="flex items-end md:col-span-2">
            {scanning ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg border border-red-500/50 bg-red-500/20 px-3 text-xs font-bold text-red-200"
              >
                <Square className="h-4 w-4" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleRunScan}
                disabled={!session || snifferRunning}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg border border-orange-500/60 bg-orange-500/20 px-3 text-xs font-bold text-orange-200 hover:bg-orange-500/30 disabled:opacity-40"
              >
                <Search className="h-4 w-4" />
                Scan 0x22
              </button>
            )}
          </div>
        </div>

        {scanStatus && (
          <div className="font-mono text-xs text-orange-300">{scanStatus}</div>
        )}

        {/* Scanned DID Results + Save to Vault Bar */}
        {entries.length > 0 && (
          <div className="space-y-3 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  placeholder="Snapshot label (e.g. Stock Factory Baseline)"
                  className="min-h-[44px] w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100"
                />
                <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={markFactory}
                    onChange={(e) => setMarkFactory(e.target.checked)}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  Pin as Factory Baseline
                </label>
              </div>
              <button
                onClick={handleSaveSnapshot}
                className="flex min-h-[44px] items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30"
              >
                <Save className="h-4 w-4" />
                Save {entries.length} DIDs to As-Built Vault
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70">
              <table className="w-full border-collapse text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900 text-[11px] text-slate-400">
                    <th className="px-3 py-2">DID</th>
                    <th className="px-3 py-2">Len</th>
                    <th className="px-3 py-2">Hex Bytes</th>
                    <th className="px-3 py-2">ASCII</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {entries.map((item) => (
                    <tr key={item.didHex} className="hover:bg-slate-900/50">
                      <td className="px-3 py-2 font-bold text-orange-300">0x{item.didHex}</td>
                      <td className="px-3 py-2 text-slate-400">{item.byteLength}B</td>
                      <td className="px-3 py-2 text-slate-100">{item.valueHex}</td>
                      <td className="px-3 py-2 text-emerald-300/80">{item.asciiPreview}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Saved Vault Snapshots + Bit-Level Snapshot Differ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Saved Snapshots List */}
        <div className="rounded-xl border border-slate-800 bg-[#10141c] p-4 lg:col-span-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">
            Saved As-Built Vault Snapshots ({snapshots.length})
          </h3>
          {snapshots.length === 0 ? (
            <p className="font-mono text-xs text-slate-500">
              No snapshots stored yet. Run a 0x22 scan above and save your Gladiator&apos;s factory baseline!
            </p>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-100">{snap.label}</span>
                      {snap.isFactoryBaseline && (
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                          FACTORY
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">
                      {snap.ecuName} ({snap.txId}) · {Object.keys(snap.dids).length} DIDs ·{' '}
                      {new Date(snap.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteSnapshot(snap.id)}
                    title="Delete snapshot"
                    className="rounded p-2 text-slate-500 hover:bg-red-500/15 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bit-Level Snapshot Differ */}
        <div className="rounded-xl border border-slate-800 bg-[#10141c] p-4 lg:col-span-7 space-y-3">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-orange-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Before / After Snapshot Byte &amp; Bit Differ
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Compare two snapshots (e.g., before &amp; after an Autel feature toggle) to isolate exact DID byte &amp; bit flips.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              value={diffBeforeId}
              onChange={(e) => setDiffBeforeId(e.target.value ? Number(e.target.value) : '')}
              className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100"
            >
              <option value="">Select BEFORE Snapshot...</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.ecuName})
                </option>
              ))}
            </select>

            <select
              value={diffAfterId}
              onChange={(e) => setDiffAfterId(e.target.value ? Number(e.target.value) : '')}
              className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100"
            >
              <option value="">Select AFTER Snapshot...</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.ecuName})
                </option>
              ))}
            </select>
          </div>

          {snapBefore && snapAfter && (
            <div className="space-y-2 pt-1">
              {diffs.length === 0 ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3 font-mono text-xs text-emerald-300">
                  Identical — 0 byte differences across all DIDs.
                </div>
              ) : (
                diffs.map((d) => (
                  <div
                    key={d.didHex}
                    className="rounded-lg border border-orange-500/30 bg-slate-950/80 p-3 font-mono text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-orange-300">DID 0x{d.didHex}</span>
                      <span className="uppercase text-[10px] text-slate-400">{d.status}</span>
                    </div>
                    <div className="text-slate-400">Before: {d.beforeHex || '(absent)'}</div>
                    <div className="text-emerald-300">After : {d.afterHex || '(absent)'}</div>
                    {d.byteDiffs.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {d.byteDiffs.map((bd) => (
                          <span
                            key={bd.byteIndex}
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-amber-200"
                          >
                            Byte[{bd.byteIndex}]: 0x
                            {bd.beforeByte?.toString(16).toUpperCase().padStart(2, '0') ?? '--'} → 0x
                            {bd.afterByte?.toString(16).toUpperCase().padStart(2, '0') ?? '--'}{' '}
                            {bd.changedBits.length > 0 &&
                              `(${bd.changedBits.map((b) => `b${b.bit}:${b.before}→${b.after}`).join(', ')})`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
