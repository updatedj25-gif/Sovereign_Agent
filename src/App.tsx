import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  ChevronLeft,
  Key, 
  RefreshCw, 
  Terminal as TerminalIcon, 
  Code, 
  Monitor, 
  X, 
  Send, 
  FileCode,
  Search, 
  Brain, 
  MessageSquare, 
  Trash2, 
  Plus, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Sparkles,
  MoreVertical,
  FileText,
  Settings,
  OctagonAlert,
  PowerOff
} from 'lucide-react';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  countBadge?: number;
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

// Custom Outline Folder SVG matching the screenshot design
function FolderOutline({ className = "w-4 h-4 text-stone-700 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.5 7.5A2 2 0 0 1 4.5 5.5h3.8a2 2 0 0 1 1.4.6l1.6 1.8a1 1 0 0 0 .7.3h7.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" />
    </svg>
  );
}

// React Atom Icon SVG in Cyan matching the screenshot
function ReactAtomIcon({ className = "w-4 h-4 text-[#06B6D4] shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <ellipse cx="12" cy="12" rx="3.2" ry="8.8" stroke="currentColor" strokeWidth="1.6" transform="rotate(0 12 12)" />
      <ellipse cx="12" cy="12" rx="3.2" ry="8.8" stroke="currentColor" strokeWidth="1.6" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="3.2" ry="8.8" stroke="currentColor" strokeWidth="1.6" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

// TypeScript TS Badge matching the screenshot
function TsBadge() {
  return (
    <span className="w-4 h-3.5 flex items-center justify-center rounded-[2px] bg-[#0284C7] text-white font-mono font-bold text-[8px] tracking-tight shrink-0 shadow-2xs">
      TS
    </span>
  );
}

// CSS 3 Badge matching the screenshot
function CssBadge() {
  return (
    <span className="w-4 h-3.5 flex items-center justify-center rounded-[2px] bg-[#2563EB] text-white font-mono font-bold text-[9px] shrink-0 shadow-2xs">
      3
    </span>
  );
}

// HTML 5 Badge matching the screenshot
function HtmlBadge() {
  return (
    <span className="w-4 h-3.5 flex items-center justify-center rounded-[2px] bg-[#EA580C] text-white font-mono font-bold text-[9px] shrink-0 shadow-2xs">
      5
    </span>
  );
}

// JSON Badge matching the screenshot
function JsonBadge() {
  return (
    <span className="w-4 h-3.5 flex items-center justify-center rounded-[2px] bg-[#CA8A04] text-white font-mono font-bold text-[7px] shrink-0 shadow-2xs">
      {"{}"}
    </span>
  );
}

// Builds clean nested hierarchical tree from flat path list
function buildHierarchy(flatList: { name: string; path: string; type?: string; countBadge?: number }[]): FileNode[] {
  const rootNodes: FileNode[] = [];
  const map: Record<string, FileNode> = {};

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
          countBadge: item.countBadge,
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
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [desktopTab, setDesktopTab] = useState<'preview' | 'code' | 'terminal'>('code');
  const [mobileTab, setMobileTab] = useState<'console' | 'preview' | 'code' | 'terminal'>('console');
  
  const [sessions, setSessions] = useState<{ id: string; title: string; createdAt?: number }[]>([
    { id: 'sovereign-session-default', title: 'Main Workspace Session' }
  ]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('sovereign-session-default');
  
  const [rawFiles, setRawFiles] = useState<{ name: string; path: string; type?: string; countBadge?: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string>('src/components');
  const [fileContent, setFileContent] = useState<string>('// Select a file to view code');
  const [previewUrl, setPreviewUrl] = useState<string>('/api/sandbox/render-preview');
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['$ Sovereign Agent Sandbox Initialized', '$ Micro-VM ready']);
  
  // Expanded folders map matching the image layout
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'src': true,
    'src/components': true,
    'artifacts': false,
    'lib': false,
    'scripts': false,
    'data': false,
    'trinityuniverse': false,
  });
  
  const [expandedPills, setExpandedPills] = useState<Record<string, boolean>>({});
  const [expandedSubRows, setExpandedSubRows] = useState<Record<string, boolean>>({});
  
  const [showEnvModal, setShowEnvModal] = useState<boolean>(false);
  const [envModalData, setEnvModalData] = useState<EnvModalData | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.sessions && Array.isArray(data.sessions) && data.sessions.length > 0) {
        setSessions(data.sessions);
      }
    } catch {}
  };

  const fetchTree = async () => {
    try {
      const res = await fetch(`/api/sandbox/tree?sessionId=${currentSessionId}`);
      const data = await res.json();
      if (data.tree && Array.isArray(data.tree) && data.tree.length > 0) {
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
        body: JSON.stringify({ sessionId: currentSessionId, filePath: path, action: 'read' })
      });
      const data = await res.json();
      setFileContent(data.content || `// File: ${path}\n// Exported module definition`);
    } catch {
      setFileContent(`// File: ${path}\nexport default function Module() {\n  return <div>Loaded {path}</div>;\n}`);
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchTree();
    loadFile('src/components/ChatArea.tsx');
  }, [currentSessionId]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [taskGroups, thoughts, finalReport]);

  const createNewSession = async () => {
    const newId = `session-${Date.now().toString(36)}`;
    const newTitle = `Session #${sessions.length + 1}`;
    
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: newId, title: newTitle })
      });
    } catch {}

    setSessions(prev => [{ id: newId, title: newTitle, createdAt: Date.now() }, ...prev]);
    setCurrentSessionId(newId);
    setUserPromptText('');
    setTaskGroups([]);
    setThoughts([]);
    setFinalReport(null);
    setPrompt('');
    setStatusNotice('Created new session.');
    setTimeout(() => setStatusNotice(null), 3000);
  };

  // Clear all session history
  const clearAllHistory = async () => {
    if (!confirm('Clear all chat session history?')) return;
    try {
      await fetch('/api/sessions', { method: 'DELETE' });
    } catch {}
    const defaultId = `session-${Date.now().toString(36)}`;
    const defaultSession = { id: defaultId, title: 'Fresh Session', createdAt: Date.now() };
    setSessions([defaultSession]);
    setCurrentSessionId(defaultId);
    setUserPromptText('');
    setTaskGroups([]);
    setThoughts([]);
    setFinalReport(null);
    setPrompt('');
    setStatusNotice('All session history cleared.');
    setTimeout(() => setStatusNotice(null), 3000);
  };

  // Clear single session history
  const clearSingleSessionHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {}

    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        const freshId = `session-${Date.now().toString(36)}`;
        return [{ id: freshId, title: 'Main Workspace', createdAt: Date.now() }];
      }
      return filtered;
    });

    if (currentSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      if (remaining.length > 0) {
        setCurrentSessionId(remaining[0].id);
      } else {
        const freshId = `session-${Date.now().toString(36)}`;
        setCurrentSessionId(freshId);
      }
      setUserPromptText('');
      setTaskGroups([]);
      setThoughts([]);
      setFinalReport(null);
    }
    setStatusNotice(`Cleared session history.`);
    setTimeout(() => setStatusNotice(null), 3000);
  };

  // Kill Active Running Process or Agent Task
  const handleKillProcess = async () => {
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
    setStatusNotice('Process killed by user.');
    setTerminalLogs(prev => [...prev, `[KILL] Task in session "${currentSessionId}" terminated.`]);
    setTimeout(() => setStatusNotice(null), 4000);
  };

  const handleApplyEnv = async () => {
    try {
      await fetch('/api/agent/env-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, envs: envValues })
      });
      setShowEnvModal(false);
      fetchTree();
      setStatusNotice('Environment secrets applied.');
      setTimeout(() => setStatusNotice(null), 3000);
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
    setStatusNotice(null);
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
                setFinalReport(data.finalResponse || 'Task finished execution.');
                if (data.elapsedSeconds) setElapsedTime(data.elapsedSeconds);
                if (data.checkpointId) setCheckpointId(data.checkpointId);
              }
              if (data.type === 'aborted') {
                setIsRunning(false);
                setStatusNotice('Agent execution stopped.');
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(err);
      }
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
    setSelectedFile(path);
    setExpandedFolders(prev => ({ ...prev, [path]: !prev[path] }));
  };

  // Complete file tree matching the exact structure in the attached screenshot
  const filteredTree = useMemo(() => {
    const list: { name: string; path: string; type?: string; countBadge?: number }[] = rawFiles.length > 0 ? rawFiles : [
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
      { name: 'trinityuniverse', path: 'trinityuniverse', type: 'directory', countBadge: 4 },
      { name: 'index.html', path: 'index.html', type: 'file' },
      { name: 'metadata.json', path: 'metadata.json', type: 'file' },
    ];

    if (!searchQuery.trim()) {
      return buildHierarchy(list);
    }
    const q = searchQuery.toLowerCase();
    const matched = list.filter(item => item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q));
    return buildHierarchy(matched);
  }, [rawFiles, searchQuery]);

  // Exact Language & File Icon Badges matching the image
  const getFileBadgeIcon = (name: string) => {
    if (name.endsWith('.tsx') || name.endsWith('.jsx')) {
      return <ReactAtomIcon className="w-4 h-4 text-[#06B6D4] mr-2 shrink-0" />;
    }
    if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      return (
        <span className="mr-2 shrink-0">
          <TsBadge />
        </span>
      );
    }
    if (name.endsWith('.css')) {
      return (
        <span className="mr-2 shrink-0">
          <CssBadge />
        </span>
      );
    }
    if (name.endsWith('.html') || name.endsWith('.htm')) {
      return (
        <span className="mr-2 shrink-0">
          <HtmlBadge />
        </span>
      );
    }
    if (name.endsWith('.json')) {
      return (
        <span className="mr-2 shrink-0">
          <JsonBadge />
        </span>
      );
    }
    if (name.endsWith('.py')) {
      return <span className="mr-2 text-xs shrink-0">🐍</span>;
    }
    return <FileText className="w-3.5 h-3.5 text-stone-500 mr-2 shrink-0" />;
  };

  // Recursive Tree Node Renderer matching the attached screenshot
  const renderTreeNodes = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => {
      const isDir = node.type === 'directory';
      const isExpanded = expandedFolders[node.path] ?? false;
      const isSelected = selectedFile === node.path;

      if (isDir) {
        return (
          <div key={node.path} className="select-none">
            <div 
              onClick={(e) => toggleFolder(node.path, e)}
              className={`flex items-center justify-between py-1 px-2 rounded-lg cursor-pointer text-[13px] font-sans transition group ${
                isSelected 
                  ? 'border border-[#38BDF8] bg-[#F0F9FF]/80 text-stone-900 font-medium shadow-2xs' 
                  : 'text-stone-800 hover:bg-[#EBE4D6]'
              }`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <div className="flex items-center gap-2.5 truncate">
                <FolderOutline className="w-4 h-4 text-stone-800 shrink-0" />
                <span className="text-stone-800 truncate">{node.name}</span>
              </div>
              
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {node.countBadge && (
                  <span className="px-1.5 py-0.2 rounded bg-[#FEF08A] text-[#854D0E] font-bold text-[10px] leading-tight">
                    {node.countBadge}
                  </span>
                )}
                <MoreVertical className="w-4 h-4 text-stone-700 shrink-0 cursor-pointer hover:text-stone-950" />
              </div>
            </div>

            {isExpanded && node.children && (
              <div>
                {node.children.length > 0 ? (
                  renderTreeNodes(node.children, depth + 1)
                ) : (
                  <div 
                    className="text-[11px] font-sans text-stone-400 italic py-1"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 12}px` }}
                  >
                    (empty)
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      return (
        <div key={node.path} className="select-none">
          <div 
            onClick={() => loadFile(node.path)}
            className={`flex items-center justify-between py-1 px-2 rounded-lg cursor-pointer text-[13px] font-sans transition group ${
              isSelected 
                ? 'border border-[#38BDF8] bg-[#F0F9FF]/80 text-stone-900 font-medium shadow-2xs' 
                : 'text-stone-800 hover:bg-[#EBE4D6]'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <div className="flex items-center truncate">
              {getFileBadgeIcon(node.name)}
              <span className="truncate">{node.name}</span>
            </div>
            <MoreVertical className="w-4 h-4 text-stone-700 shrink-0 cursor-pointer hover:text-stone-950 ml-2" />
          </div>
        </div>
      );
    });
  };

  const getSubActionIcon = (type: string) => {
    switch (type) {
      case 'python': return <span className="text-xs mr-1 font-mono">🐍</span>;
      case 'command': return <TerminalIcon className="w-3.5 h-3.5 text-emerald-600 mr-1" />;
      case 'write_file': return <FileCode className="w-3.5 h-3.5 text-sky-600 mr-1" />;
      case 'read_file': return <Search className="w-3.5 h-3.5 text-purple-600 mr-1" />;
      case 'env_box': return <Key className="w-3.5 h-3.5 text-amber-600 mr-1" />;
      default: return <Brain className="w-3.5 h-3.5 text-amber-700 mr-1" />;
    }
  };

  return (
    <div id="sovereign-agent-app" className="flex flex-col md:flex-row h-screen w-screen bg-[#FAF7F0] text-stone-900 font-sans overflow-hidden">
      
      {/* MOBILE TOP BAR */}
      <div id="mobile-topbar" className="md:hidden flex items-center justify-between px-3 py-2.5 bg-[#F2ECE1] border-b border-[#E3DCCF] z-20 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-amber-800 text-xs">
          <span className="p-1 rounded bg-amber-500/20 border border-amber-600/30">⚡</span>
          SOVEREIGN
        </div>
        <div className="flex items-center gap-1">
          {isRunning && (
            <button 
              id="mobile-kill-btn"
              onClick={handleKillProcess}
              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-bold flex items-center gap-1 shadow-sm"
              title="Kill active process"
            >
              <PowerOff className="w-3 h-3" /> Kill
            </button>
          )}
          <button onClick={() => setMobileTab('console')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'console' ? 'bg-amber-600 text-white font-bold' : 'bg-[#E5DEC9] text-stone-800'}`}>Chat</button>
          <button onClick={() => setMobileTab('code')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'code' ? 'bg-amber-600 text-white font-bold' : 'bg-[#E5DEC9] text-stone-800'}`}>Files</button>
          <button onClick={() => setMobileTab('preview')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'preview' ? 'bg-amber-600 text-white font-bold' : 'bg-[#E5DEC9] text-stone-800'}`}>Preview</button>
        </div>
      </div>

      {/* 1. LEFT SIDEBAR: CREAMY THEME WITH CLEAR HISTORY BUTTONS ON EACH SESSION */}
      <div id="sidebar-panel" className="hidden md:flex w-64 border-r border-[#E3DCCF] bg-[#F4EFE6] flex-col justify-between p-3.5 shrink-0 overflow-hidden select-none">
        <div className="flex flex-col h-full overflow-hidden">
          
          {/* Logo / Header */}
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div className="flex items-center gap-2 font-bold text-amber-900 text-sm">
              <span className="p-1.5 rounded-lg bg-amber-500/20 border border-amber-600/30 text-amber-700">⚡</span>
              SOVEREIGN AGENT
            </div>
            <button 
              onClick={fetchSessions} 
              className="p-1 rounded text-stone-500 hover:text-stone-800 hover:bg-[#EBE4D6] transition"
              title="Refresh sessions"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* New Session Button */}
          <button 
            id="new-session-btn"
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold py-2 px-3 rounded-lg mb-2.5 transition shadow-xs shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> New Session
          </button>

          {/* Environment Box Button */}
          <button 
            id="env-box-btn"
            onClick={() => {
              setEnvModalData({
                title: "Configure Environment Secrets",
                fields: [
                  { key: "GITHUB_TOKEN", label: "GitHub Personal Access Token", placeholder: "ghp_...", type: "password" },
                  { key: "CLOUDFLARE_API_KEY", label: "Cloudflare API Key / Token", placeholder: "cfut_...", type: "password" },
                  { key: "E2B_API_KEY", label: "E2B Sandbox API Key", placeholder: "e2b_...", type: "password" },
                  { key: "GEMINI_API_KEY", label: "Gemini AI API Key", placeholder: "AIza...", type: "password" }
                ]
              });
              setShowEnvModal(true);
            }}
            className="w-full flex items-center justify-center gap-2 bg-[#EAE2D2] hover:bg-[#E2D8C6] border border-[#D5C9B3] text-xs font-semibold py-2 px-3 rounded-lg text-amber-950 mb-3.5 transition shrink-0 cursor-pointer"
          >
            <Key className="w-3.5 h-3.5 text-amber-700" /> Environment Box (.env)
          </button>

          {/* Sessions List Header with Clear All Button */}
          <div className="flex items-center justify-between text-[11px] font-bold text-stone-600 uppercase tracking-wider mb-2 px-1 shrink-0">
            <span>Sessions ({sessions.length})</span>
            {sessions.length > 0 && (
              <button 
                id="clear-all-history-btn"
                onClick={clearAllHistory} 
                className="text-[10px] font-medium text-rose-700 hover:text-rose-800 hover:underline px-1 py-0.5 rounded cursor-pointer"
                title="Clear all session history"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Sessions History List with dedicated "Clear History" button on EACH item */}
          <div id="session-history-list" className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {sessions.map(s => {
              const isCurrent = currentSessionId === s.id;
              return (
                <div 
                  key={s.id}
                  id={`session-item-${s.id}`}
                  onClick={() => setCurrentSessionId(s.id)}
                  className={`group relative flex items-center justify-between p-2 rounded-lg cursor-pointer text-xs transition border ${
                    isCurrent 
                      ? 'bg-[#EAE1CF] text-amber-950 font-semibold border-amber-500/40 shadow-xs' 
                      : 'text-stone-800 bg-[#FAF7F0]/60 hover:bg-[#EBE3D4] border-transparent'
                  }`}
                  title={`Open session ${s.title}`}
                >
                  <div className="flex items-center gap-2 truncate pr-6">
                    <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-amber-700' : 'text-stone-500'}`} />
                    <span className="truncate">{s.title}</span>
                  </div>

                  {/* CLEAR HISTORY BUTTON ON EACH SESSION ITEM */}
                  <button 
                    id={`clear-session-${s.id}`}
                    onClick={(e) => clearSingleSessionHistory(s.id, e)} 
                    className="opacity-70 group-hover:opacity-100 p-1 rounded hover:bg-rose-100 hover:text-rose-700 text-stone-500 transition shrink-0 ml-1"
                    title="Clear this session history"
                    aria-label="Clear session history"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="text-[11px] text-stone-600 font-mono flex items-center justify-between pt-3 border-t border-[#E3DCCF] shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
            <span>Micro-VM Active</span>
          </div>
          <span className="text-[10px] text-stone-500">v2.0</span>
        </div>
      </div>

      {/* 2. CENTER: CHAT SPACE (CREAMY PAPER COLOR PALETTE + PROMINENT KILL BUTTON) */}
      <div id="chat-interface-panel" className={`${mobileTab === 'console' ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 border-r border-[#E3DCCF] bg-[#FAF7F0] relative`}>
        
        {/* Chat Header Status & Actions Bar */}
        <div id="chat-header-bar" className="px-4 py-2.5 bg-[#F4EFE6] border-b border-[#E3DCCF] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-stone-700">
            <span className="font-semibold text-stone-900">Workspace:</span>
            <span className="px-2 py-0.5 rounded bg-[#EBE3D4] border border-[#DDD4C1] text-amber-900 font-bold truncate max-w-[200px]">
              {currentSessionId}
            </span>
            {isRunning && (
              <span className="flex items-center gap-1 text-amber-700 font-sans font-semibold text-xs animate-pulse">
                <span className="w-2 h-2 rounded-full bg-amber-600"></span> Executing ReAct loop...
              </span>
            )}
          </div>

          {/* DEDICATED KILL / ABORT PROCESS BUTTON IN CHAT SPACE */}
          <div className="flex items-center gap-2">
            {isRunning ? (
              <button 
                id="chat-header-kill-btn"
                onClick={handleKillProcess}
                className="bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition shadow-sm animate-pulse cursor-pointer"
                title="Kill and stop the active agent process"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>Kill Process</span>
              </button>
            ) : (
              <button 
                id="chat-header-reset-btn"
                onClick={handleKillProcess}
                className="bg-[#EBE3D4] hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 border border-[#DCD3C0] text-stone-700 font-medium px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 transition cursor-pointer"
                title="Interrupt/Kill running sandbox tasks"
              >
                <PowerOff className="w-3 h-3 text-stone-500 hover:text-rose-600" />
                <span>Kill Task</span>
              </button>
            )}
          </div>
        </div>

        {/* Notification Toast if process is killed or cleared */}
        {statusNotice && (
          <div className="bg-amber-100 border-b border-amber-300 px-4 py-1.5 text-xs text-amber-900 font-medium flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <OctagonAlert className="w-3.5 h-3.5 text-amber-700" /> {statusNotice}
            </span>
            <button onClick={() => setStatusNotice(null)} className="text-amber-800 hover:text-stone-900 font-bold">×</button>
          </div>
        )}

        {/* Chat Scroll Area */}
        <div 
          ref={chatScrollRef}
          id="chat-messages-container"
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-[#FAF7F0]"
        >
          {/* Welcome Card if empty */}
          {!userPromptText && taskGroups.length === 0 && thoughts.length === 0 && (
            <div className="text-center py-12 px-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-600/30 flex items-center justify-center mx-auto mb-3 text-amber-800 text-xl font-bold">
                ⚡
              </div>
              <h2 className="text-sm font-bold text-stone-900 mb-1">Sovereign Agent Workspace</h2>
              <p className="text-xs text-stone-600 mb-4 leading-relaxed">
                Autonomous code generation, micro-VM sandbox execution, perception engine, and AST patching.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button 
                  onClick={() => setPrompt("Verify project build status and inspect current directory")} 
                  className="px-3 py-1.5 rounded-lg bg-[#F2EBDC] hover:bg-[#EBE2D0] border border-[#DDD3BF] text-xs text-stone-800 text-left transition"
                >
                  Verify build status
                </button>
                <button 
                  onClick={() => setPrompt("Check git status and active branch")} 
                  className="px-3 py-1.5 rounded-lg bg-[#F2EBDC] hover:bg-[#EBE2D0] border border-[#DDD3BF] text-xs text-stone-800 text-left transition"
                >
                  Check git status
                </button>
              </div>
            </div>
          )}

          {/* 1. USER PROMPT CARD */}
          {userPromptText && (
            <div className="flex justify-end">
              <div className="max-w-xl bg-gradient-to-r from-amber-600 to-amber-500 text-white font-medium px-4 py-2.5 rounded-2xl text-xs shadow-sm">
                {userPromptText}
              </div>
            </div>
          )}

          {/* 2. REASONING THOUGHTS */}
          {thoughts.map((t, idx) => (
            <div key={idx} className="bg-[#F5EFE4] border border-[#E3D9C6] rounded-xl p-3.5 text-xs text-stone-800 font-sans shadow-xs">
              <div className="flex items-center gap-1.5 text-amber-800 font-bold text-[11px] mb-1.5">
                <Brain className="w-3.5 h-3.5 text-amber-700" /> Reasoning {t.turn ? `(Turn ${t.turn})` : ''}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-stone-800">{t.text}</p>
            </div>
          ))}

          {/* 3. ACTION PILLS & TWO-TIER SUB-ACCORDIONS */}
          <div className="space-y-3">
            {taskGroups.map(group => {
              const isPillOpen = expandedPills[group.id] ?? true;
              const subList = group.subActions || [];

              return (
                <div key={group.id} className="space-y-2">
                  <div 
                    onClick={() => togglePill(group.id)}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#F3EDE1] border border-[#DFD5C1] hover:border-amber-600 cursor-pointer shadow-xs transition select-none"
                  >
                    <div className="flex items-center -space-x-0.5 text-xs">
                      {subList.slice(0, 4).map((sub, i) => (
                        <span key={i} className="inline-block">{getSubActionIcon(sub.type)}</span>
                      ))}
                    </div>
                    <span className="text-xs font-mono text-stone-800 font-semibold">
                      {subList.length} action{subList.length === 1 ? '' : 's'}
                    </span>
                    {group.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 ml-1" />}
                    {group.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-600 ml-1" />}
                    {group.status === 'running' && <span className="w-2 h-2 rounded-full bg-amber-600 animate-pulse ml-1" />}
                    {isPillOpen ? <ChevronDown className="w-3.5 h-3.5 text-stone-500 ml-1" /> : <ChevronRight className="w-3.5 h-3.5 text-stone-500 ml-1" />}
                  </div>

                  {isPillOpen && subList.length > 0 && (
                    <div className="border border-[#E0D6C2] bg-[#F5EFE4] rounded-xl p-2.5 space-y-2 shadow-xs">
                      <div className="flex items-center justify-between px-2 pb-1 border-b border-[#E3D9C6] text-[11px] font-mono text-stone-700 font-semibold">
                        <span className="text-amber-900">{group.title}</span>
                        <button onClick={() => togglePill(group.id)} className="text-stone-500 hover:text-amber-800 text-[10px]">^ Show less</button>
                      </div>

                      {subList.map(sub => {
                        const subKey = `${group.id}-${sub.id}`;
                        const isSubRowOpen = expandedSubRows[subKey] ?? true;

                        return (
                          <div key={sub.id} className="border border-[#DFD5C1] bg-[#FAF7F0] rounded-lg overflow-hidden">
                            <div 
                              onClick={() => toggleSubRow(subKey)}
                              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#EFE7D7] transition"
                            >
                              <div className="flex items-center gap-1.5 text-xs font-mono text-stone-900 truncate">
                                {getSubActionIcon(sub.type)}
                                <span className="truncate">{sub.title}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                                  sub.status === 'completed' 
                                    ? 'text-emerald-700 bg-emerald-100 border border-emerald-300' 
                                    : sub.status === 'error' 
                                    ? 'text-rose-700 bg-rose-100 border border-rose-300' 
                                    : 'text-amber-800 bg-amber-100 border border-amber-300 animate-pulse'
                                }`}>
                                  {sub.status.toUpperCase()}
                                </span>
                                {isSubRowOpen ? <ChevronDown className="w-3 h-3 text-stone-500" /> : <ChevronRight className="w-3 h-3 text-stone-500" />}
                              </div>
                            </div>

                            {isSubRowOpen && sub.output && (
                              <div className="px-3 py-2 bg-[#1C1917] font-mono text-[11px] text-[#E7E5E4] whitespace-pre-wrap border-t border-[#36302A] leading-relaxed overflow-x-auto">
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

          {/* 4. FINAL DELIVERY AUDIT REPORT */}
          {finalReport && (
            <div className="max-w-2xl bg-[#F5EFE4] border border-[#E0D5C0] p-4 rounded-2xl text-xs text-stone-900 shadow-xs space-y-3 mt-4">
              <div className="font-bold text-amber-900 flex items-center gap-1.5 text-xs">
                <Sparkles className="w-3.5 h-3.5 text-amber-700" /> Sovereign Agent Delivery Report
              </div>
              <div className="whitespace-pre-wrap leading-relaxed max-w-none text-xs text-stone-800">
                {finalReport}
              </div>

              {(elapsedTime || checkpointId) && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E3D9C6] text-[11px] font-mono">
                  {elapsedTime && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FAF7F0] border border-[#DFD5C1] text-stone-800">
                      <Clock className="w-3 h-3 text-amber-700" /> Worked for {elapsedTime}s
                    </span>
                  )}
                  {checkpointId && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FAF7F0] border border-[#DFD5C1] text-emerald-800 font-semibold">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Checkpoint: {checkpointId}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat Space Bottom Input Bar with Kill & Send Controls */}
        <div id="chat-input-bar" className="p-3.5 border-t border-[#E3DCCF] bg-[#F4EFE6]">
          <div className="flex gap-2">
            <input 
              id="prompt-input"
              value={prompt}
              disabled={isRunning}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isRunning && runAgent()}
              placeholder={isRunning ? "Agent is running tools in micro-VM... Click Kill to interrupt." : "Describe what you want to build or run..."}
              className="flex-1 bg-[#FCFAF6] border border-[#D9CDB8] rounded-lg px-3.5 py-2 text-xs text-stone-900 placeholder-stone-500 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-500"
            />
            {isRunning ? (
              <button 
                id="kill-task-action-btn"
                onClick={handleKillProcess} 
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 transition shadow-sm animate-pulse cursor-pointer"
                title="Kill active agent execution"
              >
                <PowerOff className="w-3.5 h-3.5" /> Kill Process
              </button>
            ) : (
              <button 
                id="send-prompt-btn"
                onClick={runAgent} 
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. RIGHT WORKSPACE: EXACT FILE EXPLORER & CODE INSPECTOR (MATCHING ATTACHED IMAGE) */}
      <div id="file-explorer-panel" className={`${mobileTab !== 'console' ? 'flex' : 'hidden md:flex'} flex-1 md:w-[560px] lg:w-[620px] md:flex-initial flex-col bg-[#FAF8F5] border-l border-[#E5E0D8] overflow-hidden`}>
        
        {/* Desktop Top Header Tab Selector */}
        <div className="hidden md:flex border-b border-[#E5E0D8] bg-[#F4EFE6] p-1 gap-1 text-xs shrink-0">
          <button 
            id="tab-code"
            onClick={() => setDesktopTab('code')} 
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${
              desktopTab === 'code' ? 'bg-[#FAF8F5] text-amber-900 font-bold shadow-xs border-b-2 border-amber-600' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Code className="w-3.5 h-3.5 text-blue-700" /> Files & Code
          </button>
          <button 
            id="tab-preview"
            onClick={() => setDesktopTab('preview')} 
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${
              desktopTab === 'preview' ? 'bg-[#FAF8F5] text-amber-900 font-bold shadow-xs border-b-2 border-amber-600' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Monitor className="w-3.5 h-3.5 text-emerald-700" /> Live Preview
          </button>
          <button 
            id="tab-terminal"
            onClick={() => setDesktopTab('terminal')} 
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${
              desktopTab === 'terminal' ? 'bg-[#FAF8F5] text-amber-900 font-bold shadow-xs border-b-2 border-amber-600' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5 text-amber-700" /> Terminal
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* CODE INSPECTOR & FILE EXPLORER (MATCHING ATTACHED IMAGE) */}
          {((desktopTab === 'code' && mobileTab === 'console') || mobileTab === 'code') && (
            <div className="flex flex-1 flex-col md:flex-row overflow-hidden bg-[#FAF8F5]">
              
              {/* File Explorer (Matching Attached Mobile/Desktop Screenshot) */}
              <div className="w-full md:w-[320px] border-r border-[#E5E0D8] bg-[#FAF8F5] flex flex-col shrink-0 select-none p-3 overflow-hidden">
                
                {/* 1. Header with Back Chevron and [ 📑 Files ] pill */}
                <div className="flex items-center gap-3 mb-3.5">
                  <button 
                    onClick={fetchTree}
                    className="p-1 rounded-full text-stone-700 hover:bg-stone-200/60 transition"
                    title="Back / Refresh"
                  >
                    <ChevronLeft className="w-5 h-5 text-stone-800" />
                  </button>

                  <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl border border-stone-300/80 bg-[#F4EFE6] text-stone-900 text-xs font-semibold shadow-2xs">
                    <span className="font-mono text-stone-700 text-sm leading-none">‹≡</span>
                    <span>Files</span>
                  </div>
                </div>

                {/* 2. Full-Width Search Input with Right MoreVertical Menu Icon */}
                <div className="flex items-center gap-2 mb-3.5">
                  <div className="flex-1 relative">
                    <input 
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search files and code"
                      className="w-full bg-white border border-stone-300/90 rounded-lg px-3 py-1.5 text-[13px] text-stone-900 placeholder-stone-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 shadow-2xs"
                    />
                  </div>
                  <button className="p-1 text-stone-700 hover:text-stone-950 transition" title="Options">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>

                {/* 3. Hierarchical File Tree List */}
                <div className="flex-1 overflow-y-auto space-y-0.5 pr-1 text-stone-800">
                  {renderTreeNodes(filteredTree)}
                </div>
              </div>

              {/* Code File Display Panel */}
              <div className="hidden md:flex flex-1 flex-col bg-[#FCFAF6] overflow-hidden">
                <div className="px-4 py-2 border-b border-[#E5E0D8] text-xs font-mono text-amber-900 bg-[#F4EFE6] flex items-center justify-between shrink-0">
                  <span className="font-semibold truncate">{selectedFile || 'src/components/ChatArea.tsx'}</span>
                  <span className="text-[10px] text-stone-500 shrink-0">UTF-8</span>
                </div>
                <pre className="flex-1 p-4 text-xs font-mono text-stone-800 overflow-auto whitespace-pre leading-relaxed bg-[#FCFAF6]">
                  {fileContent}
                </pre>
              </div>
            </div>
          )}

          {/* LIVE PREVIEW */}
          {((desktopTab === 'preview' && mobileTab === 'console') || mobileTab === 'preview') && (
            <div className="flex-1 flex flex-col bg-[#FCFAF6] overflow-hidden">
              <iframe src={previewUrl} className="flex-1 w-full border-0 bg-white" title="Live Preview" />
            </div>
          )}

          {/* TERMINAL */}
          {((desktopTab === 'terminal' && mobileTab === 'console') || mobileTab === 'terminal') && (
            <div className="flex-1 p-4 bg-[#1C1917] font-mono text-xs text-[#E7E5E4] overflow-y-auto space-y-1">
              <div className="text-amber-400 font-bold mb-2 pb-1 border-b border-stone-800 flex items-center justify-between">
                <span>E2B Sandbox Micro-VM Console</span>
                <span className="text-[10px] text-stone-400">Session: {currentSessionId}</span>
              </div>
              {terminalLogs.map((log, i) => (
                <div key={i} className={log.startsWith('[KILL]') ? 'text-rose-400 font-semibold' : 'text-emerald-400'}>
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* FLOATING MOBILE PREVIEW BUTTON */}
      <div className="md:hidden fixed bottom-16 right-4 z-30">
        <button 
          onClick={() => setMobileTab('preview')}
          className="bg-amber-600 text-white font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-xs border border-amber-500"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open preview
        </button>
      </div>

      {/* ENV MODAL */}
      {showEnvModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#FAF7F0] border border-[#DCD3BF] rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[#E3DCCF] bg-[#F4EFE6]">
              <span className="text-amber-900 font-bold text-sm">Environment Variables</span>
              <X onClick={() => setShowEnvModal(false)} className="w-4 h-4 text-stone-500 cursor-pointer hover:text-stone-900" />
            </div>
            <div className="p-4 space-y-3 bg-[#FAF7F0]">
              {(envModalData?.fields || []).map(f => (
                <div key={f.key} className="space-y-1">
                  <label className="block font-mono text-xs text-stone-700 font-medium">{f.label || f.key}</label>
                  <input 
                    type="password"
                    value={envValues[f.key] || ''}
                    onChange={e => setEnvValues({ ...envValues, [f.key]: e.target.value })}
                    placeholder={f.placeholder || "Secret key"}
                    className="w-full bg-[#FCFAF6] border border-[#D9CDB8] rounded px-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:border-amber-600"
                  />
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-[#E3DCCF] bg-[#F4EFE6] flex justify-end gap-2">
              <button onClick={() => setShowEnvModal(false)} className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-900">Cancel</button>
              <button onClick={handleApplyEnv} className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-xs">Apply Secrets</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
