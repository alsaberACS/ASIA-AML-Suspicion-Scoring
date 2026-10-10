---
name: Disclosure extraction
description: Handwritten-PDF AI extraction pipeline - whole-PDF document blocks, upload-token conditional writes in background runners, stage-time re-fetch of async inputs
---

# Handwritten PDF extraction and async-input pipeline stages

## Dual-reader adjudication (Claude + Gemini)
Two independent AI reads of the same scanned form, then an adjudication pass, materially beats one read on handwriting: primary read (Claude, whole-PDF document block) -> secondary read (Gemini, `inlineData` PDF part + `responseMimeType: "application/json"`, read `resp.text`) -> Claude adjudicates with the PDF plus BOTH JSONs and must re-look at the ink to resolve disagreements.
**Why:** on a real 13-page handwritten Arabic form the readers genuinely disagreed on bank names, owner names, a 514,433-vs-51,433 amount, and dates - exactly the errors a single read presents confidently.
**How to apply:** secondary/adjudication failures must degrade to the primary reading plus an appended warning (never fail the run); record `readers {primary, secondary, adjudicated}` in the output; surface disagreements as row-level `alternates` strings ("first/second reader saw: X"; declarant alternates prefixed by field key) so the UI can point investigators at the right ink; write pipeline phase to the row under the same run-token guard as terminal writes; a fresh AI read nulls `correctedAt` (supersedes investigator corrections), and the corrections PUT re-coerces with the same coercer used for AI output. Client side, key the editing draft on `caseId + extractedAt` and clear it while status=processing, or a stale draft can be saved over a fresh reading.

## Whole-PDF document block
Send a scanned/handwritten PDF to Claude as ONE base64 `document` content block (`type: "document"`, `media_type: "application/pdf"`) in a single message - no rasterization needed. A 4.3 MB 13-page handwritten Arabic form cost ~20k input tokens and extracted reliably, including honest `uncertain: true` flags on ambiguous handwriting.
**How to apply:** prompt must explicitly exclude pre-printed example rows and define how "none declared" checkboxes map to structured output, or the model will absorb the form's own sample data.

## Upload-token conditional writes in fire-and-forget runners
A background runner keyed on a row id, combined with an upsert-replace endpoint, silently corrupts data: upload B replaces the row while run A is in flight, then A writes A's result onto B's content. A plain "already running" dupe guard makes it worse by swallowing B's launch entirely.
**Why:** row id survives the upsert, so id-conditional writes cannot distinguish uploads.
**How to apply:** capture an upload token (uploadedAt millis) when the runner loads the row; make every terminal write conditional on `id + uploadedAt + status=processing` with `.returning()` to detect and log discarded stale results; key the dupe guard on `(id, token)` so a replacement upload can launch while the stale run is still in flight; remove the guard entry in `finally` only when the map still holds your own token.
**Reprocess needs its own token:** a "re-run without re-upload" endpoint that reuses uploadedAt reopens the race - a zombie run that outlived the watchdog shares the token with the new run and its phase/terminal writes still match. Rotate a dedicated `run_token` (UUID column) on EVERY run start (upload and reprocess), condition all runner writes on it, and key the dupe map on it.

## Stage-time re-fetch of async-prepared inputs
An AI pipeline that snapshots inputs at run start silently skips stages whose input was still being prepared (e.g. analysis launched seconds after a document upload). "Done" bookkeeping keyed on *readiness* at run start makes the skip permanent for that run.
**How to apply:** key the stage's done-flag on row *existence*, not readiness; re-fetch inside the stage with a bounded poll (10s interval, a few minutes cap, respecting the preparer's own watchdog); on success rebuild any evidence/prompt context built earlier so downstream stages see the late-arriving input; on failure/timeout skip gracefully and log.

## Sideways scans: detect once, rotate a copy for the readers only
Scanners store the landscape Nazaha form as portrait pages with content on its side; models read sideways Arabic handwriting far worse (garbled owner names with digits, example rows absorbed, month-first dates). Fix: a 4-page probe PDF (page 1 copied with +0/+90/+180/+270 `/Rotate`) and the question "which page is upright, answer 1-4" is consistent (9/9 runs, ~4s); asking a model to report an angle or corner geometry for a single page is NOT (it mentally normalizes and says 0). Then hand the readers and the adjudicator a pdf-lib copy with `/Rotate` on every page (Claude's rasterizer honors it; Gemini noisy but fine); keep the stored original and the locator on raw axes, and ship the detected rotation to the viewer as a default.
**Pitfall:** a test file that already carries `/Rotate 90` makes "raw" and "rotated" probes identical and looks like model unreliability - check `pdfinfo`/page rotation before concluding anything.

## Form-specific failure modes a prompt alone does not fix
Pre-printed example rows (fictitious family "أحمد محمد فهد", xxxx/20xx placeholders, sample assets) get transcribed as real assets; readers also emit two options joined by "/" for checkbox columns, write English notes in place of values ("(issuer illegible)"), and the adjudicator sometimes prefers the *plausible* reading over the ink. Keep a deterministic post-pass (drop fingerprinted example rows - owner family + 2 cells, or 3/3 non-owner cells, or placeholder markers; null placeholder notes; normalize day-first dates; flag names with digits/Latin, non-12-digit civil IDs) and apply it to each reading before adjudication AND to the final result. Telling the models that proper nouns must be real Kuwaiti names (bank list, area names) turned non-word garbage into correct names without inducing "most common name" substitutions.
**Verification:** ground truth from low-res renders is itself unreliable - confirm disputed digits with a 260 dpi crop before calling the model wrong (the civil ID "error" was my misread).

## Misc
/tmp stashes (upload payloads etc.) do not survive between sessions - rebuild from `attached_assets/` instead of assuming the file is still there.
