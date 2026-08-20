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
