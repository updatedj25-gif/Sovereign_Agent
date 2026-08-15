import { ExternalLink, Loader2, RefreshCw } from "lucide-react";

interface LivePreviewPanelProps {
  previewUrl: string | null;
  onRefreshUrl: () => void;
}

export function LivePreviewPanel({ previewUrl, onRefreshUrl }: LivePreviewPanelProps) {
  if (!previewUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-slate-950 text-center p-6">
        <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
        <p className="text-xs text-slate-400">Waiting for the E2B sandbox preview URL.</p>
        <button
          type="button"
          onClick={onRefreshUrl}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500 text-slate-950 text-xs font-semibold"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh preview
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between text-[10px] font-mono">
        <span className="text-emerald-300 truncate">{previewUrl}</span>
        <a href={previewUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-amber-300">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <iframe title="E2B live preview" src={previewUrl} className="flex-1 w-full bg-white" />
    </div>
  );
}