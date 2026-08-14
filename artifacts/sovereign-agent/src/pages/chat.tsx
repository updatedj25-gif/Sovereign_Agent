import React, { useState } from "react";
import { Shell } from "../components/layout/Shell";
import { LandingView } from "../components/chat/LandingView";
import { SplitChatView, ChatMessage } from "../components/chat/SplitChatView";
import { ActionItem } from "../components/chat/ActionAccordion";
import { HITLApprovalModal, PendingApprovalData } from "../components/agent/HITLApprovalModal";

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId] = useState(() => `sovereign-session-${Date.now()}`);
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalData | null>(null);

  const handleSendMessage = async (promptText: string) => {
    if (!promptText.trim() || isStreaming) return;

    const userMessage: ChatMessage = { role: "user", content: promptText };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);

    let currentActions: ActionItem[] = [];

    // Add assistant message placeholder
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Executing plan...", actions: [] },
    ]);

    try {
      const response = await fetch("/api/agent/react-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, sessionId }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalSummaryText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.replace(/^data:\s*/, "");
          try {
            const event = JSON.parse(jsonStr);

            // 1. Roadmap Subtasks
            if (event.type === "roadmap_ready" && Array.isArray(event.subtasks)) {
              currentActions = event.subtasks.map((title: string) => ({
                title,
                status: "pending",
              }));
              updateAssistantMessage(currentActions, "Subtasks initialized.");
            }

            // 2. Task Running
            else if (event.type === "task_running" || event.type === "tool_started") {
              const taskTitle = event.task || event.tool || "";
              currentActions = currentActions.map((act) =>
                act.title === taskTitle || act.status === "running"
                  ? { ...act, status: "running" }
                  : act
              );
              updateAssistantMessage(currentActions, `Running step: ${taskTitle}`);
            }

            // 3. Task Progress / Output
            else if (event.type === "task_progress" || event.output) {
              const out = event.output || event.chunk || "";
              currentActions = currentActions.map((act) =>
                act.status === "running"
                  ? { ...act, output: (act.output || "") + "\n" + out }
                  : act
              );
              updateAssistantMessage(currentActions, "Executing step logs...");
            }

            // 4. Task Completed / Finished
            else if (event.type === "task_completed" || event.type === "stream_finished") {
              currentActions = currentActions.map((act) => ({
                ...act,
                status: "completed",
              }));
              finalSummaryText = event.summary || event.finalResponse || "Task completed in E2B sandbox.";
              updateAssistantMessage(currentActions, finalSummaryText);
            }

            // 5. HITL Approval
            else if (event.type === "hitl_approval_required" || event.type === "requires_approval") {
              setPendingApproval(event.approvalData || event);
            }
          } catch {
            /* ignore parse error */
          }
        }
      }
    } catch (err: any) {
      updateAssistantMessage(currentActions, `Execution Error: ${err.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  const updateAssistantMessage = (actions: ActionItem[], summary?: string) => {
    setMessages((prev) => {
      const copy = [...prev];
      if (copy.length > 0 && copy[copy.length - 1].role === "assistant") {
        copy[copy.length - 1] = {
          role: "assistant",
          content: summary || "Executing agent roadmap...",
          actions,
          summaryText: summary,
        };
      }
      return copy;
    });
  };

  const handleResolveApproval = async (approvalId: string, approved: boolean) => {
    setPendingApproval(null);
    try {
      await fetch("/api/safety/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, approved }),
      });
    } catch (err) {
      console.error("Failed to post approval decision:", err);
    }
  };

  return (
    <Shell>
      {messages.length === 0 ? (
        <LandingView onSubmitPrompt={handleSendMessage} />
      ) : (
        <SplitChatView
          messages={messages}
          isStreaming={isStreaming}
          onSendMessage={handleSendMessage}
          sessionId={sessionId}
        />
      )}

      <HITLApprovalModal
        data={pendingApproval}
        onResolve={handleResolveApproval}
      />
    </Shell>
  );
}