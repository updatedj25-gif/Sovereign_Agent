import React, { useState } from "react";
import {
  X,
  ExternalLink,
  Monitor,
  AlertTriangle,
  FileText,
  Maximize2,
  CheckCircle2,
} from "lucide-react";

export interface VisualPreviewData {
  url: string;
  title?: string;
  screenshotBase64: string;
  consoleLogs?: Array<{ type: string; text: string }>;
  domSummarySnippet?: string;
  timestamp?: string;
}

interface VisualPreviewModalProps {
  data: VisualPreviewData | null;
  onClose: () => void;
}

export function VisualPreviewModal({ data, onClose }: VisualPreviewModalProps) {
  const [activeTab, setActiveTab] = useState<"screenshot" | "logs" | "dom">("screenshot");
  const [isZoomed, setIsZoomed] = useState(false);

  if (!data) return null;

  const errorLogs = (data.consoleLogs || []).filter((l) => l.type === "error");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans">
      <div className="relative w-full max-w-5xl bg-[#121315] border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#16171A]">
          <div className="flex items-center gap-3">
            <Monitor className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                Visual Inspection Pass: {data.title || "Web Application"}
              </h3>
              <p className="text-xs text-slate-400 font-mono flex items-center gap-1.5">
                {data.url}
                <a
                  href={data.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400 hover:text-amber-300"
                >
                  <ExternalLink className="w-3 h-3 inline" />
                </a>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {errorLogs.length > 0 ? (
              <span className="px-2.5 py-1 text-xs font-mono rounded bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> {errorLogs.length} Console Error(s)
              </span>
            ) : (
              <span className="px-2.5 py-1 text-xs font-mono rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 0 Console Errors
              </span>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-4 px-6 border-b border-slate-800/80 bg-[#141518] text-xs font-mono">
          <button
            onClick={() => setActiveTab("screenshot")}
            className={`py-2.5 border-b-2 font-medium transition-all ${
              activeTab === "screenshot"
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Screenshot View
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`py-2.5 border-b-2 font-medium transition-all ${
              activeTab === "logs"
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Console Logs ({data.consoleLogs?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("dom")}
            className={`py-2.5 border-b-2 font-medium transition-all ${
              activeTab === "dom"
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            DOM Text Snapshot
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#0E0F11]">
          {activeTab === "screenshot" && (
            <div className="flex flex-col items-center justify-center">
              <div className="relative group rounded-lg overflow-hidden border border-slate-800 bg-black max-w-full">
                <img
                  src={data.screenshotBase64}
                  alt="Page Preview Snapshot"
                  className={`transition-transform duration-200 ${
                    isZoomed ? "scale-125 cursor-zoom-out" : "scale-100 cursor-zoom-in"
                  }`}
                  onClick={() => setIsZoomed(!isZoomed)}
                />
                <button
                  onClick={() => setIsZoomed(!isZoomed)}
                  className="absolute bottom-3 right-3 p-2 bg-black/70 text-slate-200 rounded-md backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Toggle Zoom"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {activeTab === "logs" && (
            <div className="space-y-2 font-mono text-xs">
              {(!data.consoleLogs || data.consoleLogs.length === 0) ? (
                <p className="text-slate-500 italic">No console log entries recorded during navigation.</p>
              ) : (
                data.consoleLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded border ${
                      log.type === "error"
                        ? "bg-red-500/10 text-red-300 border-red-500/30"
                        : log.type === "warning"
                        ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                        : "bg-slate-900 text-slate-300 border-slate-800"
                    }`}
                  >
                    <span className="font-bold uppercase tracking-wider mr-2 text-[10px] opacity-75">
                      [{log.type}]
                    </span>
                    {log.text}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "dom" && (
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
              {data.domSummarySnippet || "No DOM text summary recorded."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}