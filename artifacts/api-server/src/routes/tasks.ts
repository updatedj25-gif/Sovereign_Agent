import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { taskGroupsTable, commandsTable, insertTaskGroupSchema, updateTaskGroupSchema, insertCommandSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

router.get("/tasks", async (req, res) => {
  try {
    const groups = await db.select().from(taskGroupsTable).orderBy(taskGroupsTable.createdAt);
    res.json(groups);
  } catch (err) {
    req.log.error(err, "Failed to list task groups");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tasks/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const [group] = await db.select().from(taskGroupsTable).where(eq(taskGroupsTable.id, id));
    if (!group) return void res.status(404).json({ error: "Task group not found" });

    const commands = await db.select().from(commandsTable).where(eq(commandsTable.taskGroupId, id)).orderBy(commandsTable.createdAt);
    res.json({ ...group, commands });
  } catch (err) {
    req.log.error(err, "Failed to get task group");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tasks", async (req, res) => {
  try {
    const body = insertTaskGroupSchema.parse(req.body);
    const [group] = await db.insert(taskGroupsTable).values(body).returning();
    res.status(201).json(group);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: (err as z.ZodError).issues });
    req.log.error(err, "Failed to create task group");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/tasks/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const body = updateTaskGroupSchema.parse(req.body);
    const [updated] = await db
      .update(taskGroupsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(taskGroupsTable.id, id))
      .returning();

    if (!updated) return void res.status(404).json({ error: "Task group not found" });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: (err as z.ZodError).issues });
    req.log.error(err, "Failed to update task group");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/tasks/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const [deleted] = await db.delete(taskGroupsTable).where(eq(taskGroupsTable.id, id)).returning();
    if (!deleted) return void res.status(404).json({ error: "Task group not found" });
    res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete task group");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tasks/:id/commands", async (req, res) => {
  try {
    const taskGroupId = parseInt(req.params.id, 10);
    if (isNaN(taskGroupId)) return void res.status(400).json({ error: "Invalid id" });

    const body = insertCommandSchema.parse({ ...req.body, taskGroupId });
    const [command] = await db.insert(commandsTable).values(body).returning();
    res.status(201).json(command);
  } catch (err) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: (err as z.ZodError).issues });
    req.log.error(err, "Failed to add command");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tasks/:id/commands", async (req, res) => {
  try {
    const taskGroupId = parseInt(req.params.id, 10);
    if (isNaN(taskGroupId)) return void res.status(400).json({ error: "Invalid id" });

    const commands = await db.select().from(commandsTable).where(eq(commandsTable.taskGroupId, taskGroupId)).orderBy(commandsTable.createdAt);
    res.json(commands);
  } catch (err) {
    req.log.error(err, "Failed to list commands");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
