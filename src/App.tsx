import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
  Key, 
  RefreshCw, 
  Terminal as TerminalIcon, 
  Code, 
  Monitor, 
  X, 
  Send, 
  Search, 
  Brain, 
  MessageSquare, 
  Trash2, 
  Square, 
  Plus, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Sparkles,
  MoreVertical,
  FileText,
  Settings
} from 'lucide-react';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface EnvField {
  key: string;
  label: string;
  placeholder?: string;
  type?: string;
}

interface EnvModalData {
  title: string;
  fields: EnvField[];
}

interface SubAction {
  id: string;
  type: 'command' | 'python' | 'write_file' | 'read_file' | 'thought' | 'env_box';
  title: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  command?: string;
  output?: string;
  icon?: string;
}

interface TaskGroup {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  command: string;
  output: string;
  subActions?: SubAction[];
}

interface MessageEntry {
  role: 'user' | 'assistant';
  text?: string;
  elapsedSeconds?: number;
  checkpointId?: string;
}

// Builds a clean nested hierarchical tree from any flat path list
function buildHierarchy(flatList: { name: string; path: string; type?: string }[]): FileNode[] {
  const rootNodes: FileNode[] = [];
  const map: Record<string, FileNode> = {};

  // Sort: directories first, then alphabetically
  const sorted = [...flatList].sort((a, b) => a.path.localeCompare(b.path));

  for (const item of sorted) {
    const parts = item.path.replace(/^\/+/, '').split('/');
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const prevPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1 && item.type !== 'directory';

      if (!map[currentPath]) {
        const newNode: FileNode = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          children: isFile ? undefined : [],
        };
        map[currentPath] = newNode;

        if (i === 0) {
          rootNodes.push(newNode);
        } else if (map[prevPath] && map[prevPath].children) {
          map[prevPath].children!.push(newNode);
        }
      }
    }
  }

  // Sort folders to top at every level
  const sortTree = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
    for (const n of nodes) {
      if (n.children) sortTree(n.children);
    }
  };

  sortTree(rootNodes);
  return rootNodes;
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [userPromptText, setUserPromptText] = useState<string>('');
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [thoughts, setThoughts] = useState<{ text: string; turn?: number }[]>([]);
  const [finalReport, setFinalReport] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [desktopTab, setDesktopTab] = useState<'code' | 'preview' | 'terminal'>('code');
  const [mobileTab, setMobileTab] = useState<'console' | 'code' | 'preview' | 'terminal'>('code');
  
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('sovereign-session-default');
  
  const [rawFiles, setRawFiles] = useState<{ name: string; path: string; type?: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string>('src/App.tsx');
  const [fileContent, setFileContent] = useState<string>('// Select a file to view code');
  const [previewUrl, setPreviewUrl] = useState<string>('/api/sandbox/render-preview');
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['$ Sovereign Agent Sandbox Initialized']);
  
  // Expanded folders map
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'src': true,
    'src/components': true,
    'artifacts': false,
    'lib': false,
    'scripts': false,
    'data': true,
  });
  
  const [expandedPills, setExpandedPills] = useState<Record<string, boolean>>({});
  const [expandedSubRows, setExpandedSubRows] = useState<Record<string, boolean>>({});
  
  const [showEnvModal, setShowEnvModal] = useState<boolean>(false);
  const [envModalData, setEnvModalData] = useState<EnvModalData | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch {}
  };

  const fetchTree = async () => {
    try {
      const res = await fetch(`/api/sandbox/tree?sessionId=${currentSessionId}`);
      const data = await res.json();
      if (data.tree) {
        setRawFiles(data.tree);
      }
    } catch {}
  };

  const loadFile = async (path: string) => {
    setSelectedFile(path);
    try {
      const res = await fetch(`/api/sandbox/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, filePath: path })
      });
      const data = await res.json();
      setFileContent(data.content || '// Empty file');
    } catch {}
  };

  useEffect(() => {
    fetchSessions();
    fetchTree();
    loadFile('src/App.tsx');
  }, [currentSessionId]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [taskGroups, thoughts, finalReport]);

  const createNewSession = () => {
    const newId = `sovereign-session-${Date.now().toString(36)}`;
    setCurrentSessionId(newId);
    setUserPromptText('');
    setTaskGroups([]);
    setThoughts([]);
    setFinalReport(null);
    setPrompt('');
  };

  const clearAllHistory = async () => {
    if (!confirm('Clear all chat session history?')) return;
    try {
      await fetch('/api/sessions', { method: 'DELETE' });
      setSessions([]);
      createNewSession();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteSingleSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) createNewSession();
    } catch (e) {
      console.error(e);
    }
  };

  const handleKillTask = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    try {
      await fetch('/api/agent/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId })
      });
    } catch {}
    setIsRunning(false);
  };

  const handleApplyEnv = async () => {
    try {
      await fetch('/api/sandbox/save-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, envVars: envValues })
      });
      setShowEnvModal(false);
      fetchTree();
    } catch (e) {
      console.error(e);
    }
  };

  const runAgent = async () => {
    if (!prompt.trim() || isRunning) return;
    const userPrompt = prompt;
    setPrompt('');
    setUserPromptText(userPrompt);
    setTaskGroups([]);
    setThoughts([]);
    setFinalReport(null);
    setIsRunning(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt, sessionId: currentSessionId }),
        signal: controller.signal
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.replace('data: ', ''));
              if (data.type === 'thought') {
                setThoughts(prev => [...prev, { text: data.text, turn: data.turn }]);
              }
              if (data.actions) {
                setTaskGroups(data.actions);
              }
              if (data.type === 'env_modal_open' && data.envBox) {
                setEnvModalData(data.envBox);
                setShowEnvModal(true);
              }
              if (data.type === 'preview_ready') {
                setPreviewUrl(`/api/sandbox/render-preview?sessionId=${currentSessionId}&t=${Date.now()}`);
              }
              if (data.type === 'stream_finished') {
                setFinalReport(data.finalResponse);
                if (data.elapsedSeconds) setElapsedTime(data.elapsedSeconds);
                if (data.checkpointId) setCheckpointId(data.checkpointId);
              }
              if (data.type === 'aborted') {
                setIsRunning(false);
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error(err);
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
      fetchSessions();
      fetchTree();
    }
  };

  const togglePill = (groupId: string) => {
    setExpandedPills(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const toggleSubRow = (subKey: string) => {
    setExpandedSubRows(prev => ({ ...prev, [subKey]: !prev[subKey] }));
  };

  const toggleFolder = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({ ...prev, [path]: !prev[path] }));
  };

  // Build tree & filter with search
  const filteredTree = useMemo(() => {
    const list = rawFiles.length > 0 ? rawFiles : [
      { name: 'artifacts', path: 'artifacts', type: 'directory' },
      { name: 'lib', path: 'lib', type: 'directory' },
      { name: 'scripts', path: 'scripts', type: 'directory' },
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'components', path: 'src/components', type: 'directory' },
      { name: 'ChatArea.tsx', path: 'src/components/ChatArea.tsx', type: 'file' },
      { name: 'Header.tsx', path: 'src/components/Header.tsx', type: 'file' },
      { name: 'LandingPage.tsx', path: 'src/components/LandingPage.tsx', type: 'file' },
      { name: 'LibraryPage.tsx', path: 'src/components/LibraryPage.tsx', type: 'file' },
      { name: 'Navbar.tsx', path: 'src/components/Navbar.tsx', type: 'file' },
      { name: 'Sidebar.tsx', path: 'src/components/Sidebar.tsx', type: 'file' },
      { name: 'SignInModal.tsx', path: 'src/components/SignInModal.tsx', type: 'file' },
      { name: 'TenantModal.tsx', path: 'src/components/TenantModal.tsx', type: 'file' },
      { name: 'data', path: 'src/data', type: 'directory' },
      { name: '_worker.ts', path: 'src/_worker.ts', type: 'file' },
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file' },
      { name: 'index.css', path: 'src/index.css', type: 'file' },
      { name: 'main.tsx', path: 'src/main.tsx', type: 'file' },
      { name: 'types.ts', path: 'src/types.ts', type: 'file' },
      { name: 'index.html', path: 'index.html', type: 'file' },
      { name: 'package.json', path: 'package.json', type: 'file' },
    ];

    if (!searchQuery.trim()) {
      return buildHierarchy(list);
    }
    const q = searchQuery.toLowerCase();
    const matched = list.filter(item => item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q));
    return buildHierarchy(matched);
  }, [rawFiles, searchQuery]);

  // Exact Language & File Icon Badges (Matching Reference Image)
  const getFileBadgeIcon = (name: string) => {
    // ⚛️ React Component Atom Icon
    if (name.endsWith('.tsx') || name.endsWith('.jsx')) {
      return (
        <span className="w-4 h-4 mr-2 flex items-center justify-center text-cyan-400 shrink-0" title="React Component">
          ⚛️
        </span>
      );
    }
    // [TS] TypeScript Solid Blue Badge
    if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      return (
        <span className="w-4 h-3.5 mr-2 flex items-center justify-center rounded bg-[#007acc] text-white font-mono font-bold text-[8px] tracking-tighter shrink-0">
          TS
        </span>
      );
    }
    // [JS] JavaScript Solid Yellow Badge
    if (name.endsWith('.js') || name.endsWith('.mjs')) {
      return (
        <span className="w-4 h-3.5 mr-2 flex items-center justify-center rounded bg-[#f7df1e] text-slate-950 font-mono font-bold text-[8px] tracking-tighter shrink-0">
          JS
        </span>
      );
    }
    // [5] HTML5 Solid Orange Badge
    if (name.endsWith('.html') || name.endsWith('.htm')) {
      return (
        <span className="w-3.5 h-3.5 mr-2 flex items-center justify-center rounded bg-[#e34f26] text-white font-mono font-bold text-[9px] shrink-0">
          5
        </span>
      );
    }
    // [3] CSS3 Solid Blue Badge
    if (name.endsWith('.css')) {
      return (
        <span className="w-3.5 h-3.5 mr-2 flex items-center justify-center rounded bg-[#1572b6] text-white font-mono font-bold text-[9px] shrink-0">
          3
        </span>
      );
    }
    // {} JSON Amber Badge
    if (name.endsWith('.json')) {
      return (
        <span className="w-3.5 h-3.5 mr-2 flex items-center justify-center text-yellow-400 font-mono font-bold text-[10px] shrink-0">
          {"{}"}
        </span>
      );
    }
    // Python Snake
    if (name.endsWith('.py')) {
      return <span className="mr-2 text-xs shrink-0">🐍</span>;
    }
    // Settings / Env
    if (name.endsWith('.toml') || name.endsWith('.yaml') || name.endsWith('.yml') || name.startsWith('.env')) {
      return <Settings className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />;
    }
    return <FileText className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />;
  };

  // Recursive Tree Node Renderer (Matching Reference Image Hierarchy)
  const renderTreeNodes = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => {
      const isDir = node.type === 'directory';
      const isExpanded = expandedFolders[node.path] ?? false;
      const isSelected = selectedFile === node.path;

      if (isDir) {
        return (
          <div key={node.path} className="select-none">
            {/* Folder Item */}
            <div 
              onClick={(e) => toggleFolder(node.path, e)}
              className={`flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer text-xs font-sans text-slate-300 transition group hover:bg-slate-800/60 ${
                isSelected ? 'border border-blue-400/80 bg-blue-500/10' : ''
              }`}
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
            >
              <div className="flex items-center gap-2 truncate">
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-slate-400 shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-slate-400 shrink-0" />
                )}
                <span className="font-normal text-slate-200 truncate">{node.name}</span>
              </div>
              <MoreVertical className="w-3.5 h-3.5 text-slate-500 opacity-0 group-hover:opacity-100 transition shrink-0" />
            </div>

            {/* Nested Child Nodes */}
            {isExpanded && node.children && (
              <div>
                {node.children.length > 0 ? (
                  renderTreeNodes(node.children, depth + 1)
                ) : (
                  <div 
                    className="text-[11px] font-sans text-slate-500 italic py-1"
                    style={{ paddingLeft: `${(depth + 1) * 14 + 14}px` }}
                  >
                    (empty)
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      // File Item
      return (
        <div key={node.path} className="select-none">
          <div 
            onClick={() => loadFile(node.path)}
            className={`flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer text-xs font-sans transition group ${
              isSelected 
                ? 'border border-blue-400/80 bg-blue-500/10 text-white font-medium' 
                : 'text-slate-300 hover:bg-slate-800/60'
            }`}
            style={{ paddingLeft: `${depth * 14 + 14}px` }}
          >
            <div className="flex items-center truncate">
              {getFileBadgeIcon(node.name)}
              <span className="truncate">{node.name}</span>
            </div>
            <MoreVertical className="w-3.5 h-3.5 text-slate-500 opacity-0 group-hover:opacity-100 transition shrink-0" />
          </div>
        </div>
      );
    });
  };

  const getSubActionIcon = (type: string) => {
    switch (type) {
      case 'python': return <span className="text-xs mr-1 font-mono">🐍</span>;
      case 'command': return <TerminalIcon className="w-3.5 h-3.5 text-emerald-400 mr-1" />;
      case 'write_file': return <FileCode className="w-3.5 h-3.5 text-cyan-400 mr-1" />;
      case 'read_file': return <Search className="w-3.5 h-3.5 text-purple-400 mr-1" />;
      case 'env_box': return <Key className="w-3.5 h-3.5 text-amber-400 mr-1" />;
      default: return <Brain className="w-3.5 h-3.5 text-amber-300 mr-1" />;
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* MOBILE ADAPTIVE TOP BAR */}
      <div className="md:hidden flex items-center justify-between px-3 py-2.5 bg-slate-900 border-b border-slate-800 z-20 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-amber-400 text-xs">
          <span className="p-1 rounded bg-amber-500/10 border border-amber-500/30">⚡</span>
          SOVEREIGN
        </div>
        <div className="flex gap-1">
          <button onClick={() => setMobileTab('console')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'console' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>Console</button>
          <button onClick={() => setMobileTab('code')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'code' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>Files</button>
          <button onClick={() => setMobileTab('preview')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'preview' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>Preview</button>
        </div>
      </div>

      {/* DESKTOP SIDEBAR */}
      <div className="hidden md:flex w-60 border-r border-slate-800 bg-slate-900/60 flex-col justify-between p-3.5 shrink-0 overflow-hidden">
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-2 font-bold text-amber-400 mb-4 text-sm shrink-0">
            <span className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">⚡</span>
            SOVEREIGN AGENT
          </div>

          <button 
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold py-2 px-3 rounded-lg mb-3 transition shadow shrink-0"
          >
            <Plus className="w-4 h-4" /> New Session
          </button>

          <button 
            onClick={() => {
              setEnvModalData({
                title: "Enter your environment variable to continue",
                fields: [
                  { key: "GITHUB_TOKEN", label: "GitHub Personal Access Token", placeholder: "ghp_...", type: "password" },
                  { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API Token", placeholder: "cfut_...", type: "password" },
                  { key: "E2B_API_KEY", label: "E2B API Key", placeholder: "e2b_...", type: "password" }
                ]
              });
              setShowEnvModal(true);
            }}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold py-2 px-3 rounded-lg text-amber-300 mb-4 transition shrink-0"
          >
            <Key className="w-3.5 h-3.5" /> Environment Box (.env)
          </button>

          <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">
            <span>Recent Sessions ({sessions.length})</span>
            {sessions.length > 0 && (
              <button onClick={clearAllHistory} className="hover:text-red-400 text-[10px]">Clear</button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {sessions.map(s => (
              <div 
                key={s.id}
                onClick={() => setCurrentSessionId(s.id)}
                className={`group flex items-center justify-between p-2 rounded cursor-pointer text-xs truncate transition ${
                  currentSessionId === s.id ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{s.title}</span>
                </div>
                <button onClick={(e) => deleteSingleSession(s.id, e)} className="opacity-0 group-hover:opacity-100 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2 pt-3 border-t border-slate-800 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          E2B Linux Micro-VM Active
        </div>
      </div>

      {/* MIDDLE: CHAT CONSOLE (CHRONOLOGICAL ORDER: PROMPT -> THOUGHTS -> ACCORDIONS -> FINAL REPORT AT BOTTOM) */}
      <div className={`${mobileTab === 'console' ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 border-r border-slate-800 bg-slate-950/40 relative`}>
        <div 
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4"
        >
          <div className="text-xs font-mono text-slate-400 flex items-center justify-between">
            <span>Workspace: <span className="text-amber-400 font-semibold">{currentSessionId}</span></span>
            {isRunning && <span className="text-amber-400 text-xs font-mono animate-pulse">⚡ Agent executing...</span>}
          </div>

          {/* 1. USER PROMPT CARD (TOP) */}
          {userPromptText && (
            <div className="flex justify-end">
              <div className="max-w-xl bg-gradient-to-r from-amber-600 to-amber-500 text-slate-950 font-semibold px-4 py-2.5 rounded-2xl text-xs shadow-md">
                {userPromptText}
              </div>
            </div>
          )}

          {/* 2. REASONING THOUGHTS */}
          {thoughts.map((t, idx) => (
            <div key={idx} className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 font-sans shadow-sm">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px] mb-1">
                <Brain className="w-3.5 h-3.5" /> Reasoning {t.turn ? `(Turn ${t.turn})` : ''}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-slate-300">{t.text}</p>
            </div>
          ))}

          {/* 3. ACTION PILLS & TWO-TIER SUB-ACCORDIONS */}
          <div className="space-y-3">
            {taskGroups.map(group => {
              const isPillOpen = expandedPills[group.id] ?? true;
              const subList = group.subActions || [];

              return (
                <div key={group.id} className="space-y-2">
                  {/* Action Pill Capsule */}
                  <div 
                    onClick={() => togglePill(group.id)}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900 border border-slate-800 hover:border-amber-500/50 cursor-pointer shadow-md transition select-none"
                  >
                    <div className="flex items-center -space-x-0.5 text-xs">
                      {subList.slice(0, 4).map((sub, i) => (
                        <span key={i} className="inline-block">{getSubActionIcon(sub.type)}</span>
                      ))}
                    </div>
                    <span className="text-xs font-mono text-slate-300 font-semibold">
                      {subList.length} action{subList.length === 1 ? '' : 's'}
                    </span>
                    {group.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 ml-1" />}
                    {group.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-400 ml-1" />}
                    {group.status === 'running' && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse ml-1" />}
                    {isPillOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 ml-1" />}
                  </div>

                  {/* Expanded Sub-Accordions */}
                  {isPillOpen && subList.length > 0 && (
                    <div className="border border-slate-800 bg-slate-900/90 rounded-xl p-2.5 space-y-2 shadow-lg">
                      <div className="flex items-center justify-between px-2 pb-1 border-b border-slate-800 text-[11px] font-mono text-slate-400 font-semibold">
                        <span className="text-amber-300">{group.title}</span>
                        <button onClick={() => togglePill(group.id)} className="text-slate-500 hover:text-amber-400 text-[10px]">^ Show less</button>
                      </div>

                      {subList.map(sub => {
                        const subKey = `${group.id}-${sub.id}`;
                        const isSubRowOpen = expandedSubRows[subKey] ?? true;

                        return (
                          <div key={sub.id} className="border border-slate-800/80 bg-slate-950/70 rounded-lg overflow-hidden">
                            <div 
                              onClick={() => toggleSubRow(subKey)}
                              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-800/50 transition"
                            >
                              <div className="flex items-center gap-1.5 text-xs font-mono text-slate-200 truncate">
                                {getSubActionIcon(sub.type)}
                                <span className="truncate">{sub.title}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                                  sub.status === 'completed' ? 'text-emerald-400 bg-emerald-500/10' : sub.status === 'error' ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10 animate-pulse'
                                }`}>
                                  {sub.status.toUpperCase()}
                                </span>
                                {isSubRowOpen ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                              </div>
                            </div>

                            {isSubRowOpen && sub.output && (
                              <div className="px-3 py-2 bg-black font-mono text-[11px] text-slate-300 whitespace-pre-wrap border-t border-slate-800/60 leading-relaxed overflow-x-auto">
                                {sub.output}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 4. FINAL DELIVERY AUDIT REPORT (AT THE VERY BOTTOM, BELOW ALL ACCORDIONS) */}
          {finalReport && (
            <div className="max-w-2xl bg-slate-900 border border-slate-800 p-4 rounded-2xl text-xs text-slate-200 shadow-lg space-y-3 mt-4">
              <div className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
                <Sparkles className="w-3.5 h-3.5" /> Sovereign Agent Delivery Report
              </div>
              <div className="whitespace-pre-wrap leading-relaxed max-w-none text-xs">
                {finalReport}
              </div>

              {(elapsedTime || checkpointId) && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800 text-[11px] font-mono">
                  {elapsedTime && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-slate-300">
                      <Clock className="w-3 h-3 text-amber-400" /> Worked for {elapsedTime}s
                    </span>
                  )}
                  {checkpointId && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-emerald-300">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Checkpoint: {checkpointId}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Bar with Red Stop Button */}
        <div className="p-3.5 border-t border-slate-800 bg-slate-900/40">
          <div className="flex gap-2">
            <input 
              value={prompt}
              disabled={isRunning}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isRunning && runAgent()}
              placeholder={isRunning ? "Agent is running tools in micro-VM..." : "Describe what you want to build or run..."}
              className="flex-1 bg-slate-800/80 border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            {isRunning ? (
              <button onClick={handleKillTask} className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 transition animate-pulse">
                <Square className="w-3.5 h-3.5 fill-current" /> Stop
              </button>
            ) : (
              <button onClick={runAgent} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 transition">
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT WORKSPACE PANELS: REFERENCE-ACCURATE FILE EXPLORER + PREVIEW */}
      <div className={`${mobileTab !== 'console' ? 'flex' : 'hidden md:flex'} flex-1 md:w-[540px] lg:w-[600px] md:flex-initial flex-col bg-slate-900/40 overflow-hidden`}>
        
        <div className="hidden md:flex border-b border-slate-800 bg-slate-900/80 p-1 gap-1 text-xs shrink-0">
          <button onClick={() => setDesktopTab('code')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'code' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <Code className="w-3.5 h-3.5" /> Code Inspector
          </button>
          <button onClick={() => setDesktopTab('preview')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'preview' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <Monitor className="w-3.5 h-3.5" /> Live Preview
          </button>
          <button onClick={() => setDesktopTab('terminal')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'terminal' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <TerminalIcon className="w-3.5 h-3.5" /> Terminal
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* REFERENCE-ACCURATE CODE INSPECTOR (SEARCH BAR + NESTED BADGE ICONS + CODE VIEWER) */}
          {((desktopTab === 'code' && mobileTab === 'console') || mobileTab === 'code') && (
            <div className="flex flex-1 overflow-hidden">
              
              {/* Explorer Sidebar matching screenshot */}
              <div className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col shrink-0 select-none p-2.5 overflow-hidden">
                
                {/* Header matching screenshot: < [≡] Files */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-sm font-bold">‹</span>
                    <span className="p-1 rounded bg-slate-800 text-slate-300 text-xs flex items-center gap-1 font-semibold">
                      <FileText className="w-3.5 h-3.5 text-amber-400" /> Files
                    </span>
                  </div>
                  <button onClick={fetchTree} className="text-slate-400 hover:text-white" title="Refresh files">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Search files and code Input (Matching Reference Image) */}
                <div className="relative mb-3">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search files and code"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Hierarchical Tree matching screenshot */}
                <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
                  {renderTreeNodes(filteredTree)}
                </div>
              </div>

              {/* Code File Display */}
              <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-800 text-xs font-mono text-amber-400 bg-slate-900/40 flex items-center justify-between shrink-0">
                  <span className="font-semibold truncate">{selectedFile || 'src/App.tsx'}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">UTF-8</span>
                </div>
                <pre className="flex-1 p-4 text-xs font-mono text-slate-300 overflow-auto whitespace-pre leading-relaxed bg-slate-950">
                  {fileContent}
                </pre>
              </div>
            </div>
          )}

          {/* LIVE PREVIEW */}
          {((desktopTab === 'preview' && mobileTab === 'console') || mobileTab === 'preview') && (
            <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
              <iframe src={previewUrl} className="flex-1 w-full border-0 bg-slate-950" title="Live Preview" />
            </div>
          )}

          {/* TERMINAL */}
          {((desktopTab === 'terminal' && mobileTab === 'console') || mobileTab === 'terminal') && (
            <div className="flex-1 p-4 bg-black font-mono text-xs text-emerald-400 overflow-y-auto">
              {terminalLogs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          )}
        </div>
      </div>

      {/* FLOATING MOBILE PREVIEW BUTTON */}
      <div className="md:hidden fixed bottom-16 right-4 z-30">
        <button 
          onClick={() => setMobileTab('preview')}
          className="bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-xs border border-amber-300"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open preview
        </button>
      </div>

      {/* ENV MODAL */}
      {showEnvModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <span className="text-amber-400 font-bold text-sm">Enter environment variables</span>
              <X onClick={() => setShowEnvModal(false)} className="w-4 h-4 text-slate-400 cursor-pointer hover:text-white" />
            </div>
            <div className="p-4 space-y-3">
              {(envModalData?.fields || []).map(f => (
                <div key={f.key} className="flex items-center gap-2">
                  <div className="w-1/2 font-mono text-xs text-slate-300 truncate">{f.key}</div>
                  <input 
                    type="password"
                    value={envValues[f.key] || ''}
                    onChange={e => setEnvValues({ ...envValues, [f.key]: e.target.value })}
                    placeholder="Secret value"
                    className="w-1/2 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-slate-800 bg-slate-950 flex justify-end gap-2">
              <button onClick={() => setShowEnvModal(false)} className="px-3 py-1 text-xs text-slate-400 hover:text-white">Cancel</button>
              <button onClick={handleApplyEnv} className="px-4 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
