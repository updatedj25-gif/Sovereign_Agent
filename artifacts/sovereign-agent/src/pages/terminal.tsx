import React, { useState, useRef, useEffect } from "react";
import { Shell } from "../components/layout/Shell";
import {
  Terminal as TerminalIcon,
  Play,
  Square,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

interface CommandLogEntry {
  id: string;
  command: string;
  status: "running" | "success" | "failed" | "aborted";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs?: number;
  timestamp: string;
}

const PRESET_COMMANDS = [
  "pnpm run typecheck",
  "pnpm --prefix artifacts/sovereign-agent test",
  "git status",
  "node -v",
];

export default function TerminalPage() {
  const [inputCmd, setInputCmd] = useState("");
  const [logs, setLogs] = useState<CommandLogEntry[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [sessionId] = useState(() => `terminal_session_${Date.now()}`);

  const abortControllerRef = useRef<AbortController | null>(null);
  const terminalBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleRunCommand = async (commandToRun?: string) => {
    const cmd = (commandToRun || inputCmd).trim();
    if (!cmd || isExecuting) return;

    const logId = `log-${Date.now()}`;
    const newEntry: CommandLogEntry = {
      id: logId,
      command: cmd,
      status: "running",
      stdout: "",
      stderr: "",
      exitCode: null,
      timestamp: new Date().toLocaleTimeString(),
    };

    setLogs((prev) => [...prev, newEntry]);
    setIsExecuting(true);
    setInputCmd("");

    abortControllerRef.current = new AbortController();

    try {
      // Connect to Express 5 E2B Sandbox Execution Endpoint
      const response = await fetch("/api/sandbox/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          command: cmd,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to execute sandbox command.`);
      }

      const result = await response.json();

      setLogs((prevLogs) =>
        prevLogs.map((entry) => {
          if (entry.id !== logId) return entry;
          return {
            ...entry,
            status: result.exitCode === 0 ? "success" : "failed",
            stdout: result.stdout || "",
            stderr: result.stderr || "",
            exitCode: result.exitCode ?? 1,
            durationMs: result.durationMs,
          };
        })
      );
    } catch (err: any) {
      if (err.name === "AbortError") {
        setLogs((prev) =>
          prev.map((e) =>
            e.id === logId
              ? { ...e, status: "aborted", stderr: e.stderr + "\n[Process cancelled by user]" }
              : e
          )
        );
      } else {
        setLogs((prev) =>
          prev.map((e) =>
            e.id === logId
              ? { ...e, status: "failed", stderr: e.stderr + `\nExecution error: ${err.message}` }
              : e
          )
        );
      }
    } finally {
      setIsExecuting(false);
      abortControllerRef.current = null;
    }
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <Shell>
      <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#0C0D0E] text-slate-200 font-mono">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-amber-950/40 bg-[#121315]">
          <div className="flex items-center gap-3">
            <TerminalIcon className="w-5 h-5 text-amber-500" />
            <h1 className="text-sm font-semibold tracking-wide text-slate-100">
              E2B SANDBOX TERMINAL CONSOLE
            </h1>
            <span className="px-2 py-0.5 text-xs rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Isolated Linux VM
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isExecuting && (
              <button
                onClick={handleAbort}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-red-400" /> Stop Process
              </button>
            )}
            <button
              onClick={clearLogs}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-md hover:bg-slate-800 transition-colors"
              title="Clear Console Output"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Preset Command Shortcuts */}
        <div className="flex items-center gap-2 px-6 py-2 border-b border-slate-800/60 bg-[#151619] text-xs">
          <span className="text-slate-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Quick Commands:
          </span>
          {PRESET_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              onClick={() => handleRunCommand(cmd)}
              disabled={isExecuting}
              className="px-2.5 py-1 rounded bg-slate-800/80 hover:bg-amber-500/20 hover:text-amber-300 text-slate-300 border border-slate-700/50 disabled:opacity-50 transition-all"
            >
              {cmd}
            </button>
          ))}
        </div>

        {/* Output Stream Terminal Window */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
              <TerminalIcon className="w-10 h-10 text-slate-700" />
              <p className="text-sm">No commands executed in this session.</p>
              <p className="text-xs text-slate-600">
                Type a command below or select a quick shortcut to launch a sandboxed process in E2B.
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg border border-slate-800/80 bg-[#111214] overflow-hidden shadow-lg"
              >
                {/* Command Title Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-[#18191C] border-b border-slate-800/60 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 font-bold">$</span>
                    <span className="text-slate-100 font-semibold">{log.command}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-slate-500 text-[11px]">{log.timestamp}</span>
                    {log.durationMs !== undefined && (
                      <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                        <Clock className="w-3 h-3" /> {log.durationMs}ms
                      </span>
                    )}

                    {log.status === "running" && (
                      <span className="flex items-center gap-1 text-amber-400 animate-pulse font-medium">
                        Executing in VM...
                      </span>
                    )}
                    {log.status === "success" && (
                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> exit 0
                      </span>
                    )}
                    {log.status === "failed" && (
                      <span className="flex items-center gap-1 text-red-400 font-medium">
                        <XCircle className="w-3.5 h-3.5" /> exit {log.exitCode ?? 1}
                      </span>
                    )}
                    {log.status === "aborted" && (
                      <span className="flex items-center gap-1 text-yellow-400 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" /> aborted
                      </span>
                    )}
                  </div>
                </div>

                {/* Console Logs Display */}
                <div className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed space-y-1 overflow-x-auto">
                  {log.stdout && <div className="text-slate-300">{log.stdout}</div>}
                  {log.stderr && <div className="text-red-400/90">{log.stderr}</div>}
                  {!log.stdout && !log.stderr && log.status === "running" && (
                    <div className="text-slate-600 italic">Executing inside E2B sandbox container...</div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={terminalBottomRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-slate-800 bg-[#121315]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRunCommand();
            }}
            className="flex items-center gap-3"
          >
            <span className="text-amber-400 font-bold text-sm">$</span>
            <input
              type="text"
              value={inputCmd}
              onChange={(e) => setInputCmd(e.target.value)}
              placeholder="Enter command (e.g. pnpm run typecheck)..."
              disabled={isExecuting}
              className="flex-1 bg-transparent text-slate-100 placeholder-slate-600 text-sm focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isExecuting || !inputCmd.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-md font-medium text-xs disabled:opacity-40 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-amber-400" /> Execute
            </button>
          </form>
        </div>
      </div>
    </Shell>
  );
}