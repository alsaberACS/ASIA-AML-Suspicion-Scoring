---
name: Fast async job completion detection
description: UI polling for server-side jobs must use a timestamp watermark, not observe a transient busy flag
---

# Detecting completion of fast server-side jobs from a polling UI

Rule: when a button kicks an async server job and the UI polls a status
endpoint, detect completion by a WATERMARK (server-side lastRunAt/lastCheckAt
timestamp >= client kick time, with ~30s clock-drift slack), never by waiting
to observe the transient busy flag turn on and then off.

**Why:** a sweep/job that finishes faster than one poll interval never shows
busy=true to any poll. A transition detector (prev busy -> now idle) then never
fires: no completion toast, no refetch callback, and the fast-poll interval
stays armed forever. Found by an e2e tester: the sanctions re-screen sweep
completed in under one 2.5s poll cycle.

**How to apply:** store kickedAt=Date.now() on mutation success; each poll,
complete when !status.busy && serverLastRunAt >= kickedAt - 30_000. Keep the
button disabled via (mutation.isPending || busyFlag || kickedAt != null) so
fast jobs still show a brief busy state. Applies to the sanctions freshness
card and any future "run now" buttons (backfills, exports, re-checks).

Two hardenings found in review: (1) also gate on React Query's dataUpdatedAt
>= kickedAt, or a cached pre-click emission can satisfy the watermark; (2) if
the server acks "already running", the in-flight job's start timestamp
predates your watermark - complete on any fresh poll showing idle instead,
or polling never terminates.
