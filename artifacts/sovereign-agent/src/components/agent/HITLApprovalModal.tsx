import React from "react";
import { ShieldAlert, CheckCircle2, XCircle, FileCode, Terminal, AlertTriangle } from "lucide-react";
import { apiUrl } from "@/lib/worker-base";

export interface PendingApprovalData {
  approvalId?: string;
  toolName?: string;
  params?: any;
  dangerReason?: string;
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  path?: string;
  diff?: string;
  command?: string;
  riskLevel?: "low" | "medium" | "high" | "critical" | string;
}

interface HITLApprovalModalProps {
  approvalData?: PendingApprovalData | null;
  data?: PendingApprovalData | null;
  isOpen?: boolean;
  onResolved?: (approvalId: string, approved: boolean) => void;
  onApprove?: () => void;
  onReject?: () => void;
}

export function HITLApprovalModal({
  approvalData,
  data,
  isOpen,
  onResolved,
  onApprove,
  onReject,
}: HITLApprovalModalProps) {
  const activeData = approvalData || data;
  const isVisible = isOpen !== undefined ? isOpen : Boolean(activeData);

  if (!isVisible || !activeData) return null;

  const approvalId = activeData.approvalId || activeData.id || "unknown";
  const toolName = activeData.toolName || activeData.type || activeData.title || "Privileged Tool Action";
  const reason = activeData.dangerReason || activeData.description || "Action requires explicit operator authorization.";

  const handleDecision = async (approved: boolean) => {
    try {
      if (approvalId !== "unknown") {
        const response = await fetch(apiUrl("/api/agent/approve"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalId,
            approved,
            reason: approved ? "Approved by operator in cockpit." : "Rejected by operator in cockpit.",
          }),
        });
        if (!response.ok) {
          throw new Error(`Approval request failed with HTTP ${response.status}`);
        }
      }
    } catch (e) {
      console.error("Failed to post approval resolution to backend:", e);
    }

    if (onResolved) {
      onResolved(approvalId, approved);
    }
    if (approved && onApprove) onApprove();
    if (!approved && onReject) onReject();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-slate-900 border border-amber-500/40 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans">
        {/* Header */}
        <div className="p-4 bg-slate-950 border-b border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">
                Operator Approval Required (HITL)
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Tool: <span className="text-amber-300 font-semibold">{toolName}</span>
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono font-bold rounded">
            GUARDED
          </span>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Security Reason
            </h4>
            <p className="text-xs text-slate-200 mt-1 leading-relaxed bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              {reason}
            </p>
          </div>

          {activeData.params && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Action Parameters
              </h4>
              <pre className="mt-1 p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono text-[11px] text-emerald-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {typeof activeData.params === "string"
                  ? activeData.params
                  : JSON.stringify(activeData.params, null, 2)}
              </pre>
            </div>
          )}

          {activeData.command && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Command
              </h4>
              <div className="mt-1 p-2 bg-slate-950 rounded border border-slate-800 font-mono text-xs text-emerald-400">
                $ {activeData.command}
              </div>
            </div>
          )}

          {activeData.diff && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Proposed Diff
              </h4>
              <pre className="mt-1 p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-slate-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {activeData.diff}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => handleDecision(false)}
            className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <XCircle className="w-4 h-4 text-rose-400" />
            <span>Reject Action</span>
          </button>
          <button
            type="button"
            onClick={() => handleDecision(true)}
            className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-md shadow-amber-500/20"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Approve & Authorize</span>
          </button>
        </div>
      </div>
    </div>
  );
}
