---
name: Monorepo env gotchas
description: Environment and codegen quirks in this pnpm workspace that repeatedly cost debugging time
---

- **After copying a template package** (e.g. integrations-anthropic-ai), its deps are declared but NOT installed — run `pnpm install` before typechecking, or module-not-found errors look like code bugs.
- **Zod v4 query params:** `z.coerce.boolean()` coerces the string "false" to `true`. For boolean query params, check the raw string ("true"/"1") in the route handler instead.
- **zod/v4 + drizzle-zod codegen exports PascalCase schema names** (`GetCaseParams`), and params schemas use `z.coerce` for numeric path params.
- **Anthropic SDK content blocks:** TS type-predicate narrowing on `ContentBlock` unions fails under this config; use `filter(...)` + cast.
- Run node scripts from inside the package dir that owns the dependency (pnpm strict node_modules layout).
