import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@workspace/db";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString: connectionString || "postgres://postgres:postgres@localhost:5432/sovereign_agent",
});

export const db = drizzle(pool, { schema });

// Persistence Helper Methods

export async function createDbTaskGroup(title: string) {
  const [result] = await db
    .insert(schema.taskGroups)
    .values({ title, status: "running" })
    .returning();
  return result;
}

export async function updateDbTaskGroupStatus(
  id: number,
  status: "running" | "success" | "failed" | "waiting_approval",
  summary?: string
) {
  const [result] = await db
    .update(schema.taskGroups)
    .set({ status, summary, updatedAt: new Date() })
    .where(eq(schema.taskGroups.id, id))
    .returning();
  return result;
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
  const [result] = await db.insert(schema.toolExecutions).values(data).returning();
  return result;
}

export async function recordApprovalAudit(data: {
  taskGroupId: number;
  approvalId: string;
  toolName: string;
  argumentsJson: Record<string, any>;
  approved: boolean;
  reason?: string;
}) {
  const [result] = await db.insert(schema.approvalAuditLogs).values(data).returning();
  return result;
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
  const [result] = await db.insert(schema.verificationRuns).values(data).returning();
  return result;
}

export async function recordVisualSnapshot(data: {
  taskGroupId: number;
  url: string;
  title?: string;
  screenshotBase64?: string;
  consoleLogsJson?: any[];
  domSummarySnippet?: string;
}) {
  const [result] = await db.insert(schema.visualSnapshots).values(data).returning();
  return result;
}

export * from "@workspace/db";