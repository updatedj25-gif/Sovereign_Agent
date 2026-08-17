import React, { useState, useEffect, useRef } from 'react';
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
  FileJson, 
  FileText, 
  Search, 
  Brain, 
  MessageSquare, 
  Trash2, 
  Square, 
  Plus, 
  Settings,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowDown,
  ExternalLink,
  Sparkles
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

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [currentGroups, setCurrentGroups] = useState<TaskGroup[]>([]);
  const [currentThoughts, setCurrentThoughts] = useState<{ text: string; turn?: number }[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [desktopTab, setDesktopTab] = useState<'preview' | 'code' | 'terminal'>('code');
  const [mobileTab, setMobileTab] = useState<'console' | 'preview' | 'code' | 'terminal'>('console');
  
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('sovereign-session-default');
  
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('package.json');
  const [fileContent, setFileContent] = useState<string>('// Select a file from the explorer sidebar');
  const [previewUrl, setPreviewUrl] = useState<string>('/api/sandbox/render-preview');
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['$ Sovereign Agent Full Delivery Engine Active']);
  
  const [expandedPills, setExpandedPills] = useState<Record<string, boolean>>({});
  const [expandedSubRows, setExpandedSubRows] = useState<Record<string, boolean>>({});
  
  const [showScrollBottom, setShowScrollBottom] = useState<boolean>(false);
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
    loadFile('package.json');
  }, [currentSessionId]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 100);
  };

  const scrollToBottom = () => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  const createNewSession = () => {
    const newId = `sovereign-session-${Date.now().toString(36)}`;
    setCurrentSessionId(newId);
    setMessages([]);
    setCurrentGroups([]);
    setCurrentThoughts([]);
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
    
    setMessages(prev => [...prev, { role: 'user', text: userPrompt }]);
    setCurrentGroups([]);
    setCurrentThoughts([]);
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
                setCurrentThoughts(prev => [...prev, { text: data.text, turn: data.turn }]);
              }
              if (data.actions) {
                setCurrentGroups(data.actions);
              }
              if (data.type === 'env_modal_open' && data.envBox) {
                setEnvModalData(data.envBox);
                setShowEnvModal(true);
              }
              if (data.type === 'preview_ready') {
                setPreviewUrl(`/api/sandbox/render-preview?sessionId=${currentSessionId}&t=${Date.now()}`);
              }
              if (data.type === 'stream_finished') {
                setMessages(prev => [
                  ...prev,
                  {
                    role: 'assistant',
                    text: data.finalResponse,
                    elapsedSeconds: data.elapsedSeconds,
                    checkpointId: data.checkpointId
                  }
                ]);
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

  const getFileIcon = (name: string, isDir: boolean) => {
    if (isDir) return <span className="mr-1.5 text-xs">📁</span>;
    if (name.endsWith('.py')) return <span className="text-xs mr-1.5">🐍</span>;
    if (name.endsWith('.tsx') || name.endsWith('.jsx')) return <FileCode className="w-3.5 h-3.5 text-cyan-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.ts') || name.endsWith('.js')) return <FileCode className="w-3.5 h-3.5 text-amber-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.json')) return <FileJson className="w-3.5 h-3.5 text-yellow-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.css')) return <FileCode className="w-3.5 h-3.5 text-sky-400 mr-1.5 shrink-0" />;
    if (name.endsWith('.env')) return <Key className="w-3.5 h-3.5 text-emerald-400 mr-1.5 shrink-0" />;
    return <FileText className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />;
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
            className="w-full flex items-center justify-center gap-2 bg-[#252526] hover:bg-[#2d2d2d] border border-[#3c3c3c] text-xs font-semibold py-2 px-3 rounded-lg text-amber-300 mb-4 transition shrink-0"
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
                  currentSessionId === s.id ? 'bg-[#094771] text-white' : 'text-slate-400 hover:bg-[#2a2d2e]'
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

        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2 pt-3 border-t border-[#2b2b2b] shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          E2B Linux Micro-VM Active
        </div>
      </div>

      {/* MIDDLE: CHAT CONSOLE */}
      <div className={`${mobileTab === 'console' ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 border-r border-[#2b2b2b] bg-[#1e1e1e] relative`}>
        <div 
          ref={chatScrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4"
        >
          <div className="text-xs font-mono text-slate-400 flex items-center justify-between">
            <span>Workspace: <span className="text-amber-400 font-semibold">{currentSessionId}</span></span>
            {isRunning && <span className="text-amber-400 text-xs font-mono animate-pulse">⚡ Agent executing...</span>}
          </div>

          {/* User & Assistant Thread */}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'user' ? (
                <div className="max-w-xl bg-gradient-to-r from-amber-600 to-amber-500 text-slate-950 font-medium px-4 py-2.5 rounded-2xl text-xs shadow-md">
                  {m.text}
                </div>
              ) : (
                <div className="max-w-2xl bg-[#252526] border border-[#333333] p-4 rounded-2xl text-xs text-slate-200 shadow-lg space-y-3">
                  <div className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
                    <Sparkles className="w-3.5 h-3.5" /> Sovereign Agent
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed prose prose-invert max-w-none text-xs">
                    {m.text}
                  </div>

                  {/* PHASE 4: AUDIT METRIC BADGES */}
                  {(m.elapsedSeconds || m.checkpointId) && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#333333] text-[11px] font-mono">
                      {m.elapsedSeconds && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#181818] border border-[#3c3c3c] text-slate-300">
                          <Clock className="w-3 h-3 text-amber-400" /> Worked for {m.elapsedSeconds}s
                        </span>
                      )}
                      {m.checkpointId && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#181818] border border-[#3c3c3c] text-emerald-300">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Checkpoint saved: {m.checkpointId}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Conversational Thoughts */}
          {currentThoughts.map((t, idx) => (
            <div key={idx} className="bg-[#252526]/80 border border-[#333333] rounded-xl p-3 text-xs text-slate-300 font-sans shadow-sm">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px] mb-1">
                <Brain className="w-3.5 h-3.5" /> Reasoning {t.turn ? `(Turn ${t.turn})` : ''}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-slate-300">{t.text}</p>
            </div>
          ))}

          {/* Action Pills & Sub-Accordions */}
          <div className="space-y-3">
            {currentGroups.map(group => {
              const isPillOpen = expandedPills[group.id] ?? true;
              const subList = group.subActions || [];

              return (
                <div key={group.id} className="space-y-2">
                  <div 
                    onClick={() => togglePill(group.id)}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#252526] border border-[#3c3c3c] hover:border-amber-500/50 cursor-pointer shadow-md transition select-none"
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

                  {isPillOpen && subList.length > 0 && (
                    <div className="border border-[#333333] bg-[#252526] rounded-xl p-2.5 space-y-2 shadow-lg">
                      <div className="flex items-center justify-between px-2 pb-1 border-b border-[#333333] text-[11px] font-mono text-slate-400 font-semibold">
                        <span className="text-amber-300">{group.title}</span>
                        <button onClick={() => togglePill(group.id)} className="text-slate-500 hover:text-amber-400 text-[10px]">^ Show less</button>
                      </div>

                      {subList.map(sub => {
                        const subKey = `${group.id}-${sub.id}`;
                        const isSubRowOpen = expandedSubRows[subKey] ?? true;

                        return (
                          <div key={sub.id} className="border border-[#2d2d2d] bg-[#1e1e1e] rounded-lg overflow-hidden">
                            <div 
                              onClick={() => toggleSubRow(subKey)}
                              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#252526] transition"
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
                              <div className="px-3 py-2 bg-[#141414] font-mono text-[11px] text-slate-300 whitespace-pre-wrap border-t border-[#2d2d2d] leading-relaxed overflow-x-auto">
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
        </div>

        {showScrollBottom && (
          <button 
            onClick={scrollToBottom}
            className="absolute bottom-20 right-6 bg-[#252526] border border-[#3c3c3c] text-xs text-slate-200 px-3 py-1.5 rounded-full shadow-xl flex items-center gap-1 hover:text-amber-400 transition"
          >
            <ArrowDown className="w-3.5 h-3.5" /> Scroll to latest
          </button>
        )}

        <div className="p-3.5 border-t border-[#2b2b2b] bg-[#181818]">
          <div className="flex gap-2">
            <input 
              value={prompt}
              disabled={isRunning}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isRunning && runAgent()}
              placeholder={isRunning ? "Agent is running tools in micro-VM..." : "Describe what you want to build or run..."}
              className="flex-1 bg-[#252526] border border-[#3c3c3c] rounded-lg px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
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

      {/* RIGHT WORKSPACE PANELS */}
      <div className={`${mobileTab !== 'console' ? 'flex' : 'hidden md:flex'} flex-1 md:w-[540px] lg:w-[600px] md:flex-initial flex-col bg-[#1e1e1e] overflow-hidden`}>
        
        <div className="hidden md:flex border-b border-[#2b2b2b] bg-[#252526] p-1 gap-1 text-xs shrink-0">
          <button onClick={() => setDesktopTab('preview')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'preview' ? 'bg-[#1e1e1e] text-white font-semibold border-b-2 border-amber-400' : 'text-slate-400 hover:text-slate-200'}`}>
            <Monitor className="w-3.5 h-3.5 text-emerald-400" /> Live Preview
          </button>
          <button onClick={() => setDesktopTab('code')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'code' ? 'bg-[#1e1e1e] text-white font-semibold border-b-2 border-amber-400' : 'text-slate-400 hover:text-slate-200'}`}>
            <Code className="w-3.5 h-3.5 text-blue-400" /> Code Inspector
          </button>
          <button onClick={() => setDesktopTab('terminal')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition ${desktopTab === 'terminal' ? 'bg-[#1e1e1e] text-white font-semibold border-b-2 border-amber-400' : 'text-slate-400 hover:text-slate-200'}`}>
            <TerminalIcon className="w-3.5 h-3.5 text-amber-400" /> Terminal
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* LIVE PREVIEW */}
          {((desktopTab === 'preview' && mobileTab === 'console') || mobileTab === 'preview') && (
            <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
              <iframe src={previewUrl} className="flex-1 w-full border-0 bg-slate-950" title="Live Preview" />
            </div>
          )}

          {/* CODE INSPECTOR */}
          {((desktopTab === 'code' && mobileTab === 'console') || mobileTab === 'code') && (
            <div className="flex flex-1 overflow-hidden">
              <div className="w-56 border-r border-[#2b2b2b] bg-[#181818] flex flex-col shrink-0 select-none">
                <div className="flex items-center justify-between px-3 py-2 text-[11px] font-bold text-[#bbbbbb] uppercase tracking-wider">
                  <span>Explorer</span>
                  <button onClick={fetchTree} className="text-slate-400 hover:text-white">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto py-1">
                  {fileTree.map(file => (
                    <div 
                      key={file.path}
                      onClick={() => file.type === 'file' && loadFile(file.path)}
                      className={`flex items-center py-1 px-2 rounded cursor-pointer text-xs font-mono transition ${
                        selectedFile === file.path 
                          ? 'bg-[#094771] text-white font-medium' 
                          : 'text-slate-300 hover:bg-[#2a2d2e]'
                      }`}
                    >
                      {getFileIcon(file.name, file.type === 'directory')}
                      <span className="truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden">
                <div className="px-4 py-2 border-b border-[#2b2b2b] text-xs font-mono text-amber-400 bg-[#181818] flex items-center justify-between shrink-0">
                  <span className="font-semibold truncate">{selectedFile || 'Select file'}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">UTF-8</span>
                </div>
                <pre className="flex-1 p-4 text-xs font-mono text-[#d4d4d4] overflow-auto whitespace-pre leading-relaxed bg-[#1e1e1e]">
                  {fileContent}
                </pre>
              </div>
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
              <button onClick={handleApplyEnv} className="px-4 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
