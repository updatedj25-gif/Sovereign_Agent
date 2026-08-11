import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import {
  Mic, Plus, ArrowUp, RefreshCw, Maximize2, ShieldCheck,
  Terminal, CheckSquare, TerminalSquare, Github, Check, ThumbsUp,
  ThumbsDown, Eye, RotateCcw, Bot, Code2, Play, ExternalLink, Sparkles,
  Globe, Loader2, Search, Copy, X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { FileExplorerSidebar } from "./FileExplorerSidebar";
import { ActionAccordion, ActionItem } from "./ActionAccordion";
import { SummaryMarkdownBlock } from "./SummaryMarkdownBlock";
import { ReActTimeline, ReActTurn } from "./ReActTimeline";
import { XTermConsole } from "@/components/terminal/XTermConsole";
import WORKER_BASE from "@/lib/worker-base";

export interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: ActionItem[];
  reactTurns?: ReActTurn[];
}

interface SplitChatViewProps {
  initialPrompt: string;
  messages: Message[];
  isStreaming: boolean;
  streamLogs: string[];
  onSendMessage: (msg: string) => void;
  onNewChat: () => void;
}

export function SplitChatView({
  initialPrompt,
  messages,
  isStreaming,
  streamLogs,
  onSendMessage,
  onNewChat,
}: SplitChatViewProps) {
  const [input, setInput] = useState("");
  const [activeRightTab, setActiveRightTab] = useState<"preview" | "code" | "terminal">("preview");
  const [activeCodeFile, setActiveCodeFile] = useState<string>("workers/src/index.ts");
  const [openTabs, setOpenTabs] = useState<string[]>(["workers/src/index.ts", "src/App.tsx"]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [activeRepoName, setActiveRepoName] = useState<string>("sovereign-agent");
  const [copiedCode, setCopiedCode] = useState(false);
  const [summaryText, setSummaryText] = useState<string>("");

  const [targetUrl, setTargetUrl] = useState("https://example.com");
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseResult, setBrowseResult] = useState<{
    status?: string;
    url?: string;
    title?: string;
    text?: string;
    screenshot?: string;
  } | null>(() => {
    try {
      const stored = localStorage.getItem("sovereign_latest_browse");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const handleBrowse = async (urlToInspect = targetUrl) => {
    const url = urlToInspect.trim();
    if (!url || browseLoading) return;

    setBrowseLoading(true);
    const sessionId = localStorage.getItem("sovereign_persistent_session_id") || `sovereign-session-${Date.now()}`;

    try {
      const res = await fetch(`${WORKER_BASE}/browse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
        },
        body: JSON.stringify({
          url,
          screenshot: true,
          extractText: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setBrowseResult(data);
        localStorage.setItem("sovereign_latest_browse", JSON.stringify(data));
      } else {
        console.error("Browse failed with status:", res.status);
      }
    } catch (err) {
      console.error("Failed to inspect URL via worker:", err);
    } finally {
      setBrowseLoading(false);
    }
  };

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamLogs, isStreaming]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const text = input.trim();
    setInput("");
    onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Sample code content for Code View tab
  const sampleFiles: Record<string, string> = {
    "workers/src/index.ts": `import { DurableObject } from "cloudflare:workers";

export class AgentSession extends DurableObject {
  async fetch(request: Request) {
    // Stateful Durable Object Session Memory
    return new Response("Session Active");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", runtime: "cloudflare-workers" });
    }
    return new Response("Sovereign Agent Worker Active");
  }
};`,
    "server.ts": `import express from "express";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", engine: "Sovereign" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(\`Server listening on port \${PORT}\`);
});`,
    "workers/wrangler.toml": `name = "sovereign-agent"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[[durable_objects.bindings]]
name = "AGENT_SESSION"
class_name = "AgentSession"

[[vectorize]]
binding = "VECTOR_INDEX"
index_name = "sovereign-vector-index"`,
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full bg-slate-950 overflow-hidden font-sans text-slate-200">
      {/* LEFT PANE: Chat & Streaming AI Console (~38% width) */}
      <div className="w-full md:w-[38%] border-r border-slate-800/80 flex flex-col bg-slate-900/90 shrink-0">
        {/* Left Subheader */}
        <div className="h-10 px-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/60 text-xs font-mono">
          <div className="flex items-center gap-2 text-slate-400">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-200 font-semibold">Sovereign 3.6 Flash</span>
            <span className="text-slate-500">· Ran for 93s</span>
          </div>
          <button
            onClick={onNewChat}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title="Start new chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Chat & Logs Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs leading-relaxed">
          {/* Post-Execution Summary Markdown Block */}
          {summaryText && <SummaryMarkdownBlock summary={summaryText} />}

          {/* Active User Prompt Header */}
          {initialPrompt && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-slate-200 text-xs font-sans leading-relaxed">
              <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider block mb-1 font-bold">Prompt</span>
              {initialPrompt}
            </div>
          )}

          {/* Conversation History & Streamed Messages */}
          {messages.map((m, idx) => {
            const isUser = m.role === "user";
            let displayContent = m.content;
            let actionsToRender: ActionItem[] | undefined = m.actions;

            if (!actionsToRender && !isUser && m.content.trim().startsWith("{")) {
              try {
                const parsed = JSON.parse(m.content.trim());
                if (parsed.text || parsed.actions) {
                  displayContent = parsed.text || m.content;
                  actionsToRender = parsed.actions;
                }
              } catch {}
            }

            return (
              <div
                key={idx}
                className={cn(
                  "p-3.5 rounded-xl text-xs leading-relaxed border space-y-2 transition-all",
                  isUser
                    ? "bg-slate-800/80 border-slate-700 text-slate-100 ml-4 font-sans"
                    : "bg-slate-950 border-slate-800/90 text-slate-300 font-mono shadow-md"
                )}
              >
                <div className="whitespace-pre-wrap">{displayContent}</div>

                {/* ReAct Execution Loop Step History */}
                {m.reactTurns && m.reactTurns.length > 0 && (
                  <ReActTimeline turns={m.reactTurns} isStreaming={isStreaming && idx === messages.length - 1} />
                )}

                {/* Inline Action Accordion for tool/skill executions */}
                {actionsToRender && actionsToRender.length > 0 && (
                  <ActionAccordion actions={actionsToRender} />
                )}
              </div>
            );
          })}

          <div ref={chatBottomRef} />
        </div>

        {/* Prompt Input Box at bottom of left pane */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950">
          <div className="relative rounded-xl bg-slate-900 border border-slate-800 focus-within:border-amber-500/50 p-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to build or change..."
              className="w-full min-h-[50px] max-h-[120px] bg-transparent border-0 focus:outline-none focus:ring-0 text-xs text-slate-200 placeholder:text-slate-500 resize-none"
            />
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1 text-slate-500">
                <button className="p-1 hover:text-slate-300 rounded" title="Add attachment"><Plus className="w-3.5 h-3.5" /></button>
              </div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 flex items-center justify-center transition-colors"
              >
                <ArrowUp className="w-4 h-4 font-bold" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT PANE: Live UI / Code Preview (~62% width) */}
      <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
        {/* Right Header Controls (Tabs & Address Bar) */}
        <div className="h-10 px-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between text-xs font-mono">
          {/* Tab Switcher */}
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveRightTab("preview")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
                activeRightTab === "preview"
                  ? "bg-slate-800 text-white font-semibold shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Preview
            </button>
            <button
              onClick={() => setActiveRightTab("code")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
                activeRightTab === "code"
                  ? "bg-slate-800 text-white font-semibold shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <Code2 className="w-3.5 h-3.5" />
              Code
            </button>
            <button
              onClick={() => setActiveRightTab("terminal")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
                activeRightTab === "terminal"
                  ? "bg-slate-800 text-amber-400 font-semibold shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <TerminalSquare className="w-3.5 h-3.5 text-amber-400" />
              Terminal
              {isStreaming && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse ml-0.5" />
              )}
            </button>
          </div>

          {/* Center Address Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleBrowse();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-md text-slate-300 text-xs w-72 md:w-96 shadow-inner focus-within:border-amber-500/50 transition-colors"
          >
            <button
              type="button"
              onClick={() => handleBrowse()}
              disabled={browseLoading}
              title="Refresh / Inspect URL"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 text-slate-400 hover:text-white cursor-pointer transition-transform", browseLoading && "animate-spin text-amber-400")} />
            </button>
            <span className="text-slate-500 font-mono text-[10px]">url:</span>
            <input
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com"
              className="flex-1 bg-transparent border-none outline-none font-mono text-xs text-slate-200 placeholder:text-slate-600"
            />
            <button
              type="submit"
              disabled={browseLoading || !targetUrl.trim()}
              className="p-1 hover:text-amber-400 text-slate-400 rounded disabled:opacity-40 transition-colors"
              title="Inspect URL via Sovereign Cloudflare Worker"
            >
              {browseLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
            </button>
          </form>

          <div className="w-16"></div>
        </div>

        {/* Right Pane Main Canvas */}
        <div className="flex-1 overflow-hidden relative">
          {activeRightTab === "preview" ? (
            /* PREVIEW TAB: Renders the Sovereign Command Center Cockpit / Live Browse Preview */
            <div className="w-full h-full bg-[#0a0a0c] flex flex-col justify-between p-6 overflow-y-auto">
              {browseLoading ? (
                <div className="my-auto flex flex-col items-center justify-center text-center space-y-4">
                  <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                  <p className="text-sm font-mono text-slate-300">Executing /browse against live Cloudflare Worker...</p>
                  <p className="text-xs font-mono text-slate-500">{targetUrl}</p>
                </div>
              ) : browseResult ? (
                  <div className="space-y-6 max-w-2xl mx-auto w-full my-auto">
                    {/* Page Title & URL Header */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-amber-400" />
                          <h3 className="font-mono text-sm font-bold text-white truncate">{browseResult.title || browseResult.url}</h3>
                        </div>
                        <span className="text-[10px] font-mono uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded">
                          Browse Inspected
                        </span>
                      </div>
                      <p className="font-mono text-xs text-slate-400 truncate">{browseResult.url}</p>
                    </div>

                    {/* Screenshot Frame */}
                    {browseResult.screenshot && (
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-2 shadow-2xl">
                        <img
                          src={browseResult.screenshot.startsWith("data:") ? browseResult.screenshot : `data:image/png;base64,${browseResult.screenshot}`}
                          alt="Web Preview"
                          className="w-full max-h-80 object-contain rounded bg-slate-900"
                        />
                      </div>
                    )}

                    {/* Extracted Text breakdown */}
                    {browseResult.text && (
                      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
                        <h4 className="text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider">Extracted Page Text</h4>
                        <div className="text-xs font-sans text-slate-300 leading-relaxed max-h-40 overflow-y-auto bg-slate-950/80 p-3 rounded border border-slate-800/80">
                          {browseResult.text}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="my-auto flex flex-col items-center text-center max-w-lg mx-auto space-y-4">
                    <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-[0_0_24px_rgba(245,158,11,0.15)]">
                      <Bot className="w-8 h-8" />
                    </div>
                    <h2 className="text-2xl font-bold font-mono text-white tracking-tight">
                      Sovereign Agent
                    </h2>
                    <p className="text-xs text-slate-400 font-sans leading-relaxed">
                      A full-stack reasoning engine. Use the address bar above to inspect web pages via live Cloudflare Worker <code className="text-amber-400 font-mono">/browse</code>.
                    </p>
                    <button
                      onClick={() => handleBrowse()}
                      className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-mono font-semibold text-xs rounded-lg transition-colors shadow-md"
                    >
                      <Globe className="w-4 h-4" /> Inspect Web Page (/browse)
                    </button>
                  </div>
                )}

                {/* Prompt Box inside preview */}
                <div className="w-full max-w-xl mx-auto mt-6 bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
                  <input
                    type="text"
                    readOnly
                    value={initialPrompt || "Describe what you want to build or change..."}
                    className="flex-1 bg-transparent text-xs text-slate-300 focus:outline-none font-sans"
                  />
                  <button className="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center shrink-0">
                    <ArrowUp className="w-4 h-4 font-bold" />
                  </button>
                </div>
            </div>
          ) : activeRightTab === "code" ? (
            /* CODE TAB: Code Editor / Viewer with File Explorer Sidebar */
            <div className="w-full h-full bg-[#0d0d11] flex overflow-hidden font-mono text-xs">
              {/* File Explorer Sidebar */}
              <FileExplorerSidebar
                selectedFilePath={activeCodeFile}
                onSelectFile={({ path, content, repo }) => {
                  setActiveCodeFile(path);
                  setActiveRepoName(repo);
                  setFileContents((prev) => ({ ...prev, [path]: content }));
                  if (!openTabs.includes(path)) {
                    setOpenTabs((prev) => [...prev, path]);
                  }
                }}
              />

              {/* Main Code Viewer Console Area */}
              <div className="flex-1 flex flex-col bg-[#0b0b0f] overflow-hidden">
                {/* Active File Tab Bar */}
                <div className="flex items-center bg-slate-950 border-b border-slate-800 px-2 overflow-x-auto shrink-0">
                  {openTabs.map((filepath) => (
                    <div
                      key={filepath}
                      onClick={() => setActiveCodeFile(filepath)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 border-r border-slate-800 text-xs font-mono transition-colors cursor-pointer group shrink-0",
                        activeCodeFile === filepath
                          ? "bg-[#0b0b0f] text-amber-400 border-t-2 border-t-amber-400 font-semibold"
                          : "text-slate-400 hover:text-slate-200 bg-slate-900/40"
                      )}
                    >
                      <Code2 className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
                      <span className="truncate max-w-[160px]">{filepath.split("/").pop()}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const filtered = openTabs.filter((t) => t !== filepath);
                          setOpenTabs(filtered);
                          if (activeCodeFile === filepath && filtered.length > 0) {
                            setActiveCodeFile(filtered[filtered.length - 1]);
                          }
                        }}
                        className="p-0.5 text-slate-500 hover:text-white rounded hover:bg-slate-800 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {openTabs.length === 0 && (
                    <div className="py-2 px-3 text-slate-500 font-mono text-xs italic">
                      No files open. Select a file from the explorer sidebar.
                    </div>
                  )}
                </div>

                {/* File Header Bar */}
                <div className="px-4 py-2 bg-slate-900/80 border-b border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-400 shrink-0">
                  <div className="flex items-center gap-2 truncate">
                    <Github className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-slate-500">{activeRepoName} /</span>
                    <span className="text-slate-200 font-bold truncate">{activeCodeFile}</span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-slate-500">
                      {((fileContents[activeCodeFile] || sampleFiles[activeCodeFile] || "").split("\n").length)} lines
                    </span>
                    <button
                      onClick={() => {
                        const codeToCopy = fileContents[activeCodeFile] || sampleFiles[activeCodeFile] || "";
                        navigator.clipboard.writeText(codeToCopy);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-colors text-[11px]"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-amber-400" />}
                      <span>{copiedCode ? "Copied!" : "Copy Code"}</span>
                    </button>
                  </div>
                </div>

                {/* Code Body Canvas with Line Numbers */}
                <div className="flex-1 p-4 overflow-auto text-slate-300 font-mono text-xs leading-relaxed bg-[#0b0b0f] flex">
                  {/* Line Numbers Column */}
                  <div className="select-none text-slate-600 text-right pr-4 border-r border-slate-800/60 font-mono shrink-0 space-y-0.5">
                    {((fileContents[activeCodeFile] || sampleFiles[activeCodeFile] || "// Select or click a file from GitHub Explorer").split("\n")).map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>

                  {/* Code Text Area */}
                  <div className="pl-4 flex-1 overflow-x-auto whitespace-pre font-mono text-slate-200">
                    <code>
                      {fileContents[activeCodeFile] || sampleFiles[activeCodeFile] || "// Select or click a file from GitHub Explorer"}
                    </code>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* TERMINAL TAB: Live XTerm.js Console Streaming */
            <div className="w-full h-full bg-[#08090d] p-2">
              <XTermConsole height="100%" streamLogs={streamLogs.join("")} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
