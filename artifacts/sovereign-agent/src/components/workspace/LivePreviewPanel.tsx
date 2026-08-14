import React, { useState } from "react";

export interface LivePreviewPanelProps {
  previewUrl: string | null;
  loading?: boolean;
  onRefreshUrl?: () => void;
}

export function LivePreviewPanel({
  previewUrl,
  loading = false,
  onRefreshUrl,
}: LivePreviewPanelProps) {
  const [viewportMode, setViewportMode] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [iframeKey, setIframeKey] = useState<number>(0);

  const getViewportWidth = () => {
    switch (viewportMode) {
      case "mobile": return "w-[375px]";
      case "tablet": return "w-[768px]";
      default: return "w-full";
    }
  };

  return (
    <div className="flex-1 bg-slate-950 flex flex-col h-full overflow-hidden border-l border-slate-800 font-mono text-xs">
      <div className="p-2 bg-slate-900 border-b border-slate-800 flex justify-between items-center gap-2">
        <div className="flex-1 flex items-center bg-slate-950 border border-slate-800 rounded px-3 py-1 text-slate-300 overflow-hidden">
          <span className="text-emerald-400 mr-2">🔒</span>
          <span className="truncate">{previewUrl || "http://localhost:5173"}</span>
        </div>
        <div className="flex bg-slate-950 border border-slate-800 rounded p-0.5">
          <button
            onClick={() => setViewportMode("desktop")}
            className={`px-2 py-0.5 rounded text-[10px] ${viewportMode === "desktop" ? "bg-amber-500/20 text-amber-400 font-bold" : "text-slate-400"}`}
          >
            Desktop
          </button>
          <button
            onClick={() => setViewportMode("tablet")}
            className={`px-2 py-0.5 rounded text-[10px] ${viewportMode === "tablet" ? "bg-amber-500/20 text-amber-400 font-bold" : "text-slate-400"}`}
          >
            Tablet
          </button>
          <button
            onClick={() => setViewportMode("mobile")}
            className={`px-2 py-0.5 rounded text-[10px] ${viewportMode === "mobile" ? "bg-amber-500/20 text-amber-400 font-bold" : "text-slate-400"}`}
          >
            Mobile
          </button>
        </div>
        <button
          onClick={() => {
            setIframeKey((prev) => prev + 1);
            if (onRefreshUrl) onRefreshUrl();
          }}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs transition-colors"
        >
          🔄
        </button>
      </div>
      <div className="flex-1 bg-slate-900/40 p-4 flex justify-center items-center overflow-auto">
        {loading ? (
          <div className="text-slate-500 animate-pulse">Connecting to sandbox...</div>
        ) : previewUrl ? (
          <div className={`${getViewportWidth()} h-full bg-white rounded-lg shadow-2xl border border-slate-800 overflow-hidden`}>
            <iframe
              key={iframeKey}
              src={previewUrl}
              title="Live Sandbox Preview"
              className="w-full h-full border-none"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
            />
          </div>
        ) : (
          <div className="text-center p-8 bg-slate-900 border border-slate-800 rounded-lg max-w-md">
            <div className="text-2xl mb-2">🚀</div>
            <h3 className="text-slate-200 font-bold mb-1">Live Preview</h3>
            <p className="text-slate-400 text-xs">Run a web dev server in E2B sandbox to view live app preview.</p>
          </div>
        )}
      </div>
    </div>
  );
}