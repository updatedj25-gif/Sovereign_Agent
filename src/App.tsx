import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
  File, 
  Key, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  Terminal as TerminalIcon, 
  Code, 
  Monitor, 
  X, 
  Send, 
  FileCode, 
  FileJson, 
  FileText, 
  Search, 
  Brain, 
  MessageSquare, 
  Trash2, 
  Square, 
  Plus, 
  FolderPlus, 
  FilePlus, 
  Minimize2,
  Settings,
  Layers,
  Sparkles
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

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [thoughts, setThoughts] = useState<{ text: string; turn?: number }[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [desktopTab, setDesktopTab] = useState<'code' | 'preview' | 'terminal'>('code');
  const [mobileTab, setMobileTab] = useState<'console' | 'preview' | 'code' | 'terminal'>('code');
  
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('sovereign-session-default');
  
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('package.json');
  const [fileContent, setFileContent] = useState<string>('// Select a file from the VS Code Explorer');
  const [previewUrl, setPreviewUrl] = useState<string>('/api/sandbox/render-preview');
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['$ Sovereign Agent VS Code Engine Ready']);
  
  // Folders expanded state (all expanded by default for full visibility)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'root': true,
    'lib': true,
    'src': true,
    'workers': true,
    'stats': true,
    'math': true,
    'adebola': true,
    'math_results': true,
    'Sovereign_Agent': true
  });
  
  const [expandedPills, setExpandedPills] = useState<Record<string, boolean>>({});
  const [showEnvModal, setShowEnvModal] = useState<boolean>(false);
  const [envModalData, setEnvModalData] = useState<EnvModalData | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

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
        setFileTree(data.tree);
        // Auto-expand all discovered directories
        const newExpanded: Record<string, boolean> = { ...expandedFolders };
        const scan = (nodes: FileNode[]) => {
          for (const n of nodes) {
            if (n.type === 'directory') {
              newExpanded[n.path] = true;
              if (n.children) scan(n.children);
            }
          }
        };
        scan(data.tree);
        setExpandedFolders(newExpanded);
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
    loadFile('package.json');
  }, [currentSessionId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [taskGroups, thoughts]);

  const toggleFolder = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const collapseAllFolders = () => {
    setExpandedFolders({});
  };

  const expandAllFolders = () => {
    const newExpanded: Record<string, boolean> = {};
    const scan = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.type === 'directory') {
          newExpanded[n.path] = true;
          if (n.children) scan(n.children);
        }
      }
    };
    scan(fileTree);
    setExpandedFolders(newExpanded);
  };

  const runAgent = async () => {
    if (!prompt.trim() || isRunning) return;
    const userPrompt = prompt;
    setPrompt('');
    setTaskGroups([]);
    setThoughts([]);
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
              if (data.actions) setTaskGroups(data.actions);
              if (data.type === 'env_modal_open' && data.envBox) {
                setEnvModalData(data.envBox);
                setShowEnvModal(true);
              }
              if (data.type === 'preview_ready') {
                setPreviewUrl(`/api/sandbox/render-preview?sessionId=${currentSessionId}&t=${Date.now()}`);
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

  // VS Code Language / File Icon Resolver (Matching Screenshot 2)
  const getVSCodeFileIcon = (name: string) => {
    if (name === 'package.json' || name.endsWith('.json')) {
      return <span className="text-yellow-400 font-mono font-bold text-xs mr-1.5 shrink-0">{"{}"}</span>;
    }
    if (name.endsWith('.toml') || name.endsWith('.yaml') || name.endsWith('.yml') || name === '.env' || name === '.env.example') {
      return <Settings className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />;
    }
    if (name.endsWith('.py')) {
      return <span className="text-xs mr-1.5 shrink-0">🐍</span>;
    }
    if (name.endsWith('.tsx') || name.endsWith('.jsx')) {
      return <span className="text-cyan-400 font-mono font-bold text-[11px] mr-1.5 shrink-0">TSX</span>;
    }
    if (name.endsWith('.ts')) {
      return <span className="text-blue-400 font-mono font-bold text-[11px] mr-1.5 shrink-0">TS</span>;
    }
    if (name.endsWith('.js') || name.endsWith('.mjs')) {
      return <span className="text-amber-300 font-mono font-bold text-[11px] mr-1.5 shrink-0">JS</span>;
    }
    if (name.endsWith('.css')) {
      return <span className="text-sky-400 font-mono font-bold text-[11px] mr-1.5 shrink-0">#</span>;
    }
    if (name.endsWith('.xml') || name.endsWith('.html')) {
      return <span className="text-orange-400 font-mono font-bold text-[11px] mr-1.5 shrink-0">&lt;&gt;</span>;
    }
    return <FileText className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />;
  };

  // Hierarchical Recursive Tree Renderer with Indentation Guides (VS Code Replica)
  const renderVSCodeTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => {
      const isDir = node.type === 'directory';
      const isExpanded = expandedFolders[node.path] ?? true;

      if (isDir) {
        return (
          <div key={node.path} className="select-none">
            {/* Folder Row */}
            <div 
              onClick={(e) => toggleFolder(node.path, e)}
              className="flex items-center gap-1.5 py-1 px-1.5 hover:bg-[#2a2d2e] cursor-pointer text-xs font-mono text-[#cccccc] transition group rounded-sm"
              style={{ paddingLeft: `${depth * 14 + 6}px` }}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className="font-sans text-xs text-slate-200 truncate">{node.name}</span>
            </div>

            {/* Nested Children */}
            {isExpanded && node.children && (
              <div className="relative border-l border-slate-800/60 ml-[11px]">
                {node.children.length > 0 ? (
                  renderVSCodeTree(node.children, depth + 1)
                ) : (
                  <div 
                    className="text-[11px] font-mono text-slate-500 italic py-0.5"
                    style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
                  >
                    (empty)
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      // File Row
      return (
        <div key={node.path} className="select-none">
          <div 
            onClick={() => loadFile(node.path)}
            className={`flex items-center py-1 px-1.5 cursor-pointer text-xs font-mono transition rounded-sm ${
              selectedFile === node.path 
                ? 'bg-[#094771] text-white font-medium' 
                : 'text-[#cccccc] hover:bg-[#2a2d2e]'
            }`}
            style={{ paddingLeft: `${depth * 14 + 18}px` }}
          >
            {getVSCodeFileIcon(node.name)}
            <span className="truncate">{node.name}</span>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-[#181818] text-[#cccccc] font-sans overflow-hidden">
      
      {/* MOBILE TOP TAB BAR */}
      <div className="md:hidden flex items-center justify-between px-3 py-2 bg-[#1f1f1f] border-b border-[#2b2b2b] z-20 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-amber-400 text-xs">
          <span className="p-1 rounded bg-amber-500/10 border border-amber-500/30">⚡</span>
          SOVEREIGN
        </div>
        <div className="flex gap-1">
          <button onClick={() => setMobileTab('console')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'console' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#2b2b2b] text-slate-300'}`}>Console</button>
          <button onClick={() => setMobileTab('code')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'code' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#2b2b2b] text-slate-300'}`}>Code</button>
          <button onClick={() => setMobileTab('preview')} className={`px-2.5 py-1 rounded text-xs font-semibold ${mobileTab === 'preview' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#2b2b2b] text-slate-300'}`}>Preview</button>
        </div>
      </div>

      {/* DESKTOP SIDEBAR */}
      <div className="hidden md:flex w-60 border-r border-[#2b2b2b] bg-[#181818] flex-col justify-between p-3.5 shrink-0 overflow-hidden">
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-2 font-bold text-amber-400 mb-4 text-sm shrink-0">
            <span className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">⚡</span>
            SOVEREIGN AGENT
          </div>

          <button 
            onClick={() => {
              setCurrentSessionId(`sovereign-session-${Date.now().toString(36)}`);
              setTaskGroups([]);
              setThoughts([]);
              setPrompt('');
            }}
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
            className="w-full flex items-center justify-center gap-2 bg-[#252526] hover:bg-[#2d2d2d] border border-[#3c3c3c] text-xs font-semibold py-2 px-3 rounded-lg text-amber-300 mb-4 transition shrink-0"
          >
            <Key className="w-3.5 h-3.5" /> Environment Box (.env)
          </button>

          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">Recent Sessions ({sessions.length})</div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {sessions.map(s => (
              <div 
                key={s.id}
                onClick={() => setCurrentSessionId(s.id)}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs truncate transition ${
                  currentSessionId === s.id ? 'bg-[#094771] text-white' : 'text-slate-400 hover:bg-[#2a2d2e]'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{s.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2 pt-3 border-t border-[#2b2b2b] shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          E2B Linux VM Active
        </div>
      </div>

      {/* MIDDLE: CHAT CONSOLE WITH ACTION PILLS */}
      <div className={`${mobileTab === 'console' ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 border-r border-[#2b2b2b] bg-[#1e1e1e]`}>
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          <div className="text-xs font-mono text-slate-400 flex items-center justify-between">
            <span>Workspace: <span className="text-amber-400 font-semibold">{currentSessionId}</span></span>
            {isRunning && <span className="text-amber-400 text-xs font-mono animate-pulse">⚡ Running tools...</span>}
          </div>

          {thoughts.map((t, idx) => (
            <div key={idx} className="bg-[#252526] border border-[#333333] rounded-lg p-3 text-xs text-slate-300 font-sans shadow-sm">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px] mb-1">
                <Brain className="w-3.5 h-3.5" /> Reasoning {t.turn ? `(Turn ${t.turn})` : ''}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{t.text}</p>
            </div>
          ))}

          {taskGroups.map(group => (
            <div key={group.id} className="border border-[#333333] bg-[#252526] rounded-xl overflow-hidden shadow-lg">
              <div className="flex items-center justify-between p-3 bg-[#2d2d2d] border-b border-[#333333]">
                <span className="text-xs font-bold text-amber-300">{group.id}. {group.title}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                  group.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400 animate-pulse'
                }`}>
                  {group.status.toUpperCase()}
                </span>
              </div>

              <div className="p-2 space-y-1.5 bg-[#1e1e1e]">
                {(group.subActions || []).map(sub => (
                  <div key={sub.id} className="border border-[#2d2d2d] bg-[#252526] rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 text-xs font-mono text-slate-300">
                      <span className="truncate">{sub.title}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                        sub.status === 'completed' ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10 animate-pulse'
                      }`}>
                        {sub.status.toUpperCase()}
                      </span>
                    </div>
                    {sub.output && (
                      <div className="px-3 py-2 bg-[#181818] font-mono text-[11px] text-slate-300 whitespace-pre-wrap border-t border-[#2d2d2d] overflow-x-auto leading-relaxed">
                        {sub.output}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div ref={chatBottomRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3.5 border-t border-[#2b2b2b] bg-[#181818]">
          <div className="flex gap-2">
            <input 
              value={prompt}
              disabled={isRunning}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isRunning && runAgent()}
              placeholder="Describe what you want to build or run..."
              className="flex-1 bg-[#252526] border border-[#3c3c3c] rounded-lg px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button onClick={runAgent} disabled={isRunning} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 transition">
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT WORKSPACE: 100% REAL VS CODE EXPLORER + EDITOR (Matching Screenshot 2) */}
      <div className={`${mobileTab !== 'console' ? 'flex' : 'hidden md:flex'} flex-1 md:w-[540px] lg:w-[600px] md:flex-initial flex-col bg-[#1e1e1e] overflow-hidden`}>
        
        {/* Top Panel Switcher */}
        <div className="hidden md:flex border-b border-[#2b2b2b] bg-[#252526] p-1 gap-1 text-xs shrink-0">
          <button onClick={() => setDesktopTab('code')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'code' ? 'bg-[#1e1e1e] text-white font-semibold border-b-2 border-amber-400' : 'text-slate-400 hover:text-slate-200'}`}>
            <Code className="w-3.5 h-3.5 text-blue-400" /> Code Inspector
          </button>
          <button onClick={() => setDesktopTab('preview')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'preview' ? 'bg-[#1e1e1e] text-white font-semibold border-b-2 border-amber-400' : 'text-slate-400 hover:text-slate-200'}`}>
            <Monitor className="w-3.5 h-3.5 text-emerald-400" /> Live Preview
          </button>
          <button onClick={() => setDesktopTab('terminal')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'terminal' ? 'bg-[#1e1e1e] text-white font-semibold border-b-2 border-amber-400' : 'text-slate-400 hover:text-slate-200'}`}>
            <TerminalIcon className="w-3.5 h-3.5 text-amber-400" /> Terminal
          </button>
        </div>

        {/* View Switcher Container */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* CODE VIEW: REAL VS CODE EXPLORER SIDEBAR + CODE EDITOR */}
          {((desktopTab === 'code' && mobileTab === 'console') || mobileTab === 'code') && (
            <div className="flex flex-1 overflow-hidden">
              
              {/* VS Code Explorer Sidebar */}
              <div className="w-56 border-r border-[#2b2b2b] bg-[#181818] flex flex-col shrink-0 select-none">
                
                {/* Explorer Title & Action Bar */}
                <div className="flex items-center justify-between px-3 py-2 text-[11px] font-bold text-[#bbbbbb] uppercase tracking-wider">
                  <span>Explorer</span>
                  <div className="flex items-center gap-1 text-slate-400">
                    <RefreshCw onClick={fetchTree} className="w-3.5 h-3.5 cursor-pointer hover:text-white" title="Refresh Explorer" />
                    <Minimize2 onClick={collapseAllFolders} className="w-3.5 h-3.5 cursor-pointer hover:text-white" title="Collapse All" />
                  </div>
                </div>

                {/* Workspace Root Header (Matching Screenshot 2) */}
                <div 
                  onClick={() => toggleFolder('root', {} as any)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-[#cccccc] cursor-pointer hover:bg-[#2a2d2e]"
                >
                  {expandedFolders['root'] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span className="truncate">Sovereign_Agent [Workspace]</span>
                </div>

                {/* Hierarchical Tree Body */}
                <div className="flex-1 overflow-y-auto py-1">
                  {fileTree.length > 0 ? (
                    renderVSCodeTree(fileTree)
                  ) : (
                    <div className="p-3 text-xs text-slate-500 font-mono italic">Scanning workspace...</div>
                  )}
                </div>
              </div>

              {/* Code File Viewer */}
              <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden">
                <div className="px-4 py-2 border-b border-[#2b2b2b] text-xs font-mono text-amber-400 bg-[#181818] flex items-center justify-between shrink-0">
                  <span className="font-semibold truncate">{selectedFile || 'package.json'}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">UTF-8</span>
                </div>
                <pre className="flex-1 p-4 text-xs font-mono text-[#d4d4d4] overflow-auto whitespace-pre leading-relaxed bg-[#1e1e1e]">
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

      {/* ENV MODAL */}
      {showEnvModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#252526] border border-[#3c3c3c] rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[#3c3c3c]">
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
                    className="w-1/2 bg-[#181818] border border-[#3c3c3c] rounded px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-[#3c3c3c] bg-[#1f1f1f] flex justify-end gap-2">
              <button onClick={() => setShowEnvModal(false)} className="px-3 py-1 text-xs text-slate-400 hover:text-white">Cancel</button>
              <button onClick={async () => {
                await fetch('/api/sandbox/save-env', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: currentSessionId, envVars: envValues })
                });
                setShowEnvModal(false);
                fetchTree();
              }} className="px-4 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
