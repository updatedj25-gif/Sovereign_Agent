export interface ReActMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  lastUpdated: string;
  credentials: {
    aiProvider: string;
    model: string;
    sandbox: string;
  };
}

export interface SubAction {
  id: string;
  type: "command" | "python" | "write_file" | "read_file" | "thought" | "env_box";
  title: string;
  status: "pending" | "running" | "completed" | "error";
  command?: string;
  output?: string;
  icon?: string;
}

export interface TaskGroup {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "error";
  command: string;
  output: string;
  subActions: SubAction[];
}

export interface FileItem {
  name: string;
  path: string;
  type: "file" | "directory";
}
