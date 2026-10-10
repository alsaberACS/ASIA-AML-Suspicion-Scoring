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

## Overlays and "blank white page" reports (added 2026-10-10)
- react-pdf's `Page` div has an inline `backgroundColor: white` and the canvas is `visibility: hidden` while pdf.js draws. A "page went blank white after navigating/rotating" report is almost always a render still in progress on a slow browser, not a failed render — gate overlays on `onRenderSuccess` (it receives the page proxy; compare `page.pageNumber` to the current page) and show a "Rendering page N" hint while they differ, instead of chasing a cancellation race.
- A zoomed sheet inside `flex justify-center` + `overflow-hidden` wrapper shrinks/clips instead of scrolling; use `flex w-max min-w-full` on the row and `shrink-0 mx-auto` on the sheet so it centres when it fits and scrolls when wider.
- Reserve `pageWidth = paneWidth - padding - sheet border`; forgetting the 2px border leaves a 1px overflow and a phantom horizontal scrollbar at 100%.
