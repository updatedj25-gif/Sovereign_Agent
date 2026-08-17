import React, { useState, useEffect } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
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
  Search,
  Brain,
  MessageSquare
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
  const [desktopTab, setDesktopTab] = useState<'preview' | 'code' | 'terminal'>('preview');
  const [mobileTab, setMobileTab] = useState<'console' | 'preview' | 'code' | 'terminal'>('console');
  
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('src/App.tsx');
  const [fileContent, setFileContent] = useState<string>('// Select a file from the explorer sidebar');
  const [previewUrl, setPreviewUrl] = useState<string>('/api/sandbox/render-preview');
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['$ Sovereign Agent Sandbox Initialized']);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ src: true, adebola: true, Sovereign_Agent: true });
  const [expandedSubActions, setExpandedSubActions] = useState<Record<string, boolean>>({});
  
  const [showEnvModal, setShowEnvModal] = useState<boolean>(false);
  const [envModalData, setEnvModalData] = useState<EnvModalData | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const sessionId = 'sovereign-session-default';

  const fetchTree = async () => {
    try {
      const res = await fetch(`/api/sandbox/tree?sessionId=${sessionId}`);
      const data = await res.json();
      if (data.tree) setFileTree(data.tree);
    } catch {}
  };

  const loadFile = async (path: string) => {
    setSelectedFile(path);
    try {
      const res = await fetch(`/api/sandbox/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, filePath: path })
      });
      const data = await res.json();
      setFileContent(data.content || '// Empty file');
    } catch {}
  };

  useEffect(() => {
    fetchTree();
    loadFile('src/App.tsx');
  }, []);

  const handleApplyEnv = async () => {
    try {
      await fetch('/api/sandbox/save-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, envVars: envValues })
      });
      setShowEnvModal(false);
      fetchTree();
    } catch (e) {
      console.error(e);
    }
  };

  const runAgent = async () => {
    if (!prompt.trim()) return;
    const userPrompt = prompt;
    setPrompt('');
    setTaskGroups([]);

    const res = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: userPrompt, sessionId })
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
            if (data.actions) {
              setTaskGroups(data.actions);
              const newExpanded: Record<string, boolean> = {};
              data.actions.forEach((g: TaskGroup) => {
                (g.subActions || []).forEach((s: SubAction) => {
                  newExpanded[`${g.id}-${s.id}`] = true;
                });
              });
              setExpandedSubActions(prev => ({ ...prev, ...newExpanded }));
            }
            if (data.type === 'env_modal_open' && data.envBox) {
              setEnvModalData(data.envBox);
              setShowEnvModal(true);
            }
            if (data.type === 'preview_ready') {
              setPreviewUrl(`/api/sandbox/render-preview?sessionId=${sessionId}&t=${Date.now()}`);
            }
          } catch {}
        }
      }
    }
    fetchTree();
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const toggleSubAction = (key: string) => {
    setExpandedSubActions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getFileIcon = (name: string) => {
    if (name.endsWith('.py')) return <span className="ml-3 text-xs">🐍</span>;
    if (name.endsWith('.tsx') || name.endsWith('.jsx')) return <FileCode className="w-3.5 h-3.5 ml-3 text-cyan-400" />;
    if (name.endsWith('.ts') || name.endsWith('.js')) return <FileCode className="w-3.5 h-3.5 ml-3 text-amber-400" />;
    if (name.endsWith('.json')) return <FileCode className="w-3.5 h-3.5 ml-3 text-yellow-400" />;
    if (name.endsWith('.css')) return <FileCode className="w-3.5 h-3.5 ml-3 text-sky-400" />;
    if (name.endsWith('.env')) return <Key className="w-3.5 h-3.5 ml-3 text-emerald-400" />;
    return <FileCode className="w-3.5 h-3.5 ml-3 text-slate-400" />;
  };

  const renderTreeNodes = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => {
      const isDir = node.type === 'directory';
      const isExpanded = expandedFolders[node.path];

      return (
        <div key={node.path} style={{ paddingLeft: `${depth * 10}px` }}>
          <div 
            onClick={() => isDir ? toggleFolder(node.path) : loadFile(node.path)}
            className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-xs font-mono transition ${
              selectedFile === node.path ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            {isDir ? (
              <>
                {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                {isExpanded ? <FolderOpen className="w-3.5 h-3.5 text-amber-400" /> : <Folder className="w-3.5 h-3.5 text-amber-400" />}
                <span className="font-semibold text-amber-200">{node.name}</span>
              </>
            ) : (
              <>
                {getFileIcon(node.name)}
                <span className="truncate">{node.name}</span>
              </>
            )}
          </div>
          {isDir && isExpanded && node.children && (
            <div>{renderTreeNodes(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const getSubActionIcon = (type: string) => {
    switch (type) {
      case 'python': return <span className="text-xs">🐍</span>;
      case 'command': return <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />;
      case 'write_file': return <FileCode className="w-3.5 h-3.5 text-cyan-400" />;
      case 'read_file': return <Search className="w-3.5 h-3.5 text-purple-400" />;
      case 'env_box': return <Key className="w-3.5 h-3.5 text-amber-400" />;
      default: return <Brain className="w-3.5 h-3.5 text-amber-300" />;
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* MOBILE ADAPTIVE TOP BAR */}
      <div className="md:hidden flex items-center justify-between px-3 py-2.5 bg-slate-900 border-b border-slate-800 z-20">
        <div className="flex items-center gap-1.5 font-bold text-amber-400 text-xs">
          <span className="p-1 rounded bg-amber-500/10 border border-amber-500/30">⚡</span>
          SOVEREIGN
        </div>
        <div className="flex gap-1">
          <button onClick={() => setMobileTab('console')} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${mobileTab === 'console' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
            <MessageSquare className="w-3 h-3" /> Console
          </button>
          <button onClick={() => setMobileTab('preview')} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${mobileTab === 'preview' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
            <Monitor className="w-3 h-3" /> Preview
          </button>
          <button onClick={() => setMobileTab('code')} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${mobileTab === 'code' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
            <Code className="w-3 h-3" /> Code
          </button>
          <button onClick={() => setMobileTab('terminal')} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${mobileTab === 'terminal' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
            <TerminalIcon className="w-3 h-3" /> CLI
          </button>
        </div>
      </div>

      {/* DESKTOP SIDEBAR */}
      <div className="hidden md:flex w-64 border-r border-slate-800 bg-slate-900/60 flex-col justify-between p-4">
        <div>
          <div className="flex items-center gap-2 font-bold text-amber-400 mb-6 text-sm">
            <span className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">⚡</span>
            SOVEREIGN AGENT
          </div>
          <button 
            onClick={() => {
              setEnvModalData({
                title: "Enter your environment variable to continue",
                fields: [
                  { key: "GITHUB_TOKEN", label: "GitHub Personal Access Token", placeholder: "ghp_...", type: "password" },
                  { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API Token", placeholder: "cfut_...", type: "password" },
                  { key: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare Account ID", placeholder: "1b77c2a9...", type: "text" },
                  { key: "E2B_API_KEY", label: "E2B API Key", placeholder: "e2b_...", type: "password" }
                ]
              });
              setShowEnvModal(true);
            }}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold py-2 px-3 rounded-lg text-amber-300 mb-4 transition"
          >
            <Key className="w-3.5 h-3.5" />
            Environment Box (.env)
          </button>
        </div>
        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          HITL Active | Python 3 + E2B
        </div>
      </div>

      {/* MIDDLE: AGENT CONSOLE */}
      <div className={`${mobileTab === 'console' ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 border-r border-slate-800 bg-slate-950/40`}>
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          <div className="text-xs font-mono text-slate-400">Workspace: <span className="text-amber-400">Agent Console</span></div>

          {/* Subtask Accordions */}
          <div className="space-y-4">
            {taskGroups.map(group => (
              <div key={group.id} className="border border-slate-800 bg-slate-900/90 rounded-2xl overflow-hidden shadow-xl">
                <div className="flex items-center justify-between p-3.5 bg-slate-900 border-b border-slate-800/80">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[10px]">
                      {group.id}
                    </span>
                    {group.title}
                  </span>
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-semibold ${
                    group.status === 'completed' 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : group.status === 'error'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
                  }`}>
                    {group.status === 'completed' ? '✓ DONE' : group.status.toUpperCase()}
                  </span>
                </div>

                <div className="p-2 space-y-2 bg-slate-950/60">
                  {(group.subActions && group.subActions.length > 0) ? (
                    group.subActions.map(sub => {
                      const subKey = `${group.id}-${sub.id}`;
                      const isSubExpanded = expandedSubActions[subKey] ?? true;

                      return (
                        <div key={sub.id} className="border border-slate-800/80 bg-slate-900/60 rounded-xl overflow-hidden">
                          <div 
                            onClick={() => toggleSubAction(subKey)}
                            className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-800/40 transition"
                          >
                            <div className="flex items-center gap-2 text-xs font-mono text-slate-200 truncate">
                              {getSubActionIcon(sub.type)}
                              <span className="truncate">{sub.title}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                                sub.status === 'completed' ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10 animate-pulse'
                              }`}>
                                {sub.status.toUpperCase()}
                              </span>
                              {isSubExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                            </div>
                          </div>

                          {isSubExpanded && sub.output && (
                            <div className="px-3 py-2 bg-black/80 font-mono text-[11px] text-slate-300 whitespace-pre-wrap border-t border-slate-800/60 leading-relaxed overflow-x-auto">
                              {sub.output}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-3 font-mono text-xs text-slate-400">
                      {group.output || 'Executing task...'}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/40">
          <div className="flex gap-2">
            <input 
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runAgent()}
              placeholder="Describe what you want to build (e.g. run a python script to calculate primes)..."
              className="flex-1 bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button onClick={runAgent} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition">
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT PANELS */}
      <div className={`${mobileTab !== 'console' ? 'flex' : 'hidden md:flex'} flex-1 md:w-[500px] lg:w-[560px] md:flex-initial flex-col bg-slate-900/40`}>
        <div className="hidden md:flex border-b border-slate-800 bg-slate-900/80 p-1.5 gap-1 text-xs">
          <button onClick={() => setDesktopTab('preview')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${desktopTab === 'preview' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <Monitor className="w-3.5 h-3.5" /> Live Preview
          </button>
          <button onClick={() => setDesktopTab('code')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${desktopTab === 'code' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <Code className="w-3.5 h-3.5" /> Code Inspector
          </button>
          <button onClick={() => setDesktopTab('terminal')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${desktopTab === 'terminal' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <TerminalIcon className="w-3.5 h-3.5" /> Terminal
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {((desktopTab === 'preview' && mobileTab === 'console') || mobileTab === 'preview') && (
            <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
              <iframe src={previewUrl} className="flex-1 w-full border-0 bg-slate-950" title="Live Preview" />
            </div>
          )}

          {((desktopTab === 'code' && mobileTab === 'console') || mobileTab === 'code') && (
            <div className="flex flex-1 overflow-hidden">
              <div className="w-48 md:w-52 border-r border-slate-800 bg-slate-950 p-2 overflow-y-auto shrink-0">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
                  <span>Explorer</span>
                  <RefreshCw onClick={fetchTree} className="w-3 h-3 cursor-pointer hover:text-amber-400 transition" />
                </div>
                {renderTreeNodes(fileTree)}
              </div>

              <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-800 text-[11px] font-mono text-amber-400 bg-slate-900/40 flex items-center justify-between">
                  <span className="truncate">{selectedFile}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">Read-only view</span>
                </div>
                <pre className="flex-1 p-4 text-xs font-mono text-slate-300 overflow-auto whitespace-pre leading-relaxed">
                  {fileContent}
                </pre>
              </div>
            </div>
          )}

          {((desktopTab === 'terminal' && mobileTab === 'console') || mobileTab === 'terminal') && (
            <div className="flex-1 p-4 bg-black font-mono text-xs text-emerald-400 overflow-y-auto">
              {terminalLogs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          )}
        </div>
      </div>

      {/* ENV BOX MODAL */}
      {showEnvModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <span className="text-amber-400 font-bold text-sm">Enter your environment variable to continue</span>
              <X onClick={() => setShowEnvModal(false)} className="w-4 h-4 text-slate-400 cursor-pointer hover:text-white" />
            </div>

            <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
              <div className="grid grid-cols-2 text-[11px] font-bold text-slate-400 pb-1 border-b border-slate-800">
                <span>Name</span>
                <span>Value</span>
              </div>

              {(envModalData?.fields || []).map(f => (
                <div key={f.key} className="flex items-center gap-2">
                  <div className="w-1/2 font-mono text-xs text-slate-300 truncate" title={f.key}>
                    {f.key}
                  </div>
                  <div className="w-1/2 relative flex items-center">
                    <input 
                      type={showSecrets[f.key] ? "text" : "password"}
                      value={envValues[f.key] || ''}
                      onChange={e => setEnvValues({ ...envValues, [f.key]: e.target.value })}
                      placeholder="Secret value"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 pr-8"
                    />
                    <button 
                      type="button"
                      onClick={() => setShowSecrets({ ...showSecrets, [f.key]: !showSecrets[f.key] })}
                      className="absolute right-2 text-slate-500 hover:text-slate-300"
                    >
                      {showSecrets[f.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-end gap-2">
              <button onClick={() => setShowEnvModal(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">Cancel</button>
              <button onClick={handleApplyEnv} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
