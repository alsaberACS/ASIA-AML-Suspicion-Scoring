---
name: Disclosure extraction
description: Handwritten-PDF AI extraction pipeline - whole-PDF document blocks, upload-token conditional writes in background runners, stage-time re-fetch of async inputs
---

# Handwritten PDF extraction and async-input pipeline stages

## Whole-PDF document block
Send a scanned/handwritten PDF to Claude as ONE base64 `document` content block (`type: "document"`, `media_type: "application/pdf"`) in a single message - no rasterization needed. A 4.3 MB 13-page handwritten Arabic form cost ~20k input tokens and extracted reliably, including honest `uncertain: true` flags on ambiguous handwriting.
**How to apply:** prompt must explicitly exclude pre-printed example rows and define how "none declared" checkboxes map to structured output, or the model will absorb the form's own sample data.

## Upload-token conditional writes in fire-and-forget runners
A background runner keyed on a row id, combined with an upsert-replace endpoint, silently corrupts data: upload B replaces the row while run A is in flight, then A writes A's result onto B's content. A plain "already running" dupe guard makes it worse by swallowing B's launch entirely.
**Why:** row id survives the upsert, so id-conditional writes cannot distinguish uploads.
**How to apply:** capture an upload token (uploadedAt millis) when the runner loads the row; make every terminal write conditional on `id + uploadedAt + status=processing` with `.returning()` to detect and log discarded stale results; key the dupe guard on `(id, token)` so a replacement upload can launch while the stale run is still in flight; remove the guard entry in `finally` only when the map still holds your own token.

## Stage-time re-fetch of async-prepared inputs
An AI pipeline that snapshots inputs at run start silently skips stages whose input was still being prepared (e.g. analysis launched seconds after a document upload). "Done" bookkeeping keyed on *readiness* at run start makes the skip permanent for that run.
**How to apply:** key the stage's done-flag on row *existence*, not readiness; re-fetch inside the stage with a bounded poll (10s interval, a few minutes cap, respecting the preparer's own watchdog); on success rebuild any evidence/prompt context built earlier so downstream stages see the late-arriving input; on failure/timeout skip gracefully and log.

## Misc
/tmp stashes (upload payloads etc.) do not survive between sessions - rebuild from `attached_assets/` instead of assuming the file is still there.
