import React, { useState, useMemo } from "react";
import {
  Folder,
  FolderOpen,
  FileCode2,
  FileText,
  FileJson,
  Code2,
  Search,
  MoreVertical,
  ChevronLeft,
  SlidersHorizontal,
} from "lucide-react";

export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  badge?: number | string;
}

interface FileExplorerProps {
  files?: string[];
  treeData?: FileNode[];
  onSelectFile?: (node: FileNode) => void;
  onBack?: () => void;
}

export function buildTreeFromPaths(paths: string[]): FileNode[] {
  const root: FileNode[] = [];

  for (const rawPath of paths) {
    const cleanPath = rawPath.replace(/^\//, "");
    const parts = cleanPath.split("/");
    let currentLevel = root;
    let accumulatedPath = "";

    parts.forEach((part, index) => {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      const isFile = index === parts.length - 1 && part.includes(".");
      let existingNode = currentLevel.find((n) => n.name === part);

      if (!existingNode) {
        existingNode = {
          id: accumulatedPath,
          name: part,
          path: accumulatedPath,
          type: isFile ? "file" : "folder",
          children: isFile ? undefined : [],
        };
        currentLevel.push(existingNode);
      }

      if (!isFile && existingNode.children) {
        currentLevel = existingNode.children;
      }
    });
  }

  const sortNodes = (nodes: FileNode[]): FileNode[] => {
    return nodes
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((node) => ({
        ...node,
        children: node.children ? sortNodes(node.children) : undefined,
      }));
  };

  return sortNodes(root);
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "tsx":
    case "jsx":
      return (
        <span className="text-sky-400 font-bold text-xs flex items-center justify-center w-4 h-4">
          ⚛
        </span>
      );
    case "ts":
    case "js":
      return (
        <span className="bg-sky-600 text-white font-bold text-[9px] px-0.5 rounded-[2px] leading-tight">
          TS
        </span>
      );
    case "css":
    case "scss":
      return (
        <span className="bg-blue-600 text-white font-bold text-[9px] px-0.5 rounded-[2px] leading-tight">
          3
        </span>
      );
    case "html":
      return (
        <span className="bg-amber-600 text-white font-bold text-[9px] px-0.5 rounded-[2px] leading-tight">
          5
        </span>
      );
    case "json":
      return <FileJson className="w-4 h-4 text-amber-400" />;
    case "md":
    case "txt":
      return <FileText className="w-4 h-4 text-slate-400" />;
    default:
      return <Code2 className="w-4 h-4 text-slate-400" />;
  }
}

function TreeItem({
  node,
  depth,
  selectedId,
  expandedMap,
  onToggle,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selectedId: string | null;
  expandedMap: Record<string, boolean>;
  onToggle: (path: string) => void;
  onSelect: (node: FileNode) => void;
}) {
  const isExpanded = !!expandedMap[node.path];
  const isSelected = selectedId === node.path;
  const isFolder = node.type === "folder";

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node);
    if (isFolder) {
      onToggle(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 18 + 12}px` }}
        className={`group relative flex items-center justify-between py-1.5 pr-3 text-sm cursor-pointer select-none transition-all rounded-md my-0.5 ${
          isSelected
            ? "border border-sky-500 bg-sky-500/10 text-slate-100 font-medium"
            : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 truncate">
          {isFolder ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4 text-slate-400 shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-slate-400 shrink-0" />
            )
          ) : (
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              <FileIcon name={node.name} />
            </div>
          )}

          <span className="truncate">{node.name}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          {node.badge !== undefined && (
            <span className="bg-amber-400/20 text-amber-400 text-xs font-semibold px-1.5 py-0.2 rounded-full text-[11px]">
              {node.badge}
            </span>
          )}

          <button
            onClick={(e) => e.stopPropagation()}
            className="opacity-60 hover:opacity-100 p-0.5 text-slate-400 hover:text-white"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedMap={expandedMap}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({
  files,
  treeData,
  onSelectFile,
  onBack,
}: FileExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>("src/components");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    src: true,
    "src/components": true,
  });

  const fullTree = useMemo(() => {
    if (treeData) return treeData;
    if (files && files.length > 0) return buildTreeFromPaths(files);

    return buildTreeFromPaths([
      "artifacts",
      "lib",
      "scripts",
      "src/components/ChatArea.tsx",
      "src/components/Header.tsx",
      "src/components/LandingPage.tsx",
      "src/components/LibraryPage.tsx",
      "src/components/Navbar.tsx",
      "src/components/Sidebar.tsx",
      "src/components/SignInModal.tsx",
      "src/components/TenantModal.tsx",
      "src/data",
      "src/_worker.ts",
      "src/App.tsx",
      "src/index.css",
      "src/main.tsx",
      "src/types.ts",
      "trinityuniverse",
      "index.html",
      "metadata.json",
    ]);
  }, [files, treeData]);

  const handleToggle = (path: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return fullTree;

    const query = searchQuery.toLowerCase();
    const filterNodes = (nodes: FileNode[]): FileNode[] => {
      return nodes
        .map((node) => {
          if (node.type === "folder") {
            const matchingChildren = node.children
              ? filterNodes(node.children)
              : [];
            if (
              matchingChildren.length > 0 ||
              node.name.toLowerCase().includes(query)
            ) {
              return { ...node, children: matchingChildren };
            }
          } else if (node.name.toLowerCase().includes(query)) {
            return node;
          }
          return null;
        })
        .filter(Boolean) as FileNode[];
    };

    return filterNodes(fullTree);
  }, [fullTree, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-[#121417] text-slate-200 border-r border-slate-800 w-full max-w-sm select-none">
      <div className="p-3 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-2 border border-slate-700 bg-slate-800/60 px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            Files
          </div>
        </div>

        <button className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white">
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 absolute left-3 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files and code"
            className="w-full bg-[#1c1f24] border border-slate-700 rounded-md pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {filteredTree.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500">
            No files found
          </div>
        ) : (
          filteredTree.map((node) => (
            <TreeItem
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              expandedMap={expandedFolders}
              onToggle={handleToggle}
              onSelect={(n) => {
                setSelectedId(n.path);
                onSelectFile?.(n);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
