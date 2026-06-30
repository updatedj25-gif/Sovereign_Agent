import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { taskGroupsTable } from "./task-groups";

export const commandsTable = pgTable("commands", {
  id: serial("id").primaryKey(),
  taskGroupId: integer("task_group_id")
    .notNull()
    .references(() => taskGroupsTable.id, { onDelete: "cascade" }),
  cmd: text("cmd").notNull(),
  exitCode: integer("exit_code"),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommandSchema = createInsertSchema(commandsTable).omit({ id: true, createdAt: true });
export const selectCommandSchema = createSelectSchema(commandsTable);

export type InsertCommand = z.infer<typeof insertCommandSchema>;
export type Command = typeof commandsTable.$inferSelect;
