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

- **Node.js**: v20.x or higher
- **pnpm**: v9.x or higher (`corepack enable pnpm`)
- **Cloudflare Account**: Authenticated via `npx wrangler login`

### Required Environment Variables
Ensure the following variables are configured in `.env` or passed via Cloudflare secrets:

```env
GEMINI_API_KEY=your_gemini_api_key
CLOUDFLARE_ACCOUNT_ID=your_cf_account_id
CLOUDFLARE_API_TOKEN=your_cf_api_token
```

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

Deploy backend Workers to Cloudflare using Wrangler flags:

### Deploy Main Durable Object Worker (`sovereign-agent`)

```bash
cd workers

# Deploy main orchestrator worker with nodejs_compat compatibility flag
npx wrangler deploy --config wrangler.toml
```

### Deploy Edge API Gateway Worker (`sovereign-agent-api`)

```bash
cd workers

# Deploy API router worker
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
curl -i https://sovereign-agent-api.trinityceo717.workers.dev/api/health

# Validate SSE stream handshake
curl -N https://sovereign-agent.trinityceo717.workers.dev/api/session/sovereign-session-default/stream
```
