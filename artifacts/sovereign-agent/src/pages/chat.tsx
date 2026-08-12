import { useState, useEffect, useRef } from "react";
import { useShell } from "@/components/layout/Shell";
import { LandingView } from "@/components/chat/LandingView";
import { SplitChatView } from "@/components/chat/SplitChatView";
import { HITLApprovalModal, PendingApprovalData } from "@/components/agent/HITLApprovalModal";
import { VisualPreviewModal, VisualPreviewData } from "@/components/chat/VisualPreviewModal";
import { ReActTurn } from "@/components/chat/ReActTimeline";
import { saveChatSession, getChatHistory, ChatSessionItem } from "@/lib/chat-history";
import WORKER_BASE from "@/lib/worker-base";

import { ActionItem } from "@/components/chat/ActionAccordion";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: ActionItem[];
  reactTurns?: ReActTurn[];
  visualPreview?: VisualPreviewData;
}

const saveMessageToBackend = async (sessionId: string, role: "user" | "assistant", content: string) => {
  try {
    await fetch(`${WORKER_BASE}/api/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content }),
    });
  } catch (err) {
    console.error("Failed to persist message to DO history:", err);
  }
};

const fetchBackendHistory = async (sessionId: string) => {
  try {
    const res = await fetch(`${WORKER_BASE}/api/session/${sessionId}/history`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error("Failed to fetch DO history:", err);
  }
  return null;
};

export default function Chat() {
  const { activeSessionId, setActiveSessionId, refreshHistory, handleNewChat } = useShell();

  const [activePrompt, setActivePrompt] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamLogs, setStreamLogs] = useState<string[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalData | null>(null);
  const [visualPreviewData, setVisualPreviewData] = useState<VisualPreviewData | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messageBufferRef = useRef<string>("");

  const updateLastAssistantTurn = (updater: (turns: ReActTurn[]) => ReActTurn[]) => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
        const currentTurns = updated[updated.length - 1].reactTurns || [];
        const newTurns = updater(currentTurns);
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          reactTurns: newTurns,
        };
      }
      return updated;
    });
  };

  const submitPrompt = async (promptText: string, sessionId: string, retryCount = 0) => {
    const MAX_RETRIES = 3;

    if (retryCount === 0) {
      abortControllerRef.current = new AbortController();
      messageBufferRef.current = "";
    }

    try {
      const response = await fetch(`${WORKER_BASE}/api/agent/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: promptText,
          prompt: promptText,
          sessionId,
          offset: messageBufferRef.current.length,
        }),
        signal: abortControllerRef.current?.signal,
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let chunkBuffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        chunkBuffer += decoder.decode(value, { stream: true });

        const messagesArr = chunkBuffer.split("\n\n");
        chunkBuffer = messagesArr.pop() || "";

        for (const msg of messagesArr) {
          if (msg.startsWith("data: ")) {
            const dataStr = msg.replace("data: ", "").trim();
            if (dataStr === "[DONE]") return;

            try {
              const parsed = JSON.parse(dataStr);

              // 1. ReAct Agent Thought Event
              if (parsed.type === "agent_thought") {
                const turnNum = parsed.turn || 1;
                updateLastAssistantTurn((turns) => {
                  const idx = turns.findIndex((t) => t.turn === turnNum);
                  if (idx >= 0) {
                    const next = [...turns];
                    next[idx] = { ...next[idx], thought: parsed.thought };
                    return next;
                  }
                  return [...turns, { turn: turnNum, thought: parsed.thought, status: "running" }];
                });
              }

              // 2. Tool Started Event
              else if (parsed.type === "tool_started") {
                const turnNum = parsed.turn || 1;
                updateLastAssistantTurn((turns) => {
                  const idx = turns.findIndex((t) => t.turn === turnNum);
                  if (idx >= 0) {
                    const next = [...turns];
                    next[idx] = { ...next[idx], tool: parsed.tool, params: parsed.params, status: "running" };
                    return next;
                  }
                  return [...turns, { turn: turnNum, tool: parsed.tool, params: parsed.params, status: "running" }];
                });
              }

              // 3. Visual Verification Captured Event
              else if (parsed.type === "visual_verification_captured") {
                const previewPayload: VisualPreviewData = {
                  url: parsed.url,
                  title: parsed.title,
                  screenshotBase64: parsed.screenshotBase64,
                  consoleLogs: parsed.consoleLogs,
                  domSummarySnippet: parsed.domSummarySnippet,
                  timestamp: new Date().toLocaleTimeString(),
                };

                setVisualPreviewData(previewPayload);

                setMessages((prev) => {
                  const updated = [...prev];
                  if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      visualPreview: previewPayload,
                    };
                  }
                  return updated;
                });
              }

              // 4. HITL Approval Required Event
              else if (parsed.type === "hitl_approval_required" || parsed.type === "approval_required") {
                setPendingApproval({
                  approvalId: parsed.approvalId,
                  toolName: parsed.toolName || parsed.tool,
                  params: parsed.params || parsed.arguments,
                  dangerReason: parsed.dangerReason || parsed.message,
                });

                updateLastAssistantTurn((turns) => {
                  if (turns.length === 0) return turns;
                  const next = [...turns];
                  const lastIdx = next.length - 1;
                  next[lastIdx] = {
                    ...next[lastIdx],
                    status: "waiting_approval",
                    dangerReason: parsed.dangerReason || parsed.message,
                    approvalId: parsed.approvalId,
                  };
                  return next;
                });
              }

              // 5. HITL Approved
              else if (parsed.type === "hitl_approved") {
                setPendingApproval((prev) => (prev?.approvalId === parsed.approvalId ? null : prev));
                updateLastAssistantTurn((turns) => {
                  const next = [...turns];
                  const idx = next.findIndex((t) => t.approvalId === parsed.approvalId || t.status === "waiting_approval");
                  if (idx >= 0) {
                    next[idx] = { ...next[idx], status: "running" };
                  }
                  return next;
                });
              }

              // 6. HITL Rejected
              else if (parsed.type === "hitl_rejected") {
                setPendingApproval((prev) => (prev?.approvalId === parsed.approvalId ? null : prev));
                updateLastAssistantTurn((turns) => {
                  const next = [...turns];
                  const idx = next.findIndex((t) => t.approvalId === parsed.approvalId || t.status === "waiting_approval");
                  if (idx >= 0) {
                    next[idx] = { ...next[idx], status: "rejected", output: parsed.reason || "Action rejected by human operator." };
                  }
                  return next;
                });
              }

              // 7. Execution Progress / Log Event
              else if (parsed.type === "task_progress" || parsed.type === "task_running" || parsed.log) {
                const chunk = parsed.stdout || parsed.stderr || parsed.log || parsed.output || "";
                if (chunk) {
                  setStreamLogs((prev) => [...prev, chunk]);
                  updateLastAssistantTurn((turns) => {
                    if (turns.length === 0) return turns;
                    const next = [...turns];
                    const lastIdx = next.length - 1;
                    const prevOut = next[lastIdx].output || "";
                    next[lastIdx] = { ...next[lastIdx], output: prevOut + chunk };
                    return next;
                  });
                }
              }

              // 8. Tool Completed
              else if (parsed.type === "tool_completed") {
                const turnNum = parsed.turn;
                updateLastAssistantTurn((turns) => {
                  const next = [...turns];
                  const idx = turnNum ? next.findIndex((t) => t.turn === turnNum) : next.length - 1;
                  if (idx >= 0) {
                    next[idx] = {
                      ...next[idx],
                      output: parsed.output || next[idx].output || "",
                      exitCode: parsed.exitCode,
                      status: parsed.exitCode === 0 ? "completed" : "failed",
                    };
                  }
                  return next;
                });
              }

              // 9. Stream Finished / Final Response
              else if (parsed.type === "stream_finished" || parsed.finalResponse) {
                const finalTxt = parsed.finalResponse || parsed.response;
                if (finalTxt) {
                  messageBufferRef.current = finalTxt;
                  setMessages((prev) => {
                    const updated = [...prev];
                    if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                      updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        content: finalTxt,
                      };
                    }
                    return updated;
                  });
                }
              }

              // Fallback for response text chunks
              else if (parsed.response) {
                messageBufferRef.current += parsed.response;
                setMessages((prev) => {
                  const updated = [...prev];
                  if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: messageBufferRef.current,
                    };
                  }
                  return updated;
                });
              }

              if (parsed.actions) {
                setMessages((prev) => {
                  const updated = [...prev];
                  if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      actions: parsed.actions,
                    };
                  }
                  return updated;
                });
              }
            } catch (e) {
              if (dataStr) {
                messageBufferRef.current += dataStr;
                setMessages((prev) => {
                  const updated = [...prev];
                  if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: messageBufferRef.current,
                    };
                  }
                  return updated;
                });
                setStreamLogs((prev) => [...prev, dataStr]);
              }
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("Stream manually aborted by user.");
        return;
      }

      if (retryCount < MAX_RETRIES) {
        const backoffDelay = Math.pow(2, retryCount) * 1000;
        console.warn(`Stream interrupted. Reconnecting in ${backoffDelay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);

        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        await submitPrompt(promptText, sessionId, retryCount + 1);
      } else {
        console.error("Max stream retries reached. Connection failed.");
      }
    }
  };

  const runStreamAndChat = async (userPrompt: string, historySnapshot: ChatMessage[], sessionId: string) => {
    setIsStreaming(true);

    // 1. Store user message in Durable Object backend
    await saveMessageToBackend(sessionId, "user", userPrompt);

    // Prepare UI state for live streaming assistant response
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "" }
    ]);

    // 2. Stream execution with auto-reconnect and buffer resuming
    await submitPrompt(userPrompt, sessionId, 0);

    const accumulatedAssistantText = messageBufferRef.current || "Sovereign Agent execution completed successfully.";

    // 3. Store assistant message in Durable Object backend
    await saveMessageToBackend(sessionId, "assistant", accumulatedAssistantText);

    // 4. Fetch updated DO history if available
    const doHistory = await fetchBackendHistory(sessionId);

    setIsStreaming(false);

    const updatedMessages: ChatMessage[] = doHistory || [
      ...historySnapshot,
      { role: "user", content: userPrompt },
      { role: "assistant", content: accumulatedAssistantText },
    ];

    // Save session to local storage for sidebar chat history
    const sessionToSave: ChatSessionItem = {
      id: sessionId,
      title: userPrompt,
      timestamp: Date.now(),
      messages: updatedMessages,
      logs: streamLogs,
    };

    saveChatSession(sessionToSave);
    refreshHistory();
  };

  const handleStartPrompt = (prompt: string, providedSessionId?: string) => {
    const sessionId = providedSessionId || `sovereign-session-${Date.now()}`;
    setCurrentSessionId(sessionId);
    setActiveSessionId(sessionId);
    setActivePrompt(prompt);
    setMessages([{ role: "user", content: prompt }]);
    setStreamLogs([]);

    runStreamAndChat(prompt, [], sessionId);
  };

  const handleSendMessage = (text: string) => {
    if (!text.trim()) return;
    const historySnapshot = [...messages];
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    const sessionId = currentSessionId || `sovereign-session-${Date.now()}`;
    if (!currentSessionId) {
      setCurrentSessionId(sessionId);
      setActiveSessionId(sessionId);
    }

    runStreamAndChat(text, historySnapshot, sessionId);
  };

  // If no prompt has been submitted yet and no chat history is selected, render LandingView
  if (!activePrompt && messages.length === 0) {
    return <LandingView onSubmitPrompt={handleStartPrompt} />;
  }

  // Once prompt is submitted or history item selected, render SplitChatView
  return (
    <>
      <SplitChatView
        initialPrompt={activePrompt}
        messages={messages}
        isStreaming={isStreaming}
        streamLogs={streamLogs}
        onSendMessage={handleSendMessage}
        onNewChat={handleNewChat}
      />

      <HITLApprovalModal
        approvalData={pendingApproval}
        onResolved={(_id, _approved) => {
          setPendingApproval(null);
        }}
      />

      <VisualPreviewModal
        data={visualPreviewData}
        onClose={() => setVisualPreviewData(null)}
      />
    </>
  );
}