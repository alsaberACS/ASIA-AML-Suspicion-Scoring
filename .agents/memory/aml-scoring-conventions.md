---
name: AML scoring conventions
description: Decisions in the Bayesian aggregation layer that future tuning must stay consistent with
---

- **Weights are expert-elicited log-likelihood-ratios.** The design doc has no numeric weight table; the values in rules.ts ARE the elicitation. Change them only with a stated rationale, not to hit a target score.
- **Per-family diminishing returns:** strongest fired rule in a family contributes its full weight, others ×0.5. A "small" driver contribution usually means family overlap (e.g. velocity + dormancy are both temporal), not a bug.
- **Residual feature evidence** (elevated/critical features not covered by a fired rule) is capped as a bundle; candidates must be admitted strongest-first (critical before elevated) or the cap can crowd out the most probative signal.
- **Data-quality shrinkage scales evidence, and that is the product story:** a tampered ledger (balance breaks) visibly suppresses the score — the demo's Burgan file does this by design.
- **The LLM never states or adjusts probability.** It narrates typologies, produces benign scenarios/objections, and drafts the memo citing txn ids. Probability comes only from M2.
- Demo landing point: subject FAHAD scores ≈0.46 (top of Elevated) with five rules fired and −0.5 DQ suppression; Elevated rather than High is intentional given the corrupted Burgan ledger.

## Investigation-forensics evidence constraints

**Rule:** Statement dates alone cannot establish same-day transaction ordering, and own-account “circulation” requires a later reversed account route with non-overlapping transfer evidence.

**Why:** Same-day row order is not intraday chronology, while ordinary one-way account consolidation is not a return loop; treating either as circulation creates unsupported forensic claims.

**How to apply:** Require a positive date gap for credit-to-debit sequences. For own-account circulation, match A→B followed by amount-similar B→A and consume both transfer edges so one transfer cannot inflate multiple loops.

## Cross-bank pattern measurement constraints

**Rule:** Cross-bank correlation statistics must use jointly observed months (months where BOTH banks demonstrably transacted) as the sample space, never a calendar interval inferred from first/last activity. Matched internal-transfer pairs are excluded from all cross-bank tests, and same-day cross-bank amount echoes carry an explicit no-ordering-claim caveat.

**Why:** Statement coverage cannot be inferred from activity spans — sparse or gapped accounts make an inclusive interval enormous, which inflates the independence lift and manufactures false burst-synchronization findings (caught by architect review). Own money moving between own accounts mechanically correlates institutions.

**How to apply:** Burst synchronization requires ≥6 jointly active months per bank pair and computes lift as coincident×jointMonths/(burstsA×burstsB). When thresholds are unmet but pairs were comparable, report an honest negative (no gate); gate only when no pair is comparable, with the reason stated.
