---
name: Methodology copy honesty
description: User-facing "how it works" copy must be fact-checked against engine source; specific overclaim words to avoid.
---

Any user-facing methodology/about/marketing copy describing the engine must be reviewed against the actual engine source, not written from memory of what the engine "roughly does".

**Why:** The About page's first draft contained four overclaims the architect caught: "duplicates collapsed / balances reconciled" (engine only detects and reports), "every driver cites exact transactions" (several rules and all residual/prior drivers carry no row citations), "quality score from six checks" (the six-check report is explanatory only; scoring uses transaction-weighted parser per-file quality), and "calibrated probability" (prior and weights are expert-configured, never validated against outcomes).

**How to apply:** When writing such copy, treat these words as red flags requiring proof from source: "calibrated", "every", "only", "always", "validated", "reconciled/corrected" (vs detected/reported). Static fact files that mirror engine constants (e.g. the About page's data file) must be updated whenever scoring/rules change. In always-dark image sections of a themable UI, every child element must use literal light colors — shared components defaulting to theme tokens (like a muted-foreground label) go invisible on light themes; pass an explicit on-dark variant.
