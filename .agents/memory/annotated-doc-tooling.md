---
name: Annotated-doc tooling
description: Lessons from generating annotated screenshot manuals as PDFs (react-pdf tool scripts, ImageMagick contact sheets)
---

# One-off TSX document generators

Rule: for a one-off react-pdf document tool in the api-server artifact, put the
TSX under src/tools/ (typecheck covers it) and bundle with the artifact's own
esbuild via a tiny script in tools/ (mirror build.mjs: platform node, format
esm, external @react-pdf/renderer + react), then run the bundle with plain node.
**Why:** node --experimental-strip-types cannot handle JSX, and no tsx/ts-node
binary exists at the workspace root; esbuild is already a dependency so no
installs are needed.
**How to apply:** build script + `node dist-tools/<name>.mjs`; keep the entry
self-contained (no imports from server code) so the server bundle is untouched.

# Annotated screenshot figures (absolute notes over images)

Rule: when handwritten notes/arrows are absolutely positioned inside a figure
container, the container height must be max(imageHeight, bottom of every note,
estimated from text length / chars-per-line), never just the image height.
**Why:** short-aspect screenshots with note stacks otherwise bleed notes into
the body text below — hit on 4 of 17 figures in the AML manual before the
auto-height fix.
**How to apply:** estimate note height as ceil(len*ptPerChar/width) lines *
lineHeight + pad; also keep note tips in image-fraction coords so resizing the
image never breaks arrows.

# react-pdf SVG prop casing

Rule: react-pdf SVG uses `strokeLinecap` (lowercase c), not `strokeLineCap`.
TS catches it; at runtime it would be silently ignored.

# ImageMagick in this workspace

Rule: any magick operation that rasterizes text (montage -label, caption:,
annotate) crashes with a missing-font error; geometry-only ops (+append,
-append, -crop, -resize) are safe.
**How to apply:** build contact sheets with append chains; skip labels or add
them via the PDF layer instead.
