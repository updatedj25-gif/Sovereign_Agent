import { Rocket, Github, Globe, Cloud, Sparkles, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DeploymentTargetInfo {
  name: string; // e.g. "Cloudflare Workers", "Vercel", "GitHub"
  suggestedAction?: string;
  repoUrl?: string;
}

interface DeploymentSuggestBoxProps {
  target?: DeploymentTargetInfo;
  onActionSelect?: (actionPrompt: string) => void;
}

export function DeploymentSuggestBox({ target, onActionSelect }: DeploymentSuggestBoxProps) {
  const targetName = target?.name || "Cloudflare Workers & GitHub";
  const actionText =
    target?.suggestedAction ||
    "Your code is ready and verified! Would you like to deploy to Cloudflare Workers or push to GitHub?";

  const handleActionClick = (prompt: string) => {
    if (onActionSelect) {
      onActionSelect(prompt);
    }
  };

  return (
    <div className="bg-slate-900/95 border border-sky-500/30 rounded-xl p-4 shadow-[0_0_20px_rgba(56,189,248,0.08)] space-y-3 font-mono text-xs my-2">
      <div className="flex items-center gap-2">
        <div className="p-1.5 bg-sky-500/10 border border-sky-500/20 rounded-lg text-sky-400">
          <Rocket className="w-4 h-4" />
        </div>
        <div>
          <h4 className="font-bold text-white text-xs tracking-tight flex items-center gap-2">
            Deployment & Push Ready
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border uppercase bg-sky-500/10 text-sky-300 border-sky-500/20">
              Proactive Finalization
            </span>
          </h4>
          <p className="text-[11px] text-slate-400 font-sans mt-0.5">{actionText}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
        {/* Option 1: Deploy to Cloudflare Workers */}
        <button
          onClick={() => handleActionClick("Deploy application to Cloudflare Workers using wrangler deploy")}
          className="flex flex-col items-start p-2.5 bg-slate-950/80 hover:bg-slate-800/90 border border-amber-500/30 hover:border-amber-500/60 rounded-lg text-left transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="text-amber-400 font-bold flex items-center gap-1.5 text-[11px]">
              <Cloud className="w-3.5 h-3.5" /> Cloudflare Edge
            </span>
            <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
          </div>
          <span className="text-[10px] text-slate-400 font-sans">
            Deploy Worker script & D1 database bindings.
          </span>
        </button>

        {/* Option 2: Push to GitHub */}
        <button
          onClick={() => handleActionClick("Stage all changes, commit, and push repository to origin main")}
          className="flex flex-col items-start p-2.5 bg-slate-950/80 hover:bg-slate-800/90 border border-slate-700/80 hover:border-slate-500 rounded-lg text-left transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="text-slate-200 font-bold flex items-center gap-1.5 text-[11px]">
              <Github className="w-3.5 h-3.5 text-slate-300" /> Push GitHub Main
            </span>
            <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
          </div>
          <span className="text-[10px] text-slate-400 font-sans">
            Sync codebase & commit changes to GitHub repo.
          </span>
        </button>

        {/* Option 3: Deploy to Vercel */}
        <button
          onClick={() => handleActionClick("Deploy project to Vercel edge infrastructure")}
          className="flex flex-col items-start p-2.5 bg-slate-950/80 hover:bg-slate-800/90 border border-sky-500/30 hover:border-sky-500/60 rounded-lg text-left transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="text-sky-300 font-bold flex items-center gap-1.5 text-[11px]">
              <Globe className="w-3.5 h-3.5" /> Vercel Deploy
            </span>
            <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-sky-300 group-hover:translate-x-0.5 transition-all" />
          </div>
          <span className="text-[10px] text-slate-400 font-sans">
            Trigger Vercel build & production deployment.
          </span>
        </button>
      </div>
    </div>
  );
}
