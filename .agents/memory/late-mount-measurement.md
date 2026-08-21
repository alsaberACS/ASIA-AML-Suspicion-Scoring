---
name: Late-mount measurement
description: Measuring hooks (ResizeObserver) must use callback refs when the measured element mounts after loading gates; symptom is silent 0x0 canvas.
---

# Measuring elements that mount late

Rule: any hook that observes a DOM element (ResizeObserver, IntersectionObserver) must attach via a **callback ref**, not a mount-time `useEffect` reading `ref.current`.

**Why:** components with loading/empty early returns mount the measured div only after data arrives. A `useEffect(..., [])` runs at first mount, finds `ref.current === null`, and never re-runs — the observer never attaches, size stays 0x0. With a canvas library (react-force-graph) the result is a fully interactive page with a silently blank canvas: zero console errors, data visibly reaching sibling DOM (stats bars), controls working. Cost hours in the AML network graph.

**How to apply:** `const ref = useCallback((el) => { disconnect old; if (el) observe(el); }, [])` plus an unmount-cleanup effect. When a canvas paints nothing without errors, first check the size plumbing before suspecting the render library.

Debug channel: the app-preview screenshot tool returns the page's console output — temporary `console.log` diagnostics show up right in the screenshot result, one round-trip. Screenshot captures race force-graph settle/zoomToFit animations; judge framing by staged fit logic (early tick + engine-stop fits, suppressed after user pointer/wheel), not by capture timing.
