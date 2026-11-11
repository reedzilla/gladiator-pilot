import Dexie, { type EntityTable } from 'dexie';
import { AddressingBits, BusTarget, EcuEndpoint } from '../transport/types';

export interface AsBuiltSnapshot {
  id?: number;
  createdAt: number;
  label: string;
  vin: string;
  ecuId: string;
  ecuName: string;
  bus: BusTarget;
  bits: AddressingBits;
  txId: string;
  rxId: string;
  scheme: EcuEndpoint['scheme'];
  isFactoryBaseline: boolean;
  /** Map of 4-char uppercase DID hex (e.g. "0130") -> spaced uppercase byte hex (e.g. "09 D5 01 75") */
  dids: Record<string, string>;
}

export interface SavedUdsMacro {
  id?: number;
  createdAt: number;
  name: string;
  category: 'coding_2e' | 'live_2f' | 'routine_31';
  bus: BusTarget;
  bits: AddressingBits;
  txId: string;
  rxId: string;
  scheme: EcuEndpoint['scheme'];
  stepsHex: string[];
  releaseStepsHex?: string[];
  provenance: 'sniffer_captured' | 'user_defined' | 'sim_demo';
  notes?: string;
}

export interface VaultExportBundle {
  schemaVersion: 1;
  exportedAt: string;
  app: 'gladiator-pilot';
  snapshots: AsBuiltSnapshot[];
  macros: SavedUdsMacro[];
}

export class GladiatorVaultDb extends Dexie {
  snapshots!: EntityTable<AsBuiltSnapshot, 'id'>;
  macros!: EntityTable<SavedUdsMacro, 'id'>;

  constructor() {
    super('GladiatorPilotVault');
    this.version(1).stores({
      snapshots: '++id, createdAt, vin, ecuId, txId, isFactoryBaseline',
      macros: '++id, createdAt, category, txId, provenance',
    });
  }
}

export const vaultDb = new GladiatorVaultDb();

export async function exportVaultJson(): Promise<string> {
  const [snapshots, macros] = await Promise.all([
    vaultDb.snapshots.orderBy('createdAt').reverse().toArray(),
    vaultDb.macros.orderBy('createdAt').reverse().toArray(),
  ]);

  const bundle: VaultExportBundle = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: 'gladiator-pilot',
    snapshots,
    macros,
  };
  return JSON.stringify(bundle, null, 2);
}

export async function importVaultJson(rawJson: string): Promise<{ snapshotsAdded: number; macrosAdded: number }> {
  const parsed = JSON.parse(rawJson) as Partial<VaultExportBundle>;
  if (parsed.app !== 'gladiator-pilot' || !Array.isArray(parsed.snapshots)) {
    throw new Error('Invalid Gladiator Pilot backup JSON file.');
  }

  let snapshotsAdded = 0;
  let macrosAdded = 0;

  for (const snap of parsed.snapshots) {
    const { id: _omit, ...clean } = snap;
    await vaultDb.snapshots.add(clean);
    snapshotsAdded++;
  }

  if (Array.isArray(parsed.macros)) {
    for (const macro of parsed.macros) {
      const { id: _omit, ...clean } = macro;
      await vaultDb.macros.add(clean);
      macrosAdded++;
    }
  }

  return { snapshotsAdded, macrosAdded };
}
