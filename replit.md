# ASIA AML Suspicion Scoring Console

AI-assisted money-laundering suspicion scoring for ASIA Consulting (Kuwait): one subject, accounts at five banks, heterogeneous xlsx statement exports in, defensible suspicion probability + evidence pack out.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 5000)
- `pnpm --filter @workspace/aml-console run dev` — web console (Vite)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `POST /api/demo/seed` — idempotent demo case (5 statement files, subject FAHAD); `POST /api/cases/:id/analyze` re-runs the pipeline
- Required env: `DATABASE_URL`; AI layers use Replit AI Integrations (Anthropic) via `@workspace/integrations-anthropic-ai`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; DB: PostgreSQL + Drizzle ORM; Validation: Zod (`zod/v4`)
- API codegen: Orval (OpenAPI spec is the contract between server and console)
- Frontend: React + Vite, shadcn/ui, Tailwind, Recharts; cybersecurity command-center theme, no emojis
- AI: Anthropic `claude-sonnet-4-6` through Replit AI Integrations proxy (no user API key; billed to Replit credits)

## Where things live

- `artifacts/api-server/src/aml/` — the entire scoring engine: `parse.ts` (adaptive xlsx extraction), `vocab.ts` (channel/narrative lexicons, counterparty extraction), `netting.ts` (internal-transfer pairing), `features.ts` (typology features + zones), `rules.ts` (M1 deterministic rules, FATF citations), `scoring.ts` (M2 Bayesian log-odds aggregation), `ai.ts` (P3 typology / P5 critic / P4 memo), `pipeline.ts` (orchestration), `demo.ts` (seed)
- `artifacts/api-server/demo-data/` — five heterogeneous demo statements (bank1..5.xlsx)
- `artifacts/aml-console/src/pages/` — dashboard + case workspace (intake, evidence pack tabs)
- `packages/api-spec/` — OpenAPI source of truth; `lib/api-client-react/` — generated hooks

## Architecture decisions

- Scoring is evidence-based Bayesian log-odds: prior 2% (−3.89 logits) + expert-elicited log-LR weights per fired rule, per-family diminishing returns (strongest full, others ×0.5), residual feature evidence capped at 0.9 admitting critical zones first, data-quality shrinkage scaling all evidence, rule floors, probability cap 0.97. The LLM NEVER states or adjusts the probability — it only narrates typologies, attacks the case (critic), and drafts the memo, citing txn ids.
- Validation gate: per-file extraction quality (parse rate, balance reconciliation, duplicates) suppresses alerts when low — an unreliable ledger cannot raise confident alarms. Reconciliation is order-aware (newest-first exports are reconciled in reverse).
- Counterparties are mined from narratives when no column exists ("Transfer from X", "InstaPay ref-ACCT") — this unlocks fan-in/funnel detection; settlement rails (Central Bank) are never counterparties.
- Bands: Low <.05, Moderate <.2, Elevated <.5, High <.8, Critical ≥.8. Kuwait KD 3,000 cash trigger drives structuring features.

## Product

- Case registry → file intake with per-file parser transparency → consolidated evidence pack: score dial, Bayesian driver waterfall, rule engine hits with FATF citations, feature matrix, consolidation/netting view, timeline, AI analyst (profile consistency, typologies, benign scenarios, objections, memo), transaction explorer with flag filters, disposition workflow.

## User preferences

- Cybersecurity command-center aesthetic ("attractive and impactful"), ASIA branding, strictly no emojis anywhere in UI or documents.
- E2E tests and code-review round explicitly waived by the user for this first build.

## Gotchas

- After template copy, workspace deps exist in package.json but are not installed — run `pnpm install`.
- Query params: `z.coerce.boolean()` turns "false" into true — raw-string check for boolean query params in routes.
- Generated react-query hooks: passing `query` options requires an explicit `queryKey` (use exported `getXQueryKey` helpers).
- bank1.xlsx has a huge formatted range with only ~29 real data rows — parsing "few" rows there is correct, not a bug.
