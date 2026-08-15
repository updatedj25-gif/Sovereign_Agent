import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@workspace/db";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;

let isDbConnected = false;
let pool: Pool | null = null;
let db: any = null;

// In-memory fallback stores
let idCounter = 1;
const taskGroupsStore = new Map<number, any>();
const toolExecutionsStore = new Map<number, any>();
const approvalAuditStore = new Map<number, any>();
const verificationRunsStore = new Map<number, any>();
const visualSnapshotsStore = new Map<number, any>();

if (connectionString) {
  try {
    pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 2000,
    });
    db = drizzle(pool, { schema });
    isDbConnected = true;
  } catch (err) {
    console.warn("[Database] Failed to connect to PostgreSQL — using in-memory store:", err);
    isDbConnected = false;
  }
}

export { pool, db };

// Persistence Helper Methods with Fallbacks

export async function createDbTaskGroup(title: string) {
  if (isDbConnected && db) {
    try {
      const [result] = await db
        .insert(schema.taskGroups)
        .values({ title, status: "running" })
        .returning();
      return result;
    } catch (e) {
      console.warn("[Database] DB insert failed, falling back to memory:", e);
    }
  }
  const id = idCounter++;
  const taskGroup = {
    id,
    title,
    status: "running",
    summary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  taskGroupsStore.set(id, taskGroup);
  return taskGroup;
}

export async function updateDbTaskGroupStatus(
  id: number,
  status: "running" | "success" | "failed" | "waiting_approval",
  summary?: string
) {
  if (isDbConnected && db) {
    try {
      const [result] = await db
        .update(schema.taskGroups)
        .set({ status, summary, updatedAt: new Date() })
        .where(eq(schema.taskGroups.id, id))
        .returning();
      return result;
    } catch (e) {
      console.warn("[Database] DB update failed, falling back to memory:", e);
    }
  }
  const existing = taskGroupsStore.get(id) || { id, title: "Task Group", createdAt: new Date() };
  const updated = {
    ...existing,
    status,
    summary: summary || existing.summary,
    updatedAt: new Date(),
  };
  taskGroupsStore.set(id, updated);
  return updated;
}

export async function recordToolExecution(data: {
  taskGroupId: number;
  toolName: string;
  argumentsJson: Record<string, any>;
  status: "running" | "success" | "failed" | "rejected";
  resultJson?: Record<string, any>;
  error?: string;
  durationMs?: number;
}) {
  if (isDbConnected && db) {
    try {
      const [result] = await db.insert(schema.toolExecutions).values(data).returning();
      return result;
    } catch (e) {
      console.warn("[Database] DB insert failed, falling back to memory:", e);
    }
  }
  const id = idCounter++;
  const record = { id, ...data, createdAt: new Date() };
  toolExecutionsStore.set(id, record);
  return record;
}

export async function recordApprovalAudit(data: {
  taskGroupId: number;
  approvalId: string;
  toolName: string;
  argumentsJson: Record<string, any>;
  approved: boolean;
  reason?: string;
}) {
  if (isDbConnected && db) {
    try {
      const [result] = await db.insert(schema.approvalAuditLogs).values(data).returning();
      return result;
    } catch (e) {
      console.warn("[Database] DB insert failed, falling back to memory:", e);
    }
  }
  const id = idCounter++;
  const record = { id, ...data, createdAt: new Date() };
  approvalAuditStore.set(id, record);
  return record;
}

export async function recordVerificationRun(data: {
  taskGroupId: number;
  scope: string;
  passed: boolean;
  typecheckPassed: boolean;
  testPassed: boolean;
  issuesJson: any[];
  durationMs: number;
}) {
  if (isDbConnected && db) {
    try {
      const [result] = await db.insert(schema.verificationRuns).values(data).returning();
      return result;
    } catch (e) {
      console.warn("[Database] DB insert failed, falling back to memory:", e);
    }
  }
  const id = idCounter++;
  const record = { id, ...data, createdAt: new Date() };
  verificationRunsStore.set(id, record);
  return record;
}

export async function recordVisualSnapshot(data: {
  taskGroupId: number;
  url: string;
  title?: string;
  screenshotBase64?: string;
  consoleLogsJson?: any[];
  domSummarySnippet?: string;
}) {
  if (isDbConnected && db) {
    try {
      const [result] = await db.insert(schema.visualSnapshots).values(data).returning();
      return result;
    } catch (e) {
      console.warn("[Database] DB insert failed, falling back to memory:", e);
    }
  }
  const id = idCounter++;
  const record = { id, ...data, createdAt: new Date() };
  visualSnapshotsStore.set(id, record);
  return record;
}

export * from "@workspace/db";