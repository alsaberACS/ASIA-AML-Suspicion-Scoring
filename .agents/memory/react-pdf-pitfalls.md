---
name: react-pdf server-side pitfalls
description: Crash and rendering quirks when generating PDFs with @react-pdf/renderer on the API server
---

# react-pdf server-side pitfalls

## Fixed absolute footer MUST have explicit height
- A `fixed` View with `position: "absolute", bottom: N` and **no height** makes Yoga's unresolved top compound geometrically (~x42 per page). Under ~8 pages the garbage stays below pdfkit's 1e21 limit and renders "fine"; beyond that the render throws `unsupported number: -2.7e21` in `clipBorderTop`.
- **Why:** bottom-anchored absolute layout has no height constraint to resolve against; each page's layout pass multiplies the error.
- **How to apply:** always give fixed footers/mastheads an explicit `height`. If a PDF crashes with `unsupported number` in a border clip, suspect the fixed chrome first, not the content sections.

## Page-level lineHeight silently kills render-prop page numbers
- Any `lineHeight` on the Page style makes every `<Text render={({pageNumber}) => ...} fixed />` render NOTHING (v4.6.x). A local `lineHeight` override on the Text does NOT rescue it; page count, masthead structure, and Text placement are red herrings.
- **Fix:** keep the Page style lineHeight-free and put lineHeight on the individual body-text styles (paragraphs, bullets, memo). Do NOT route it through a content wrapper View — inherited-through-View lineHeight inflates spacing (~2x page count).
- When bisecting react-pdf, change ONE style/structure variable per variant — lineHeight rode along with an unrelated structural change and confounded a whole round.

## Debugging recipe that worked
- Bisect by DATA, not code: clone the API run payload and empty one section at a time, rendering directly via an esbuild-bundled harness (`--packages=external`, bundle inside the package so node_modules resolves). Leave-one-out isolates the section; a temporary guard log injected into @react-pdf/render's clip function fingerprints the crashing node via its border widths/padding (revert after).
- Bordered+rounded content cards should be `wrap={false}` anyway; long boxes that must split across pages (case memo) should not have borderRadius.

## Unitless lineHeight requires an explicit fontSize in the SAME style object
Rule: any Text style that sets a unitless `lineHeight` must also declare `fontSize` in that same style object.
**Why:** @react-pdf resolves the unitless multiplier against the DEFAULT font size (18pt), not the inherited one. A style like `{ lineHeight: 1.5 }` on 9pt inherited text renders near-double-spaced (27pt leading). Styles with `fontSize` alongside render correctly, which makes the bug look intermittent across components.
**How to apply:** when paragraphs look mysteriously double-spaced in a rendered PDF, check for lineHeight-without-fontSize before suspecting anything else.
