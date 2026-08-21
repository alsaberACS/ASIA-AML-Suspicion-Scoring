---
name: Toast system — sonner only
description: All console notifications go through sonner; mounting the wrong (radix) Toaster silently disabled every toast in the app.
---
All notification call sites use `toast` from 'sonner'. The shadcn template shipped TWO toast systems — a radix trio (ui/toaster.tsx, ui/toast.tsx, hooks/use-toast.ts) and a sonner wrapper (ui/sonner.tsx). App.tsx originally mounted the radix Toaster while every call site fired sonner, so NO toast ever rendered, app-wide, with zero errors.

**Why:** sonner's `toast()` enqueues into module state; without sonner's own `<Toaster />` mounted it is a silent no-op. Flow tests that assert DOM state changes (cards, badges) never catch missing toasts, and testers can mistake pending button labels for toasts.

**How to apply:** Mount the sonner wrapper's Toaster in App.tsx with `theme="dark"` (the app forces dark mode; without a next-themes provider, useTheme falls back to system). The radix trio has been deleted — if a shadcn generator re-adds toaster.tsx / use-toast.ts, do not mount or use them. When verifying toasts e2e, poll `li[data-sonner-toast]` immediately after the trigger; they auto-dismiss in ~4s. First mount of ui/sonner.tsx also first-imports next-themes → expect the one-time vite optimize reload blip.
