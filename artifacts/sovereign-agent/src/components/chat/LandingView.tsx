import React, { useState, type KeyboardEvent } from "react";
import {
  Sparkles,
  ArrowUp,
  Terminal,
  Shield,
  Layers,
  Cpu,
  GitBranch,
  Search,
  Code2,
  Zap,
} from "lucide-react";

interface LandingViewProps {
  onSubmitPrompt: (prompt: string) => void;
}

const STARTER_PROMPTS = [
  {
    title: "Build REST CRUD Service",
    description: "Scaffold Express 5 REST API with validation, schemas, and error handling",
    prompt: "Create an Express 5 REST API endpoint with Zod schema validation and unit tests.",
    icon: Code2,
  },
  {
    title: "Codebase Perception & AST Analysis",
    description: "Scan the monorepo, build AST symbol map, and diagnose circular dependencies",
    prompt: "Analyze the current workspace files, find circular imports, and list all exported routes.",
    icon: Layers,
  },
  {
    title: "Sandboxed Command Execution",
    description: "Run automated tests, verify build artifacts, and generate test reports",
    prompt: "Run the test suite in the isolated sandbox, capture stdout/stderr, and summarize failed assertions.",
    icon: Terminal,
  },
  {
    title: "Refactor & Fuzzy Diff Patching",
    description: "Search/replace block diff engine with dry-run verification and git checkpoints",
    prompt: "Refactor the authentication middleware to support role-based access control (RBAC) with checkpoints.",
    icon: GitBranch,
  },
];

export function LandingView({ onSubmitPrompt }: LandingViewProps) {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim()) return;
    onSubmitPrompt(prompt.trim());
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between overflow-y-auto bg-slate-950 p-6 sm:p-10 font-sans">
      <div className="max-w-4xl w-full mx-auto space-y-8 my-auto">
        {/* Hero Section */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-mono">
            <Zap className="w-3.5 h-3.5" />
            <span>Autonomous Full-Stack AI Engineer</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-100">
            Sovereign Agent Cockpit
          </h1>
          <p className="text-slate-400 text-sm max-w-xl mx-auto leading-relaxed">
            Execute complex coding tasks, run sandboxed commands, perform AST code perception,
            and apply verified diff patches under Human-in-the-Loop supervision.
          </p>
        </div>

        {/* Prompt Input Box */}
        <form onSubmit={handleSubmit} className="w-full">
          <div className="relative border border-slate-700/80 hover:border-amber-500/60 focus-within:border-amber-500/80 focus-within:ring-1 focus-within:ring-amber-500/30 bg-slate-900/90 rounded-xl p-3 shadow-xl transition-all">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="Describe a task or instruction for Sovereign Agent (e.g. 'Audit the API endpoints and write tests')..."
              className="w-full bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none resize-none text-sm font-sans leading-relaxed"
            />

            <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
                <span className="flex items-center gap-1">
                  <Shield className="w-3 h-3 text-emerald-400" />
                  HITL Guardrails Active
                </span>
                <span>•</span>
                <span>Shift + Enter for new line</span>
              </div>

              <button
                type="submit"
                disabled={!prompt.trim()}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-semibold rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow-sm shadow-amber-500/20"
              >
                <span>Deploy Agent</span>
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </form>

        {/* Quick Starters */}
        <div className="space-y-3">
          <div className="text-xs font-mono font-medium text-slate-400 uppercase tracking-wider">
            Quick Operations
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {STARTER_PROMPTS.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSubmitPrompt(item.prompt)}
                  className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-800/80 bg-slate-900/40 hover:bg-slate-900/90 hover:border-slate-700 text-left transition-all group"
                >
                  <div className="p-2 rounded-lg bg-slate-800/80 text-amber-400 group-hover:bg-amber-500/10 transition-colors shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-200 group-hover:text-amber-300 transition-colors">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 leading-normal">
                      {item.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Feature Badges */}
        <div className="pt-4 border-t border-slate-900 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs font-mono text-slate-500">
          <div className="p-2 rounded-lg bg-slate-950 border border-slate-900">
            <span className="text-slate-300 font-semibold block">ReAct Loop</span>
            <span className="text-[10px]">Autonomous Planning</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-950 border border-slate-900">
            <span className="text-slate-300 font-semibold block">E2B Sandboxing</span>
            <span className="text-[10px]">Isolated Shell & Exec</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-950 border border-slate-900">
            <span className="text-slate-300 font-semibold block">AST Perception</span>
            <span className="text-[10px]">Semantic Search & Index</span>
          </div>
          <div className="p-2 rounded-lg bg-slate-950 border border-slate-900">
            <span className="text-slate-300 font-semibold block">Git Checkpoints</span>
            <span className="text-[10px]">Safe Atomic Rollbacks</span>
          </div>
        </div>
      </div>
    </div>
  );
}
