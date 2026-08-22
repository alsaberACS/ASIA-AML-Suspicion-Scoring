---
name: Tester console noise
description: Long-lived tester browser sessions accumulate stale HMR errors - hard-reload before treating console errors as real
---

# Stale console errors in long-lived tester sessions

A persistent tester's browser tab that stayed open across live-editing sessions accumulates Vite HMR errors ("Failed to reload X.tsx") and transient 404s from mid-edit states and codegen rewrites of generated files. These show up in "verify no console errors" steps and produce false FAILURE verdicts.

**Why:** HMR errors persist in the console log across the session; they describe a moment during editing, not the current build.

**How to apply:** when a tester reports console errors after a session that involved live edits, send a follow-up asking for a full hard reload and to report ONLY errors emitted after that reload, with exact URLs for any 404s (expected-by-design 404s, like REST "no resource yet" probes, must be attributed before being called bugs).

Refinement: hard reload is not always enough - the dev server itself can
serve a stale module hybrid after rapid successive edits. If a tester
reports an error impossible for the current source (e.g. ReferenceError for
an import that is clearly there), flush/restart the dev server before
spending another tester round.
