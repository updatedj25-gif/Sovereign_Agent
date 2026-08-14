import React, { useState } from "react";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

export interface FileExplorerProps {
  tree?: FileNode[];
  files?: FileNode[];
  selectedFile?: string | null;
  selectedFilePath?: string | null;
  onSelectFile?: (file: any) => void;
  onRefresh?: () => void;
  loading?: boolean;
}

export function FileExplorerSidebar({
  tree = [],
  files = [],
  selectedFile,
  selectedFilePath,
  onSelectFile,
  onRefresh,
  loading = false,
}: FileExplorerProps) {
  const activeFile = selectedFile || selectedFilePath;
  const displayTree = tree.length > 0 ? tree : files;

  return (
    <div className="w-60 bg-slate-950 text-slate-200 border-r border-slate-800 flex flex-col h-full font-mono text-xs select-none">
      <div className="p-2.5 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
        <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
          Explorer
        </span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-amber-400"
          >
            🔄
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="p-4 text-center text-slate-500 animate-pulse">Scanning...</div>
        ) : displayTree.length === 0 ? (
          <div className="p-4 text-center text-slate-600">No workspace files</div>
        ) : (
          displayTree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              selectedFile={activeFile}
              onSelect={onSelectFile}
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
  onSelect,
}: {
  node: FileNode;
  selectedFile?: string | null;
  onSelect?: (file: any) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const isSelected = selectedFile === node.path;

  const handleClick = () => {
    if (onSelect) {
      onSelect({ path: node.path, content: "", repo: "" });
    }
  };

  if (node.type === "dir") {
    return (
      <div className="my-0.5">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 py-1 px-2 hover:bg-slate-900 rounded cursor-pointer text-slate-300"
        >
          <span className="text-[10px] text-slate-500">{isOpen ? "▼" : "▶"}</span>
          <span>📁</span>
          <span className="font-medium text-slate-200">{node.name}</span>
        </div>
        {isOpen && node.children && (
          <div className="pl-3 border-l border-slate-800 ml-2">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                selectedFile={selectedFile}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer my-0.5 transition-colors ${
        isSelected
          ? "bg-amber-500/20 text-amber-300 font-semibold border-l-2 border-amber-400"
          : "hover:bg-slate-900 text-slate-400"
      }`}
    >
      <span>📄</span>
      <span className="truncate">{node.name}</span>
    </div>
  );
}