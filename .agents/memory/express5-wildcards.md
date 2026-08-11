---
name: Express 5 wildcard route patterns
description: How to handle catch-all path segments in Express 5 (path-to-regexp v8)
---

## The rule
Never use `*` or `(:param)(*)` wildcard patterns in Express 5 routes. path-to-regexp v8 rejects both. Use a query parameter for paths that need to capture arbitrary slashes.

**Why:** Express 5 upgraded to path-to-regexp v8 which is strict about wildcard syntax and throws `PathError` at startup for any undefined or parenthesized wildcards.

**How to apply:**
- Instead of `router.get("/repos/:owner/:repo/contents/*", ...)` → use `router.get("/repos/:owner/:repo/contents", ...)` and read `req.query.path`.
- Update any OpenAPI spec path params that would generate catch-all client routes to use query params instead.
- The named wildcard syntax that DOES work in some versions (`{:param}*`) is not reliably supported in the version shipped with Express 5.2.x — avoid it.
