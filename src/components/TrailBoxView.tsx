import React, { useState } from 'react';
import { Plus, Power, Trash2, Zap } from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';
import { findModuleById, GLADIATOR_MODULES } from '../lib/gladiator/moduleCatalog';
import { SavedUdsMacro, vaultDb } from '../lib/storage/vaultDb';
import { EcuEndpoint } from '../lib/transport/types';
import { OfflineLinkBanner } from './OfflineLinkBanner';

const DEMO_SWITCHES: SavedUdsMacro[] = [
  {
    id: -1,
    createdAt: 0,
    name: 'ABS Tire Size Re-Learn',
    category: 'routine_31',
    bus: 'CAN_C',
    bits: 11,
    txId: '747',
    rxId: '4C7',
    scheme: 'fca_minus280',
    stepsHex: ['10 03', '31 01 F0 01'],
    provenance: 'sim_demo',
    notes: 'Initializes ABS/ESC wheel-speed reference after BCM tire change',
  },
  {
    id: -2,
    createdAt: 0,
    name: 'Camp / Trail Light Sweep',
    category: 'live_2f',
    bus: 'CAN_C',
    bits: 11,
    txId: '620',
    rxId: '504',
    scheme: 'fca_asymmetric',
    stepsHex: ['10 03', '2F D1 20 03 01'],
    releaseStepsHex: ['2F D1 20 00'],
    provenance: 'sim_demo',
    notes: 'Actuates exterior lamps via UDS 0x2F IOControl (tap again to release)',
  },
  {
    id: -3,
    createdAt: 0,
    name: 'ABS Brake Hold / Bleed Prep',
    category: 'routine_31',
    bus: 'CAN_C',
    bits: 11,
    txId: '747',
    rxId: '4C7',
    scheme: 'fca_minus280',
    stepsHex: ['10 03', '31 01 02 05'],
    provenance: 'sim_demo',
    notes: 'Runs hydraulic valve routine on ABS 747 → 4C7',
  },
];

export const TrailBoxView: React.FC = () => {
  const { session, simTransport, sgwState, macros, refreshVault, snifferRunning } =
    useGladiator();

  const [latchedIds, setLatchedIds] = useState<Set<number>>(new Set());
  const [busySwitchId, setBusySwitchId] = useState<number | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  const [newName, setNewName] = useState('');
  const [newEcuId, setNewEcuId] = useState('BCM_C');
  const [newSteps, setNewSteps] = useState('10 03\n2F D1 20 03 01');
  const [newRelease, setNewRelease] = useState('2F D1 20 00');

  // Show built-in demo switches when offline or running Simulator so pod is never empty
  const allSwitches: SavedUdsMacro[] = !session || simTransport
    ? [...DEMO_SWITCHES, ...macros]
    : macros;

  const canTransmit = Boolean(session) && sgwState === 'bypass_active' && !snifferRunning;

  const handleToggleSwitch = async (sw: SavedUdsMacro) => {
    if (!session) return;
    const id = sw.id ?? 0;
    const isCurrentlyLatched = latchedIds.has(id);
    const useRelease = isCurrentlyLatched && Boolean(sw.releaseStepsHex?.length);
    const steps = useRelease ? sw.releaseStepsHex! : sw.stepsHex;

    const endpoint: EcuEndpoint = {
      id: `SW_${id}`,
      shortName: sw.name,
      fullName: sw.name,
      bus: sw.bus,
      bits: sw.bits,
      txId: sw.txId,
      rxId: sw.rxId,
      scheme: sw.scheme,
      category: 'body',
      provenance: 'jl_jt_architecture',
    };

    setBusySwitchId(id);
    setStatusBanner(null);
    try {
      const exec = async () => {
        let allOk = true;
        const replies: string[] = [];
        for (const step of steps) {
          const resp = await session.requestUds(endpoint, step, 2500);
          replies.push(resp.ok ? resp.hex : resp.errorReason || 'NO DATA');
          if (!resp.ok) {
            allOk = false;
            break;
          }
        }
        return { allOk, text: replies.join(' → ') };
      };

      const outcome =
        sw.bus === 'CAN_IHS' || sw.bits === 29
          ? await session.withBusSafetyRestore(sw.bus, sw.bits, exec)
          : await exec();

      if (outcome.allOk) {
        setLatchedIds((prev) => {
          const next = new Set(prev);
          if (useRelease) {
            next.delete(id);
          } else if (sw.releaseStepsHex?.length) {
            next.add(id);
          }
          return next;
        });
      }
      setStatusBanner(`${sw.name}: ${outcome.text}`);
    } finally {
      setBusySwitchId(null);
    }
  };

  const handleSaveSwitch = async () => {
    if (!newName.trim()) return;
    const ecu = findModuleById(newEcuId);
    const stepsHex = newSteps
      .split(/[\r\n,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!stepsHex.length) return;

    const releaseStepsHex = newRelease
      .split(/[\r\n,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    await vaultDb.macros.add({
      createdAt: Date.now(),
      name: newName.trim(),
      category: releaseStepsHex.length ? 'live_2f' : 'routine_31',
      bus: ecu.bus,
      bits: ecu.bits,
      txId: ecu.txId,
      rxId: ecu.rxId,
      scheme: ecu.scheme,
      stepsHex,
      releaseStepsHex: releaseStepsHex.length ? releaseStepsHex : undefined,
      provenance: 'user_defined',
    });

    setNewName('');
    setShowBuilder(false);
    await refreshVault();
  };

  return (
    <div className="space-y-5">
      <OfflineLinkBanner />

      {/* Header Bar */}
      <div className="uconnect-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800/90 px-5 py-4">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-orange-400" />
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Trail Box — Auxiliary Switch Pod
            </h2>
            <p className="text-xs text-slate-400">
              {canTransmit
                ? 'Tap any backlit rocker switch to trigger live UDS actuations or service routines'
                : 'Plug in 12+8 SGW Bypass Cable (or switch Sim to 12+8) to arm live switches'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowBuilder(!showBuilder)}
          className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-orange-500/50 bg-orange-500/15 px-4 py-2 text-xs font-bold text-orange-200 hover:bg-orange-500/25"
        >
          <Plus className="h-4 w-4" />
          Add Custom Switch
        </button>
      </div>

      {statusBanner && (
        <div className="rounded-xl border border-sky-500/35 bg-sky-950/25 px-4 py-2.5 font-mono text-xs text-sky-200">
          {statusBanner}
        </div>
      )}

      {/* Optional Add Custom Switch Drawer */}
      {showBuilder && (
        <div className="uconnect-card rounded-2xl border border-orange-500/35 p-5 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-orange-300">
            Create New Trail Box Rocker Switch
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Switch Label (e.g. Winch High-Idle / Rock Light Test)"
              className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100"
            />
            <select
              value={newEcuId}
              onChange={(e) => setNewEcuId(e.target.value)}
              className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100"
            >
              {GLADIATOR_MODULES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shortName} ({m.txId}→{m.rxId})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block font-mono text-[11px] text-slate-400">
                ON / Trigger Hex Steps (one per line)
              </label>
              <textarea
                rows={2}
                value={newSteps}
                onChange={(e) => setNewSteps(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] text-slate-400">
                OFF / Release Step (optional, for latching toggle)
              </label>
              <textarea
                rows={2}
                value={newRelease}
                onChange={(e) => setNewRelease(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-100"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowBuilder(false)}
              className="min-h-[40px] rounded-lg border border-slate-700 px-4 text-xs text-slate-400"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSwitch}
              disabled={!newName.trim()}
              className="min-h-[40px] rounded-lg border border-orange-500/60 bg-orange-500/25 px-4 text-xs font-bold text-orange-100 disabled:opacity-40"
            >
              Save Switch to Pod
            </button>
          </div>
        </div>
      )}

      {/* Backlit Overland 6-Switch Pod Grid */}
      {allSwitches.length === 0 ? (
        <div className="uconnect-card rounded-2xl border border-slate-800 py-14 text-center space-y-2">
          <Power className="mx-auto h-8 w-8 text-slate-600" />
          <div className="text-sm font-bold text-slate-200">No Switches Programmed Yet</div>
          <p className="mx-auto max-w-md text-xs text-slate-400">
            Capture any actuation or service routine from your Autel in the <strong>R&amp;D Lab</strong>{' '}
            tab and tap &ldquo;Save Macro&rdquo;, or click &ldquo;Add Custom Switch&rdquo; above.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allSwitches.map((sw) => {
            const id = sw.id ?? 0;
            const isLatched = latchedIds.has(id);
            const isBusy = busySwitchId === id;
            return (
              <div
                key={id}
                className={`uconnect-card relative flex flex-col justify-between rounded-2xl border p-5 transition ${
                  isLatched
                    ? 'border-orange-500 bg-gradient-to-b from-orange-500/20 to-slate-950 shadow-[0_0_24px_rgba(249,115,22,0.22)]'
                    : 'border-slate-800/90 hover:border-slate-700'
                }`}
              >
                {/* Top Backlit Rocker Indicator Bar */}
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`h-2 w-16 rounded-full transition ${
                      isLatched
                        ? 'bg-orange-400 shadow-[0_0_12px_#fb923c]'
                        : 'bg-slate-800'
                    }`}
                  />
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-400">
                      {sw.provenance === 'sim_demo'
                        ? 'DEMO'
                        : sw.provenance === 'sniffer_captured'
                          ? 'CAPTURED'
                          : 'CUSTOM'}
                    </span>
                    {id > 0 && (
                      <button
                        onClick={async () => {
                          await vaultDb.macros.delete(id);
                          await refreshVault();
                        }}
                        className="rounded p-1 text-slate-500 hover:text-red-300"
                        title="Remove switch"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="my-4">
                  <div className="text-base font-extrabold text-slate-100">{sw.name}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {sw.notes || `${sw.bus} (${sw.txId}→${sw.rxId})`}
                  </div>
                </div>

                <button
                  onClick={() => handleToggleSwitch(sw)}
                  disabled={!canTransmit || isBusy}
                  className={`min-h-[48px] w-full rounded-xl border font-mono text-xs font-extrabold uppercase tracking-wider transition disabled:opacity-40 ${
                    isLatched
                      ? 'border-orange-400 bg-orange-500 text-slate-950 hover:bg-orange-400'
                      : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-orange-500/50 hover:text-orange-200'
                  }`}
                >
                  {isBusy
                    ? 'Transmitting...'
                    : isLatched
                      ? 'ACTIVE — TAP TO RELEASE'
                      : sw.releaseStepsHex?.length
                        ? 'ENGAGE SWITCH'
                        : 'RUN ROUTINE'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
