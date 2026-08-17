import React, { useState, useEffect, useRef } from 'react';
import { 
  Folder, 
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
  Plus
} from 'lucide-react';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  lastUpdated: string;
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
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [desktopTab, setDesktopTab] = useState<'preview' | 'code' | 'terminal'>('code');
  const [mobileTab, setMobileTab] = useState<'console' | 'preview' | 'code' | 'terminal'>('console');
  
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('sovereign-session-default');
  
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('// Select a file from the explorer');
  const [previewUrl, setPreviewUrl] = useState<string>('/api/sandbox/render-preview');
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['$ Sovereign Agent Sandbox Initialized']);
  
  const [showEnvModal, setShowEnvModal] = useState<boolean>(false);
  const [envModalData, setEnvModalData] = useState<EnvModalData | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const abortControllerRef = useRef<AbortController | null>(null);

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
      if (data.tree) setFileTree(data.tree);
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
  }, [currentSessionId]);

  const createNewSession = () => {
    const newId = `sovereign-session-${Date.now().toString(36)}`;
    setCurrentSessionId(newId);
    setTaskGroups([]);
    setPrompt('');
    setFileTree([]);
    setSelectedFile('');
    setFileContent('// Workspace initialized for new session');
  };

  const clearAllHistory = async () => {
    if (!confirm('Are you sure you want to clear all session history?')) return;
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
      if (currentSessionId === id) {
        createNewSession();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // STOP / KILL ACTIVE TASK
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
    setTaskGroups([]);
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
              if (data.actions) setTaskGroups(data.actions);
              if (data.type === 'env_modal_open' && data.envBox) {
                setEnvModalData(data.envBox);
                setShowEnvModal(true);
              }
              if (data.type === 'preview_ready') {
                setPreviewUrl(`/api/sandbox/render-preview?sessionId=${currentSessionId}&t=${Date.now()}`);
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

  const getFileIcon = (name: string, isDir: boolean) => {
    if (isDir) return <Folder className="w-3.5 h-3.5 text-amber-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.py')) return <span className="text-xs mr-1.5">🐍</span>;
    if (name.endsWith('.tsx') || name.endsWith('.jsx')) return <FileCode className="w-3.5 h-3.5 text-cyan-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.ts') || name.endsWith('.js')) return <FileCode className="w-3.5 h-3.5 text-amber-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.json')) return <FileJson className="w-3.5 h-3.5 text-yellow-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.css')) return <FileCode className="w-3.5 h-3.5 text-sky-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.env')) return <Key className="w-3.5 h-3.5 text-emerald-400 mr-1.5 shrink-0" />;
    return <FileText className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />;
  };

  const getSubActionIcon = (type: string) => {
    switch (type) {
      case 'python': return <span className="text-xs mr-1">🐍</span>;
      case 'command': return <TerminalIcon className="w-3.5 h-3.5 text-emerald-400 mr-1" />;
      case 'write_file': return <FileCode className="w-3.5 h-3.5 text-cyan-400 mr-1" />;
      case 'read_file': return <Search className="w-3.5 h-3.5 text-purple-400 mr-1" />;
      case 'env_box': return <Key className="w-3.5 h-3.5 text-amber-400 mr-1" />;
      default: return <Brain className="w-3.5 h-3.5 text-amber-300 mr-1" />;
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* MOBILE TOP TAB BAR */}
      <div className="md:hidden flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800 z-20 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-amber-400 text-xs">
          <span className="p-1 rounded bg-amber-500/10 border border-amber-500/30">⚡</span>
          SOVEREIGN
        </div>
        <div className="flex gap-1">
          <button onClick={() => setMobileTab('console')} className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${mobileTab === 'console' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>
            <MessageSquare className="w-3 h-3" /> Console
          </button>
          <button onClick={() => setMobileTab('preview')} className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${mobileTab === 'preview' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>
            <Monitor className="w-3 h-3" /> Preview
          </button>
          <button onClick={() => setMobileTab('code')} className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${mobileTab === 'code' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>
            <Code className="w-3 h-3" /> Code
          </button>
          <button onClick={() => setMobileTab('terminal')} className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${mobileTab === 'terminal' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>
            <TerminalIcon className="w-3 h-3" /> CLI
          </button>
        </div>
      </div>

      {/* DESKTOP SIDEBAR WITH HISTORY & CLEAR BUTTONS */}
      <div className="hidden md:flex w-64 border-r border-slate-800 bg-slate-900/70 flex-col justify-between p-3.5 shrink-0 overflow-hidden">
        <div className="flex flex-col h-full overflow-hidden">
          {/* Logo & New Session */}
          <div className="flex items-center gap-2 font-bold text-amber-400 mb-4 text-sm shrink-0">
            <span className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">⚡</span>
            SOVEREIGN AGENT
          </div>

          <button 
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold py-2 px-3 rounded-xl mb-3 transition shadow-lg shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>

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
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold py-2 px-3 rounded-xl text-amber-300 mb-4 transition shrink-0"
          >
            <Key className="w-3.5 h-3.5" />
            Environment Box (.env)
          </button>

          {/* Recent Sessions List Header with Clear All Button */}
          <div className="flex items-center justify-between px-1 pb-2 border-b border-slate-800/80 mb-2 shrink-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Recent Sessions ({sessions.length})</span>
            {sessions.length > 0 && (
              <button 
                onClick={clearAllHistory}
                title="Clear All History"
                className="text-slate-500 hover:text-red-400 flex items-center gap-1 text-[10px] transition"
              >
                <Trash2 className="w-3 h-3" /> Clear All
              </button>
            )}
          </div>

          {/* Scrollable Sessions List */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {sessions.map(s => (
              <div 
                key={s.id}
                onClick={() => setCurrentSessionId(s.id)}
                className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer text-xs transition ${
                  currentSessionId === s.id 
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 text-slate-500 group-hover:text-amber-400" />
                  <span className="truncate">{s.title}</span>
                </div>
                <button 
                  onClick={(e) => deleteSingleSession(s.id, e)}
                  title="Delete Session"
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2 pt-3 border-t border-slate-800/80 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          E2B Sandbox Connected
        </div>
      </div>

      {/* MIDDLE: AGENT CONSOLE & CHAT WITH KILL BUTTON */}
      <div className={`${mobileTab === 'console' ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 border-r border-slate-800 bg-slate-950/40`}>
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          <div className="text-xs font-mono text-slate-400 flex items-center justify-between">
            <span>Workspace: <span className="text-amber-400 font-semibold">{currentSessionId}</span></span>
            {isRunning && (
              <span className="text-xs font-mono text-amber-400 flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span> Agent Running...
              </span>
            )}
          </div>

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
                    group.subActions.map(sub => (
                      <div key={sub.id} className="border border-slate-800/80 bg-slate-900/60 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 text-xs font-mono text-slate-200">
                          <div className="flex items-center gap-1 truncate">
                            {getSubActionIcon(sub.type)}
                            <span className="truncate">{sub.title}</span>
                          </div>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                            sub.status === 'completed' ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10 animate-pulse'
                          }`}>
                            {sub.status.toUpperCase()}
                          </span>
                        </div>

                        {sub.output && (
                          <div className="px-3 py-2 bg-black/80 font-mono text-[11px] text-slate-300 whitespace-pre-wrap border-t border-slate-800/60 leading-relaxed overflow-x-auto">
                            {sub.output}
                          </div>
                        )}
                      </div>
                    ))
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

        {/* Input Bar with Send & Red Stop / Kill Button */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/40">
          <div className="flex gap-2">
            <input 
              value={prompt}
              disabled={isRunning}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isRunning && runAgent()}
              placeholder={isRunning ? "Agent is currently executing tasks..." : "Describe what you want to build or run..."}
              className="flex-1 bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 disabled:opacity-60"
            />

            {/* Dynamic Send / Kill Button */}
            {isRunning ? (
              <button 
                onClick={handleKillTask} 
                className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition shadow-lg shadow-red-500/30 animate-pulse"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop
              </button>
            ) : (
              <button 
                onClick={runAgent} 
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT WORKSPACE PANELS */}
      <div className={`${mobileTab !== 'console' ? 'flex' : 'hidden md:flex'} flex-1 md:w-[520px] lg:w-[580px] md:flex-initial flex-col bg-slate-900/40 overflow-hidden`}>
        
        <div className="hidden md:flex border-b border-slate-800 bg-slate-900/80 p-1.5 gap-1 text-xs shrink-0">
          <button onClick={() => setDesktopTab('code')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${desktopTab === 'code' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <Code className="w-3.5 h-3.5" /> Code Inspector
          </button>
          <button onClick={() => setDesktopTab('preview')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${desktopTab === 'preview' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <Monitor className="w-3.5 h-3.5" /> Live Preview
          </button>
          <button onClick={() => setDesktopTab('terminal')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${desktopTab === 'terminal' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <TerminalIcon className="w-3.5 h-3.5" /> Terminal
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* CODE INSPECTOR */}
          {((desktopTab === 'code' && mobileTab === 'console') || mobileTab === 'code') && (
            <div className="flex flex-1 overflow-hidden">
              <div className="w-56 border-r border-slate-800 bg-slate-950 p-2 overflow-y-auto shrink-0 select-none">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2 pb-1 border-b border-slate-800/80">
                  <span>Explorer</span>
                  <RefreshCw onClick={fetchTree} className="w-3 h-3 cursor-pointer hover:text-amber-400 transition" />
                </div>
                <div className="space-y-0.5">
                  {fileTree.map(file => (
                    <div 
                      key={file.path}
                      onClick={() => file.type === 'file' && loadFile(file.path)}
                      className={`flex items-center py-1 px-2 rounded cursor-pointer text-xs font-mono transition ${
                        selectedFile === file.path 
                          ? 'bg-amber-500/20 text-amber-300 font-semibold border-l-2 border-amber-400' 
                          : 'text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      {getFileIcon(file.name, file.type === 'directory')}
                      <span className="truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-800 text-[11px] font-mono text-amber-400 bg-slate-900/40 flex items-center justify-between shrink-0">
                  <span className="truncate font-semibold">{selectedFile || 'Select file'}</span>
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

      {/* ENV MODAL */}
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
