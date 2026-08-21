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

## Misc
/tmp stashes (upload payloads etc.) do not survive between sessions - rebuild from `attached_assets/` instead of assuming the file is still there.
