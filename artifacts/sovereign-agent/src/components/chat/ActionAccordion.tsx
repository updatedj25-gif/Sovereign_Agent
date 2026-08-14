import React, { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Clock, Terminal, AlertCircle } from "lucide-react";

export interface ActionItem {
  id?: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  command?: string;
  output?: string;
}

interface ActionAccordionProps {
  actions: ActionItem[];
}

export function ActionAccordion({ actions }: ActionAccordionProps) {
  const [openItems, setOpenItems] = useState<Record<number, boolean>>({ 0: true });

  if (!actions || actions.length === 0) return null;

  const toggleItem = (idx: number) => {
    setOpenItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="my-3 space-y-2 font-mono text-xs">
      <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
        <Terminal className="w-3.5 h-3.5 text-amber-400" />
        <span>Execution Plan & Subtask Accordion ({actions.length} Steps)</span>
      </div>

      <div className="space-y-1.5 border border-slate-800 bg-slate-950/80 rounded-lg p-1.5">
        {actions.map((act, idx) => {
          const isOpen = !!openItems[idx];

          return (
            <div
              key={idx}
              className="border border-slate-800/80 rounded bg-slate-900/60 overflow-hidden transition-all"
            >
              {/* Accordion Header */}
              <button
                type="button"
                onClick={() => toggleItem(idx)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-slate-800/60 transition-colors text-left"
              >
                <div className="flex items-center gap-2 text-slate-200 font-semibold truncate">
                  <span className="text-amber-400">{idx + 1}.</span>
                  <span className="truncate">{act.title}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {act.status === "running" && (
                    <span className="flex items-center gap-1 text-amber-400 text-[10px] animate-pulse">
                      <Clock className="w-3 h-3" /> Running
                    </span>
                  )}
                  {act.status === "completed" && (
                    <span className="flex items-center gap-1 text-emerald-400 text-[10px]">
                      <CheckCircle2 className="w-3 h-3" /> Done
                    </span>
                  )}
                  {act.status === "failed" && (
                    <span className="flex items-center gap-1 text-rose-400 text-[10px]">
                      <AlertCircle className="w-3 h-3" /> Failed
                    </span>
                  )}
                  {act.status === "pending" && (
                    <span className="text-slate-600 text-[10px]">Queued</span>
                  )}

                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </div>
              </button>

              {/* Accordion Body Output */}
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-800/60 bg-slate-950/90 text-[11px] font-mono space-y-2">
                  {act.command && (
                    <div className="text-slate-400">
                      <span className="text-amber-400">$ </span>
                      <code className="text-amber-300">{act.command}</code>
                    </div>
                  )}

                  {act.output ? (
                    <pre className="p-2.5 bg-black/60 rounded border border-slate-800 text-emerald-400 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                      {act.output}
                    </pre>
                  ) : (
                    <p className="text-slate-600 italic">
                      {act.status === "running" ? "Streaming live terminal logs..." : "No output logs captured."}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}