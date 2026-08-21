---
name: Monorepo env gotchas
description: Environment and codegen quirks in this pnpm workspace that repeatedly cost debugging time
---

- **After copying a template package** (e.g. integrations-anthropic-ai), its deps are declared but NOT installed — run `pnpm install` before typechecking, or module-not-found errors look like code bugs.
- **Zod v4 query params:** `z.coerce.boolean()` coerces the string "false" to `true`. For boolean query params, check the raw string ("true"/"1") in the route handler instead.
- **zod/v4 + drizzle-zod codegen exports PascalCase schema names** (`GetCaseParams`), and params schemas use `z.coerce` for numeric path params.
- **Anthropic SDK content blocks:** TS type-predicate narrowing on `ContentBlock` unions fails under this config; use `filter(...)` + cast.
- **pino child loggers as params:** typing a function parameter as `ReturnType<typeof logger.child>` resolves the generic to `never` under this TS config — declare a small structural interface (`{ info(...): void; warn(...): void; ... }`) instead.
- Run node scripts from inside the package dir that owns the dependency (pnpm strict node_modules layout).

## Codegen
- Regenerate API clients ONLY with: pnpm --filter @workspace/api-spec run codegen
- **Why:** bare `orval` emits `import * as zod from 'zod'` while the generated code uses zod v4 APIs (zod.int()); the codegen script runs patch-zod-import.mjs to point generated schemas at zod/v4, then typechecks libs.
- **How to apply:** any time lib/api-spec/openapi.yaml changes; never run plain `pnpm exec orval`.

## Vite first-import optimize reload (transient hook errors)
The first runtime import of a dependency that is in package.json but was never imported before (seen with framer-motion, then next-themes via the sonner wrapper) makes the live vite session optimize it: "new dependencies optimized ... reloading", plus one-off `Invalid hook call` / `Cannot read properties of null (reading 'useContext')` errors in already-open tabs.
**Why:** vite rewrites the dep graph mid-session; open tabs briefly execute mismatched module copies.
**How to apply:** do not chase dual-React ghosts. Confirm `ls node_modules/.pnpm | grep -E '^react@'` shows one copy, then do a fresh page load — a clean console means it was the optimize blip, not a real bug.

## Phantom console errors from mid-edit HMR windows

Multi-step edits to one file can hot-apply broken intermediate modules into
long-lived browser tabs (e.g. ReferenceError for an identifier whose import was
removed one edit before its usages; esbuild compiles undefined identifiers fine
and they throw only at runtime). These phantom errors are absent from a fresh
load of the final code - before debugging a console error reported from an open
tab, check whether the current file still contains the referenced identifier
and re-verify on a clean navigation.
