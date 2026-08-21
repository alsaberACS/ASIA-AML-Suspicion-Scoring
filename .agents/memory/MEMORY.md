# Memory Index

- [Orval hook options](orval-query-options.md) — hooks need explicit `queryKey` when passing `query` options; mutations never auto-invalidate — prop-drill the owner's refetch for in-place refresh.
- [Statement parsing lessons](statement-parsing-lessons.md) — reconcile running balances in both row orders; mine counterparties from narratives; sparse xlsx grids legitimately parse few rows.
- [AML scoring conventions](aml-scoring-conventions.md) — weights are expert-elicited log-LRs; family diminishing returns halves same-family rules; residual cap must admit critical features first.
- [Monorepo env gotchas](monorepo-env-gotchas.md) — pnpm install after copy; zod coerce.boolean("false") is true; codegen ONLY via api-spec script; first-import vite optimize = transient hook errors.
- [Toast system](ui-toast-system.md) — all toasts are sonner; sonner's own Toaster must be mounted or every toast is a silent no-op; radix use-toast trio deleted, don't resurrect.
- [Identity resolution](identity-resolution.md) — counterparty analytics key on identity clusters; digit-preserving normalizer; masked refs merge only literally; self-references nulled at ingestion.
- [Dev API access](dev-api-access.md) — proxy path /api-server serves the SPA (HTML 200 trap); reach the API via PORT from /proc; health is /api/healthz; latest run is GET /cases/:id/analysis.
- [react-pdf pitfalls](react-pdf-pitfalls.md) — fixed absolute footer needs explicit height or >7-page docs crash; page/wrapper lineHeight breaks render-prop page numbers — set it per body style only.
- [react-pdf viewer + Vite](react-pdf-viewer-vite.md) — v10 killed dist/esm CSS paths; worker needs ?url asset import; pdfjs-dist must be a direct dep pinned to react-pdf's exact version.
- [Sanctions screening](sanctions-screening.md) — OFAC/UN endpoints 302 (plain GET, follow, no Range); possible-tier needs distinctive-token filter; PDF section numbers also hide in aiComplete ternaries.
- [Disclosure extraction](disclosure-extraction.md) — whole-PDF document block to Claude works; upsert-runners need upload-token conditional writes; AI stages re-fetch async inputs at stage time.
- [Disclosure locator](disclosure-locator.md) — sideways scans: models flip row boxes to reading frame; repair via model-reported page rotation; salvage+retry flaky JSON; verify by overlay on pdftoppm renders.
- [Tester console noise](tester-console-noise.md) — long-lived tester browsers accumulate stale HMR errors; hard-reload before treating console errors as real bugs.
- [Publish promote debugging](deploy-debugging.md) — build log dying at "Creating Autoscale service" +5min = candidate never ready; its logs are never surfaced — replicate prod boot locally to split app vs platform.
