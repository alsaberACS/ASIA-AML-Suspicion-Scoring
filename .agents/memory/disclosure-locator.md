---
name: Disclosure locator (field-to-ink boxes)
description: Lessons from mapping disclosure form fields to page regions on sideways-scanned Nazaha PDFs with a vision model.
---

# Sideways scans and box geometry

Nazaha disclosure PDFs store A4 portrait pages with /Rotate 0, but the form
content is scanned 90 degrees sideways: handwriting runs vertically and a
table "row" is a TALL NARROW strip in raw page axes.

**Why it bites:** vision models stochastically emit row boxes transposed into
reading-frame axis order (wide flat bands) even when the prompt demands raw
stored-page axes and shows row examples in both orientations. Prompt
discipline alone is NOT reliable — one pass nails it, the next flips.

**How to apply:** require the model to also report per-page content rotation
(degrees clockwise to read normally) — that claim is far more reliable than
its coordinate-frame discipline. Then deterministically repair: on a 90/270
page, any row box wider than tall gets its x/y ranges swapped. Compact
single-field boxes usually stay in correct raw axes even when rows flip, so
only swap row items. Single-field boxes are per-run hit-or-miss (can drift
one strip onto a blank neighbor); a page-level flash fallback covers misses.

# Locator response flakiness

Gemini JSON mode intermittently: (a) appends trailing junk after the closing
brace, (b) truncates mid-array on thinking-heavy runs (~120 s instead of
~15 s) because thinking tokens share maxOutputTokens.

**How to apply:** generous maxOutputTokens; parse chain = strict loose-parse,
then first-balanced-object brace scan, then salvage of individual complete
{"key",...,"box_2d"} fragments via regex; plus one full retry of the model
call. Partial mapping beats none — the feature is approximate by design.

# Ground-truth verification

Overlay normalized boxes on `pdftoppm` page renders with `magick -draw
rectangle` and eyeball the result (PIL is absent in this environment).
Numbers alone lie: a coordinate list can look plausible while boxes sit on
blank strips. This caught both the transposed-rows regression and drifted
single-field boxes.

# Locations lifecycle convention

`extraction.locations` undefined = never mapped (UI auto-backfills once per
draft key); `[]` = mapped, nothing found. Corrections PUT without locations
carries stored ones forward only when per-section row counts match, else
drops them (self-heals: absence re-triggers backfill on next visit). The
locate route's UPDATE is guarded by a locations-absence predicate; a
concurrent loser re-selects and returns the winner's mapping.
