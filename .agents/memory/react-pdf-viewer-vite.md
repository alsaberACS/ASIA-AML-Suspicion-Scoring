---
name: react-pdf viewer + Vite/pnpm
description: Gotchas embedding the react-pdf (wojtekmaj) PDF viewer in a Vite app under strict pnpm — CSS paths, worker URL, pdfjs-dist dependency. NOT @react-pdf/renderer (see react-pdf-pitfalls.md).
---

# react-pdf viewer under Vite + strict pnpm

Two different libraries share the name: `react-pdf` (viewer, this file) vs `@react-pdf/renderer` (PDF generation, react-pdf-pitfalls.md).

- **v10 killed `dist/esm/` paths.** `import "react-pdf/dist/esm/Page/AnnotationLayer.css"` fails Vite import-analysis and blocks the whole app with an overlay. v10 paths are `react-pdf/dist/Page/*.css` — and if pages render with `renderTextLayer={false} renderAnnotationLayer={false}` (right choice for scanned forms), skip the CSS imports entirely.
- **Worker URL:** `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` does NOT resolve the bare package specifier — at runtime it 404s relative to the module path and pages never render. Use a Vite asset import instead: `import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"; pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;` (needs `vite/client` types).
- **Strict pnpm:** `pdfjs-dist` is a transitive dep of react-pdf and NOT importable from app code until added as a direct dependency. Pin it to the EXACT version react-pdf depends on (check `node_modules/react-pdf/package.json`) — pdfjs hard-errors on worker/API version mismatch.
- Serve the PDF binary from a dedicated GET endpoint and hand react-pdf the raw URL (`${BASE_URL}api/...`); don't pipe base64 through JSON/hooks.

**Why:** each of these failed loudly in sequence when the disclosure workbench was first built (Vite overlay → blank viewer → resolution error).
**How to apply:** any Vite artifact embedding the react-pdf viewer; check all three (CSS, worker, direct dep) before first run.
