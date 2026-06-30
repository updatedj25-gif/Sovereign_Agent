# Trinity Universe Web — AI Coding Agent Platform

An autonomous AI coding agent platform with structured task execution, live preview, secure secrets management, and a CI/CD pipeline deploying to Cloudflare Pages.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (`task_groups`, `commands` tables)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend sandbox: Vite + React + Tailwind CSS
- CI/CD: GitHub Actions → Cloudflare Pages (`trinity-universe-web`)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (`task-groups.ts`, `commands.ts`)
- `artifacts/api-server/src/routes/tasks.ts` — task group CRUD + command log routes
- `artifacts/mockup-sandbox/src/components/mockups/TaskGroupAccordion.tsx` — collapsible accordion UI component (spec §3)
- `.github/workflows/ci.yml` — typecheck → build → deploy to Cloudflare Pages
- `wrangler.toml` — Cloudflare Pages project config

## Architecture decisions

- **Contract-first API**: OpenAPI spec gates all codegen; never write hooks or Zod schemas by hand.
- **Task execution model**: `task_groups` tracks milestone status (pending/running/success/failed); `commands` logs individual shell outputs with exit codes — matching the spec's accordion UX.
- **Cloudflare Pages deploy**: frontend-only static deploy (mockup-sandbox/dist) via wrangler-action in CI; API server stays on Replit.
- **Secrets never in chat**: all credentials stored in Replit vault and injected as env vars; GitHub Actions reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from repo secrets.
- **Sequential CI gates**: typecheck must pass before build; build artifact must exist before deploy (needs: chain).

## Product

- Task group CRUD API (`GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id`)
- Command log append API (`POST /api/tasks/:id/commands`)
- TaskGroupAccordion UI: auto-expands on `running`/`failed`, auto-collapses on `success`, nested command sub-accordions with exit codes and stdout/stderr
- CI pipeline: push to `main` → typecheck → Vite build → Cloudflare Pages deploy

## User preferences

- GitHub repo: `Trinity-Ceo/Sovereign_Agent`
- Cloudflare Pages project: `trinity-universe-web`
- Secrets managed via Replit vault, never hardcoded

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- `pnpm --filter @workspace/db run push` requires `DATABASE_URL` to be set
- Cloudflare Pages project must exist before first wrangler deploy (create via dashboard or `wrangler pages project create`)
- GitHub Actions needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set as repo secrets

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
