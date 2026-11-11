import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  detectSgwState,
  findModuleById,
  resolveActiveBcm,
  SgwProbeResult,
} from '../lib/gladiator/moduleCatalog';
import {
  DecodedUdsTransaction,
  PassiveUdsSnifferEngine,
  SniffedCanFrame,
} from '../lib/gladiator/udsSniffer';
import { AsBuiltSnapshot, SavedUdsMacro, vaultDb } from '../lib/storage/vaultDb';
import { BleTransport } from '../lib/transport/bleTransport';
import { ElmSession } from '../lib/transport/elmSession';
import { GladiatorSimTransport } from '../lib/transport/gladiatorSimTransport';
import { SerialTransport } from '../lib/transport/serialTransport';
import {
  AdapterCapabilities,
  BusTarget,
  EcuEndpoint,
  SgwState,
  TerminalLogEntry,
} from '../lib/transport/types';

interface GladiatorContextValue {
  session: ElmSession | null;
  simTransport: GladiatorSimTransport | null;
  connecting: boolean;
  connectionError: string | null;
  capabilities: AdapterCapabilities | null;
  activeBus: BusTarget;
  activeBcm: EcuEndpoint;
  sgwState: SgwState;
  sgwProbe: SgwProbeResult | null;
  vin: string | null;
  batteryVolts: number | null;
  speedMph: number | null;
  updateLiveVitals: (volts: number | null, mph: number | null) => void;

  connectBle: () => Promise<void>;
  connectSerial: () => Promise<void>;
  connectSimulator: (bypassInstalled?: boolean) => Promise<void>;
  setSimulatorBypass: (bypassInstalled: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  reprobeSgw: () => Promise<void>;

  snapshots: AsBuiltSnapshot[];
  macros: SavedUdsMacro[];
  refreshVault: () => Promise<void>;

  terminalLogs: TerminalLogEntry[];
  clearTerminalLogs: () => void;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  nightTrailMode: boolean;
  setNightTrailMode: (on: boolean) => void;
  stage2DeleteMode: boolean;
  setStage2DeleteMode: (on: boolean) => void;

  snifferRunning: boolean;
  snifferFrames: SniffedCanFrame[];
  udsTransactions: DecodedUdsTransaction[];
  startSniffer: (bus: BusTarget, filterCanId?: string) => Promise<void>;
  stopSniffer: () => Promise<void>;
  clearSniffer: () => void;
}

const GladiatorContext = createContext<GladiatorContextValue | null>(null);

export const GladiatorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<ElmSession | null>(null);
  const [simTransport, setSimTransport] = useState<GladiatorSimTransport | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AdapterCapabilities | null>(null);
  const [activeBus, setActiveBus] = useState<BusTarget>('CAN_C');
  const [activeBcm, setActiveBcm] = useState<EcuEndpoint>(() => findModuleById('BCM_C'));
  const [sgwProbe, setSgwProbe] = useState<SgwProbeResult | null>(null);
  const [vin, setVin] = useState<string | null>(null);
  const [batteryVolts, setBatteryVolts] = useState<number | null>(null);
  const [speedMph, setSpeedMph] = useState<number | null>(0);

  const [snapshots, setSnapshots] = useState<AsBuiltSnapshot[]>([]);
  const [macros, setMacros] = useState<SavedUdsMacro[]>([]);

  const [terminalLogs, setTerminalLogs] = useState<TerminalLogEntry[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [nightTrailMode, setNightTrailMode] = useState(false);
  const [stage2DeleteMode, setStage2DeleteModeState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('gladiator_stage2_delete');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const setStage2DeleteMode = useCallback((on: boolean) => {
    setStage2DeleteModeState(on);
    try {
      localStorage.setItem('gladiator_stage2_delete', String(on));
    } catch {
      // Ignore private browsing storage failures
    }
  }, []);

  const [snifferRunning, setSnifferRunning] = useState(false);
  const [snifferFrames, setSnifferFrames] = useState<SniffedCanFrame[]>([]);
  const [udsTransactions, setUdsTransactions] = useState<DecodedUdsTransaction[]>([]);
  const snifferEngineRef = useRef(new PassiveUdsSnifferEngine());

  const refreshVault = useCallback(async () => {
    const [snaps, macs] = await Promise.all([
      vaultDb.snapshots.orderBy('createdAt').reverse().toArray(),
      vaultDb.macros.orderBy('createdAt').reverse().toArray(),
    ]);
    setSnapshots(snaps);
    setMacros(macs);
  }, []);

  useEffect(() => {
    refreshVault().catch(() => undefined);
  }, [refreshVault]);

  const appendLog = useCallback((entry: TerminalLogEntry) => {
    setTerminalLogs((prev) => (prev.length >= 400 ? [...prev.slice(-399), entry] : [...prev, entry]));
  }, []);

  const handleMonitorFrame = useCallback((rawLine: string, bus: BusTarget) => {
    const { frame, udsTransaction } = snifferEngineRef.current.ingestRawLine(rawLine, bus);
    if (frame) {
      setSnifferFrames((prev) => (prev.length >= 600 ? [...prev.slice(-599), frame] : [...prev, frame]));
    }
    if (udsTransaction) {
      setUdsTransactions((prev) =>
        prev.length >= 250 ? [...prev.slice(-249), udsTransaction] : [...prev, udsTransaction]
      );
    }
  }, []);

  const bootstrapSession = useCallback(
    async (elm: ElmSession, sim: GladiatorSimTransport | null) => {
      const caps = await elm.initialize();
      setCapabilities(caps);
      setSession(elm);
      setSimTransport(sim);

      // Read Pin 16 Voltage
      const volts = await elm.readPin16Voltage();
      if (volts !== null) setBatteryVolts(volts);

      // Auto-resolve whether this truck's Continental BCM answers on 11-bit `620->504` or 29-bit `18DA40F1->18DAF140`
      const bcm = await resolveActiveBcm(elm);
      setActiveBcm(bcm);

      // Read chassis VIN from active BCM first (protects against donor VIN on swapped Stage 2 ECMs), fallback to PCM
      const pcm = findModuleById('PCM');
      let vinResp =
        bcm.bits === 29
          ? await elm.withBusSafetyRestore('CAN_C', 29, () => elm.requestUds(bcm, '22F190', 1400))
          : await elm.requestUds(bcm, '22F190', 1400);
      if (!vinResp.ok || vinResp.bytes.length < 20) {
        vinResp = await elm.requestUds(pcm, '22F190', 1600);
      }
      if (vinResp.ok && vinResp.bytes.length >= 20) {
        const ascii = vinResp.bytes
          .slice(3, 20)
          .map((b) => String.fromCharCode(b))
          .join('')
          .trim();
        if (ascii.length === 17) setVin(ascii);
      }

      // Probe SGW vs 12+8 Bypass
      const sgw = await detectSgwState(elm, bcm);
      setSgwProbe(sgw);
    },
    []
  );

  const disconnect = useCallback(async () => {
    setSnifferRunning(false);
    if (session) {
      await session.close().catch(() => undefined);
    }
    setSession(null);
    setSimTransport(null);
    setCapabilities(null);
    setSgwProbe(null);
    setActiveBus('CAN_C');
  }, [session]);

  const connectBle = useCallback(async () => {
    setConnecting(true);
    setConnectionError(null);
    try {
      if (session) await disconnect();
      const transport = new BleTransport();
      const elm = new ElmSession(transport, {
        onLog: appendLog,
        onMonitorFrame: handleMonitorFrame,
        onBusChange: setActiveBus,
        onDisconnect: () => {
          setSession(null);
          setCapabilities(null);
          setSnifferRunning(false);
        },
      });
      await bootstrapSession(elm, null);
    } catch (err) {
      setConnectionError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [appendLog, bootstrapSession, disconnect, handleMonitorFrame, session]);

  const connectSerial = useCallback(async () => {
    setConnecting(true);
    setConnectionError(null);
    try {
      if (session) await disconnect();
      const transport = new SerialTransport();
      const elm = new ElmSession(transport, {
        onLog: appendLog,
        onMonitorFrame: handleMonitorFrame,
        onBusChange: setActiveBus,
        onDisconnect: () => {
          setSession(null);
          setCapabilities(null);
          setSnifferRunning(false);
        },
      });
      await bootstrapSession(elm, null);
    } catch (err) {
      setConnectionError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [appendLog, bootstrapSession, disconnect, handleMonitorFrame, session]);

  const connectSimulator = useCallback(
    async (bypassInstalled = false) => {
      setConnecting(true);
      setConnectionError(null);
      try {
        if (session) await disconnect();
        const sim = new GladiatorSimTransport({ sgwBypassInstalled: bypassInstalled });
        const elm = new ElmSession(sim, {
          onLog: appendLog,
          onMonitorFrame: handleMonitorFrame,
          onBusChange: setActiveBus,
        });
        await bootstrapSession(elm, sim);
      } catch (err) {
        setConnectionError((err as Error).message);
      } finally {
        setConnecting(false);
      }
    },
    [appendLog, bootstrapSession, disconnect, handleMonitorFrame, session]
  );

  const setSimulatorBypass = useCallback(
    async (bypassInstalled: boolean) => {
      if (!simTransport || !session) return;
      simTransport.sgwBypassInstalled = bypassInstalled;
      const sgw = await detectSgwState(session, activeBcm);
      setSgwProbe(sgw);
    },
    [activeBcm, session, simTransport]
  );

  const reprobeSgw = useCallback(async () => {
    if (!session) return;
    const bcm = await resolveActiveBcm(session);
    setActiveBcm(bcm);
    const sgw = await detectSgwState(session, bcm);
    setSgwProbe(sgw);
    const v = await session.readPin16Voltage();
    if (v !== null) setBatteryVolts(v);
  }, [session]);

  const updateLiveVitals = useCallback((volts: number | null, mph: number | null) => {
    if (volts !== null) setBatteryVolts(volts);
    if (mph !== null) setSpeedMph(mph);
  }, []);

  const startSniffer = useCallback(
    async (bus: BusTarget, filterCanId?: string) => {
      if (!session) return;
      snifferEngineRef.current.reset();
      await session.startPassiveMonitor(bus, filterCanId);
      setSnifferRunning(true);
    },
    [session]
  );

  const stopSniffer = useCallback(async () => {
    if (!session) return;
    await session.stopPassiveMonitor();
    setSnifferRunning(false);
  }, [session]);

  const clearSniffer = useCallback(() => {
    snifferEngineRef.current.reset();
    setSnifferFrames([]);
    setUdsTransactions([]);
  }, []);

  return (
    <GladiatorContext.Provider
      value={{
        session,
        simTransport,
        connecting,
        connectionError,
        capabilities,
        activeBus,
        activeBcm,
        sgwState: sgwProbe?.state ?? 'unknown',
        sgwProbe,
        vin,
        batteryVolts,
        speedMph,
        updateLiveVitals,
        connectBle,
        connectSerial,
        connectSimulator,
        setSimulatorBypass,
        disconnect,
        reprobeSgw,
        snapshots,
        macros,
        refreshVault,
        terminalLogs,
        clearTerminalLogs: () => setTerminalLogs([]),
        terminalOpen,
        setTerminalOpen,
        nightTrailMode,
        setNightTrailMode,
        stage2DeleteMode,
        setStage2DeleteMode,
        snifferRunning,
        snifferFrames,
        udsTransactions,
        startSniffer,
        stopSniffer,
        clearSniffer,
      }}
    >
      {children}
    </GladiatorContext.Provider>
  );
};

export function useGladiator(): GladiatorContextValue {
  const ctx = useContext(GladiatorContext);
  if (!ctx) throw new Error('useGladiator must be used within GladiatorProvider');
  return ctx;
}
