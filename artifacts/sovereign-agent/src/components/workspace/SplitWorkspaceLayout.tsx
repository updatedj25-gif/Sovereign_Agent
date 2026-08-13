import React, { useState, useEffect } from "react";
import { FileExplorerSidebar, FileNode } from "./FileExplorerSidebar";
import { LivePreviewPanel } from "./LivePreviewPanel";

export function SplitWorkspaceLayout({ sessionId = "default-session" }) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("preview");

  // Fetch directory tree from E2B sandbox
  const fetchTree = async () => {
    setLoadingTree(true);
    try {
      const res = await fetch(`/api/sandbox/tree?sessionId=${sessionId}`);
      const data = await res.json();
      setTree(data.tree || []);
    } catch {
      setTree([]);
    } finally {
      setLoadingTree(false);
    }
  };

  // Fetch E2B sandbox preview host URL
  const fetchPreviewUrl = async () => {
    try {
      const res = await fetch(`/api/sandbox/preview-url?sessionId=${sessionId}&port=5173`);
      const data = await res.json();
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
      }
    } catch {
      setPreviewUrl(null);
    }
  };

  // Read selected file content from E2B
  const handleSelectFile = async (filePath: string) => {
    setSelectedFile(filePath);
    setActiveTab("code");
    try {
      const res = await fetch("/api/sandbox/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action: "read", filePath }),
      });
      const data = await res.json();
      setFileContent(data.content || "");
    } catch {
      setFileContent("// Failed to load file content");
    }
  };

  useEffect(() => {
    fetchTree();
    fetchPreviewUrl();
  }, [sessionId]);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-mono">
      {/* 1. File Explorer Sidebar */}
      <FileExplorerSidebar
        tree={tree}
        selectedFile={selectedFile}
        onSelectFile={handleSelectFile}
        onRefresh={fetchTree}
        loading={loadingTree}
      />

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Workspace Tab Bar */}
        <div className="bg-slate-900 border-b border-slate-800 px-4 flex justify-between items-center">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("preview")}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "preview"
                  ? "border-amber-400 text-amber-300 bg-slate-950"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              🌐 Live Preview
            </button>
            <button
              onClick={() => setActiveTab("code")}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "code"
                  ? "border-amber-400 text-amber-300 bg-slate-950"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              📄 Code Editor {selectedFile ? `(${selectedFile})` : ""}
            </button>
          </div>
        </div>

        {/* Workspace Panel Switcher */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "preview" ? (
            <LivePreviewPanel
              previewUrl={previewUrl}
              onRefreshUrl={fetchPreviewUrl}
            />
          ) : (
            <div className="h-full bg-slate-950 p-4 overflow-auto">
              {selectedFile ? (
                <pre className="text-xs text-amber-200/90 leading-relaxed font-mono">
                  {fileContent}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                  Select a file from the explorer to view code.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
