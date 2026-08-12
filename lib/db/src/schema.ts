import { pgTable, serial, text, integer, boolean, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";

// Enums
export const taskGroupStatusEnum = pgEnum("task_group_status", [
  "running",
  "success",
  "failed",
  "waiting_approval",
]);

export const toolStatusEnum = pgEnum("tool_status", [
  "running",
  "success",
  "failed",
  "rejected",
]);

// 1. Task Groups Table
export const taskGroups = pgTable("task_groups", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  status: taskGroupStatusEnum("status").notNull().default("running"),
  summary: text("summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 2. Commands Execution Logs Table
export const commands = pgTable("commands", {
  id: serial("id").primaryKey(),
  taskGroupId: integer("task_group_id")
    .notNull()
    .references(() => taskGroups.id, { onDelete: "cascade" }),
  cmd: text("cmd").notNull(),
  exitCode: integer("exit_code"),
  stdout: text("stdout"),
  stderr: text("stderr"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 3. Fine-Grained Tool Execution Logs
export const toolExecutions = pgTable("tool_executions", {
  id: serial("id").primaryKey(),
  taskGroupId: integer("task_group_id")
    .notNull()
    .references(() => taskGroups.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  argumentsJson: jsonb("arguments_json"),
  resultJson: jsonb("result_json"),
  status: toolStatusEnum("status").notNull().default("running"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 4. HITL Approval Audit Trail
export const approvalAuditLogs = pgTable("approval_audit_logs", {
  id: serial("id").primaryKey(),
  taskGroupId: integer("task_group_id")
    .notNull()
    .references(() => taskGroups.id, { onDelete: "cascade" }),
  approvalId: text("approval_id").notNull(),
  toolName: text("tool_name").notNull(),
  argumentsJson: jsonb("arguments_json"),
  approved: boolean("approved").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 5. Verification Check Runs
export const verificationRuns = pgTable("verification_runs", {
  id: serial("id").primaryKey(),
  taskGroupId: integer("task_group_id")
    .notNull()
    .references(() => taskGroups.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("all"),
  passed: boolean("passed").notNull(),
  typecheckPassed: boolean("typecheck_passed"),
  testPassed: boolean("test_passed"),
  issuesJson: jsonb("issues_json"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 6. Visual Verification Screenshots & DOM Artifacts
export const visualSnapshots = pgTable("visual_snapshots", {
  id: serial("id").primaryKey(),
  taskGroupId: integer("task_group_id")
    .notNull()
    .references(() => taskGroups.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title"),
  screenshotBase64: text("screenshot_base64"),
  consoleLogsJson: jsonb("console_logs_json"),
  domSummarySnippet: text("dom_summary_snippet"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});