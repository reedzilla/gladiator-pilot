import React, { useEffect, useRef, useState } from 'react';
import { Send, Trash2, X } from 'lucide-react';
import { useGladiator } from '../context/GladiatorContext';

const QUICK_COMMANDS = ['ATI', 'VTI', 'STI', 'STPR', 'STPRS', 'ATRV', '010C', '22F190'];

export const RawTerminalDrawer: React.FC = () => {
  const {
    session,
    terminalLogs,
    clearTerminalLogs,
    terminalOpen,
    setTerminalOpen,
    snifferRunning,
  } = useGladiator();

  const [cmdInput, setCmdInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [terminalLogs, terminalOpen]);

  if (!terminalOpen) return null;

  const fireCommand = async (raw: string) => {
    if (!session || !raw.trim() || snifferRunning) return;
    setSending(true);
    try {
      await session.sendCommand(raw.trim(), 2500);
    } catch {
      /* logged inside sendCommand */
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = cmdInput;
    setCmdInput('');
    await fireCommand(c);
  };

  return (
    <div className="fixed inset-x-0 bottom-[68px] md:bottom-0 z-40 border-t border-orange-500/40 bg-[#0b0e13]/98 shadow-2xl backdrop-blur-md">
      <div className="mx-auto max-w-7xl p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-orange-400">
              RAW AT / ST / UDS HEX CONSOLE
            </span>
            <div className="flex flex-wrap gap-1">
              {QUICK_COMMANDS.map((q) => (
                <button
                  key={q}
                  onClick={() => fireCommand(q)}
                  disabled={!session || sending || snifferRunning}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:border-orange-500/50 hover:text-orange-200 disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={clearTerminalLogs}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              title="Clear log"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setTerminalOpen(false)}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              title="Close console"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="h-48 overflow-y-auto rounded-lg border border-slate-800 bg-black/70 p-2.5 font-mono text-xs space-y-1"
        >
          {terminalLogs.map((entry) => (
            <div key={entry.id} className="flex gap-2">
              <span className="shrink-0 text-slate-600">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={
                  entry.direction === 'tx'
                    ? 'text-orange-300'
                    : entry.direction === 'rx'
                      ? 'text-emerald-300'
                      : entry.direction === 'error'
                        ? 'text-red-400'
                        : 'text-sky-300'
                }
              >
                {entry.direction === 'tx' ? '>' : entry.direction === 'rx' ? '<' : '#'} {entry.text}
              </span>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={cmdInput}
            onChange={(e) => setCmdInput(e.target.value)}
            disabled={!session || snifferRunning}
            placeholder="Enter AT, STP, or hex UDS command (e.g. STPRS, ATSH 747, 22 F1 90)..."
            className="min-h-[42px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-slate-100"
          />
          <button
            type="submit"
            disabled={!session || sending || !cmdInput.trim() || snifferRunning}
            className="flex min-h-[42px] items-center gap-1.5 rounded-lg border border-orange-500/60 bg-orange-500/20 px-4 font-mono text-xs font-bold text-orange-200 hover:bg-orange-500/30 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
