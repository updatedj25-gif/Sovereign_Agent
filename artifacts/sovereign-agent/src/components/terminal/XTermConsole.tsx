import React, { useState, useEffect, useRef } from "react";
import { Terminal as TerminalIcon, Play, Trash2, CheckCircle2, XCircle, Clock } from "lucide-react";
import WORKER_BASE from "@/lib/worker-base";

interface XTermConsoleProps {
  initialCommand?: string;
  onExecuteCommand?: (cmd: string) => void;
  streamLogs?: string;
  height?: string;
}

export function XTermConsole({
  initialCommand = "",
  onExecuteCommand,
  streamLogs,
  height,
}: XTermConsoleProps) {
  const [command, setCommand] = useState(initialCommand);
  const [outputLines, setOutputLines] = useState<string[]>([
    "Sovereign Agent Sandboxed Shell v2.0",
    "Type a command below (e.g. `npm test`, `git status`, `ls -la`) and press Enter.",
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streamLogs) {
      setOutputLines((prev) => {
        const last = prev[prev.length - 1];
        if (last !== streamLogs) {
          return [...prev, streamLogs];
        }
        return prev;
      });
    }
  }, [streamLogs]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [outputLines]);

  const runCommand = async (cmdToRun: string) => {
    const trimmed = cmdToRun.trim();
    if (!trimmed || isRunning) return;

    setIsRunning(true);
    setOutputLines((prev) => [...prev, `\n$ ${trimmed}`]);
    setCommand("");

    if (onExecuteCommand) {
      onExecuteCommand(trimmed);
    }

    try {
      const res = await fetch(`${WORKER_BASE}/api/sandbox/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: trimmed }),
      });

      if (res.ok) {
        const data = await res.json();
        const out = data.stdout || data.output || "";
        const err = data.stderr || "";
        const exit = data.exitCode !== undefined ? `[Process exited with code ${data.exitCode}]` : "";

        setOutputLines((prev) => [
          ...prev,
          ...(out ? [out] : []),
          ...(err ? [`ERR: ${err}`] : []),
          ...(exit ? [exit] : []),
        ]);
      } else {
        setOutputLines((prev) => [...prev, `[Execution failed: HTTP ${res.status}]`]);
      }
    } catch (e: any) {
      setOutputLines((prev) => [...prev, `[Execution error: ${e.message || "Failed to execute"}]`]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      runCommand(command);
    }
  };

  const clearLogs = () => {
    setOutputLines(["Sovereign Agent Sandboxed Shell v2.0"]);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200 font-mono text-xs select-text">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2 text-slate-400">
          <TerminalIcon className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-semibold text-[11px]">Sandboxed Terminal</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1 text-amber-400 text-[10px]">
              <Clock className="w-3 h-3 animate-spin" />
              <span>RUNNING</span>
            </span>
          )}
          <button
            type="button"
            onClick={clearLogs}
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
            title="Clear terminal"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1 bg-black/40">
        {outputLines.map((line, idx) => (
          <div
            key={idx}
            className={
              line.startsWith("$")
                ? "text-emerald-400 font-bold"
                : line.startsWith("ERR:") || line.includes("failed")
                ? "text-rose-400"
                : "text-slate-300 whitespace-pre-wrap"
            }
          >
            {line}
          </div>
        ))}
        <div ref={terminalEndRef} />
      </div>

      <div className="p-2 border-t border-slate-800 bg-slate-900/80 flex items-center gap-2">
        <span className="text-emerald-400 font-bold">$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type sandbox command..."
          disabled={isRunning}
          className="flex-1 bg-transparent text-slate-100 placeholder-slate-600 focus:outline-none font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => runCommand(command)}
          disabled={isRunning || !command.trim()}
          className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold rounded text-xs transition-colors flex items-center gap-1"
        >
          <Play className="w-3 h-3" />
          <span>Run</span>
        </button>
      </div>
    </div>
  );
}
