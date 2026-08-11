# Sovereign Agent — Codebase Guide

> **For incoming agents and contributors.** This file explains the architecture, key decisions, and common gotchas so you can navigate the codebase quickly and avoid repeating past mistakes.

---

## What is Sovereign Agent?

Sovereign Agent is a full-stack AI coding assistant with a dark cockpit UI. It lets users describe tasks in natural language; the agent plans them as an ordered roadmap, executes each subtask with streaming progress updates, and persists the session history to PostgreSQL.

---

## Monorepo Layout

```
/
├── artifacts/
│   ├── sovereign-agent/     # React/Vite frontend (Tailwind, shadcn, wouter)
│   └── api-server/          # Express 5 backend (Node.js, SSE, Drizzle ORM)
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client/          # Generated Axios client (from Orval)
│   ├── api-client-react/    # Generated React Query hooks (from Orval)
│   ├── api-zod/             # Generated Zod validators (from Orval)
│   └── db/                  # Drizzle ORM schema + migrations
├── workers/                 # Cloudflare Workers (edge deployment)
│   ├── src/index.ts         # Main worker — streaming AI + Durable Objects
│   ├── src/api.ts           # API worker — non-streaming chat endpoint
│   ├── wrangler.toml        # Main worker config (sovereign-agent)
│   └── wrangler.api.toml    # API worker config (sovereign-agent-api)
├── .github/
│   ├── workflows/ci.yml     # Typecheck + build all packages
│   └── workflows/deploy.yml # Deploys both Cloudflare Workers on push to main
└── CODEBASE.md              # This file
```

---

## Frontend (`artifacts/sovereign-agent`)

### Stack
- **React 19** + **Vite 7** with TypeScript strict mode
- **Tailwind CSS v4** + **shadcn/ui** components (dark amber-carbon theme)
- **Wouter** for client-side routing (NOT react-router)
- **React Query** (`@tanstack/react-query`) for server state
- **Framer Motion** for animations

### Pages
| Route | File | Purpose |
|---|---|---|
| `/` | `pages/chat.tsx` | Main agent console — stream prompt, accordion task steps |
| `/tasks` | `pages/tasks.tsx` | List of all persisted task groups |
| `/tasks/:id` | `pages/task-detail.tsx` | Detail view for a single task group + commands |
| `/terminal` | `pages/terminal.tsx` | Interactive AI-powered terminal sandbox |
| `/github` | `pages/github.tsx` | GitHub repo browser + create repo dialog |

### Key Components
- **`Shell`** (`components/layout/Shell.tsx`) — sidebar nav, API health indicator, mobile header
- **`ThemeProvider`** (`components/theme-provider.tsx`) — wraps app for dark/light theming

### Streaming (IMPORTANT)
The chat page uses **native `fetch` + `ReadableStream`**, NOT the generated mutation hook, for the SSE stream. The stream events use a `type` field (not `event`):

```ts
// SSE event shapes:
{ type: "roadmap_ready", subtasks: string[] }
{ type: "task_running",  task: string }
{ type: "session_created", taskGroupId: number }
{ type: "task_complete", summary: string }
```

After the stream ends, the final prose reply arrives via the `useAgentChat` POST hook.

### Routing Base Path
The Vite app uses `import.meta.env.BASE_URL` as the wouter base — do NOT hardcode `/` as the base or relative navigation will break in the Replit preview proxy.

---

## API Server (`artifacts/api-server`)

### Stack
- **Express 5** (NOT Express 4 — wildcard route syntax differs, see Gotchas)
- **SSE** for agent streaming (`/api/agent/stream`)
- **Cloudflare AI** via REST (`https://api.cloudflare.com/client/v4/accounts/:id/ai/run/...`)
- **Drizzle ORM** + **PostgreSQL** for task persistence

### Routes
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/agent/chat` | Non-streaming chat |
| POST | `/api/agent/stream` | SSE streaming — main agent endpoint |
| GET | `/api/tasks` | List task groups |
| GET | `/api/tasks/:id` | Task group + commands |
| PATCH | `/api/tasks/:id` | Update status/summary |
| DELETE | `/api/tasks/:id` | Delete task group |
| GET | `/api/github/user` | Proxied GitHub user info |
| GET | `/api/github/repos` | Proxied repo list |
| GET | `/api/github/repos/:owner/:repo/tree` | Proxied file tree |
| GET | `/api/github/repos/:owner/:repo/contents` | File contents via `?path=` query |

### GitHub Proxy
All GitHub API calls go through the server. The `GITHUB_TOKEN` secret is **never sent to the browser**. The file-contents route uses `?path=` instead of a path segment because Express 5 / path-to-regexp v8 rejects catch-all path patterns (see Gotchas).

### DB Persistence
When a stream request arrives:
1. A `task_groups` row is created (status `running`).
2. `session_created` SSE event carries `taskGroupId` so the UI can link to it.
3. Each `task_running` event inserts a `commands` row.
4. On stream end, task group is marked `success` or `failed`.

---

## Database (`lib/db`)

### Schema
```
task_groups
  id          serial PK
  title       text NOT NULL
  status      enum('running','success','failed') NOT NULL  default 'running'
  summary     text
  created_at  timestamp NOT NULL default now()
  updated_at  timestamp NOT NULL default now()

commands
  id            serial PK
  task_group_id int NOT NULL → task_groups.id
  cmd           text NOT NULL   (the subtask title/command)
  exit_code     int
  stdout        text
  stderr        text
  created_at    timestamp NOT NULL default now()
```

### Migrations
Run `pnpm --filter @workspace/db run push` to apply schema changes. The DB URL is read from the `DATABASE_URL` environment secret.

---

## API Codegen (`lib/api-spec`, `lib/api-client`, `lib/api-client-react`, `lib/api-zod`)

The source of truth is `lib/api-spec/openapi.yaml`. Client code is generated by **Orval**:

```bash
cd lib/api-spec && pnpm run generate
```

### Orval Barrel Fix (IMPORTANT)
After running Orval, `lib/api-zod/src/index.ts` gets regenerated with **two** exports that collide (`TS2308`). Fix by overwriting the barrel immediately after generation:

```ts
// lib/api-zod/src/index.ts — must contain ONLY this line:
export * from "./generated/api";
```

The `orval.config.ts` already has `schemas` removed from the `zod` output block to minimise the collision — but the barrel still needs to be overwritten.

---

## Cloudflare Workers (`workers/`)

Two workers are deployed:

| Worker | Config | Entry | Purpose |
|---|---|---|---|
| `sovereign-agent` | `wrangler.toml` | `src/index.ts` | Streaming AI + Durable Object sessions |
| `sovereign-agent-api` | `wrangler.api.toml` | `src/api.ts` | Non-streaming chat for webhooks/batch |

### Durable Objects
`AgentSession` (class in `src/index.ts`) persists up to 40 turns of conversation history per session. The Durable Object is keyed by `sessionId` (a UUID from the client).

### Secrets for Deployment
These GitHub Actions repository secrets must be set for `deploy.yml` to work:
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Workers:Edit permission
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

---

## CI/CD (`.github/workflows/`)

### `ci.yml` — runs on every push + PR to `main`
1. **Typecheck** — `pnpm run typecheck` across all packages
2. **Build API** — `pnpm --filter @workspace/api-server run build`
3. **Build Workers** — `pnpm --filter @workspace/workers run build` (wrangler dry-run)
4. **Build Frontend** — `pnpm --filter @workspace/sovereign-agent run build`

### `deploy.yml` — runs on push to `main`
Deploys both Cloudflare Workers using `cloudflare/wrangler-action@v3`.

---

## Known Gotchas

### 1. Express 5 Wildcard Routes
Express 5 uses `path-to-regexp` v8, which **rejects** `*` and `(:param)(*)` patterns. Use query parameters for catch-all cases (e.g. `?path=` instead of `/*`). See `.agents/memory/express5-wildcards.md`.

### 2. Orval Zod Barrel Collision (`TS2308`)
Orval regenerates `lib/api-zod/src/index.ts` with duplicate exports. After every `pnpm run generate`, overwrite the file with `export * from "./generated/api";` only. See `.agents/memory/orval-zod-barrel.md`.

### 3. Wouter Base Path
`WouterRouter` is initialized with `base={import.meta.env.BASE_URL.replace(/\/$/, "")}`. Never hardcode `/` — the Replit preview proxy uses a path prefix.

### 4. SSE `type` vs `event` Field
The frontend parses `{ type: "..." }` from the JSON data payload — it does NOT use the SSE `event:` line. Don't confuse these when changing either side.

### 5. AI Model ID
The Cloudflare AI model in `agent.ts` is `@cf/meta/llama-3.1-70b-instruct`. This is passed as a URL segment in the REST call — ensure the model exists in your Cloudflare account.

---

## Environment Secrets

| Secret | Used By | Description |
|---|---|---|
| `CLOUDFLARE_API_KEY` | `api-server` | Cloudflare API key for AI REST calls |
| `CLOUDFLARE_EMAIL` | `api-server` | Cloudflare account email |
| `GITHUB_TOKEN` | `api-server` | GitHub PAT for proxied API calls |
| `SESSION_SECRET` | `api-server` | Express session secret |
| `DATABASE_URL` | `api-server`, `lib/db` | PostgreSQL connection string |

Set all of these as **Replit Secrets** (not in `.env` files). For GitHub Actions, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets.

---

## Development

```bash
# Install all dependencies
pnpm install

# Start API server (port from $PORT env)
pnpm --filter @workspace/api-server run dev

# Start frontend (port from $PORT env)
pnpm --filter @workspace/sovereign-agent run dev

# Regenerate API client from OpenAPI spec
cd lib/api-spec && pnpm run generate
# Then fix the barrel:
echo 'export * from "./generated/api";' > ../api-zod/src/index.ts

# Push DB schema changes
pnpm --filter @workspace/db run push

# Typecheck everything
pnpm run typecheck
```
