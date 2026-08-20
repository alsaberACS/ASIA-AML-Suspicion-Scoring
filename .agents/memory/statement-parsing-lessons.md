---
name: Statement parsing lessons
description: Non-obvious behaviors of real-world bank statement xlsx exports and how the parser must handle them
---

Lessons from parsing five heterogeneous Kuwaiti bank statement exports:

- **Row order is not ledger order.** Some exports list newest-first. Running-balance reconciliation (`balance[i-1] + signed[i] == balance[i]`) must be evaluated in BOTH orders per account and keep the better fit, else a clean file scores as full of balance breaks and data quality is wrongly crushed.
- **Counterparties often live in narratives, not columns.** "Transfer from  01326XXXXX ANWAR H", "InstaPay Credit : 865887-663XXXXX", "Transfer From: 100600XXXX" all identify senders. Without narrative extraction, fan-in/funnel features are blind and the network graph is empty. Settlement rails ("CENTRAL BANK") must be nulled — they are transit, not beneficiaries.
- **Sparse formatted grids are normal.** A sheet can have thousands of styled rows with only ~30 real data rows; parsing few rows there is correct. Do not "fix" the parser based on sheet dimensions.
- **Per-month intensity features must use active months** (distinct months with activity), not the full first-to-last span, or long dormant gaps dilute income-multiple style ratios.
