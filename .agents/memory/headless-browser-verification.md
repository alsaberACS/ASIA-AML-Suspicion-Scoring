---
name: Headless browser verification from the shell
description: How to drive the running console in a real browser yourself (clicks, timers, computed styles) without the tester subagent
---

# Headless browser verification from the shell

Rule: for interactive UI checks (click a button, wait N seconds, read computed styles / scroll metrics / console errors), drive a local headless Chromium over CDP instead of guessing or launching the tester.

- A Chromium binary exists at `/repl/tools/bin/chromium` (no Playwright browsers are installed). Start it as a **background task** (`run_in_background: true`) with `--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9333`; a foreground shell kills it when the command returns. It needs ~4 s before `/json/version` answers.
- `npm i playwright-core` in `/tmp/pw` (no browser download, ~5 s) and `chromium.connectOverCDP("http://127.0.0.1:9333")`; write scripts as `.mjs`, run with `timeout`.
- Reach the console through the port-80 proxy (`http://127.0.0.1/<route>`); the dev-only `?access=<code>` query unlocks the landing gate for scripts and screenshots (code in `src/lib/access.ts`, never in docs/UI).
- Prefer `page.getByTestId` + `page.evaluate` snapshots (canvas visibility, scrollWidth/clientWidth, element inline styles, computed box-shadow) over screenshots; screenshots to `/tmp/pw/*.png` only for the visual confirmation.

**Why:** the tester subagent reported "overlay missing" and "blank page" findings that turned out to be timing (a 5 s fade and a render in progress); a 30-line script reproduced the real behaviour in one run and verified the fix without a second tester pass.
**How to apply:** any time a fix depends on timing, animation, scroll geometry, or state that only exists after a click — things the Screenshot tool cannot reach.
