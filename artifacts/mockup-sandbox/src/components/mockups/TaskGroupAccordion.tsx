import { useState, useEffect } from "react";

interface Command {
  cmd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface TaskGroup {
  id: string;
  title: string;
  status: "running" | "success" | "failed" | "pending";
  summary?: string;
  commands: Command[];
}

function StatusIndicator({ status }: { status: TaskGroup["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center justify-center w-5 h-5">
          <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
        </span>
      );
    case "success":
      return (
        <span className="inline-flex items-center justify-center w-5 h-5 text-emerald-500 font-bold text-sm">
          ✓
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center justify-center w-5 h-5 text-red-500 font-bold text-sm">
          ✗
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center justify-center w-5 h-5">
          <span className="w-3 h-3 rounded-full bg-gray-400" />
        </span>
      );
  }
}

const statusBorder: Record<TaskGroup["status"], string> = {
  running: "border-blue-500",
  success: "border-emerald-500",
  failed: "border-red-500",
  pending: "border-gray-700",
};

const statusHeader: Record<TaskGroup["status"], string> = {
  running: "bg-blue-950/40",
  success: "bg-emerald-950/30",
  failed: "bg-red-950/40",
  pending: "bg-gray-900/60",
};

function CommandBlock({ command }: { command: Command }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-gray-800 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-left bg-gray-900 hover:bg-gray-800 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-mono text-xs text-gray-300 truncate">$ {command.cmd}</span>
        <span className={`text-xs font-semibold ml-3 shrink-0 ${command.exitCode === 0 ? "text-emerald-400" : "text-red-400"}`}>
          exit {command.exitCode ?? "—"}
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-gray-800 bg-black font-mono text-xs space-y-1">
          {command.stdout && <pre className="whitespace-pre-wrap text-emerald-400 break-all">{command.stdout}</pre>}
          {command.stderr && <pre className="whitespace-pre-wrap text-rose-400 break-all mt-1">{command.stderr}</pre>}
          {!command.stdout && !command.stderr && <span className="text-gray-600">(no output)</span>}
        </div>
      )}
    </div>
  );
}

export function TaskGroupAccordion({ group }: { group: TaskGroup }) {
  const [isOpen, setIsOpen] = useState(group.status === "running" || group.status === "failed");

  useEffect(() => {
    if (group.status === "running" || group.status === "failed") setIsOpen(true);
    else if (group.status === "success") setIsOpen(false);
  }, [group.status]);

  return (
    <div className={`rounded-lg border ${statusBorder[group.status]} bg-gray-950 overflow-hidden transition-all duration-200`}>
      <button
        className={`w-full flex items-center justify-between px-4 py-3 ${statusHeader[group.status]} hover:brightness-110 transition-all select-none`}
        onClick={() => setIsOpen((o) => !o)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusIndicator status={group.status} />
          <span className="font-semibold text-sm text-gray-100 truncate">{group.title}</span>
          {group.status === "running" && (
            <span className="text-xs text-blue-400 animate-pulse shrink-0">running…</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0 ml-3">
          <span>{group.commands.length} action{group.commands.length !== 1 ? "s" : ""}</span>
          <span style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.2s" }}>▶</span>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 py-3 border-t border-gray-800 space-y-2">
          {group.summary && <p className="text-xs text-gray-400 italic mb-2">{group.summary}</p>}
          {group.commands.map((c, i) => <CommandBlock key={i} command={c} />)}
          {group.commands.length === 0 && <p className="text-xs text-gray-600 italic">No commands yet…</p>}
        </div>
      )}
    </div>
  );
}

const DEMO: TaskGroup[] = [
  {
    id: "1",
    title: "Installing Dependencies",
    status: "success",
    summary: "142 packages installed, 0 vulnerabilities.",
    commands: [
      { cmd: "pnpm install --frozen-lockfile", exitCode: 0, stdout: "Packages: +142\nProgress: resolved 142, reused 142, downloaded 0, added 142, done\ndone in 4.2s", stderr: "" },
    ],
  },
  {
    id: "2",
    title: "Typecheck & Build",
    status: "success",
    summary: "TypeScript passed. esbuild compiled 14 assets in 1.42s.",
    commands: [
      { cmd: "pnpm run typecheck", exitCode: 0, stdout: "tsc --build\n✓ No errors found", stderr: "" },
      { cmd: "pnpm --filter @workspace/mockup-sandbox run build", exitCode: 0, stdout: "vite v7.3.2 building for production...\n✓ 14 modules transformed.\n✓ built in 1.42s", stderr: "" },
    ],
  },
  {
    id: "3",
    title: "Deploy to Cloudflare Pages",
    status: "running",
    commands: [
      { cmd: "wrangler pages deploy artifacts/mockup-sandbox/dist --project-name=trinity-universe-web", exitCode: 0, stdout: "Uploading… (14/14)\nSuccess! Uploaded 14 files\n✨ Deployment complete!", stderr: "" },
    ],
  },
  {
    id: "4",
    title: "Post-merge Health Check",
    status: "pending",
    commands: [],
  },
];

export default function Preview() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-sans">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="mb-2">
          <h1 className="text-lg font-bold text-white">CI / Deploy Pipeline</h1>
          <p className="text-xs text-gray-500 mt-0.5">Task execution log — collapsible accordion pattern from spec §3</p>
        </div>
        <div className="space-y-1.5">
          {DEMO.map((g) => <TaskGroupAccordion key={g.id} group={g} />)}
        </div>
      </div>
    </div>
  );
}
