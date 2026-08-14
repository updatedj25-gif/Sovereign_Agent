import React from "react";
import { BrainCircuit } from "lucide-react";

export interface ReActTurn {
  step?: number;
  turn?: number;
  thought?: string;
  action?: string;
  tool?: string;
  params?: any;
  observation?: string;
  output?: string;
  plan?: string[];
  status?: "running" | "completed" | "failed" | "waiting_approval" | "rejected";
  exitCode?: number;
  dangerReason?: string;
  approvalId?: string;
  timestamp?: string;
}

export interface ReActTimelineProps {
  turns?: ReActTurn[];
  isStreaming?: boolean;
}

export function ReActTimeline({ turns = [], isStreaming = false }: ReActTimelineProps) {
  if (!turns || turns.length === 0) return null;

  return (
    <div className="my-4 border border-amber-500/20 bg-gradient-to-b from-amber-950/10 to-slate-950/40 rounded-lg p-3 space-y-3 font-sans text-xs">
      <div className="flex items-center gap-2 text-xs font-mono font-semibold text-amber-400 border-b border-amber-500/10 pb-2">
        <BrainCircuit className="w-4 h-4 text-amber-400" />
        <span>Cognitive ReAct Execution Loop</span>
      </div>

      <div className="space-y-3">
        {turns.map((turn, idx) => (
          <div
            key={idx}
            className="text-xs space-y-2 bg-slate-900/60 border border-slate-800/80 rounded-md p-2.5 font-mono"
          >
            <div className="flex items-center justify-between text-slate-400 border-b border-slate-800/50 pb-1.5">
              <span className="text-amber-300 font-semibold">
                Turn {turn.turn || turn.step || idx + 1} {turn.tool ? `• ${turn.tool}` : ""}
              </span>
              <span className="font-bold text-[10px]">
                {turn.status === "running" && "⏳ Running"}
                {turn.status === "completed" && "✅ Done"}
                {turn.status === "failed" && "❌ Failed"}
                {turn.status === "waiting_approval" && "⚠️ Waiting Approval"}
                {turn.status === "rejected" && "🚫 Rejected"}
              </span>
            </div>

            {turn.thought && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Thought
                </span>
                <p className="text-slate-300 font-sans leading-relaxed text-xs pl-2 border-l-2 border-amber-500/40">
                  {turn.thought}
                </p>
              </div>
            )}

            {(turn.action || turn.tool) && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">
                  Action
                </span>
                <div className="p-1.5 bg-slate-950 rounded border border-cyan-500/20 text-cyan-300 font-mono text-[11px]">
                  {turn.action || turn.tool} {turn.params ? JSON.stringify(turn.params) : ""}
                </div>
              </div>
            )}

            {(turn.observation || turn.output) && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">
                  Observation
                </span>
                <div className="p-1.5 bg-slate-950 rounded border border-emerald-500/20 text-emerald-300 font-mono text-[11px] max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {turn.observation || turn.output}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {isStreaming && (
        <div className="text-[11px] text-amber-400 animate-pulse font-mono flex items-center gap-1.5">
          <span>⚡</span>
          <span>Sovereign Agent thinking...</span>
        </div>
      )}
    </div>
  );
}