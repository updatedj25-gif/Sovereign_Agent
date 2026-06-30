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

interface AccordionProps {
  group: TaskGroup;
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
          <span className="w-3 h-3 rounded-full bg-gray-300" />
        </span>
      );
  }
}

const statusBorder: Record<TaskGroup["status"], string> = {
  running: "border-blue-400",
  success: "border-emerald-400",
  failed: "border-red-400",
  pending: "border-gray-300",
};

const statusHeader: Record<TaskGroup["status"], string> = {
  running: "bg-blue-950/40",
  success: "bg-emerald-950/30",
  failed: "bg-red-950/40",
  pending: "bg-gray-900",
};

export function TaskGroupAccordion({ group }: AccordionProps) {
  const [isOpen, setIsOpen] = useState<boolean>(
    group.status === "running" || group.status === "failed"
  );

  useEffect(() => {
    if (group.status === "running" || group.status === "failed") {
      setIsOpen(true);
    } else if (group.status === "success") {
      setIsOpen(false);
    }
  }, [group.status]);

  return (
    <div
      className={`rounded-lg border ${statusBorder[group.status]} bg-gray-950 my-2 overflow-hidden transition-all duration-200`}
    >
      <button
        className={`w-full flex items-center justify-between px-4 py-3 cursor-pointer ${statusHeader[group.status]} hover:brightness-110 transition-all select-none`}
        onClick={() => setIsOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <StatusIndicator status={group.status} />
          <span className="font-semibold text-sm text-gray-100">{group.title}</span>
          {group.status === "running" && (
            <span className="text-xs text-blue-400 animate-pulse">running…</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{group.commands.length} action{group.commands.length !== 1 ? "s" : ""}</span>
          <span className="transition-transform duration-200" style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
            ▶
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 py-3 border-t border-gray-800 bg-gray-950 space-y-3">
          {group.summary && (
            <p className="text-xs text-gray-400 italic">{group.summary}</p>
          )}

          {group.commands.map((c, i) => (
            <CommandBlock key={i} command={c} />
          ))}

          {group.commands.length === 0 && (
            <p className="text-xs text-gray-600 italic">No commands yet…</p>
          )}
        </div>
      )}
    </div>
  );
}

function CommandBlock({ command }: { command: Command }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md bg-gray-900 border border-gray-800 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-mono text-xs text-gray-300">$ {command.cmd}</span>
        <span
          className={`text-xs font-semibold ml-2 shrink-0 ${command.exitCode === 0 ? "text-emerald-400" : "text-red-400"}`}
        >
          exit: {command.exitCode ?? "—"}
        </span>
      </button>

      {open && (
        <div className="px-3 py-2 border-t border-gray-800 font-mono text-xs space-y-1">
          {command.stdout && (
            <pre className="whitespace-pre-wrap text-emerald-400 break-all">{command.stdout}</pre>
          )}
          {command.stderr && (
            <pre className="whitespace-pre-wrap text-rose-400 break-all">{command.stderr}</pre>
          )}
          {!command.stdout && !command.stderr && (
            <span className="text-gray-600">(no output)</span>
          )}
        </div>
      )}
    </div>
  );
}

const DEMO_GROUPS: TaskGroup[] = [
  {
    id: "1",
    title: "Installing Dependencies",
    status: "success",
    summary: "Installed 142 packages, 0 vulnerabilities found.",
    commands: [
      {
        cmd: "pnpm install --frozen-lockfile",
        exitCode: 0,
        stdout: "Packages: +142\nProgress: resolved 142, reused 142, downloaded 0, added 142, done\n\ndevDependencies:\n+ typescript 5.9.3\n\ndone in 4.2s",
        stderr: "",
      },
    ],
  },
  {
    id: "2",
    title: "Typecheck & Build",
    status: "success",
    summary: "TypeScript compilation passed. esbuild bundled 14 assets in 1.42s.",
    commands: [
      {
        cmd: "pnpm run typecheck",
        exitCode: 0,
        stdout: "tsc --build\n✓ No errors found",
        stderr: "",
      },
      {
        cmd: "pnpm --filter @workspace/mockup-sandbox run build",
        exitCode: 0,
        stdout: "vite v7.3.2 building for production...\n✓ 14 modules transformed.\ndist/index.html   1.20 kB\ndist/assets/index-BxK9j2V1.css   28.14 kB\ndist/assets/index-CdXoGhf8.js   142.10 kB\n✓ built in 1.42s",
        stderr: "",
      },
    ],
  },
  {
    id: "3",
    title: "Deploy to Cloudflare Pages",
    status: "running",
    summary: undefined,
    commands: [
      {
        cmd: "wrangler pages deploy artifacts/mockup-sandbox/dist --project-name=trinity-universe-web",
        exitCode: 0,
        stdout: "Uploading... (14/14)\nSuccess! Uploaded 14 files (1.23 sec)\n✨ Deployment complete! https://trinity-universe-web.pages.dev",
        stderr: "",
      },
    ],
  },
  {
    id: "4",
    title: "Post-merge Setup",
    status: "pending",
    summary: undefined,
    commands: [],
  },
];

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-sans">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">CI / Deploy Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time task execution log with collapsible accordions</p>
        </div>
        <div className="space-y-1">
          {DEMO_GROUPS.map((g) => (
            <TaskGroupAccordion key={g.id} group={g} />
          ))}
        </div>
      </div>
    </div>
  );
}
