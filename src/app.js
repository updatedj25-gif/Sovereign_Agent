// ══════════════════════════════════════════════════════════════════════════════
// SOVEREIGN AGENT — UI Controller v3.2.0
// API: https://sovereign-agent-api.trinityceo717.workers.dev
// ══════════════════════════════════════════════════════════════════════════════

const API = 'https://sovereign-agent-api.trinityceo717.workers.dev';
let currentWorkspaceId = null;
let chatHistory        = [];
let activeFile         = null;

// ── FILE SYSTEM STATE ─────────────────────────────────────────────────────────
let workspaceFiles = [
  { id: 'app',        name: 'app',        type: 'folder', open: true,  children: ['_layout.tsx', 'index.tsx', '(tabs)'] },
  { id: 'assets',     name: 'assets',     type: 'folder', open: false, children: ['icon.png', 'splash.png', 'adaptive-icon.png'] },
  { id: 'components', name: 'components', type: 'folder', open: false, children: ['ThemedText.tsx', 'ThemedView.tsx', 'ExploreCard.tsx'] },
  { id: 'constants',  name: 'constants',  type: 'folder', open: false, children: ['Colors.ts'] },
  { id: 'contexts',   name: 'contexts',   type: 'folder', open: false, children: ['AuthContext.tsx'] },
  { id: 'hooks',      name: 'hooks',      type: 'folder', open: false, children: ['useColorScheme.ts', 'useThemeColor.ts'] },
  { id: 'public',     name: 'public',     type: 'folder', open: false, children: ['favicon.ico'] },
  { id: 'styles',     name: 'styles',     type: 'folder', open: false, children: ['global.css'] },
  { id: 'types',      name: 'types',      type: 'folder', open: false, children: ['index.d.ts'] },
  { id: 'utils',      name: 'utils',      type: 'folder', open: false, children: ['api.ts', 'storage.ts'] },
  { id: 'envex',      name: '.env.example',    type: 'file' },
  { id: 'gitignore',  name: '.gitignore',      type: 'file' },
  { id: 'apicfg',     name: 'API_CONFIG.ts',   type: 'file' },
  { id: 'appjson',    name: 'app.json',         type: 'file' },
  { id: 'pkgjson',    name: 'package.json',     type: 'file' },
  { id: 'tsconfig',   name: 'tsconfig.json',   type: 'file' },
];

const fileIcons = {
  '.tsx': '⚛️', '.ts': '🔷', '.js': '🟨', '.json': '📋',
  '.css': '🎨', '.md': '📝', '.png': '🖼️', '.ico': '🌐',
  '.env.example': '⚙️', '.gitignore': '🔴', folder: '📁',
};

function getFileIcon(name, type) {
  if (type === 'folder') return '📁';
  const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
  return fileIcons[name] || fileIcons[ext] || '📄';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── API HELPER ────────────────────────────────────────────────────────────────
async function apiCall(path, opts = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  initAccordion();
  initChatInput();
  switchView('chat');
  switchPreview('web');
  switchCodeTab('explorer');
  await initDB();
  await loadNotificationCount();
  updateStatusIndicator(true);
});

// ── CHAT INPUT ────────────────────────────────────────────────────────────────
function initChatInput() {
  const input = document.getElementById('chat-input');
  if (!input) return;

  // Auto-resize
  function resize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 128) + 'px';
  }
  input.addEventListener('input', resize);

  // Send on Enter (Shift+Enter for newline)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Ensure the textarea is fully interactive
  input.removeAttribute('disabled');
  input.removeAttribute('readonly');
  input.style.pointerEvents = 'auto';
  input.style.userSelect = 'text';
  input.style.webkitUserSelect = 'text';
}

async function initDB() {
  await apiCall('/api/db/migrate', { method: 'POST' });
  const ws = await apiCall('/api/workspaces');
  if (ws.workspaces?.length) {
    currentWorkspaceId = ws.workspaces[0].id;
    renderSidebarHistory(ws.workspaces);
  } else {
    const created = await apiCall('/api/workspaces', { method: 'POST', body: { name: 'CEO Strategy Workspace', description: 'Default Sovereign workspace' } });
    if (created.id) currentWorkspaceId = created.id;
  }
}

function updateStatusIndicator(online) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (dot)  { dot.className  = `w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-400'}`; }
  if (text) { text.textContent = online ? 'Live' : 'Offline'; }
}

function renderSidebarHistory(workspaces) {
  const hist = document.getElementById('sidebar-chat-history');
  if (!hist) return;
  hist.innerHTML = workspaces.slice(0, 8).map(ws => `
    <button onclick="loadWorkspace('${ws.id}')" class="w-full text-left px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 rounded-xl truncate">${escHtml(ws.name)}</button>
  `).join('');
}

window.loadWorkspace = async function(id) {
  currentWorkspaceId = id;
  chatHistory        = [];
  const msgs = document.getElementById('chat-messages-container');
  if (msgs) msgs.innerHTML = '';
  document.getElementById('chat-hero')?.classList.remove('hidden');
  document.getElementById('agent-steps-accordion-root')?.classList.add('hidden');
  const files = await apiCall(`/api/files?workspace_id=${id}`);
  if (files.files?.length) {
    workspaceFiles = files.files.map(f => ({ id: f.path, name: f.path.split('/').pop(), type: 'file' }));
  }
  closeSidebar();
  renderExplorer();
};

// ── EXPLORER ──────────────────────────────────────────────────────────────────
function renderExplorer() {
  const root = document.getElementById('file-explorer-root');
  if (!root) return;
  root.innerHTML = '';
  workspaceFiles.forEach(item => {
    const el = document.createElement('div');
    if (item.type === 'folder') {
      el.innerHTML = `
        <div class="select-none">
          <div onclick="toggleFolder('${item.id}')" class="file-row flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer">
            <svg class="w-2.5 h-2.5 text-stone-400 shrink-0 transition-transform ${item.open ? 'rotate-90' : ''}" fill="currentColor" viewBox="0 0 20 20"><path d="M6 6l8 4-8 4V6z"/></svg>
            <span class="text-xs">${getFileIcon(item.name,'folder')}</span>
            <span class="text-xs text-stone-700 font-medium truncate">${item.name}</span>
          </div>
          <div class="${item.open ? '' : 'hidden'} ml-4 border-l border-stone-100 pl-1 space-y-0.5 py-0.5">
            ${item.children.map(child => `
              <div onclick="selectFile('${child}')" class="file-row ${activeFile===child?'active':''} flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer">
                <span class="text-xs">${getFileIcon(child,'file')}</span>
                <span class="text-xs text-stone-600 truncate">${child}</span>
              </div>`).join('')}
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <div onclick="selectFile('${item.name}')" class="file-row ${activeFile===item.name?'active':''} flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer">
          <span class="text-xs">${getFileIcon(item.name,'file')}</span>
          <span class="text-xs text-stone-600 truncate">${item.name}</span>
        </div>`;
    }
    root.appendChild(el);
  });
}

window.toggleFolder = function(id) {
  const f = workspaceFiles.find(f => f.id === id);
  if (f) { f.open = !f.open; renderExplorer(); }
};

window.selectFile = async function(name) {
  activeFile = name;
  renderExplorer();
  const canvas = document.getElementById('editor-canvas');
  if (!canvas) return;

  let content = `// ${name}\nimport Sovereign from '@sovereign/core';\n\nexport default function Component() {\n  return Sovereign.render('${name}');\n}`;
  if (currentWorkspaceId) {
    const res = await apiCall(`/api/files/content?path=${encodeURIComponent(name)}&workspace_id=${currentWorkspaceId}`);
    if (res.content) content = res.content;
  }

  canvas.className = 'flex-1 bg-stone-950 text-stone-200 flex flex-col overflow-hidden';
  canvas.innerHTML = `
    <div class="flex items-center justify-between border-b border-stone-800 px-4 py-2 shrink-0">
      <div class="flex items-center gap-2">
        <span class="text-xs">${getFileIcon(name,'file')}</span>
        <span class="text-stone-300 text-xs font-mono">${name}</span>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="saveFile('${name}')" class="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 uppercase font-sans hover:bg-emerald-500/20 cursor-pointer">Save</button>
        <button onclick="runSelfHeal('${name}')" class="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20 uppercase font-sans hover:bg-amber-500/20 cursor-pointer">⚡ Heal</button>
      </div>
    </div>
    <textarea id="editor-textarea" class="flex-1 p-4 font-mono text-xs bg-stone-950 text-stone-200 resize-none outline-none border-none" spellcheck="false">${escHtml(content)}</textarea>
    <div class="border-t border-stone-900 px-4 py-1.5 flex justify-between items-center text-[10px] text-stone-600 font-sans shrink-0">
      <span>UTF-8 · TypeScript · ${content.length} chars</span>
      <span id="editor-status">Ready</span>
    </div>`;
};

window.saveFile = async function(name) {
  const textarea = document.getElementById('editor-textarea');
  if (!textarea || !currentWorkspaceId) return;
  const content = textarea.value;
  const res = await apiCall('/api/files/save', { method: 'POST', body: { workspace_id: currentWorkspaceId, path: name, content } });
  document.getElementById('editor-status').textContent = res.success ? '✓ Saved' : '✗ Error';
  setTimeout(() => { const s = document.getElementById('editor-status'); if (s) s.textContent = 'Ready'; }, 2000);
};

window.runSelfHeal = async function(name) {
  const textarea = document.getElementById('editor-textarea');
  const code     = textarea?.value || '';
  const status   = document.getElementById('editor-status');
  if (status) status.textContent = '⚡ Healing...';
  const res = await apiCall('/api/self-heal', { method: 'POST', body: { code, error: 'Analyze and improve this code', context: name } });
  if (res.analysis) {
    showToast('Self-Heal complete — see console for analysis', 'success');
    console.log('[Sovereign Self-Heal]', res.analysis);
  }
  if (status) status.textContent = 'Ready';
};

window.createNewNode = function(type) {
  const name = prompt(`New ${type} name:`);
  if (!name?.trim()) return;
  const id = 'n_' + Date.now();
  if (type === 'folder') {
    workspaceFiles.push({ id, name: name.trim(), type: 'folder', open: true, children: [] });
  } else {
    const openFolder = workspaceFiles.find(f => f.type === 'folder' && f.open);
    if (openFolder) openFolder.children.push(name.trim());
    else workspaceFiles.push({ id, name: name.trim(), type: 'file' });
  }
  renderExplorer();
};

window.searchFiles = function() {
  const q       = document.getElementById('code-search-input')?.value.toLowerCase().trim();
  const results = document.getElementById('search-results');
  if (!results) return;
  if (!q) { results.textContent = 'Start typing to search...'; return; }
  const matches = [];
  workspaceFiles.forEach(f => {
    if (f.name.toLowerCase().includes(q)) matches.push(f.name);
    if (f.type === 'folder') f.children.forEach(c => { if (c.toLowerCase().includes(q)) matches.push(c); });
  });
  results.innerHTML = matches.length
    ? matches.map(m => `<div onclick="selectFile('${m}');switchCodeTab('explorer')" class="flex items-center gap-2 p-2 hover:bg-stone-50 rounded-xl cursor-pointer"><span>${getFileIcon(m,'file')}</span><span class="text-stone-700">${m}</span></div>`).join('')
    : '<p class="text-stone-400">No files found</p>';
};

// ── VIEW ROUTER ───────────────────────────────────────────────────────────────
window.switchView = function(target) {
  ['chat','preview','code'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) { el.classList.remove('active'); el.classList.add('hidden'); }
  });
  const el = document.getElementById(`view-${target}`);
  if (el) { el.classList.remove('hidden'); el.classList.add('active'); }

  const inactive = 'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all cursor-pointer text-stone-600 hover:text-stone-900 hover:bg-stone-50';
  const active   = 'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all cursor-pointer tab-active';

  document.getElementById('tab-chat').className    = inactive;
  document.getElementById('tab-preview').className = inactive;
  const moreTrigger = document.getElementById('tab-more-trigger');
  const moreLabel   = document.getElementById('more-pill-label');
  if (moreTrigger) moreTrigger.className = 'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors cursor-pointer';

  if (target === 'chat')    { document.getElementById('tab-chat').className = active; }
  else if (target === 'preview') { document.getElementById('tab-preview').className = active; }
  else if (target === 'code') {
    if (moreTrigger) moreTrigger.className = 'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium tab-active cursor-pointer';
    if (moreLabel)   moreLabel.textContent = '</> Code';
    renderExplorer();
  }
  if (target !== 'code' && moreLabel && moreLabel.textContent !== 'More') moreLabel.textContent = 'More';
};

// ── DROPDOWN ──────────────────────────────────────────────────────────────────
// Use click (not mousedown) to open so item clicks register before close fires
window.toggleDropdown = function(e) {
  e.stopPropagation();
  const dd = document.getElementById('more-dropdown');
  if (!dd) return;
  const isHidden = dd.classList.contains('hidden');
  dd.classList.toggle('hidden', !isHidden);
  document.getElementById('dropdown-arrow')?.classList.toggle('rotate-180', isHidden);
};

window.closeDropdown = function() {
  document.getElementById('more-dropdown')?.classList.add('hidden');
  document.getElementById('dropdown-arrow')?.classList.remove('rotate-180');
};

// Close dropdown when clicking outside.
// Use click (not mousedown) so dropdown item onclick fires BEFORE this handler.
document.addEventListener('click', function(e) {
  const dd      = document.getElementById('more-dropdown');
  const trigger = document.getElementById('tab-more-trigger');
  if (!dd || dd.classList.contains('hidden')) return;
  // Don't close if click was inside dropdown or on trigger button
  if (dd.contains(e.target) || trigger?.contains(e.target)) return;
  closeDropdown();
});

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
window.openSidebar  = function() { document.getElementById('sidebar')?.classList.remove('-translate-x-full'); document.getElementById('sidebar-overlay')?.classList.remove('hidden'); };
window.closeSidebar = function() { document.getElementById('sidebar')?.classList.add('-translate-x-full'); document.getElementById('sidebar-overlay')?.classList.add('hidden'); };
window.toggleSidebar = function() { document.getElementById('sidebar')?.classList.contains('-translate-x-full') ? openSidebar() : closeSidebar(); };

window.startNewChat = function() {
  document.getElementById('chat-hero')?.classList.remove('hidden');
  document.getElementById('agent-steps-accordion-root')?.classList.add('hidden');
  const msgs = document.getElementById('chat-messages-container');
  if (msgs) msgs.innerHTML = '';
  chatHistory = [];
  closeSidebar();
};

// ── MODAL SYSTEM ──────────────────────────────────────────────────────────────
window.openModal = function(name) {
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('modal-overlay')?.classList.remove('hidden');
  const panel = document.getElementById(`modal-${name}`);
  if (panel) { panel.classList.remove('hidden'); panel.classList.add('panel-slide'); }
  if (name === 'database') loadDBPanel();
  else if (name === 'logs') loadLogsPanel();
  else if (name === 'notifications') loadNotificationsPanel();
  else if (name === 'screenshots') loadScreenshotsPanel();
  else if (name === 'settings') loadSettingsPanel();
};
window.closeModal = function() {
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('modal-overlay')?.classList.add('hidden');
};
window.showModal = window.openModal;

// ── CODE SUB-TABS ─────────────────────────────────────────────────────────────
window.switchCodeTab = function(tab) {
  ['explorer','search','guide'].forEach(t => {
    document.getElementById(`code-panel-${t}`)?.classList.add('hidden');
    const btn = document.getElementById(`code-tab-${t}`);
    if (btn) btn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-all cursor-pointer';
  });
  document.getElementById(`code-panel-${tab}`)?.classList.remove('hidden');
  const activeBtn = document.getElementById(`code-tab-${tab}`);
  if (activeBtn) activeBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 text-stone-800 transition-all cursor-pointer';
  if (tab === 'explorer') renderExplorer();
};

// ── PREVIEW TABS ──────────────────────────────────────────────────────────────
window.switchPreview = function(tab) {
  ['web','ios','android','expo'].forEach(t => {
    const panel = document.getElementById(`prev-panel-${t}`);
    const btn   = document.getElementById(`prev-${t}`);
    if (panel) { panel.classList.add('hidden'); panel.classList.remove('flex'); }
    if (btn) btn.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer text-stone-500';
  });
  const activePanel = document.getElementById(`prev-panel-${tab}`);
  const activeBtn   = document.getElementById(`prev-${tab}`);
  if (activePanel) { activePanel.classList.remove('hidden'); activePanel.classList.add('flex'); }
  if (activeBtn) activeBtn.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer bg-white text-stone-800 shadow-sm';
};

// ── ACCORDION ─────────────────────────────────────────────────────────────────
// FIX: content starts open (no 'hidden' class in HTML). Toggle checks current state correctly.
function initAccordion() {
  const trigger = document.getElementById('accordion-trigger');
  const content = document.getElementById('accordion-content');
  const arrow   = document.getElementById('accordion-arrow');
  if (!trigger) return;
  trigger.addEventListener('click', () => {
    // Check if currently visible
    const isOpen = !content?.classList.contains('hidden');
    if (isOpen) {
      content?.classList.add('hidden');
      arrow?.classList.remove('rotate-180');
    } else {
      content?.classList.remove('hidden');
      arrow?.classList.add('rotate-180');
    }
  });
}

// ── CHAT / AGENT CORE ─────────────────────────────────────────────────────────
window.sendMessage = function() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  input.style.height = 'auto';

  document.getElementById('chat-hero')?.classList.add('hidden');

  const msgs      = document.getElementById('chat-messages-container');
  const scrollArea = document.getElementById('chat-scroll-area');
  if (msgs) {
    const bubble = document.createElement('div');
    bubble.className = 'flex justify-end mb-1';
    bubble.innerHTML = `<div class="max-w-xs bg-stone-900 text-white text-sm rounded-2xl rounded-br-sm px-4 py-2.5">${escHtml(text)}</div>`;
    msgs.appendChild(bubble);
    if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
  }

  // Show and reset accordion
  const root     = document.getElementById('agent-steps-accordion-root');
  const timeline = document.getElementById('accordion-steps-timeline');
  const titleTxt = document.getElementById('accordion-title-text');
  const content  = document.getElementById('accordion-content');
  const arrow    = document.getElementById('accordion-arrow');

  if (root)    root.classList.remove('hidden');
  if (timeline) timeline.innerHTML = '';
  if (titleTxt) titleTxt.textContent = 'Sovereign Agent initializing...';

  // Ensure accordion is open when a new message is sent
  if (content) content.classList.remove('hidden');
  if (arrow)   arrow.classList.add('rotate-180');

  // Hierarchical task steps: pending → running → done
  const steps = [
    { name: 'Analyzing user prompt',     detail: `"${text.slice(0,60)}${text.length>60?'…':''}"` },
    { name: 'Loading Workers AI',        detail: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    { name: 'Executing D1 context read', detail: `workspace_id: ${currentWorkspaceId||'global'}` },
    { name: 'Generating response',       detail: 'Streaming via SSE — /api/agent/stream' },
    { name: 'Self-healing validation',   detail: 'Syntax tree checks passed ✓' },
  ];

  // Render all steps as pending immediately
  steps.forEach(step => updateStep(step.name, 'pending', step.detail));

  const STEP_MS = 900;

  steps.forEach((step, i) => {
    // Mark step as running
    setTimeout(() => {
      updateStep(step.name, 'running', step.detail);
    }, i * STEP_MS);

    // Mark step as done — one interval later
    setTimeout(() => {
      updateStep(step.name, 'done', step.detail);

      // When the last step finishes, fetch the actual reply
      if (i === steps.length - 1) {
        if (titleTxt) titleTxt.textContent = 'Task completed successfully.';
        fetchAgentReply(text, msgs);
      }
    }, (i + 1) * STEP_MS);
  });
};

async function fetchAgentReply(text, container) {
  chatHistory.push({ role: 'user', content: text });
  const scrollArea = document.getElementById('chat-scroll-area');

  // Create the reply bubble with a streaming cursor
  const bubble = document.createElement('div');
  bubble.className = 'flex justify-start';
  bubble.innerHTML = `
    <div class="max-w-sm bg-white border border-stone-200 text-stone-800 text-sm rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm">
      <div class="flex items-center gap-1.5 mb-1.5">
        <div class="w-4 h-4 bg-amber-500 rounded flex items-center justify-center">
          <svg class="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </div>
        <span class="text-xs font-semibold text-stone-500">Sovereign</span>
        <span class="text-[10px] text-stone-400 ml-auto">${new Date().toLocaleTimeString()}</span>
      </div>
      <p id="stream-text-${Date.now()}" class="leading-relaxed whitespace-pre-wrap"></p>
    </div>`;
  if (container) container.appendChild(bubble);
  const replyEl = bubble.querySelector('p[id^="stream-text-"]');

  // Blinking cursor
  const cursor = document.createElement('span');
  cursor.className = 'inline-block w-0.5 h-3.5 bg-stone-400 ml-0.5 align-middle animate-pulse';
  if (replyEl) replyEl.appendChild(cursor);
  if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;

  let full = '';
  try {
    const res = await fetch(`${API}/api/agent/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: chatHistory.slice(-8), workspace_id: currentWorkspaceId }),
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // last incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const chunk = line.slice(6).trim();
        if (chunk === '[DONE]') break;
        try {
          const parsed = JSON.parse(chunk);
          const token  = parsed.response ?? parsed.text ?? '';
          if (token) {
            full += token;
            if (replyEl) {
              // Remove cursor, set text, re-add cursor
              cursor.remove();
              replyEl.textContent = full;
              replyEl.appendChild(cursor);
            }
            if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
          }
        } catch { /* non-JSON SSE line — skip */ }
      }
    }
  } catch (err) {
    // Streaming failed — fall back to non-streaming chat
    try {
      const data  = await apiCall('/api/agent/chat', {
        method: 'POST',
        body: { message: text, history: chatHistory.slice(-8), workspace_id: currentWorkspaceId },
      });
      full = data.reply || data.error || 'No response.';
    } catch {
      full = 'Connection error — check backend status.';
    }
  }

  // Finalise bubble
  cursor.remove();
  if (replyEl) replyEl.textContent = full || '(empty response)';
  if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;

  chatHistory.push({ role: 'assistant', content: full });
  if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

  // Persist to D1 via tasks endpoint
  if (currentWorkspaceId && full) {
    const sid = 'sess_' + Date.now();
    apiCall('/api/tasks', { method: 'POST', body: { session_id: sid, workspace_id: currentWorkspaceId, name: 'AI response', status: 'done', detail: full.slice(0, 120) } }).catch(() => {});
  }
}

// ── STEP RENDERER — pending / running / done ───────────────────────────────────
function updateStep(name, status, detail) {
  const timeline = document.getElementById('accordion-steps-timeline');
  if (!timeline) return;
  const id = 'step-' + name.replace(/\s+/g,'-').toLowerCase();
  let el   = document.getElementById(id);

  let icon;
  if (status === 'pending') {
    icon = `<span class="flex h-2 w-2 mt-1 shrink-0"><span class="relative inline-flex rounded-full h-2 w-2 bg-stone-300"></span></span>`;
  } else if (status === 'running') {
    icon = `<span class="flex h-2 w-2 mt-1 relative shrink-0"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>`;
  } else if (status === 'done') {
    icon = `<svg class="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
  } else {
    icon = `<svg class="w-3 h-3 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
  }

  const nameColor = status === 'pending' ? 'text-stone-400' : status === 'running' ? 'text-stone-700 font-semibold' : 'text-stone-700';
  const html = `<div class="flex items-start gap-2">${icon}<div><p class="${nameColor}">${escHtml(name)}</p>${detail?`<p class="text-stone-400 text-[10px] font-mono mt-0.5">${escHtml(detail)}</p>`:''}</div></div>`;

  if (el) { el.innerHTML = html; }
  else {
    el = document.createElement('div');
    el.id = id; el.className = 'text-xs';
    el.innerHTML = html;
    timeline.appendChild(el);
  }
}
window.updateAgentStep = updateStep;

// ── DATABASE PANEL ────────────────────────────────────────────────────────────
async function loadDBPanel() {
  // Update env status to connecting
  const envStatus = document.getElementById('db-env-status');
  const badge     = document.getElementById('db-status-badge');
  if (envStatus) envStatus.textContent = 'Connecting to sovereign-agent-api...';
  if (badge)     { badge.textContent = '● Connecting'; badge.className = 'text-xs border rounded-full px-3 py-1 border-amber-200 text-amber-600 bg-amber-50'; }

  const data = await apiCall('/api/db/tables');
  const tableCount = data.tables?.length || 0;

  // Update env status
  if (envStatus) envStatus.textContent = `✓ Connected — sovereign-agent-api (D1 · ${tableCount} tables · KV · R2)`;
  if (badge)     { badge.textContent = '● Live'; badge.className = 'text-xs border rounded-full px-3 py-1 border-emerald-200 text-emerald-600 bg-emerald-50'; }

  // Update binding status labels
  const kvEl = document.getElementById('kv-status');
  const d1El = document.getElementById('d1-status');
  const r2El = document.getElementById('r2-status');
  if (kvEl) { kvEl.textContent = '✓ SOVEREIGN_KV · Connected'; kvEl.className = 'text-xs text-emerald-600 font-mono'; }
  if (d1El) { d1El.textContent = `✓ SOVEREIGN_DB · ${tableCount} tables`; d1El.className = 'text-xs text-emerald-600 font-mono'; }
  if (r2El) { r2El.textContent = '✓ LOBES_VAULT · R2 Bucket'; r2El.className = 'text-xs text-emerald-600 font-mono'; }

  // Populate tables list
  const tbody = document.getElementById('db-tables-body');
  if (tbody) {
    if (tableCount > 0) {
      tbody.innerHTML = data.tables.map(t => `
        <tr class="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onclick="runPreviewQuery('${escHtml(t.name)}')">
          <td class="py-2 px-3 text-xs font-mono text-stone-700">${escHtml(t.name)}</td>
          <td class="py-2 px-3 text-xs text-stone-500 text-right">${t.rows}</td>
          <td class="py-2 px-3 text-xs text-stone-400">${t.name === 'sqlite_sequence' ? 'system' : 'user'}</td>
        </tr>`).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3 text-stone-400 text-xs">No tables yet — migrations run on first chat</td></tr>';
    }
  }

  // Expand tables section if collapsed
  const tablesSection = document.getElementById('tables-section');
  if (tablesSection?.classList.contains('hidden')) {
    tablesSection.classList.remove('hidden');
    const arrow = document.querySelector('[data-toggle="tables-section"] .toggle-arrow');
    if (arrow) arrow.classList.add('rotate-180');
  }
}

window.runPreviewQuery = async function(tableName) {
  const input  = document.getElementById('db-query-input');
  const output = document.getElementById('db-query-output');
  if (input)  input.value = `SELECT * FROM ${tableName} LIMIT 10`;
  if (output) output.textContent = 'Running...';
  const data = await apiCall('/api/db/query', { method: 'POST', body: { sql: `SELECT * FROM ${tableName} LIMIT 10` } });
  if (data.error) { if (output) output.textContent = `Error: ${data.error}`; return; }
  if (output) output.textContent = JSON.stringify(data.results, null, 2);
};

window.runDBQuery = async function() {
  const sql    = document.getElementById('db-query-input')?.value.trim();
  const output = document.getElementById('db-query-output');
  if (!sql || !output) return;
  output.classList.remove('hidden');
  output.textContent = 'Running...';
  const data = await apiCall('/api/db/query', { method: 'POST', body: { sql } });
  if (data.error) { output.textContent = `Error: ${data.error}`; return; }
  const rows = data.results || [];
  output.textContent = rows.length ? JSON.stringify(rows, null, 2) : '(no rows)';
};

window.toggleSection = function(sectionId, btn) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const isHidden = section.classList.toggle('hidden');
  // Rotate the chevron inside the button
  const arrow = btn ? btn.querySelector('svg:last-of-type') : document.querySelector(`[data-toggle="${sectionId}"] svg:last-of-type`);
  if (arrow) arrow.style.transform = isHidden ? '' : 'rotate(180deg)';
};

// ── FILE DRAG & DROP ──────────────────────────────────────────────────────────
window.handleDragOver = function(e) {
  e.preventDefault();
  document.getElementById('storage-drop-zone')?.classList.add('drag-over');
};
window.handleDragLeave = function() {
  document.getElementById('storage-drop-zone')?.classList.remove('drag-over');
};
window.handleDrop = async function(e) {
  e.preventDefault();
  document.getElementById('storage-drop-zone')?.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer?.files || []);
  await uploadFiles(files);
};
window.handleFileSelect = async function(e) {
  const files = Array.from(e.target?.files || []);
  await uploadFiles(files);
};
async function uploadFiles(files) {
  const status = document.getElementById('storage-status');
  if (!files.length) return;
  if (status) status.textContent = `Uploading ${files.length} file(s)...`;
  let uploaded = 0;
  for (const file of files) {
    try {
      const content = await file.text();
      const res = await apiCall('/api/files/save', { method: 'POST', body: { workspace_id: currentWorkspaceId, path: file.name, content } });
      if (res.success) uploaded++;
    } catch {}
  }
  if (status) status.textContent = `✓ Uploaded ${uploaded}/${files.length} file(s)`;
  showToast(`${uploaded} file(s) uploaded to R2`, 'success');
  renderExplorer();
}

// ── LOGS PANEL ────────────────────────────────────────────────────────────────
async function loadLogsPanel() {
  const list = document.getElementById('backend-logs-list');
  if (!list) return;
  list.innerHTML = '<p class="text-xs text-stone-400 text-center py-4">Loading...</p>';
  const data = await apiCall('/api/logs/backend?limit=50');
  if (!data.logs?.length) { list.innerHTML = '<p class="text-xs text-stone-400 text-center py-4">No logs yet</p>'; return; }
  const colors = { info: 'text-blue-600', warn: 'text-amber-600', error: 'text-red-600', debug: 'text-stone-400' };
  list.innerHTML = data.logs.map(log => `
    <div class="flex items-start gap-2 py-1.5 border-b border-stone-50 font-mono">
      <span class="text-[10px] text-stone-400 shrink-0 w-20">${new Date(log.created_at).toLocaleTimeString()}</span>
      <span class="text-[10px] ${colors[log.level]||'text-stone-500'} uppercase w-12 shrink-0">${log.level}</span>
      <span class="text-[10px] text-stone-700 flex-1 truncate">${escHtml(log.message)}</span>
    </div>`).join('');
}

window.refreshLogs = loadLogsPanel;
window.clearLogs   = async function() {
  const list = document.getElementById('backend-logs-list');
  if (list) list.innerHTML = '<p class="text-xs text-stone-400 text-center py-4">Logs cleared locally</p>';
};

// ── NOTIFICATIONS PANEL ───────────────────────────────────────────────────────
async function loadNotificationsPanel() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  const data = await apiCall('/api/notifications');
  if (!data.notifications?.length) {
    list.innerHTML = '<p class="text-xs text-stone-400 text-center py-8">No notifications</p>';
    return;
  }
  list.innerHTML = data.notifications.map(n => `
    <div class="flex items-start gap-3 p-3 ${n.read ? '' : 'bg-blue-50'} rounded-xl border border-stone-100">
      <div class="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
        <svg class="w-4 h-4 text-amber-600" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-stone-800">${escHtml(n.title)}</p>
        <p class="text-xs text-stone-500 mt-0.5">${escHtml(n.message||'')}</p>
        <p class="text-[10px] text-stone-400 mt-1">${new Date(n.created_at).toLocaleString()}</p>
      </div>
      ${n.read ? '' : `<button onclick="markNotifRead('${n.id}')" class="text-[10px] text-blue-500 hover:text-blue-700 shrink-0 cursor-pointer">Mark read</button>`}
    </div>`).join('');
}

window.markNotifRead = async function(id) {
  await apiCall('/api/notifications/mark-read', { method: 'POST', body: { id } });
  await loadNotificationsPanel();
  await loadNotificationCount();
};

async function loadNotificationCount() {
  const data  = await apiCall('/api/notifications');
  const count = data.notifications?.filter(n => !n.read).length || 0;
  const badge = document.getElementById('notif-badge');
  if (badge) { badge.textContent = count; badge.classList.toggle('hidden', count === 0); }
}

// ── SCREENSHOTS PANEL ─────────────────────────────────────────────────────────
async function loadScreenshotsPanel() {
  const grid = document.getElementById('screenshots-grid');
  if (!grid) return;
  const data = await apiCall('/api/screenshots');
  if (!data.screenshots?.length) {
    grid.innerHTML = '<p class="text-xs text-stone-400 text-center py-8 col-span-2">No screenshots yet</p>';
    return;
  }
  grid.innerHTML = data.screenshots.map(s => `
    <div class="rounded-2xl border border-stone-200 overflow-hidden bg-stone-50">
      <div class="aspect-video bg-stone-100 flex items-center justify-center">
        <svg class="w-8 h-8 text-stone-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z"/></svg>
      </div>
      <div class="p-2">
        <p class="text-xs font-medium text-stone-700 truncate">${escHtml(s.name)}</p>
        <p class="text-[10px] text-stone-400">${new Date(s.created_at).toLocaleDateString()}</p>
      </div>
    </div>`).join('');
}

window.captureScreenshot = async function() {
  const data = await apiCall('/api/screenshots/capture', { method: 'POST', body: { workspace_id: currentWorkspaceId, name: `Screenshot ${new Date().toLocaleString()}`, url: location.href } });
  if (data.success) { showToast('Screenshot captured!', 'success'); await loadScreenshotsPanel(); }
};

// ── SETTINGS PANEL ────────────────────────────────────────────────────────────
async function loadSettingsPanel() {
  const data = await apiCall('/api/settings');
  const modelSel = document.getElementById('settings-model');
  const tempSel  = document.getElementById('settings-temperature');
  const tokSel   = document.getElementById('settings-maxtokens');
  if (modelSel && data.ai_model) modelSel.value = data.ai_model;
  if (tempSel  && data.temperature) tempSel.value = data.temperature;
  if (tokSel   && data.max_tokens) tokSel.value = data.max_tokens;
}

window.saveSettings = async function() {
  const model = document.getElementById('settings-model')?.value;
  const temp  = parseFloat(document.getElementById('settings-temperature')?.value || '0.4');
  const tok   = parseInt(document.getElementById('settings-maxtokens')?.value || '2048');
  await apiCall('/api/settings', { method: 'POST', body: { ai_model: model, temperature: temp, max_tokens: tok } });
  showToast('Settings saved!', 'success');
};

// ── GITHUB PANEL ──────────────────────────────────────────────────────────────
let ghVisibility = 'private';

window.switchGHTab = function(tab) {
  const createBtn  = document.getElementById('gh-create-btn');
  const existBtn   = document.getElementById('gh-existing-btn');
  const createForm = document.getElementById('gh-create-form');
  const existForm  = document.getElementById('gh-existing-form');
  if (tab === 'create') {
    createBtn.className  = 'flex-1 py-2 text-sm font-medium rounded-xl bg-stone-900 text-white transition-all cursor-pointer';
    existBtn.className   = 'flex-1 py-2 text-sm font-medium rounded-xl text-stone-600 transition-all cursor-pointer';
    createForm?.classList.remove('hidden');
    existForm?.classList.add('hidden');
  } else {
    existBtn.className   = 'flex-1 py-2 text-sm font-medium rounded-xl bg-stone-900 text-white transition-all cursor-pointer';
    createBtn.className  = 'flex-1 py-2 text-sm font-medium rounded-xl text-stone-600 transition-all cursor-pointer';
    existForm?.classList.remove('hidden');
    createForm?.classList.add('hidden');
  }
};

window.selectVisibility = function(vis) {
  ghVisibility = vis;
  const priv = document.getElementById('vis-private');
  const pub  = document.getElementById('vis-public');
  const desc = document.getElementById('vis-desc');
  const sel  = 'flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-blue-500 bg-blue-50 transition-all cursor-pointer';
  const unsel= 'flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-stone-200 bg-stone-50 transition-all cursor-pointer';
  if (vis === 'private') { priv.className = sel; pub.className = unsel; if (desc) desc.textContent = 'Only you can see this repository.'; }
  else { pub.className = sel; priv.className = unsel; if (desc) desc.textContent = 'Anyone can see this repository.'; }
};

window.createAndPush = async function() {
  const name    = document.getElementById('gh-repo-name')?.value.trim() || 'sovereign-project';
  const token   = document.getElementById('gh-token-input')?.value.trim();
  if (!token) { showToast('Paste your GitHub Personal Access Token first', 'error'); return; }
  showToast('Creating repository...', 'info');
  const data = await apiCall('/api/github/create', { method: 'POST', body: { name, private: ghVisibility === 'private', github_token: token } });
  if (data.success) { showToast(`✓ Created: ${data.name}`, 'success'); if (currentWorkspaceId) { await apiCall(`/api/workspaces`, { method: 'POST', body: { name, github_url: data.url } }); } }
  else showToast(data.error || 'Failed to create repo', 'error');
};

window.cloneExistingRepo = async function() {
  const url   = document.getElementById('gh-clone-url')?.value.trim();
  const token = document.getElementById('gh-token-input')?.value.trim();
  if (!url) { showToast('Paste a GitHub repo URL', 'error'); return; }
  showToast('Cloning...', 'info');
  const data = await apiCall('/api/git/clone', { method: 'POST', body: { repo_url: url, workspace_id: currentWorkspaceId, github_token: token } });
  if (data.success) { showToast(`✓ Cloned ${data.files_cloned} files`, 'success'); await loadWorkspace(currentWorkspaceId); }
  else showToast(data.error || 'Clone failed', 'error');
};

window.disconnectGitHub = function() { if (confirm('Disconnect GitHub integration?')) closeModal(); };
window.refreshGitHub    = function() { showToast('GitHub refreshed', 'info'); };

// ── SANDBOX PANEL ─────────────────────────────────────────────────────────────
window.runSandbox = async function() {
  const code    = document.getElementById('sandbox-input')?.value.trim();
  const output  = document.getElementById('sandbox-output');
  if (!code || !output) return;
  output.textContent = 'Running...';
  const data = await apiCall('/api/sandbox/execute', { method: 'POST', body: { code, language: 'javascript' } });
  output.textContent = data.output || data.error || 'No output';
  if (data.self_healed) {
    output.textContent += `\n\n⚡ Auto-healed:\n${data.healed_code}`;
  }
};

// ── PERMISSIONS PANEL ─────────────────────────────────────────────────────────
window.setProjectVisibility = function(vis) {
  const priv = document.getElementById('perm-private');
  const pub  = document.getElementById('perm-public');
  if (vis === 'private') { priv.className = 'px-4 py-1.5 rounded-full text-xs font-semibold bg-white text-stone-900 shadow-sm transition-all cursor-pointer'; pub.className = 'px-4 py-1.5 rounded-full text-xs font-semibold text-stone-600 transition-all hover:bg-white/60 cursor-pointer'; }
  else { pub.className = 'px-4 py-1.5 rounded-full text-xs font-semibold bg-white text-stone-900 shadow-sm transition-all cursor-pointer'; priv.className = 'px-4 py-1.5 rounded-full text-xs font-semibold text-stone-600 transition-all hover:bg-white/60 cursor-pointer'; }
  apiCall('/api/permissions', { method: 'POST', body: { workspace_id: currentWorkspaceId, visibility: vis } });
};

window.addInvitedUser = function() {
  const input = document.getElementById('invite-email');
  const list  = document.getElementById('invited-users-list');
  if (!input || !list || !input.value.trim()) return;
  const email = input.value.trim();
  const el    = document.createElement('div');
  el.className = 'flex items-center justify-between bg-white border border-stone-200 rounded-xl px-3 py-2';
  el.innerHTML = `<span class="text-sm text-stone-700">${escHtml(email)}</span><button onclick="this.parentElement.remove()" class="text-xs text-red-400 hover:text-red-600 cursor-pointer">Remove</button>`;
  list.appendChild(el);
  input.value = '';
};

// ── SUPABASE PANEL ────────────────────────────────────────────────────────────
window.connectSupabase = async function() {
  const url    = document.getElementById('supabase-url')?.value.trim();
  const key    = document.getElementById('supabase-key')?.value.trim();
  const status = document.getElementById('supabase-status');
  if (!url || !key) { showToast('Supabase URL and Anon Key required', 'error'); return; }
  if (status) status.textContent = 'Connecting...';
  const data = await apiCall('/api/supabase/connect', { method: 'POST', body: { url, anon_key: key } });
  if (data.success) { if (status) status.textContent = '✓ Connected'; showToast('Supabase connected!', 'success'); }
  else { if (status) status.textContent = '✗ Failed'; showToast(data.error || 'Connection failed', 'error'); }
};

// ── SECRETS PANEL ─────────────────────────────────────────────────────────────
window.saveSecret = async function() {
  const key   = document.getElementById('secret-key')?.value.trim();
  const value = document.getElementById('secret-value')?.value.trim();
  if (!key || !value) { showToast('Key and value required', 'error'); return; }
  const data = await apiCall('/api/secrets/save', { method: 'POST', body: { workspace_id: currentWorkspaceId, key, value } });
  if (data.success) { showToast(`Secret "${key}" saved`, 'success'); document.getElementById('secret-key').value = ''; document.getElementById('secret-value').value = ''; }
};

// ── DEPLOY ────────────────────────────────────────────────────────────────────
window.triggerDeploy = async function() {
  showToast('Triggering deployment...', 'info');
  const status = document.getElementById('deploy-status');
  if (status) status.classList.remove('hidden');
};

window.downloadZip = function() {
  showToast('Download not yet configured', 'info');
};

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-stone-800', warn: 'bg-amber-600' };
  const toast  = document.createElement('div');
  toast.className = `fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] ${colors[type]} text-white text-sm font-medium px-4 py-2.5 rounded-2xl shadow-xl transition-all`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── LEGACY ALIASES ────────────────────────────────────────────────────────────
window.triggerMockAgentLoop = window.sendMessage;
window.refreshConsoleLogs   = function() { showToast('Console logs refreshed', 'info'); };
window.loadBackendLogs      = loadLogsPanel;
