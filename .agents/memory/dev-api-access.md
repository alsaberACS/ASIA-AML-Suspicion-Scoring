---
name: Dev API access for curl/scripts
description: How to reach the api-server from the shell in development - the shared proxy path serves the SPA, not the API.
---

# Dev API access (curl / scripts)

- `http://localhost:80/api-server/...` does NOT reach the API server: the
  shared proxy falls back to the aml-console SPA for unknown paths, returning
  Vite HTML with status 200. A "200 OK" from a proxy path is not proof the API
  answered - check the body is JSON.
- To reach the API directly: find the workflow process
  (`pgrep -f dist/index.mjs`), read PORT from `/proc/<pid>/environ`, then hit
  `http://127.0.0.1:<PORT>/api/...`. Express mounts the router at `/api`;
  health is `/api/healthz` (not /api/health).
- Latest-analysis endpoint is `GET /api/cases/:caseId/analysis` (no /latest
  suffix). Upload is `POST /api/cases/:caseId/files` with JSON
  `{filename, bankLabel, contentBase64}`; delete cascades transactions.
- Re-ingesting case 2 works from `attached_assets/بنك_*_1787248148376.xlsx`;
  bank label mapping: واحد=Boubyan, اثنين=Commercial Bank of Kuwait,
  ثلاثة=Gulf Bank, اربعة=Burgan Bank, خمسة=National Bank of Kuwait.
