import React, { useState, useEffect, useRef } from "react";
import { ActionAccordion, ActionItem } from "./ActionAccordion";
import { SummaryMarkdownBlock } from "./SummaryMarkdownBlock";
import { FileExplorerSidebar, FileNode } from "./FileExplorerSidebar";
import { Send, Monitor, Code2, Terminal as TerminalIcon, RotateCw } from "lucide-react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: ActionItem[];
  summaryText?: string;
}

export interface SplitChatViewProps {
  initialPrompt?: string;
  messages: ChatMessage[];
  isStreaming?: boolean;
  streamLogs?: string[];
  onSendMessage: (text: string) => void;
  onNewChat?: () => void;
  sessionId?: string;
}

export function SplitChatView({
  messages,
  isStreaming = false,
  onSendMessage,
  sessionId = "default-session",
}: SplitChatViewProps) {
  const [inputText, setInputText] = useState("");
  const [activePane, setActivePane] = useState<"preview" | "code" | "terminal">("preview");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const fetchPreviewUrl = async () => {
    try {
      const res = await fetch(`/api/sandbox/preview-url?sessionId=${sessionId}&port=5173`);
      const data = await res.json();
      if (data.previewUrl && data.previewUrl.startsWith("https://") && !data.previewUrl.includes("localhost")) {
        setPreviewUrl(data.previewUrl);
      } else {
        setPreviewUrl(null);
      }
    } catch {
      setPreviewUrl(null);
    }
  };

  const fetchTree = async () => {
    setWorkspaceLoading(true);
    try {
      const res = await fetch(`/api/sandbox/tree?sessionId=${sessionId}`);
      const data = await res.json();
      setTree(data.tree || []);
    } catch {
      setTree([]);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const handleSelectFile = async (fileObj: any) => {
    const filePath = typeof fileObj === "string" ? fileObj : fileObj?.path || "";
    setSelectedFile(filePath);
    setActivePane("code");
    try {
      const res = await fetch("/api/sandbox/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action: "read", filePath }),
      });
      const data = await res.json();
      setFileContent(data.content || "");
    } catch {
      setFileContent("// Unable to read file content");
    }
  };

  useEffect(() => {
    fetchPreviewUrl();
    fetchTree();
  }, [sessionId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isStreaming) return;
    onSendMessage(inputText);
    setInputText("");
  };

  return (
    <div className="flex h-full bg-slate-950 text-slate-100 font-mono text-xs overflow-hidden">
      {/* LEFT COLUMN: Chat Messages & Subtask Step Accordions */}
      <div className="w-1/2 flex flex-col h-full border-r border-slate-800 bg-slate-950">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-600 text-center p-6">
              Agent initialized. Describe a task below to start the ReAct reasoning loop.
            </div>
          ) : (
            messages.map((m, idx) => (
              <div key={idx} className="space-y-2">
                <div
                  className={`p-3 rounded-lg border ${
                    m.role === "user"
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
                      : "bg-slate-900 border-slate-800 text-slate-200"
                  }`}
                >
                  <span className="font-bold text-[10px] text-slate-500 block mb-1 uppercase tracking-wider">
                    {m.role === "user" ? "👤 User Prompt" : "🤖 Sovereign Agent"}
                  </span>
                  <p className="whitespace-pre-wrap font-sans text-xs leading-relaxed">
                    {m.content}
                  </p>
                </div>

                {/* Subtask Action Accordion Steps */}
                {m.actions && m.actions.length > 0 && (
                  <ActionAccordion actions={m.actions} />
                )}

                {/* Summary Markdown Pass */}
                {m.summaryText && <SummaryMarkdownBlock summary={m.summaryText} />}
              </div>
            ))
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Single Prompt Input Bar */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-slate-800 bg-slate-900/60 flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Describe what you want to build or change..."
            disabled={isStreaming}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-400 font-mono disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !inputText.trim()}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs font-mono transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <span>{isStreaming ? "Executing..." : "Send"}</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* RIGHT COLUMN: Web Preview, Code Inspector, or Terminal */}
      <div className="w-1/2 flex flex-col h-full bg-slate-950">
        {/* Right Pane Tab Bar */}
        <div className="p-2 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
          <div className="flex gap-1 bg-slate-950 border border-slate-800 rounded p-0.5">
            <button
              onClick={() => setActivePane("preview")}
              className={`px-3 py-1 rounded text-[11px] flex items-center gap-1.5 transition-colors ${
                activePane === "preview"
                  ? "bg-amber-500/20 text-amber-300 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Monitor className="w-3.5 h-3.5" /> Live Preview
            </button>
            <button
              onClick={() => setActivePane("code")}
              className={`px-3 py-1 rounded text-[11px] flex items-center gap-1.5 transition-colors ${
                activePane === "code"
                  ? "bg-amber-500/20 text-amber-300 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" /> Code Inspector
            </button>
            <button
              onClick={() => setActivePane("terminal")}
              className={`px-3 py-1 rounded text-[11px] flex items-center gap-1.5 transition-colors ${
                activePane === "terminal"
                  ? "bg-amber-500/20 text-amber-300 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <TerminalIcon className="w-3.5 h-3.5" /> Terminal
            </button>
          </div>

          <button
            onClick={() => {
              fetchPreviewUrl();
              fetchTree();
            }}
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded"
            title="Refresh Viewport"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Viewport Content */}
        <div className="flex-1 overflow-hidden">
          {activePane === "preview" && (
            <div className="w-full h-full bg-slate-900/40 flex justify-center items-center p-4">
              {previewUrl && previewUrl.startsWith("https://") && !previewUrl.includes("localhost") ? (
                <iframe
                  src={previewUrl}
                  title="Live Sandbox Preview"
                  className="w-full h-full bg-white rounded-lg shadow-2xl border border-slate-800"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                />
              ) : (
                <div className="text-center p-8 bg-slate-900 border border-slate-800 rounded-xl max-w-md space-y-3 font-mono">
                  <div className="text-3xl">🚀</div>
                  <h3 className="text-slate-200 font-bold text-sm">E2B Web Preview Idle</h3>
                  <p className="text-slate-400 text-xs leading-relaxed">
                    When Sovereign Agent spins up a live web server inside the E2B sandbox micro-VM (e.g. `pnpm dev`), the forwarded live preview will render here automatically.
                  </p>
                </div>
              )}
            </div>
          )}

          {activePane === "code" && (
            <div className="flex h-full">
              <FileExplorerSidebar
                tree={tree}
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
                onRefresh={fetchTree}
                loading={workspaceLoading}
              />
              <div className="flex-1 p-4 bg-slate-950 text-emerald-300 overflow-auto font-mono text-xs">
                {selectedFile ? (
                  <pre>{fileContent}</pre>
                ) : (
                  <div className="text-slate-600">Select a file from the explorer sidebar to view code.</div>
                )}
              </div>
            </div>
          )}

          {activePane === "terminal" && (
            <div className="p-4 bg-slate-950 text-slate-300 font-mono text-xs h-full overflow-auto space-y-1">
              <div className="text-amber-400 font-bold">$ Sandbox Terminal Active</div>
              <p className="text-slate-500">Live command execution output streams here during ReAct turns.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}