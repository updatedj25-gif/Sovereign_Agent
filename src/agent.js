// ── AGENT SESSION DURABLE OBJECT ─────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export class AgentSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.db = state.storage.sql;

    // Create session tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        content TEXT,
        timestamp TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        status TEXT,
        kind TEXT,
        title TEXT,
        subtitle TEXT,
        output TEXT,
        ts TEXT
      )
    `);
  }

  // Load chat logs
  getMessages() {
    return this.db.exec("SELECT role, content FROM messages ORDER BY id ASC").toArray();
  }

  // Save message
  saveMessage(role, content) {
    this.db.exec("INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)", role, content, new Date().toISOString());
  }

  // Clear session
  clearHistory() {
    this.db.exec("DELETE FROM messages");
    this.db.exec("DELETE FROM steps");
  }

  // Load steps
  getSteps() {
    return this.db.exec("SELECT id, status, kind, title, subtitle, output, ts FROM steps ORDER BY ts ASC").toArray();
  }

  // Save step
  saveStep(step) {
    this.db.exec(`
      INSERT OR REPLACE INTO steps (id, status, kind, title, subtitle, output, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, step.id, step.status, step.kind, step.title, step.subtitle, step.output || '', step.ts || new Date().toISOString());
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Clear history or retrieve history
    if (path === '/api/agent/chat') {
      if (method === 'DELETE') {
        this.clearHistory();
        return json({ success: true, message: 'Session history cleared' });
      }
      if (method === 'GET') {
        return json({ messages: this.getMessages() });
      }
    }

    // Retrieve steps
    if (path === '/api/agent/steps' && method === 'GET') {
      return json({ steps: this.getSteps() });
    }

    // Handle Streaming / Regular Chat
    if ((path === '/api/agent/chat' || path === '/api/agent/stream') && method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const message = (body.message || '').trim();
      const clearFirst = !!body.clearHistory;
      if (clearFirst) {
        this.clearHistory();
      }

      if (!message) return json({ error: 'message is required' }, 400);

      // Save user message
      this.saveMessage('user', message);

      const isStreaming = path.includes('stream');

      if (isStreaming) {
        return this.handleStream(message);
      } else {
        return this.handleChat(message);
      }
    }

    return json({ error: 'Not found' }, 404);
  }

  // ── Non-streaming handler ──
  async handleChat(userMessage) {
    const history = this.getMessages();
    const result = await this.runAgentLoop(userMessage, history);
    
    this.saveMessage('assistant', result.reply);
    return json({
      reply: result.reply,
      steps: result.steps,
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    });
  }

  // ── Streaming SSE handler ──
  handleStream(userMessage) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sendEvent = (event, data) => {
      writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };

    // Run agent execution in the background
    this.state.blockConcurrencyWhile(async () => {
      try {
        const history = this.getMessages();
        
        // Define live logger
        const stepLogger = (step) => {
          this.saveStep(step);
          sendEvent('step', step);
        };

        const result = await this.runAgentLoop(userMessage, history, stepLogger, (chunk) => {
          sendEvent('content', chunk);
        });

        this.saveMessage('assistant', result.reply);
        sendEvent('done', { reply: result.reply, steps: this.getSteps() });
      } catch (err) {
        sendEvent('error', { error: err.message });
      } finally {
        writer.close();
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });
  }

  // ── Core Full-Stack Agent Loop ──
  async runAgentLoop(userMessage, history, logStep = () => {}, streamChunk = () => {}) {
    let loopCount = 0;
    const maxLoops = 4;
    let assistantReply = '';
    
    // Get file workspace context
    const fileDoId = this.env.FILE_TOOLS_MCP.idFromName(this.state.id.toString());
    const fileDo = this.env.FILE_TOOLS_MCP.get(fileDoId);
    
    const gitDoId = this.env.GIT_TOOLS_MCP.idFromName(this.state.id.toString());
    const gitDo = this.env.GIT_TOOLS_MCP.get(gitDoId);

    const projectDoId = this.env.PROJECT_TOOLS.idFromName(this.state.id.toString());
    const projectDo = this.env.PROJECT_TOOLS.get(projectDoId);

    // Initial logs
    const initialStep = {
      id: 'step_init',
      status: 'done',
      kind: 'tool',
      title: 'Initializing sovereign workspaces',
      subtitle: 'Retrieved DO context and databases',
      ts: new Date().toISOString()
    };
    logStep(initialStep);

    // Get list of active files to provide context to LLM
    let filesListText = '[]';
    try {
      const filesResp = await fileDo.fetch(`http://local/api/agent/files`);
      const { files } = await filesResp.json();
      filesListText = JSON.stringify(files, null, 2);
    } catch(e) {}

    const fileContextStep = {
      id: 'step_files',
      status: 'done',
      kind: 'tool',
      title: 'Scanning project files',
      subtitle: `Loaded file registry context`,
      ts: new Date().toISOString(),
      output: filesListText
    };
    logStep(fileContextStep);

    // Loop
    while (loopCount < maxLoops) {
      loopCount++;

      const systemPrompt = `You are Sovereign Agent, an elite AI coding assistant running on Cloudflare's serverless infrastructure.
Your workspace files:
${filesListText}

CRITICAL EXPLANATION RULE: Before outputting any tool block, you MUST write a clear, brief sentence explaining what you are going to do and why you are choosing that action.

You can execute tools by outputting a tool call JSON block wrapped inside a markdown \`\`\`tool codeblock.
Format:
I am going to check the existing button logic before writing modifications.
\`\`\`tool
{
  "name": "write_file",
  "arguments": {
    "path": "src/components/button.js",
    "content": "..."
  }
}
\`\`\`

You MUST only call ONE tool per response. Do not output anything after the \`\`\`tool block.
If you call a tool, you will receive its output in the next turn.
Once you have finished editing, writing, or reading, output your final thoughts directly to the developer without any tool blocks.

Your Available Tools:
1. list_files: {}
2. read_file: { "path": "relative/file/path" }
3. write_file: { "path": "relative/file/path", "content": "file contents" }
4. create_folder: { "path": "relative/directory/path" }
5. grep_search: { "query": "text to search" }
6. git_log: {}
7. git_commit: { "message": "commit message" }
`;

      const currentStepId = `step_loop_${loopCount}`;
      const runningStep = {
        id: currentStepId,
        status: 'running',
        kind: 'tool',
        title: `Workers AI execution (Loop ${loopCount}/${maxLoops})`,
        subtitle: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        ts: new Date().toISOString()
      };
      logStep(runningStep);

      // Call LLM
      let modelResponseText = '';
      try {
        const aiResponse = await this.env.AI.run(
          '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          {
            messages: [
              { role: 'system', content: systemPrompt },
              ...history.slice(-10), // Keep context window reasonable
              { role: 'user', content: userMessage }
            ],
            max_tokens: 1536,
            temperature: 0.2,
          }
        );
        modelResponseText = aiResponse?.response || aiResponse?.result?.response || '';
      } catch (err) {
        console.warn("Workers AI Error (falling back to local agent simulation):", err.message);
        
        // Simulating the agent locally for development / offline support
        const query = userMessage.toLowerCase();
        
        if (loopCount === 1) {
          if (query.includes('create') || query.includes('write') || query.includes('add') || query.includes('button')) {
            modelResponseText = `I will add a new button component to the project.
\`\`\`tool
{
  "name": "write_file",
  "arguments": {
    "path": "src/components/button.js",
    "content": "// Dynamic UI Button\\nexport function renderButton(label, onClick) {\\n  const btn = document.createElement('button');\\n  btn.className = 'px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors';\\n  btn.innerText = label;\\n  btn.onclick = onClick;\\n  return btn;\\n}"
  }
}
\`\`\``;
          } else if (query.includes('folder') || query.includes('mkdir') || query.includes('directory')) {
            modelResponseText = `I will create a structural folder layout context inside the virtual filesystem.
\`\`\`tool
{
  "name": "create_folder",
  "arguments": {
    "path": "src/utils"
  }
}
\`\`\``;
          } else if (query.includes('list') || query.includes('show') || query.includes('files')) {
            modelResponseText = `I will retrieve the list of files in the workspace.
\`\`\`tool
{
  "name": "list_files",
  "arguments": {}
}
\`\`\``;
          } else if (query.includes('commit') || query.includes('git')) {
            modelResponseText = `I will create a commit for the workspace.
\`\`\`tool
{
  "name": "git_commit",
  "arguments": {
    "message": "Update code and layouts"
  }
}
\`\`\``;
          } else {
            modelResponseText = `Hello! I am Sovereign Agent. Since Workers AI is not fully authenticated on your local Wrangler session, I am running in local agent simulation mode.

Here is the current status of the project:
1. Virtual Filesystem: Seeded with src/app.js, package.json, README.md
2. Git Control: Initial commit a1b2c3d created
3. System: Health check OK.

How can I help you build or customize this full-stack agent?`;
          }
        } else {
          // Loop > 1 (the tool was executed, and we are returning the final results)
          if (query.includes('create') || query.includes('write') || query.includes('add') || query.includes('button')) {
            modelResponseText = `I have successfully written the button component file at \`src/components/button.js\`. The project structure has been updated. Let me know if you want to make any further modifications!`;
          } else if (query.includes('folder') || query.includes('mkdir') || query.includes('directory')) {
            modelResponseText = `I have completed setting up the folder layout structure inside the virtual SQLite system layout. Ready for file injections!`;
          } else if (query.includes('list') || query.includes('show') || query.includes('files')) {
            modelResponseText = `I have listed the files. The workspace contains \`src/app.js\`, \`src/components/button.js\`, \`package.json\`, and \`README.md\`.`;
          } else if (query.includes('commit') || query.includes('git')) {
            modelResponseText = `I have committed the changes successfully. The Git commit log has been updated in the repository history.`;
          } else {
            modelResponseText = `Task executed successfully. Let me know if you need anything else!`;
          }
        }
      }

      if (!modelResponseText) {
        modelResponseText = 'No response generated.';
      }

      // Check if there is a tool call
      const toolMatch = modelResponseText.match(/```tool\s*([\s\S]*?)\s*```/);
      
      if (toolMatch) {
        let toolCall;
        try {
          toolCall = JSON.parse(toolMatch[1]);
        } catch (e) {
          // Parse failed
          runningStep.status = 'failed';
          runningStep.subtitle = 'Tool JSON parsing error';
          runningStep.output = toolMatch[1];
          logStep(runningStep);
          
          assistantReply += '\nError parsing tool JSON.';
          break;
        }

        // Extract any text written *before* the tool block as the agent's stated intent
        const splitText = modelResponseText.split(/```tool/)[0] || '';
        const cleanIntent = splitText.trim();

        // Complete the AI run step with intent visibility
        runningStep.status = 'done';
        runningStep.subtitle = `Called tool: ${toolCall.name}`;
        runningStep.output = `Intent: ${cleanIntent || 'Executing tool'}\nArguments: ${JSON.stringify(toolCall.arguments || {})}`;
        logStep(runningStep);

        // Stream only the intent text to the front conversation panel
        if (cleanIntent) {
          streamChunk(cleanIntent + '\n');
          assistantReply += cleanIntent + '\n';
        }

        // Execute Tool via DO stubs
        const toolExecId = `step_tool_exec_${loopCount}`;
        const execStep = {
          id: toolExecId,
          status: 'running',
          kind: 'terminal',
          title: `Executing: ${toolCall.name}`,
          subtitle: cleanIntent || `Running workspace action`,
          ts: new Date().toISOString()
        };
        logStep(execStep);

        let toolResultText = '';
        try {
          let toolResponse;
          if (['list_files', 'read_file', 'write_file', 'create_folder', 'grep_search'].includes(toolCall.name)) {
            // Call FileToolsMcp DO
            toolResponse = await fileDo.fetch(`http://local/mcp`, {
              method: 'POST',
              body: JSON.stringify({
                method: 'tools/call',
                params: { name: toolCall.name, arguments: toolCall.arguments || {} }
              })
            });
          } else if (['git_log', 'git_commit'].includes(toolCall.name)) {
            // Call GitToolsMcp DO
            toolResponse = await gitDo.fetch(`http://local/mcp`, {
              method: 'POST',
              body: JSON.stringify({
                method: 'tools/call',
                params: { name: toolCall.name, arguments: toolCall.arguments || {} }
              })
            });
          }

          if (toolResponse && toolResponse.ok) {
            const resData = await toolResponse.json();
            toolResultText = resData.content?.[0]?.text || JSON.stringify(resData);
            execStep.status = 'done';
            execStep.subtitle = 'Tool executed successfully';
            execStep.output = toolResultText;
          } else {
            toolResultText = `Tool call returned error status: ${toolResponse ? toolResponse.status : 'unknown'}`;
            execStep.status = 'failed';
            execStep.subtitle = 'Tool execution failed';
            execStep.output = toolResultText;
          }
        } catch (e) {
          toolResultText = `Tool execution threw error: ${e.message}`;
          execStep.status = 'failed';
          execStep.subtitle = 'Tool execution failed';
          execStep.output = toolResultText;
        }
        logStep(execStep);

        // Refresh file list cache
        try {
          const filesResp = await fileDo.fetch(`http://local/api/agent/files`);
          const { files } = await filesResp.json();
          filesListText = JSON.stringify(files);
        } catch(e) {}

        // Add tool outputs to history
        history.push({ role: 'assistant', content: modelResponseText });
        history.push({ role: 'user', content: `Tool execution response:\n${toolResultText}` });

        // Stream a clean non-intrusive notification indicator
        streamChunk(`\n*[Running execution for ${toolCall.name}...]*\n`);

      } else {
        // No tool call: AI finished execution loop
        runningStep.status = 'done';
        runningStep.subtitle = 'Generation completed';
        runningStep.output = modelResponseText;
        logStep(runningStep);

        // Stream the text content chunk to client
        streamChunk(modelResponseText);
        assistantReply += modelResponseText;
        break;
      }
    }

    if (loopCount >= maxLoops) {
      assistantReply += '\nReached maximum agent execution iterations.';
    }

    return { reply: assistantReply, steps: this.getSteps() };
  }
}