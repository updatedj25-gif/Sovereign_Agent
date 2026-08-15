export interface ChatSessionItem {
  id: string;
  title: string;
  updatedAt?: string;
  timestamp?: number;
  preview?: string;
  messageCount?: number;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  logs?: string[];
}

const STORAGE_KEY = "sovereign_chat_sessions_v1";

export function getChatHistory(): ChatSessionItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to load chat history:", e);
    return [];
  }
}

export function saveChatSession(session: ChatSessionItem): void {
  try {
    const history = getChatHistory().filter((s) => s.id !== session.id);
    const updated = [session, ...history].slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save chat session:", e);
  }
}

export function getChatSession(id: string): ChatSessionItem | null {
  const history = getChatHistory();
  return history.find((s) => s.id === id) || null;
}

export function deleteChatSession(id: string): void {
  try {
    const history = getChatHistory().filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    console.error("Failed to delete chat session:", e);
  }
}
