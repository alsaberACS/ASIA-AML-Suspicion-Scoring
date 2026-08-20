import type { Driver, FeatureValue, RuleHit } from "./types";
import { RULE_FLOORS } from "./rules";
import { bandFor } from "./types";

/**
 * M2 - Bayesian log-odds aggregation.
 *
 * posterior_log_odds = prior_log_odds + sum(evidence log-LRs)
 * probability        = sigmoid(posterior_log_odds)
 *
 * - Prior: ~2% base rate of genuinely suspicious subjects in a review queue.
 * - Fired rule weights are treated as log-likelihood ratios.
 * - Correlated rules within one typology family are de-duplicated with
 *   diminishing returns (strongest full, remainder at 50%).
 * - Elevated/critical features not already represented by a fired rule add
 *   small residual evidence.
 * - Low data quality shrinks ALL evidence toward the prior (an unreliable
 *   ledger cannot produce a confident alarm) and appears as its own negative
 *   driver for transparency.
 */

const PRIOR_P = 0.02;

const FAMILY: Record<string, string> = {
  "R-STRUCT-01": "structuring",
  "R-STRUCT-02": "structuring",
  "R-STRUCT-03": "structuring",
  "R-SMURF-01": "structuring",
  "R-LAYER-01": "layering",
  "R-LAYER-02": "layering",
  "R-LAYER-03": "layering",
  "R-CIRC-01": "layering",
  "R-FUNNEL-01": "network",
  "R-CASH-01": "cash",
  "R-CASH-02": "cash",
  "R-GEO-01": "geo",
  "R-VEL-01": "temporal",
  "R-DORM-01": "temporal",
  "R-NARR-01": "narrative",
  "R-BENF-01": "statistical",
};

// Features whose signal is already captured by a rule (avoid double count).
const FEATURE_RULE_COVER: Record<string, string[]> = {
  near_threshold_density: ["R-STRUCT-01"],
  same_day_multibank_cash_days: ["R-STRUCT-02"],
  aggregate_threshold_evasion: ["R-STRUCT-03"],
  bank_fragmentation_index: ["R-SMURF-01"],
  pass_through_ratio: ["R-LAYER-01"],
  quick_out_share: ["R-LAYER-02"],
  dwell_median_days: ["R-LAYER-02"],
  relay_chain_count: ["R-LAYER-03"],
  internal_circulation_share: ["R-CIRC-01"],
  cash_to_income_peak: ["R-CASH-01"],
  income_multiple: ["R-CASH-01"],
  cash_share: ["R-CASH-01"],
  round_number_share: ["R-CASH-02"],
  high_risk_geo_share: ["R-GEO-01"],
  velocity_burst_z: ["R-VEL-01"],
  dormancy_reactivation: ["R-DORM-01"],
  narrative_vagueness_share: ["R-NARR-01"],
  unexplained_inflow_share: ["R-NARR-01"],
  benford_mad: ["R-BENF-01"],
  fan_in_count: ["R-FUNNEL-01"],
  counterparty_concentration_hhi: ["R-FUNNEL-01"],
  crypto_exposure_count: ["R-VA-01"],
};

export interface ScoreResult {
  probability: number;
  priorProbability: number;
  posteriorLogOdds: number;
  band: string;
  drivers: Driver[];
}

export function aggregate(
  ruleHits: RuleHit[],
  features: FeatureValue[],
  dataQuality: number,
): ScoreResult {
  const priorLogOdds = Math.log(PRIOR_P / (1 - PRIOR_P));
  const drivers: Driver[] = [
    {
      label: "Base rate prior (2% of reviewed subjects)",
      contribution: round3(priorLogOdds),
      source: "prior",
      ruleId: null,
      featureKey: null,
      txnIds: [],
    },
  ];

  // Rule evidence with per-family diminishing returns.
  const fired = ruleHits.filter((r) => r.fired);
  const byFamily = new Map<string, RuleHit[]>();
  for (const r of fired) {
    const fam = FAMILY[r.ruleId] ?? r.ruleId;
    const arr = byFamily.get(fam);
    if (arr) arr.push(r);
    else byFamily.set(fam, [r]);
  }
  const ruleContribution = new Map<string, number>();
  for (const [, rules] of byFamily) {
    const sorted = [...rules].sort((a, b) => b.weightLogLr - a.weightLogLr);
    sorted.forEach((r, i) => {
      ruleContribution.set(r.ruleId, i === 0 ? r.weightLogLr : r.weightLogLr * 0.5);
    });
  }

  // Residual feature evidence not covered by fired rules. Strongest signals
  // are admitted first so the bundle cap never crowds out a critical feature
  // in favour of weaker elevated ones.
  const firedIds = new Set(fired.map((r) => r.ruleId));
  let residual = 0;
  const residualDrivers: Driver[] = [];
  const residualCandidates = features
    .filter((f) => f.zone === "elevated" || f.zone === "critical")
    .filter((f) => !(FEATURE_RULE_COVER[f.key] ?? []).some((id) => firedIds.has(id)))
    .sort((a, b) => (b.zone === "critical" ? 0.3 : 0.15) - (a.zone === "critical" ? 0.3 : 0.15));
  for (const f of residualCandidates) {
    const c = f.zone === "critical" ? 0.3 : 0.15;
    if (residual + c > 0.9) continue; // cap residual bundle
    residual += c;
    residualDrivers.push({
      label: `Feature signal: ${f.label}`,
      contribution: c,
      source: "feature",
      ruleId: null,
      featureKey: f.key,
      txnIds: [],
    });
  }

  let evidence = residual;
  for (const c of ruleContribution.values()) evidence += c;

  // Data-quality shrinkage: below 0.9 the evidence is scaled down; below the
  // 0.7 design threshold the shrinkage is severe.
  const shrink = dataQuality >= 0.9 ? 1 : Math.max(0.55, dataQuality / 0.9);
  const shrunkEvidence = evidence * shrink;

  for (const r of fired) {
    const c = (ruleContribution.get(r.ruleId) ?? 0) * shrink;
    drivers.push({
      label: r.title,
      contribution: round3(c),
      source: "rule",
      ruleId: r.ruleId,
      featureKey: null,
      txnIds: r.txnIds.slice(0, 25),
    });
  }
  for (const d of residualDrivers) {
    drivers.push({ ...d, contribution: round3(d.contribution * shrink) });
  }
  if (shrink < 1 && evidence > 0) {
    drivers.push({
      label: `Data-quality suppression (score ${dataQuality.toFixed(2)}) - unreliable ledgers cannot raise confident alarms`,
      contribution: round3(shrunkEvidence - evidence),
      source: "data_quality",
      ruleId: null,
      featureKey: null,
      txnIds: [],
    });
  }

  let logOdds = priorLogOdds + shrunkEvidence;
  let p = sigmoid(logOdds);

  // Severity floors: a hard typology hit guarantees a minimum score, softened
  // when data quality is poor.
  let floor = 0;
  for (const r of fired) floor = Math.max(floor, RULE_FLOORS[r.ruleId] ?? 0);
  if (dataQuality < 0.7) floor *= 0.75;
  if (p < floor) {
    p = floor;
    logOdds = Math.log(p / (1 - p));
  }
  p = Math.min(p, 0.97);

  drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    probability: round4(p),
    priorProbability: PRIOR_P,
    posteriorLogOdds: round3(logOdds),
    band: bandFor(p),
    drivers: drivers.slice(0, 16),
  };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round4 = (v: number) => Math.round(v * 10000) / 10000;
