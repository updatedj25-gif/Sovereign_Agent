# Sovereign Agent — Deployment & Monorepo Operations Guide

This guide details the procedure for building, testing, syncing, and deploying the **Sovereign Agent** monorepo workspace to Cloudflare's global edge network using Wrangler and pnpm.

---

## Workspace Structure

```
Sovereign_Agent/
├── artifacts/
│   └── sovereign-agent/       # React 19 + Tailwind v4 + Radix UI Frontend App
├── workers/                   # Cloudflare Workers & Durable Objects Edge Backend
│   ├── src/
│   │   ├── index.ts           # Main Agent Durable Object Orchestrator
│   │   └── api.ts             # Edge API Gateway Router
│   ├── wrangler.toml          # Orchestrator worker deployment config
│   └── wrangler.api.toml      # API gateway worker deployment config
├── lib/                       # Shared monorepo packages
└── pnpm-workspace.yaml        # Workspace configuration
```

---

## 1. Prerequisites & Environment Setup

- **Node.js**: v24.x (the CI and deployment workflows use the same runtime)
- **pnpm**: v10.x (`corepack enable pnpm`)
- **Cloudflare Account**: Authenticated via `npx wrangler login`

### Required Environment Variables
For local Wrangler commands, authenticate with `npx wrangler login` or set these
environment variables. For GitHub Actions, add the same two values as repository
secrets named exactly `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`:

```env
GEMINI_API_KEY=your_gemini_api_key
CLOUDFLARE_ACCOUNT_ID=your_cf_account_id
CLOUDFLARE_API_TOKEN=your_cf_api_token
```

`CLOUDFLARE_API_TOKEN` must be an active Cloudflare API token with permission to
edit Workers. An API key (`CLOUDFLARE_API_KEY`) is a different credential type
and cannot be used as the Wrangler token without the matching account email.

---

## 2. Local Workspace Synchronization & Build

Run local workspace synchronization and typechecking prior to deployment:

```bash
# 1. Install all monorepo dependencies
pnpm install

# 2. Run TypeScript typecheck across all workspace packages
pnpm run typecheck

# 3. Execute Vitest component & unit test suite
pnpm --prefix artifacts/sovereign-agent test
```

---

## 3. Cloudflare Worker & Durable Object Deployment

Deploy backend Workers to Cloudflare using Wrangler flags. The configs use
isolated names (`sovereign-agent-replit` and `sovereign-agent-api-replit`) so
this repository cannot overwrite the existing production Workers with the
same product names.

### Deploy Main Durable Object Worker (`sovereign-agent`)

```bash
cd workers

# Validate the token and account before deploying
npx wrangler whoami

# Deploy main orchestrator worker with nodejs_compat compatibility flag
npx wrangler deploy --config wrangler.toml
```

### Deploy Edge API Gateway Worker (`sovereign-agent-api`)

```bash
cd workers

# Deploy API router worker (this worker has no Durable Object migrations)
npx wrangler deploy --config wrangler.api.toml
```

---

## 4. Useful Wrangler Deployment Flags

| Flag | Description |
| --- | --- |
| `--env production` | Specifies target Cloudflare deployment environment |
| `--keep-vars` | Prevents overriding remote secrets during publish |
| `--dry-run` | Validates bundle compilation without uploading to Cloudflare |
| `--minify` | Enables JS bundle minification on Cloudflare edge |

---

## 5. Verification & Health Monitoring

After deploying, verify endpoint health:

```bash
# Health check HTTP GET request
curl -i https://sovereign-agent-api-replit.<your-subdomain>.workers.dev/api/health

# Validate SSE stream handshake
curl -N https://sovereign-agent-replit.<your-subdomain>.workers.dev/api/session/sovereign-session-default/stream
```
