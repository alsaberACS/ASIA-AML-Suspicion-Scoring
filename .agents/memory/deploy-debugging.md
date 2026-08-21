---
name: Publish promote-step debugging
description: How to tell app-side from platform-side publish failures in this monorepo; what the deployment log stream does and does not show.
---

# Publish promote-step debugging

Rule: when a publish build log ends at "Creating Autoscale service" and the build is marked failed ~5 minutes later with no error line, the candidate revision never became ready. Candidate-revision logs are NOT surfaced in the deployment log stream (fetchDeploymentLogs / RefreshAllLogs only show the live revision), so absence of logs there is not evidence about the candidate.

**Why:** Two consecutive publishes failed exactly 5m00s after "Creating Autoscale service" (a healthy promote completes it in ~20s: "upsertCloudRunService completed" → "Deployment successful"). No candidate logs existed in any window, while the old live version's cold starts logged normally.

**How to apply:** Before blaming the app, replicate production locally — it takes ~10s total and is decisive:
1. `NODE_ENV=production pnpm --filter @workspace/api-server run build` and the aml-console build with its build.env (NODE_ENV/PORT/BASE_PATH).
2. Boot exactly as production does: `PORT=<spare> NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs`, then curl `/api/healthz` on that port. Healthy boot is <2s (sanctions warm-load runs after listen and never blocks the port; it takes ~0.7s locally vs 100-250s in production due to network — still non-blocking).
3. Check `artifacts/aml-console/dist/public/index.html` exists after the web build (static probe path is `/`).
If all green plus schema diff empty plus prod secrets present, the failure is platform-side: recommend one retry, then Replit support with the build IDs and the "5-minute timeout at Creating Autoscale service" detail.

Other checks that ruled things out fast: `explainSchemaDiff()` (pending DB migration), prod `information_schema.columns` read-only query (column actually present), `machineConfiguration` on builds (same cr-2-4 for success and failure), `getDeploymentInfo()` (old build stays live and serving during failed promotes).

Note: the sidecar logs "healthcheck /api returned status 500" for the first ~1-3s of every cold start until port 8080 opens — normal noise, not a failure signal. `fetchDeploymentLogs` timestamps: no-args works; timestamp filtering returned nothing for past windows regardless of seconds/ms.
