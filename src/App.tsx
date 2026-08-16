import React, { useState, useEffect } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
  FileText, 
  Key, 
  Eye, 
  EyeOff, 
  Play, 
  RefreshCw, 
  Terminal as TerminalIcon, 
  Code, 
  Monitor, 
  CheckCircle2, 
  Clock, 
  X, 
  Send 
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
  type: string;
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
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'terminal'>('code');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('.env');
  const [fileContent, setFileContent] = useState<string>('// Loading workspace...');
  const [previewUrl, setPreviewUrl] = useState<string>('/api/sandbox/render-preview');
  const [terminalLogs, setTerminalLogs] = useState<string[]>(['$ Sovereign Agent Sandbox Console Initialized']);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ adebola: true });
  
  // Google AI Studio-style Env Box Modal
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
    loadFile('.env');
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
      loadFile('.env');
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
            if (data.actions) setTaskGroups(data.actions);
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

  const renderTreeNodes = (nodes: FileNode[], depth = 0) => {
    return nodes.map(node => {
      const isDir = node.type === 'directory';
      const isExpanded = expandedFolders[node.path];

      return (
        <div key={node.path} style={{ paddingLeft: `${depth * 12}px` }}>
          <div 
            onClick={() => isDir ? toggleFolder(node.path) : loadFile(node.path)}
            className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-xs font-mono transition ${
              selectedFile === node.path ? 'bg-amber-500/20 text-amber-300' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {isDir ? (
              <>
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                {isExpanded ? <FolderOpen className="w-3.5 h-3.5 text-amber-400" /> : <Folder className="w-3.5 h-3.5 text-amber-400" />}
                <span className="font-semibold text-amber-200">{node.name}</span>
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5 ml-3 text-slate-400" />
                <span>{node.name}</span>
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

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-64 border-r border-slate-800 bg-slate-900/60 flex flex-col justify-between p-4">
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
          HITL Active | E2B Sandbox
        </div>
      </div>

      {/* Main Agent Console */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="text-xs font-mono text-slate-400">Workspace: <span className="text-amber-400">Agent Console</span></div>

          {/* Task Accordion Cards */}
          <div className="space-y-3">
            {taskGroups.map(group => (
              <div key={group.id} className="border border-slate-800 bg-slate-900/80 rounded-xl overflow-hidden shadow-lg">
                <div className="flex items-center justify-between p-3 bg-slate-900 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-200">{group.id}. {group.title}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                    group.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 animate-pulse'
                  }`}>
                    {group.status.toUpperCase()}
                  </span>
                </div>
                <div className="p-3 bg-black/70 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                  {group.output || 'Executing task actions in micro-VM...'}
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
              placeholder="Describe what you want to build or change (e.g. send me empty env box)..."
              className="flex-1 bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button onClick={runAgent} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition">
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Right Workspace Panels */}
      <div className="w-[500px] border-l border-slate-800 bg-slate-900/40 flex flex-col">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-900/80 p-1.5 gap-1 text-xs">
          <button onClick={() => setActiveTab('code')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${activeTab === 'code' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <Code className="w-3.5 h-3.5" />
            Code Inspector
          </button>
          <button onClick={() => setActiveTab('preview')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${activeTab === 'preview' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <Monitor className="w-3.5 h-3.5" />
            Live Preview
          </button>
          <button onClick={() => setActiveTab('terminal')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${activeTab === 'terminal' ? 'bg-slate-800 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>
            <TerminalIcon className="w-3.5 h-3.5" />
            Terminal
          </button>
        </div>

        {/* Panel Content */}
        <div className="flex-1 flex overflow-hidden">
          {activeTab === 'code' && (
            <div className="flex flex-1 overflow-hidden">
              {/* VS Code-like Tree Explorer */}
              <div className="w-48 border-r border-slate-800 bg-slate-950 p-2 overflow-y-auto">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
                  <span>Explorer</span>
                  <RefreshCw onClick={fetchTree} className="w-3 h-3 cursor-pointer hover:text-amber-400" />
                </div>
                {renderTreeNodes(fileTree)}
              </div>

              {/* Code Viewer */}
              <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-800 text-[11px] font-mono text-amber-400 bg-slate-900/40">
                  {selectedFile}
                </div>
                <pre className="flex-1 p-4 text-xs font-mono text-slate-300 overflow-auto whitespace-pre leading-relaxed">
                  {fileContent}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="flex-1 flex flex-col bg-slate-950">
              <iframe src={previewUrl} className="flex-1 w-full border-0 bg-slate-950" title="Preview" />
            </div>
          )}

          {activeTab === 'terminal' && (
            <div className="flex-1 p-4 bg-black font-mono text-xs text-emerald-400 overflow-y-auto">
              {terminalLogs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          )}
        </div>
      </div>

      {/* Google AI Studio-style Env Box Modal */}
      {showEnvModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-amber-400 font-bold text-sm">Enter your environment variable to continue</span>
              </div>
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
              <button 
                onClick={() => setShowEnvModal(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button 
                onClick={handleApplyEnv}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
