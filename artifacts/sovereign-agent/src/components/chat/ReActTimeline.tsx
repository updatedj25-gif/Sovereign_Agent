import { BrainCircuit, CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReActTurn {
  turn?: number;
  step?: number;
  thought?: string;
  tool?: string;
  params?: unknown;
  status?: "running" | "waiting_approval" | "completed" | "failed" | "rejected";
  output?: string;
  exitCode?: number;
  dangerReason?: string;
  approvalId?: string;
  action?: string;
  observation?: string;
  plan?: string[];
  timestamp?: string;
}

interface ReActTimelineProps {
  turns: ReActTurn[];
  isStreaming?: boolean;
}

export function ReActTimeline({ turns }: ReActTimelineProps) {
  if (!turns || turns.length === 0) return null;

  return (
    <div className="my-4 border border-amber-500/20 bg-gradient-to-b from-amber-950/10 to-slate-950/40 rounded-lg p-3 space-y-3 font-sans">
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
              <div className="flex items-center gap-2">
                <span className="text-amber-300 font-semibold">Step {turn.turn || turn.step || idx + 1}</span>
                {turn.status === "running" && <Loader2 className="w-3 h-3 animate-spin text-amber-400" />}
                {turn.status === "completed" && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                {(turn.status === "failed" || turn.status === "rejected") && <CircleAlert className="w-3 h-3 text-rose-400" />}
              </div>
              {turn.timestamp && <span className="text-[10px] text-slate-500">{turn.timestamp}</span>}
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

            {turn.action && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">
                  Action
                </span>
                <div className="p-1.5 bg-slate-950 rounded border border-cyan-500/20 text-cyan-300 font-mono text-[11px]">
                  {turn.action}
                </div>
              </div>
            )}

            {turn.tool && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">
                  Tool
                </span>
                <div className="p-1.5 bg-slate-950 rounded border border-cyan-500/20 text-cyan-300 font-mono text-[11px]">
                  {turn.tool}
                </div>
              </div>
            )}

            {turn.params !== undefined && (
              <pre className="p-1.5 bg-slate-950 rounded border border-slate-800 text-[10px] text-slate-400 max-h-24 overflow-y-auto whitespace-pre-wrap">
                {typeof turn.params === "string" ? turn.params : JSON.stringify(turn.params, null, 2)}
              </pre>
            )}

            {turn.observation && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">
                  Observation
                </span>
                <div className="p-1.5 bg-slate-950 rounded border border-emerald-500/20 text-emerald-300 font-mono text-[11px] max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {turn.observation}
                </div>
              </div>
            )}

            {turn.output && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">
                  Output
                </span>
                <div className="p-1.5 bg-slate-950 rounded border border-emerald-500/20 text-emerald-300 font-mono text-[11px] max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {turn.output}
                </div>
              </div>
            )}

            {turn.dangerReason && (
              <div className="p-1.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[11px]">
                {turn.dangerReason}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
