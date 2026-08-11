---
name: Orval zod barrel TS2308 fix
description: How to fix duplicate-export collisions in lib/api-zod when using orval zod client with split mode
---

## The rule
Remove the `schemas` option from the zod output block in `lib/api-spec/orval.config.ts`. Then, after running orval, overwrite `lib/api-zod/src/index.ts` to only export from `./generated/api`.

**Why:** With `schemas: { path: "generated/types", type: "typescript" }`, orval generates TypeScript types in `generated/types/` AND Zod schemas in `generated/api.ts` — both with the same names (e.g. `AgentChatResponse`, `GetRepoTreeParams`). The barrel at `src/index.ts` re-exports from both, causing TS2308. Removing `schemas` stops the separate TS type generation; the Zod schemas in `generated/api.ts` are sufficient.

**How to apply:** Any time the zod codegen is set up with `schemas` and `mode: "split"`, remove the `schemas` key. Then run `npx orval --config ./orval.config.ts` (not the full `codegen` script which chains typecheck), overwrite the barrel to `export * from "./generated/api";`, then run `pnpm run typecheck:libs`.
