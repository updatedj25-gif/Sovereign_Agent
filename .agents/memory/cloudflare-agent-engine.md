---
name: Cloudflare Agent Engine
description: Agent routes use Cloudflare Workers AI (llama-3.3-70b) via REST API — model name must NOT be URL-encoded in path
---

# Cloudflare Workers AI Integration

## Rule
Use `cfAiUrl(model)` helper — never `encodeURIComponent(model)` in the CF AI run URL.
The model name `@cf/meta/llama-3.3-70b-instruct-fp8-fast` contains `@` and `/` which must remain literal in the path segment.

**Why:** `encodeURIComponent` converts `@→%40`, `/→%2F`, producing a 404 from CF API.

**How to apply:** In `artifacts/api-server/src/routes/agent.ts`, always use the `cfAiUrl(model)` helper for all CF AI fetch calls.

## Agent system prompt strategy
The system prompt always injects the full DB context (all task groups + commands) before any AI call.
This prevents hallucination — the LLM can't invent tasks that don't exist.

## GitHub push
Repo: `Trinity-Ceo/Sovereign_Agent` (main branch)
Token env var: `GITHUB_TOKEN` (belongs to Trinity-Ceo account)
Push command: `GIT_TERMINAL_PROMPT=0 git push https://Trinity-Ceo:$GITHUB_TOKEN@github.com/Trinity-Ceo/Sovereign_Agent.git main`
