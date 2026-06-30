import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taskStatusEnum = ["pending", "running", "success", "failed"] as const;
export type TaskStatus = (typeof taskStatusEnum)[number];

export const taskGroupsTable = pgTable("task_groups", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status", { enum: taskStatusEnum }).notNull().default("pending"),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskGroupSchema = createInsertSchema(taskGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectTaskGroupSchema = createSelectSchema(taskGroupsTable);
export const updateTaskGroupSchema = insertTaskGroupSchema.partial();

export type InsertTaskGroup = z.infer<typeof insertTaskGroupSchema>;
export type TaskGroup = typeof taskGroupsTable.$inferSelect;
