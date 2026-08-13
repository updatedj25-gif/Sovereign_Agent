import React, { useState } from "react";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

interface FileExplorerProps {
  tree: FileNode[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  onRefresh: () => void;
  loading?: boolean;
}

export function FileExplorerSidebar({
  tree,
  selectedFile,
  onSelectFile,
  onRefresh,
  loading = false,
}: FileExplorerProps) {
  return (
    <div className="w-64 bg-slate-950 text-slate-200 border-r border-slate-800 flex flex-col h-full font-mono text-xs select-none">
      {/* Sidebar Header */}
      <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
        <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
          Explorer
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-amber-400 transition-colors"
          title="Refresh File Tree"
        >
          🔄
        </button>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="p-4 text-center text-slate-500 animate-pulse">
            Scanning sandbox workspace...
          </div>
        ) : tree.length === 0 ? (
          <div className="p-4 text-center text-slate-600">No files found</div>
        ) : (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeItem({
  node,
  selectedFile,
  onSelectFile,
}: {
  node: FileNode;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const isSelected = selectedFile === node.path;

  const getIcon = (name: string, isDir: boolean) => {
    if (isDir) return isOpen ? "📂" : "📁";
    if (name.endsWith(".tsx") || name.endsWith(".jsx")) return "⚛️";
    if (name.endsWith(".ts") || name.endsWith(".js")) return "🟦";
    if (name.endsWith(".css")) return "🎨";
    if (name.endsWith(".json")) return "⚙️";
    return "📄";
  };

  if (node.type === "dir") {
    return (
      <div className="my-0.5">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 py-1 px-2 hover:bg-slate-900 rounded cursor-pointer text-slate-300"
        >
          <span className="text-[10px] text-slate-500">{isOpen ? "▼" : "▶"}</span>
          <span>{getIcon(node.name, true)}</span>
          <span className="font-medium text-slate-200">{node.name}</span>
        </div>
        {isOpen && node.children && (
          <div className="pl-3 border-l border-slate-800/60 ml-2">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelectFile(node.path)}
      className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer my-0.5 transition-colors ${
        isSelected
          ? "bg-amber-500/20 text-amber-300 font-semibold border-l-2 border-amber-400"
          : "hover:bg-slate-900 text-slate-400 hover:text-slate-200"
      }`}
    >
      <span>{getIcon(node.name, false)}</span>
      <span className="truncate">{node.name}</span>
    </div>
  );
}
