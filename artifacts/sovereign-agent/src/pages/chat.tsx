import { useEffect, useRef, useState } from "react";
import { useShell, Shell } from "@/components/layout/Shell";
import { LandingView } from "@/components/chat/LandingView";
import { SplitChatView } from "@/components/chat/SplitChatView";
import { HITLApprovalModal, type PendingApprovalData } from "@/components/agent/HITLApprovalModal";
import { VisualPreviewModal, type VisualPreviewData } from "@/components/chat/VisualPreviewModal";
import { type ReActTurn } from "@/components/chat/ReActTimeline";
import {
  getChatSession,
  saveChatSession,
  type ChatSessionItem,
} from "@/lib/chat-history";
import { apiUrl } from "@/lib/worker-base";
import type { ActionItem } from "@/components/chat/ActionAccordion";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: ActionItem[];
  reactTurns?: ReActTurn[];
  visualPreview?: VisualPreviewData;
}

function createSessionId() {
  return `sovereign-session-${crypto.randomUUID()}`;
}

export default function Chat() {
  const { activeSessionId, setActiveSessionId, refreshHistory, handleNewChat } = useShell();
  const [activePrompt, setActivePrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamLogs, setStreamLogs] = useState<string[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalData | null>(null);
  const [visualPreviewData, setVisualPreviewData] = useState<VisualPreviewData | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messageBufferRef = useRef("");

  const updateLastAssistant = (updater: (message: ChatMessage) => ChatMessage) => {
    setMessages((previous) => {
      const next = [...previous];
      const lastIndex = next.length - 1;
      if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
        next[lastIndex] = updater(next[lastIndex]);
      }
      return next;
    });
  };

  const updateTurn = (turnNumber: number, updater: (turn: ReActTurn) => ReActTurn) => {
    updateLastAssistant((message) => {
      const turns = [...(message.reactTurns || [])];
      const index = turns.findIndex((turn) => (turn.turn || turn.step) === turnNumber);
      const current = index >= 0 ? turns[index] : { turn: turnNumber, status: "running" as const };
      const updated = updater(current);
      if (index >= 0) turns[index] = updated;
      else turns.push(updated);
      return { ...message, reactTurns: turns };
    });
  };

  useEffect(() => {
    if (!activeSessionId || activeSessionId === currentSessionId) return;
    const saved = getChatSession(activeSessionId);
    if (!saved) return;
    setCurrentSessionId(saved.id);
    setActivePrompt(saved.title);
    setMessages((saved.messages || []) as ChatMessage[]);
    setStreamLogs(saved.logs || []);
    setPendingApproval(null);
  }, [activeSessionId, currentSessionId]);

  useEffect(() => {
    if (activeSessionId !== null) return;
    setCurrentSessionId(null);
    setActivePrompt("");
    setMessages([]);
    setStreamLogs([]);
    setPendingApproval(null);
    setVisualPreviewData(null);
  }, [activeSessionId]);

  const handleStreamEvent = (parsed: Record<string, any>) => {
    const turnNumber = Number(parsed.turn || parsed.taskId || parsed.index || 1);
    if (parsed.type === "agent_thought") {
      updateTurn(turnNumber, (turn) => ({ ...turn, thought: parsed.thought, status: "running" }));
      return;
    }
    if (parsed.type === "tool_started" || parsed.type === "task_running") {
      updateTurn(turnNumber, (turn) => ({
        ...turn,
        tool: parsed.tool || turn.tool,
        params: parsed.params || parsed.arguments || turn.params,
        action: parsed.task || turn.action,
        status: "running",
      }));
      return;
    }
    if (parsed.type === "task_progress" || parsed.type === "command_logged") {
      const chunk = parsed.chunk || parsed.stdout || parsed.stderr || parsed.log || parsed.output || "";
      if (!chunk) return;
      setStreamLogs((previous) => [...previous, String(chunk)]);
      updateTurn(turnNumber, (turn) => ({ ...turn, output: `${turn.output || ""}${chunk}` }));
      return;
    }
    if (parsed.type === "tool_completed" || parsed.type === "task_completed" || parsed.type === "task_failed") {
      const exitCode = parsed.exitCode ?? (parsed.type === "task_failed" ? 1 : 0);
      const output = parsed.output || parsed.log || parsed.summary || "";
      updateTurn(turnNumber, (turn) => ({
        ...turn,
        output: output || turn.output,
        exitCode,
        status: exitCode === 0 ? "completed" : "failed",
      }));
      return;
    }
    if (parsed.type === "approval_required" || parsed.type === "hitl_approval_required") {
      setPendingApproval({
        approvalId: parsed.approvalId,
        toolName: parsed.toolName || parsed.tool,
        params: parsed.params || parsed.arguments,
        dangerReason: parsed.dangerReason || parsed.message,
        command: parsed.command,
        riskLevel: "high",
      });
      updateTurn(turnNumber, (turn) => ({
        ...turn,
        tool: parsed.toolName || parsed.tool || turn.tool,
        params: parsed.params || parsed.arguments || turn.params,
        dangerReason: parsed.dangerReason || parsed.message,
        approvalId: parsed.approvalId,
        status: "waiting_approval",
      }));
      return;
    }
    if (parsed.type === "approval_granted" || parsed.type === "hitl_approved") {
      setPendingApproval((previous) => previous?.approvalId === parsed.approvalId ? null : previous);
      updateTurn(turnNumber, (turn) => ({ ...turn, status: "running" }));
      return;
    }
    if (parsed.type === "approval_rejected" || parsed.type === "hitl_rejected") {
      setPendingApproval((previous) => previous?.approvalId === parsed.approvalId ? null : previous);
      updateTurn(turnNumber, (turn) => ({
        ...turn,
        status: "rejected",
        output: parsed.reason || "Action rejected by operator.",
      }));
      return;
    }
    if (parsed.type === "visual_verification_captured") {
      const preview: VisualPreviewData = {
        url: parsed.url,
        title: parsed.title,
        screenshotBase64: parsed.screenshotBase64,
        consoleLogs: parsed.consoleLogs,
        domSummarySnippet: parsed.domSummarySnippet,
        timestamp: new Date().toLocaleTimeString(),
      };
      setVisualPreviewData(preview);
      updateLastAssistant((message) => ({ ...message, visualPreview: preview }));
      return;
    }
    if (parsed.type === "error") {
      const message = parsed.message || parsed.error || "The agent stream failed.";
      setStreamLogs((previous) => [...previous, String(message)]);
      updateLastAssistant((current) => ({ ...current, content: String(message) }));
      return;
    }
    if (parsed.type === "stream_finished") {
      const finalResponse = parsed.finalResponse || parsed.response || parsed.review?.summary || "";
      if (finalResponse) {
        messageBufferRef.current = String(finalResponse);
        updateLastAssistant((current) => ({ ...current, content: String(finalResponse) }));
      }
      return;
    }
    if (parsed.response) {
      messageBufferRef.current += String(parsed.response);
      updateLastAssistant((current) => ({ ...current, content: messageBufferRef.current }));
    }
    if (Array.isArray(parsed.actions)) {
      updateLastAssistant((current) => ({ ...current, actions: parsed.actions }));
    }
  };

  const submitPrompt = async (prompt: string, sessionId: string) => {
    abortControllerRef.current = new AbortController();
    messageBufferRef.current = "";
    const response = await fetch(apiUrl("/api/agent/stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ prompt, sessionId }),
      signal: abortControllerRef.current.signal,
    });
    if (!response.ok) throw new Error(`Agent stream failed with HTTP ${response.status}`);
    if (!response.body) throw new Error("The agent returned no stream body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const line = frame.split(/\r?\n/).find((candidate) => candidate.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          handleStreamEvent(JSON.parse(payload));
        } catch {
          setStreamLogs((previous) => [...previous, payload]);
        }
      }
      if (done) break;
    }
  };

  const runStreamAndChat = async (prompt: string, historySnapshot: ChatMessage[], sessionId: string) => {
    setIsStreaming(true);
    setMessages((previous) => [...previous, { role: "assistant", content: "" }]);
    let finalResponse = "";
    try {
      await submitPrompt(prompt, sessionId);
      finalResponse = messageBufferRef.current;
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        finalResponse = error?.message || "The agent stream ended unexpectedly.";
        updateLastAssistant((message) => ({ ...message, content: finalResponse }));
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
    const assistantMessage = finalResponse || "Agent execution completed.";
    saveChatSession({
      id: sessionId,
      title: prompt,
      updatedAt: new Date().toISOString(),
      timestamp: Date.now(),
      preview: assistantMessage.slice(0, 140),
      messageCount: historySnapshot.length + 2,
      messages: [...historySnapshot, { role: "user", content: prompt }, { role: "assistant", content: assistantMessage }],
      logs: streamLogs,
    });
    refreshHistory();
  };

  const handleStartPrompt = (prompt: string) => {
    const sessionId = createSessionId();
    setCurrentSessionId(sessionId);
    setActiveSessionId(sessionId);
    setActivePrompt(prompt);
    setMessages([{ role: "user", content: prompt }]);
    setStreamLogs([]);
    void runStreamAndChat(prompt, [], sessionId);
  };

  const handleSendMessage = (text: string) => {
    if (!text.trim() || isStreaming) return;
    const prompt = text.trim();
    const historySnapshot = [...messages];
    const sessionId = currentSessionId || createSessionId();
    setMessages((previous) => [...previous, { role: "user", content: prompt }]);
    if (!currentSessionId) {
      setCurrentSessionId(sessionId);
      setActiveSessionId(sessionId);
      setActivePrompt(prompt);
    }
    void runStreamAndChat(prompt, historySnapshot, sessionId);
  };

  if (!activePrompt && messages.length === 0) {
    return <Shell><LandingView onSubmitPrompt={handleStartPrompt} /></Shell>;
  }

  return (
    <Shell>
      <SplitChatView
        sessionId={currentSessionId || "default-session"}
        initialPrompt={activePrompt}
        messages={messages}
        isStreaming={isStreaming}
        streamLogs={streamLogs}
        onSendMessage={handleSendMessage}
        onNewChat={handleNewChat}
      />
      <HITLApprovalModal approvalData={pendingApproval} onResolved={() => setPendingApproval(null)} />
      <VisualPreviewModal data={visualPreviewData} onClose={() => setVisualPreviewData(null)} />
    </Shell>
  );
}