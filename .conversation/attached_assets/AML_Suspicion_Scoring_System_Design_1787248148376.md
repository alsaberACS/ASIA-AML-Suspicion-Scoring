# Multi-Bank AML Suspicion Scoring System — Design Specification

**Scope:** Ingest bank statements belonging to one subject across multiple Kuwaiti banks, consolidate them, and return a calibrated suspicion score with an auditable evidence trail.

**Design principle:** The LLM is an *extraction and reasoning* layer. The *probability* comes from a statistical layer that can be calibrated, validated and defended. Never ask a language model for a bare number and call it a probability.

---

## 0. Governance framing (do this before any code)

| Question | Why it determines the design |
|---|---|
| Who operates the system? | A CBK-licensed bank, an exchange company, a DNFBP (real estate, auditors, lawyers), an internal audit function, or a research setting. Each has a different lawful basis and different output obligations. |
| What is the lawful basis for holding the statements? | Subject consent (forensic/audit engagement), the operator's own customer relationship, or a court/regulatory mandate. Processing another person's statements without one of these is not defensible. |
| What decision does the output drive? | Decision-support for a human analyst — not automated account closure, refusal or reporting. |
| What is the reporting path? | Under Law No. 106 of 2013 (AML/CFT) and CBK instructions, suspicion reports go to the Kuwait FIU. Confirm the current filing channel, deadlines and tipping-off provisions with the compliance function — the framework has been under amendment. |

**Two non-negotiables**

1. **Human-in-the-loop.** The system produces a ranked alert with evidence. A qualified analyst decides.
2. **No adverse action from the score alone.** Record the model version, the features that fired, and the analyst's disposition for every case.

Call the output what it is. It is not `P(the subject is laundering money)` — that is unknowable and unlabelled. It is `P(a trained AML analyst, given this evidence pack, would escalate this case)`. That target is observable, labellable and calibratable.

---

## 1. Pipeline architecture

```
[Statement PDFs, N banks]
        │
   ①  Ingestion & OCR
        │
   ②  LLM schema extraction → strict JSON per statement
        │
   ③  Validation gate (running-balance reconciliation, totals, duplicates)
        │
   ④  Normalization (currency, dates, channel taxonomy, Arabic/English)
        │
   ⑤  Cross-bank entity resolution & internal-transfer netting
        │
   ⑥  Consolidated ledger + subject profile (KYC/declared income)
        │
   ⑦  Feature engineering (typology-aligned indicators)
        │
   ⑧  Scoring layer  ── choose from Methodologies M1–M8
        │
   ⑨  Calibration → probability + risk band
        │
   ⑩  LLM analyst layer: typology narrative + evidence citation
        │
   ⑪  Adversarial critic pass (benign-explanation generator)
        │
   ⑫  Analyst dashboard: score, drivers (SHAP/rule attribution), transaction IDs
        │
   ⑬  Disposition capture → label store → retraining loop
```

---

## 2. Step ① – ④: Ingestion, extraction, normalization

### 2.1 Kuwaiti statement realities

- Multiple layouts: NBK, KFH, Boubyan, Gulf Bank, Burgan, ABK, Warba, CBK, KIB each differ; Islamic banks label profit/murabaha entries differently from conventional interest entries.
- Bilingual Arabic/English narratives, sometimes mixed within one field.
- Debit/credit expressed as separate columns in some, signed amounts in others.
- Occasional Hijri dates in Arabic-language statements.
- Multi-currency accounts (KWD, USD, GBP, SAR, AED).

### 2.2 Extraction strategy (layered, cheapest first)

1. **Digital-text PDFs:** `pdfplumber` / `camelot` for ruled tables → deterministic, cheap, exact.
2. **Scanned PDFs:** OCR with Arabic support (Tesseract `ara+eng`, or Azure Document Intelligence / AWS Textract, which handle table structure better).
3. **LLM structuring pass** over the extracted text to map heterogeneous layouts to one schema (see Prompt P1). Use the LLM for *mapping*, not for arithmetic.

### 2.3 Canonical transaction schema

```json
{
  "subject_id": "string",
  "bank": "NBK | KFH | GULF | BURGAN | ABK | BOUBYAN | WARBA | CBK | KIB | OTHER",
  "account_id_masked": "string",
  "account_type": "current | savings | salary | corporate | investment | credit_card",
  "currency": "KWD",
  "txn_id": "string (deterministic hash of bank+account+date+amount+seq)",
  "posting_date": "YYYY-MM-DD",
  "value_date": "YYYY-MM-DD | null",
  "direction": "credit | debit",
  "amount": 0.000,
  "amount_kwd": 0.000,
  "fx_rate_used": 1.0,
  "channel": "cash_deposit | cash_withdrawal | atm | cheque | pos | local_transfer | international_wire | standing_order | salary | card_payment | internal_transfer | other",
  "counterparty_name_raw": "string | null",
  "counterparty_name_norm": "string | null",
  "counterparty_account": "string | null",
  "counterparty_bank": "string | null",
  "counterparty_country": "ISO-3166 alpha-2 | null",
  "narrative_raw": "string",
  "narrative_lang": "ar | en | mixed",
  "running_balance": 0.000,
  "extraction_confidence": 0.0
}
```

### 2.4 Validation gate (③) — do not skip

- **Balance reconciliation:** for each account, `balance[i-1] + signed_amount[i] == balance[i]` for every row. Any break means extraction failure, not suspicious activity. Fail the file back for re-extraction rather than scoring on corrupt data.
- **Period continuity:** no missing months between the first and last statement per account.
- **Opening/closing tie-out:** statement header totals match the sum of rows.
- **Duplicate detection:** identical `(date, amount, narrative, balance)` rows from overlapping statement periods.

Emit a **data-quality score** per subject. A low score must suppress the alert rather than inflate it — missing data is not evidence.

---

## 3. Step ⑤: Cross-bank consolidation (the real value-add)

Analysing three banks separately misses exactly what a multi-bank layering pattern is designed to hide.

**Internal-transfer netting.** Detect transfers between the subject's own accounts and mark them so they do not inflate turnover:

- Opposite-direction pair, `|amount_A − amount_B| ≤ max(0.5 KWD, 0.5% × amount)`
- `|date_A − date_B| ≤ 3 days`
- Counterparty name matches the subject (fuzzy: Jaro-Winkler ≥ 0.85 after Arabic/English transliteration normalization), or counterparty account is a known subject account.

**Cross-bank features that only exist after consolidation:**

| Feature | Definition | Typology |
|---|---|---|
| `bank_fragmentation_index` | Shannon entropy of cash-deposit value across banks in a 7-day window | Smurfing across institutions |
| `same_day_multibank_cash` | Count of days with cash deposits at ≥2 institutions | Structuring |
| `aggregate_threshold_evasion` | Σ(same-day cash across banks) ÷ verification threshold, where every individual deposit is below it | Structuring |
| `consolidated_passthrough_ratio` | Σ debits ÷ Σ credits across all accounts | Layering |
| `inter_bank_relay_chains` | Funds in at Bank A → out to Bank B account → out internationally, within N days | Layering |

---

## 4. Step ⑦: Feature engineering, organized by typology

Everything is computed **relative to a baseline**: (a) the subject's own history, and (b) a peer cohort (same declared occupation, income band, account type, nationality-neutral segmentation — see §8 on fairness).

### 4.1 Placement / cash

| Feature | Formula | Theory anchor |
|---|---|---|
| Cash-to-income ratio | `Σ cash_credits(30d) ÷ declared_monthly_income` | Profile deviation, FATF R.10 |
| Threshold proximity density | `count(amount ∈ [0.80·T, T)) ÷ count(all cash deposits)`, T = the local source-of-funds verification threshold (KD 3,000) | Structuring literature |
| Deposit dispersion | count of distinct branches/ATMs used per 30d | Smurfing |
| Round-number share | share of amounts ≡ 0 (mod 100) or (mod 500) | Human-generated amounts |
| **Benford first-digit divergence** | χ² or KL divergence of the first-digit distribution against Benford's expected `log10(1+1/d)` | Nigrini (2012), *Benford's Law*. Valid only on n ≥ 300 organically-scaled amounts; salary/round-fee accounts violate the assumptions — gate this feature on n and on coefficient of variation. |

### 4.2 Layering / flow-through

| Feature | Formula |
|---|---|
| Pass-through ratio | `Σ debits ÷ Σ credits` over the window (flag when 0.95–1.05) |
| Idle-balance ratio | `mean(daily_end_balance) ÷ mean(monthly_turnover)` (flag when ≪ 1) |
| Dwell time | median hours/days between a credit and the next matching-magnitude debit |
| Amount-matching score | share of debits within 1–5% of a preceding credit |
| Fan-in / fan-out | distinct payers per consolidating outflow, and vice versa |
| Velocity burst | `turnover(30d) − μ_12m` ÷ `σ_12m` (z-score on the subject's own history) |

### 4.3 Geography & counterparty

- Share of value to/from FATF grey-/black-listed jurisdictions and high-secrecy centres.
- Country set disjoint from the declared trade/family footprint.
- Third-party settlement: payer ≠ named trading counterparty.
- Counterparty concentration: Herfindahl index over counterparties — both extremes are informative (single-counterparty funnel vs. implausibly diffuse retail-like inflows on a personal account).
- Screening hits: PEP lists, sanctions lists, adverse media (this is a *separate* screening service, not an LLM guess — never let the model assert a sanctions match from memory).

### 4.4 Temporal & behavioural

- Inter-arrival time coefficient of variation (burstiness).
- Out-of-hours / weekend / public-holiday share.
- Dormancy reactivation: gap ≥ 180 days followed by turnover > historical p95.
- Structural break tests on the turnover series (CUSUM, Bai–Perron) — gives a defensible "activity changed on date X" statement.

### 4.5 Narrative-text features

- Vagueness score on the narrative field ("consultancy", "gift", "family support", "loan settlement", "دعم", "هدية") weighted by amount.
- Narrative-to-channel inconsistency (e.g. "salary" narrative on a cash deposit).
- Embedding-based clustering of narratives to find repeated boilerplate across unrelated counterparties.

### 4.6 Network features (requires counterparty graph)

Build a directed weighted graph: nodes = accounts (subject + counterparties), edges = aggregated flows.

- Degree, weighted degree, betweenness of the subject node.
- Cycle detection (A→B→C→A) within a value tolerance and time window.
- Community detection (Louvain / Leiden) — is the subject embedded in a tight cluster of mutually-transacting accounts?
- Motif counts (fan-in, fan-out, scatter-gather, bipartite relay) — these are the canonical AML graph motifs used in **AMLSim** and IBM's synthetic AML benchmark datasets.

---

## 5. Step ⑧: Methodologies — eight options and when each fits

### M1 — Rule-based typology engine (FATF / Egmont / Wolfsberg)

Deterministic boolean rules encoding published typologies. Each rule carries an ID, a citation, a severity weight and a threshold.

- **Theory:** FATF Recommendations (risk-based approach, R.10 CDD, R.20 reporting); Egmont Group typology compendia; Wolfsberg Statement on Monitoring, Screening and Searching.
- **Strengths:** fully explainable, regulator-friendly, no labels needed, works on day one.
- **Weaknesses:** high false-positive rate (industry alert-to-SAR conversion is commonly in the low single-digit percent), static, gameable by anyone who learns the thresholds.
- **Verdict:** mandatory as a floor layer. Never the whole system.

### M2 — Bayesian evidence aggregation / Bayesian Belief Network

Treat each indicator as evidence updating a prior. With conditional independence assumptions this is naive Bayes; with an expert-specified DAG it is a BBN over latent typology nodes (Placement, Layering, Integration) feeding a `Suspicion` node.

```
P(S | e₁…eₙ) ∝ P(S) · Π P(eᵢ | S)
log-odds form:  logit P(S|e) = logit P(S) + Σ wᵢ·eᵢ,  wᵢ = log LR(eᵢ)
```

- **Theory:** Bayesian evidential reasoning; likelihood-ratio frameworks from forensic science.
- **Strengths:** produces a genuine posterior probability; expert-elicited likelihood ratios let you run it **before** you have labels; the log-odds form is transparent — each indicator contributes a readable number of "points".
- **Weaknesses:** independence assumptions are wrong (cash-intensity and round-amounts correlate heavily); needs a base-rate prior, which is uncertain.
- **Verdict:** the best starting point for a cold start with no labelled data. This is the layer I would build first for the probability output.

### M3 — Unsupervised anomaly detection

Isolation Forest, Local Outlier Factor, One-Class SVM, Gaussian Mixture, or a deep autoencoder scored on reconstruction error. Applied within **peer cohorts**, not globally.

- **Theory:** outlier detection; the AML assumption that laundering is a low-density behaviour relative to a peer group.
- **Strengths:** no labels required; catches novel typologies the rules miss.
- **Weaknesses:** anomalous ≠ criminal. A wealthy retiree selling property is a screaming outlier and entirely legitimate. Raw anomaly scores are **not** probabilities.
- **Verdict:** valuable as a *novelty channel* alongside rules. Its score must be mapped to a probability through calibration (§6), never used raw.

### M4 — Supervised learning on historical dispositions

Gradient-boosted trees (XGBoost / LightGBM / CatBoost) or a regularized logistic regression on engineered features, trained on the outcome label.

- **Label options, in descending quality:** confirmed enforcement outcome > FIU/regulator feedback > internally filed STR > analyst escalated to L2 > analyst closed alert. Most programmes only ever have the last two in volume.
- **Critical statistical issue — this is positive-unlabelled data, not binary.** An unreported account is *unlabelled*, not confirmed clean. Naïvely training on `reported=1 / everything else=0` biases the model toward reproducing existing detection rules and their blind spots. Use PU learning (Elkan & Noto, 2008) or treat unlabelled cases with instance weights.
- **Class imbalance:** positives are typically 0.01–0.5%. Use cost-sensitive loss or `scale_pos_weight`; be sceptical of SMOTE on mixed-type tabular financial data.
- **Evaluate on:** PR-AUC (not ROC-AUC, which is misleading under extreme imbalance), precision@k where k = analyst capacity, and alert-to-SAR conversion lift over the rule baseline.
- **Verdict:** the strongest ranker once you have ≥ a few hundred positives. It should rank; M2 or a calibrator should assign the probability.

### M5 — Graph / network methods

Feature-based (motif and centrality features fed into M4) or end-to-end **Graph Neural Networks** (GraphSAGE, R-GCN, GAT) over the transaction graph.

- **Theory / practice:** the Elliptic Bitcoin dataset, IBM's synthetic AML transaction graphs, AMLSim; published work showing GNNs outperform tabular models on layering typologies specifically.
- **Strengths:** the only family that natively detects relational structure — mule networks, cycles, relay chains. Exactly the thing a single-account view cannot see.
- **Weaknesses:** you only observe the subject's *ego network* from statements; counterparty-to-counterparty edges are invisible unless the operator is a bank with wider visibility. Explainability is harder (use GNNExplainer / attention weights).
- **Verdict:** high value if you have graph reach. From statements alone, use graph *features* (M5-lite) rather than a full GNN.

### M6 — Sequence models

Treat each account as a token sequence of transaction events (channel, binned amount, time delta) and model it with an LSTM or a temporal transformer; score by next-event surprisal or via a supervised head.

- **Theory:** self-supervised sequence modelling; anomaly-as-surprisal.
- **Strengths:** captures ordering and rhythm that aggregate features flatten — the *sequence* deposit→wait 36h→wire out is the signal, not the marginals.
- **Weaknesses:** data-hungry, opaque, hard to justify to a regulator.
- **Verdict:** phase 3. Use it as a challenger model, not the production scorer.

### M7 — LLM analyst layer

The LLM does four things well, and one thing badly.

**Well:**
1. Schema extraction from heterogeneous bilingual statements (P1).
2. Semantic interpretation of narrative fields and counterparty names.
3. Typology matching — mapping a fired feature set to named FATF/Egmont typologies with reasoning.
4. Drafting the analyst-facing narrative and the internal case memo (P4).

**Badly:** producing a calibrated probability. LLM confidence expressions are not frequency-calibrated, are sensitive to prompt phrasing, and drift across model versions. Extract **structured indicator judgements** from the LLM and feed them into M2/M4 as features. Do not let the model emit the final number.

### M8 — Hybrid ensemble (recommended architecture)

```
Rules (M1) ──────────► binary indicator vector ─┐
Statistical features ──────────────────────────┼──► M4 ranker ──┐
Anomaly score (M3) ────────────────────────────┤               ├──► isotonic
Graph features (M5-lite) ──────────────────────┤               │   calibration
LLM structured judgements (M7) ────────────────┘               │       │
                                                               ▼       ▼
                          Cold-start path: M2 Bayesian aggregation ──► P(escalate)
                                                                       │
                                                                       ▼
                                                       Risk band + evidence pack
```

Run M2 in production from day one. Shadow-run M4 until it beats M2 on precision@k in a champion/challenger test, then promote it with M2 retained as the fallback and explanation layer.

---

## 6. Step ⑨: Calibration — turning a score into a probability

A score of 0.87 must mean *"87 of every 100 cases scored here get escalated"*, or it is decoration.

1. **Fit a calibrator** on held-out data: Platt scaling (sigmoid) or isotonic regression (non-parametric, needs more data, no monotonic-shape assumption). Fit on a time-forward split, never a random split — AML data drifts.
2. **Measure calibration:** Brier score, expected calibration error (ECE), and a reliability diagram. Report these in the model documentation.
3. **Adjust for the base rate.** If you train on a stratified sample, correct the intercept back to the operational prior: `logit_corrected = logit_model + log(π_true/(1−π_true)) − log(π_train/(1−π_train))`.
4. **Publish verbal-numeric anchors** so analysts read bands consistently:

| Band | Calibrated P(escalate) | Action |
|---|---|---|
| Low | < 0.05 | Log only |
| Moderate | 0.05 – 0.20 | Periodic review / watchlist |
| Elevated | 0.20 – 0.50 | Analyst review within SLA |
| High | 0.50 – 0.80 | Priority review, source-of-funds enquiry |
| Critical | > 0.80 | Immediate L2 escalation |

5. **Set the operating threshold by capacity and cost**, not by 0.5. Choose the cut-off where expected analyst hours equal available hours, and document the cost ratio of a false negative to a false positive that justifies it.

---

## 7. Steps ⑩–⑫: Explanation, adversarial review, output

**Evidence pack** — every alert ships with:
- The calibrated probability and band.
- Top drivers with signed contributions (SHAP for M4, log-LR contributions for M2, fired rule IDs for M1).
- The **specific transaction IDs** supporting each driver — an analyst must be able to click through to the rows.
- The data-quality score and any extraction caveats.
- Benign explanations already considered and why they were or were not sufficient (from the critic pass, P5).

**Adversarial critic pass (P5).** A second LLM call whose only job is to argue the innocent case: what lawful pattern would produce this exact evidence, and what document would confirm it (property sale contract, inheritance deed, business licence, invoice set, remittance history for family support). This is the single cheapest intervention against automation bias and confirmation bias, and it also pre-writes the analyst's enquiry list.

---

## 8. Validation, monitoring and fairness

**Model risk management.** Follow a model-risk framework (SR 11-7 is the standard reference even outside the US): independent validation, conceptual soundness review, outcome analysis, versioned documentation.

**Standard AML tuning discipline:**
- **Below-the-line testing:** sample alerts just under the threshold and have analysts review them. If they find escalatable cases, the threshold is too high.
- **Above-the-line testing:** sample alerts just over the threshold. If they are uniformly noise, tighten.
- Re-tune on a fixed cadence and after any typology change.

**Drift monitoring:** PSI on feature distributions, monthly alert-volume and conversion-rate tracking, alarm on both a spike and a collapse in alert volume.

**Fairness — treat this as a first-class requirement in Kuwait.** A large share of the population are expatriate workers whose entirely lawful behaviour — cash wage receipt, periodic remittances to South Asia, the Philippines, Egypt — structurally resembles placement-and-transfer typologies. A naïve model will learn nationality, remittance corridor, or salary band as a proxy and generate a discriminatory alert pipeline.

Mitigations:
- Exclude nationality, national origin and residency status as direct features.
- Test for proxy leakage: train an auxiliary classifier to predict nationality from your feature set; if it succeeds well above chance, you have a proxy.
- Report alert rates and, more importantly, **alert-to-escalation conversion rates** by group. Equal alert rates with unequal conversion rates means one group is being over-alerted on noise.
- Define peer cohorts by *declared income band and account type*, not by nationality.
- Build a documented carve-out for the regular-remittance profile: consistent amount, consistent corridor, consistent beneficiary, consistent with declared salary credits.

---

## 9. Prompt suite

### P1 — Statement extraction (per PDF)

```
ROLE
You are a document extraction engine for bank statements. You transcribe. You do
not interpret, summarize, or assess.

INPUT
Raw text and table structure extracted from one bank statement PDF. It may be in
Arabic, English, or both.

TASK
Return a single JSON object matching the schema below. Nothing else — no prose,
no markdown fences, no commentary.

SCHEMA
{
  "bank_name_as_printed": string,
  "bank_code": one of [NBK, KFH, GULF, BURGAN, ABK, BOUBYAN, WARBA, CBK, KIB, OTHER],
  "account_holder_name_as_printed": string,
  "account_number_masked": string,          // keep only the last 4 digits, mask the rest with X
  "account_type": string|null,
  "currency": ISO-4217 string,
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "opening_balance": number,
  "closing_balance": number,
  "transactions": [
    {
      "seq": integer,                        // row order as printed, starting at 1
      "posting_date": "YYYY-MM-DD",
      "value_date": "YYYY-MM-DD"|null,
      "direction": "credit"|"debit",
      "amount": number,                      // always positive
      "narrative_raw": string,               // verbatim, original script, do not translate
      "narrative_en": string|null,           // translation only if the original is Arabic
      "counterparty_name_raw": string|null,
      "counterparty_account": string|null,
      "counterparty_bank": string|null,
      "counterparty_country_iso2": string|null,
      "channel": one of [cash_deposit, cash_withdrawal, atm, cheque, pos,
                         local_transfer, international_wire, standing_order,
                         salary, card_payment, internal_transfer, other],
      "running_balance": number|null,
      "extraction_confidence": number        // 0.0–1.0
    }
  ],
  "extraction_notes": [string]
}

RULES
1. Transcribe every row. Never merge, split, reorder or omit rows.
2. Never compute, correct or infer a value. If a field is illegible or absent,
   emit null and add a line to extraction_notes.
3. Convert Hijri dates to Gregorian and note the conversion in extraction_notes.
4. Set channel from the printed narrative and transaction-code column only. If
   the narrative does not determine the channel, use "other" — do not guess.
5. Do not translate narrative_raw. Populate narrative_en separately.
6. Set extraction_confidence below 0.7 for any row read from degraded OCR.
7. Mask the account number. Do not reproduce a full IBAN or account number
   anywhere in the output.
8. Emit no assessment of any transaction. Risk language is out of scope here.
```

### P2 — Cross-bank consolidation and entity resolution

```
ROLE
You reconcile transaction records belonging to one subject across multiple banks.

INPUT
- subject_profile: { declared_occupation, declared_monthly_income_kwd,
                     declared_business_activity, known_account_ids[],
                     expected_countries[] }
- transactions: the merged, validated array from all P1 outputs.

TASK
Return JSON only:
{
  "internal_transfer_pairs": [
    { "debit_txn_id": string, "credit_txn_id": string,
      "match_basis": string, "confidence": number }
  ],
  "counterparty_clusters": [
    { "canonical_name": string, "variants": [string], "txn_ids": [string],
      "relationship_hypothesis": string|null }
  ],
  "duplicate_txn_ids": [string],
  "unresolved_flags": [string]
}

RULES
1. Pair a debit and a credit as an internal transfer only when ALL hold:
   opposite direction; |amount difference| <= max(0.5 KWD, 0.5% of amount);
   |date difference| <= 3 days; and the counterparty resolves to the subject or
   to a known_account_id. State which condition carried the match in match_basis.
2. Cluster counterparty name variants across Arabic/English transliteration and
   abbreviation. Do not cluster two names solely because the amounts are similar.
3. relationship_hypothesis must be null unless the narrative states it.
4. Never assert that a counterparty is sanctioned, a PEP, or adversely reported.
   That determination comes from a screening service, not from you. If a name
   seems to warrant screening, add it to unresolved_flags as
   "screening_required: <name>".
```

### P3 — Typology assessment (structured judgement, **not** a probability)

```
ROLE
You are an AML typology analyst. You assess evidence against published typologies
and return structured findings. You do NOT output an overall probability or
score — a separate calibrated statistical model does that.

INPUT
- subject_profile (declared occupation, income, business activity, expected
  countries) — nationality and residency status are deliberately excluded
- consolidated_features: the computed indicator values with their peer-cohort
  and own-history baselines
- transaction_evidence: transactions referenced by the fired indicators
- data_quality_score: 0.0–1.0

TASK
Return JSON only:
{
  "typology_findings": [
    {
      "typology_id": string,             // e.g. FATF-STRUCTURING, EGMONT-FUNNEL-ACCOUNT
      "typology_name": string,
      "present": "yes"|"partial"|"no",
      "strength": "weak"|"moderate"|"strong",
      "supporting_txn_ids": [string],
      "supporting_features": [{ "feature": string, "value": number,
                                "baseline": number }],
      "reasoning": string,               // max 4 sentences
      "benign_explanations_possible": [string]
    }
  ],
  "profile_consistency": {
    "verdict": "consistent"|"partially_inconsistent"|"inconsistent",
    "explanation": string
  },
  "information_gaps": [string],          // what document would resolve the ambiguity
  "data_quality_caveat": string|null
}

RULES
1. Every finding must cite at least one transaction ID and one feature value.
   A finding without citations is invalid — set present to "no".
2. Never infer intent, criminality or guilt. Describe patterns and their
   consistency or inconsistency with the declared profile. Nothing more.
3. For every finding where present != "no", list at least one plausible lawful
   explanation. If none exists, say so explicitly.
4. Never use nationality, ethnicity, religion, or residency status as a basis
   for any finding. Regular remittances consistent with declared salary are a
   normal pattern, not an indicator.
5. If data_quality_score < 0.7, state in data_quality_caveat that findings are
   provisional pending re-extraction, and downgrade every "strong" to "moderate".
6. Do not output a number, percentage, score or likelihood for overall suspicion.
```

### P4 — Analyst case narrative

```
ROLE
You draft an internal AML case memo for a qualified analyst.

INPUT
- calibrated_probability and risk_band from the scoring model
- model_version, top_drivers with contribution values
- typology_findings from P3
- critic_output from P5
- data_quality_score

OUTPUT — plain prose, max 500 words, in this order:
1. Subject and period covered, accounts and institutions consolidated.
2. What the consolidated activity shows, in factual terms with figures.
3. Which typologies the pattern is consistent with, and the specific evidence.
4. Lawful explanations considered and what would confirm or exclude each.
5. Recommended next steps for the analyst (documents to request, enquiries).
6. Model output stated as: "Model <version> assigns a calibrated escalation
   probability of X (band: Y). This is a decision-support output and is not a
   determination of suspicion."

RULES
- Cite transaction IDs and dates for every factual claim.
- Never state or imply that the subject committed an offence.
- Never recommend filing a report — that decision belongs to the MLRO.
- If data_quality_score < 0.7, open the memo with the data limitation.
```

### P5 — Adversarial critic (benign-explanation generator)

```
ROLE
You are the defence. Your sole task is to construct the strongest lawful
explanation for the observed pattern, and to attack weak reasoning in the
assessment.

INPUT
- typology_findings from P3
- consolidated_features and transaction_evidence
- subject_profile

TASK
Return JSON only:
{
  "benign_scenarios": [
    { "scenario": string,
      "explains_findings": [typology_id],
      "consistency_check": string,        // which evidence fits, which does not
      "confirming_document": string,      // what would verify this scenario
      "plausibility": "high"|"medium"|"low" }
  ],
  "methodological_objections": [
    { "target_finding": typology_id,
      "objection": string,                // e.g. base-rate neglect, small n,
                                          // Benford applied to a non-conforming
                                          // series, peer cohort mis-specified
      "severity": "high"|"medium"|"low" }
  ],
  "residual_unexplained": [string]        // what NO benign scenario accounts for
}

RULES
1. Argue in good faith and at full strength. A weak defence is a failed critique.
2. Explicitly consider: property or asset sale, inheritance, business seasonality,
   family support and remittance obligations, informal lending within a family,
   a legitimate cash-intensive trade, wedding or event gifts, end-of-service
   settlement, and account consolidation after a bank switch.
3. residual_unexplained is the most important field. Be rigorous about what
   genuinely survives every benign scenario.
```

---

## 10. Build sequence

| Phase | Deliverable | Depends on labels? |
|---|---|---|
| 1 | Ingestion + P1 extraction + validation gate, tested across all target banks | No |
| 2 | Consolidation (P2), canonical ledger, data-quality scoring | No |
| 3 | Feature library with unit tests and baselines | No |
| 4 | M1 rule engine with cited typology IDs | No |
| 5 | M2 Bayesian aggregation with expert-elicited likelihood ratios → first probability output | No |
| 6 | P3 + P5 + P4 analyst layer and evidence pack UI | No |
| 7 | Disposition capture — this is what creates your label store | — |
| 8 | M3 anomaly channel, M5-lite graph features | No |
| 9 | M4 supervised ranker + isotonic calibration, champion/challenger vs M2 | Yes |
| 10 | Below/above-the-line tuning, fairness audit, drift monitoring, model documentation | Yes |

Phase 7 is the one most projects skip and the one that determines whether the system improves. Instrument it before you need it.

---

## 11. Reference anchors

- FATF, *International Standards on Combating Money Laundering and the Financing of Terrorism & Proliferation* — Recommendations 1, 10, 20; and the risk-based approach guidance.
- Egmont Group typology compendia; Wolfsberg Group, *Statement on Monitoring, Screening and Searching*.
- Basel Committee, *Sound management of risks related to money laundering and financing of terrorism*.
- Nigrini, M. (2012). *Benford's Law: Applications for Forensic Accounting, Auditing, and Fraud Detection*.
- Elkan, C. & Noto, K. (2008). "Learning classifiers from only positive and unlabeled data." *KDD*.
- Weber et al., "Scalable Graph Learning for Anti-Money Laundering" — Elliptic dataset.
- Suzumura & Kanezashi, AMLSim — synthetic AML transaction graph generator.
- Federal Reserve/OCC SR 11-7, *Guidance on Model Risk Management*.
- Kuwait: Law No. 106 of 2013 on AML/CFT and its executive regulations; Central Bank of Kuwait AML/CFT instructions to banks; Kuwait FIU reporting requirements. **Verify current text and procedure directly — this framework has been subject to amendment.**
