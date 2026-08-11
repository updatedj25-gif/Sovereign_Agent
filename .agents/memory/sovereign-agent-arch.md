---
name: Sovereign Agent architecture
description: Key design decisions for the Sovereign Agent full-stack coding agent app
---

## Architecture
- **Frontend:** React + Vite at `artifacts/sovereign-agent/` (previewPath `/`). Dark carbon/amber theme ("Amber Carbon"). Chat UI with SSE streaming, task accordion, GitHub panel.
- **API server:** Express 5 at `artifacts/api-server/` (previewPath `/api`). Routes: `/api/agent/chat`, `/api/agent/stream`, `/api/tasks`, `/api/github`.
- **Database:** PostgreSQL via Drizzle ORM. Tables: `task_groups` (id, title, status enum, summary, timestamps), `commands` (id, task_group_id FK, cmd, exit_code, stdout, stderr, timestamp).
- **Cloudflare AI:** Called via REST API from Express server using `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL` env secrets. Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- **GitHub:** Server-side proxy using `GITHUB_TOKEN` secret. Never exposes token to client.

## SSE event format (agent/stream)
Frontend (chat.tsx) expects `event.type` (not `event.event`). Backend sends: `{ type: "analysis_started"|"roadmap_ready"|"task_running"|"task_progress"|"task_completed"|"stream_finished"|"error", ... }`.
`roadmap_ready.subtasks` must be `string[]` (task titles only, not objects).

**Why:** The design subagent built the frontend using `event.type` convention; the backend must match.

## GitHub file contents route
Uses `GET /api/github/repos/:owner/:repo/contents?path=<filepath>` (query param) instead of a path param, because Express 5 / path-to-regexp v8 doesn't support catch-all wildcard path segments.
