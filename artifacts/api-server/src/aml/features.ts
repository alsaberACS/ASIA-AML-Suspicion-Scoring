import type { FeatureValue, InternalPair, SubjectProfile, Txn, Zone } from "./types";
import { daysBetween } from "./netting";
import { buildIdentityIndex } from "./identity";
import { countryRisk, isCryptoNarrative, isSelfNarrative, isVagueNarrative } from "./vocab";

/**
 * Feature engineering layer.
 *
 * Deterministic, explainable indicators aligned to laundering typologies.
 * Every feature carries its baseline and a zone so the UI and the rule engine
 * share one source of truth. Features that lack statistical support are
 * emitted as "gated" instead of silently pretending to be evidence.
 */

export interface FeatureBundle {
  features: FeatureValue[];
  aux: {
    nearThresholdTxns: number[];
    multibankCashDays: Array<{ date: string; txnIds: number[] }>;
    splitDepositDays: Array<{ date: string; txnIds: number[] }>;
    quickOutMatches: Array<{ creditId: number; debitId: number; days: number }>;
    relayChains: Array<{ txnIds: number[] }>;
    geoTxns: number[];
    geoBlackTxns: number[];
    vagueHighValueTxns: number[];
    dormancyTxns: number[];
    burstWindow: { start: string; end: string; txnIds: number[] } | null;
    roundCashTxns: number[];
    topOutflowCounterparty: { name: string; share: number } | null;
    fanInCount: number;
    fanInTxns: number[];
    cryptoTxns: number[];
    cashDepositTxns: number[];
    benfordN: number;
  };
}

const KD_THRESHOLD = 3000;
const NEAR_LOW = 2400;

export function computeFeatures(
  all: Txn[],
  pairs: InternalPair[],
  profile: SubjectProfile,
): FeatureBundle {
  const internalIds = new Set<number>();
  for (const p of pairs) {
    internalIds.add(p.debitTxnId);
    internalIds.add(p.creditTxnId);
  }
  const external = all.filter((t) => !internalIds.has(t.id));
  const extCredits = external.filter((t) => t.direction === "credit");
  const extDebits = external.filter((t) => t.direction === "debit");
  const cashDeps = external.filter((t) => t.channel === "cash_deposit");
  const sum = (ts: Txn[]) => ts.reduce((s, t) => s + t.amountKwd, 0);
  const totalCredits = sum(extCredits);
  const totalDebits = sum(extDebits);
  const turnoverAll = sum(all);
  const cashDepTotal = sum(cashDeps);
  const income = profile.declaredMonthlyIncomeKwd;

  const dates = all.map((t) => t.postingDate).sort();
  const first = dates[0] ?? null;
  const last = dates[dates.length - 1] ?? null;
  const spanDays = first && last ? Math.max(1, daysBetween(first, last)) : 1;
  const spanMonths = Math.max(1, spanDays / 30.44);
  // Months in which the subject actually transacted. Statements with long
  // silent gaps would otherwise dilute per-month intensity measures.
  const activeMonths = Math.max(1, new Set(all.map((t) => t.postingDate.slice(0, 7))).size);

  const features: FeatureValue[] = [];
  const F = (
    key: string,
    label: string,
    group: FeatureValue["group"],
    value: number,
    zone: Zone,
    opts: Partial<Pick<FeatureValue, "unit" | "baseline" | "baselineLabel" | "description" | "gatedReason">> = {},
  ) => {
    features.push({
      key,
      label,
      group,
      value: round3(value),
      unit: opts.unit ?? null,
      baseline: opts.baseline ?? null,
      baselineLabel: opts.baselineLabel ?? null,
      zone,
      description: opts.description ?? null,
      gatedReason: opts.gatedReason ?? null,
    });
  };
  const zoneOf = (v: number, elevated: number, critical: number, reverse = false): Zone => {
    if (reverse) return v <= critical ? "critical" : v <= elevated ? "elevated" : "normal";
    return v >= critical ? "critical" : v >= elevated ? "elevated" : "normal";
  };

  // --- Cross-bank totals -------------------------------------------------
  F("total_turnover_kwd", "Total consolidated turnover", "cross_bank", turnoverAll, "normal", {
    unit: "KWD",
    description: "Sum of all movements across every bank, before netting internal transfers.",
  });

  const monthlyInflow = totalCredits / activeMonths;
  if (income && income > 0) {
    const mult = monthlyInflow / income;
    F("income_multiple", "External inflows vs declared income", "placement", mult, zoneOf(mult, 3, 6), {
      unit: "x income",
      baseline: 1.5,
      baselineLabel: "typical salary-account range",
      description: `External inflows average ${fmt(monthlyInflow)} KWD per active month (${activeMonths} months with activity over a ${Math.round(spanMonths)}-month span) against declared income ${fmt(income)} KWD/month.`,
    });
  } else {
    F("income_multiple", "External inflows vs declared income", "placement", 0, "gated", {
      gatedReason: "No declared monthly income on the subject profile.",
    });
  }

  // --- Cash placement ----------------------------------------------------
  const cashShare = totalCredits > 0 ? cashDepTotal / totalCredits : 0;
  if (totalCredits >= 1000) {
    F("cash_share", "Cash share of external inflows", "placement", cashShare, zoneOf(cashShare, 0.4, 0.7), {
      unit: "share",
      baseline: 0.15,
      baselineLabel: "retail banking norm",
      description: `Cash deposits total ${fmt(cashDepTotal)} KWD of ${fmt(totalCredits)} KWD external inflows.`,
    });
  } else {
    F("cash_share", "Cash share of external inflows", "placement", cashShare, "gated", {
      gatedReason: "External inflows below 1,000 KWD - share is not meaningful.",
    });
  }

  if (income && income > 0) {
    const peak = maxWindowSum(cashDeps, 30) / income;
    F("cash_to_income_peak", "Peak 30-day cash vs monthly income", "placement", peak, zoneOf(peak, 2, 4), {
      unit: "x income",
      baseline: 1,
      description: "Highest cash deposited in any 30-day window relative to declared monthly income.",
    });
  }

  const cashDepCountable = cashDeps.filter((t) => t.amountKwd >= 300);
  const nearThreshold = cashDeps.filter(
    (t) => t.amountKwd >= NEAR_LOW && t.amountKwd < KD_THRESHOLD,
  );
  const ntDensity = cashDepCountable.length > 0 ? nearThreshold.length / cashDepCountable.length : 0;
  if (cashDepCountable.length >= 5) {
    F("near_threshold_density", "Cash deposits just under KD 3,000", "placement", ntDensity, zoneOf(ntDensity, 0.2, 0.35), {
      unit: "share",
      baseline: 0.05,
      baselineLabel: "expected uniform share",
      description: `${nearThreshold.length} of ${cashDepCountable.length} sizeable cash deposits fall in the 2,400-2,999 KWD band directly below the KD 3,000 reporting trigger.`,
    });
  } else {
    F("near_threshold_density", "Cash deposits just under KD 3,000", "placement", ntDensity, "gated", {
      gatedReason: `Only ${cashDepCountable.length} sizeable cash deposits - density needs at least 5.`,
    });
  }

  // Same-day multi-bank cash aggregation.
  const byDay = groupBy(cashDeps, (t) => t.postingDate);
  const multibankCashDays: Array<{ date: string; txnIds: number[] }> = [];
  const splitDepositDays: Array<{ date: string; txnIds: number[] }> = [];
  let splitAggRatio = 0;
  for (const [date, ts] of byDay) {
    const eachBelow = ts.every((t) => t.amountKwd < KD_THRESHOLD);
    const total = sum(ts);
    const banks = new Set(ts.map((t) => t.bank));
    if (eachBelow && total >= KD_THRESHOLD) {
      if (banks.size >= 2) multibankCashDays.push({ date, txnIds: ts.map((t) => t.id) });
      else if (ts.length >= 2) {
        splitDepositDays.push({ date, txnIds: ts.map((t) => t.id) });
        splitAggRatio = Math.max(splitAggRatio, total / KD_THRESHOLD);
      }
    }
  }
  F(
    "same_day_multibank_cash_days",
    "Same-day cash placement across multiple banks",
    "cross_bank",
    multibankCashDays.length,
    multibankCashDays.length >= 5 ? "critical" : multibankCashDays.length >= 2 ? "elevated" : "normal",
    {
      unit: "days",
      baseline: 0,
      description:
        "Days where cash was deposited at two or more banks, each deposit below KD 3,000, while the daily total crossed the threshold - visible only after cross-bank consolidation.",
    },
  );
  F(
    "aggregate_threshold_evasion",
    "Split cash deposits under the threshold (single bank)",
    "placement",
    splitAggRatio,
    zoneOf(splitAggRatio, 0.8, 1.0),
    {
      unit: "x threshold",
      baseline: 0,
      description: `Largest same-day aggregate of multiple sub-threshold cash deposits at one bank, relative to the KD 3,000 trigger (${splitDepositDays.length} such day${splitDepositDays.length === 1 ? "" : "s"}). At or above 1.0 the combined sum crossed the trigger while every individual deposit stayed under it.`,
    },
  );

  // Bank fragmentation entropy of cash placement.
  if (cashDeps.length >= 5) {
    const perBank = groupBy(cashDeps, (t) => t.bank);
    const totals = [...perBank.values()].map((ts) => sum(ts));
    const totalV = totals.reduce((a, b) => a + b, 0);
    let H = 0;
    for (const v of totals) {
      if (v <= 0) continue;
      const p = v / totalV;
      H -= p * Math.log(p);
    }
    const norm = perBank.size > 1 ? H / Math.log(perBank.size) : 0;
    const frag = norm * Math.min(1, (perBank.size - 1) / 3);
    F("bank_fragmentation_index", "Cash fragmentation across banks", "cross_bank", frag, zoneOf(frag, 0.45, 0.7), {
      unit: "0-1",
      baseline: 0.2,
      description: `Cash placement spread across ${perBank.size} banks (entropy-based). High values mean deliberate distribution of cash entry points.`,
    });
  } else {
    F("bank_fragmentation_index", "Cash fragmentation across banks", "cross_bank", 0, "gated", {
      gatedReason: "Fewer than 5 cash deposits.",
    });
  }

  // Round numbers.
  const cashAll = external.filter(
    (t) => t.channel === "cash_deposit" || t.channel === "cash_withdrawal",
  );
  const roundCash = cashAll.filter((t) => t.amountKwd >= 100 && Math.abs(t.amountKwd % 100) < 0.001);
  const roundShare = cashAll.length > 0 ? roundCash.length / cashAll.length : 0;
  if (cashAll.length >= 10) {
    F("round_number_share", "Round-amount share of cash activity", "placement", roundShare, zoneOf(roundShare, 0.6, 0.8), {
      unit: "share",
      baseline: 0.35,
      description: "Share of cash transactions in exact multiples of 100 KWD. Genuine retail cash is messier.",
    });
  } else {
    F("round_number_share", "Round-amount share of cash activity", "placement", roundShare, "gated", {
      gatedReason: `Only ${cashAll.length} cash transactions - needs at least 10.`,
    });
  }

  // Benford (gated below n=300 per design).
  const benfordEligible = external.filter((t) => t.amountKwd >= 1);
  let benfordMad = 0;
  if (benfordEligible.length >= 300) {
    const counts = new Array(9).fill(0) as number[];
    for (const t of benfordEligible) {
      const d = firstDigit(t.amountKwd);
      if (d >= 1) counts[d - 1]!++;
    }
    const n = benfordEligible.length;
    let mad = 0;
    for (let d = 1; d <= 9; d++) {
      const expected = Math.log10(1 + 1 / d);
      mad += Math.abs(counts[d - 1]! / n - expected);
    }
    benfordMad = mad / 9;
    F("benford_mad", "Benford first-digit deviation", "placement", benfordMad, zoneOf(benfordMad, 0.012, 0.015), {
      unit: "MAD",
      baseline: 0.006,
      baselineLabel: "close conformity",
      description: `Mean absolute deviation of first-digit distribution from Benford's law over ${n} amounts.`,
    });
  } else {
    F("benford_mad", "Benford first-digit deviation", "placement", 0, "gated", {
      gatedReason: `Requires at least 300 transactions; only ${benfordEligible.length} available. Small samples produce false Benford alarms.`,
    });
  }

  // --- Layering ----------------------------------------------------------
  const passThrough = totalCredits > 0 ? totalDebits / totalCredits : 0;
  if (totalCredits >= 2000) {
    const inBand = passThrough >= 0.95 && passThrough <= 1.05;
    F("pass_through_ratio", "Outflow / inflow ratio (pass-through)", "layering", passThrough, inBand && totalCredits >= 10000 ? "elevated" : "normal", {
      unit: "ratio",
      baseline: 0.8,
      baselineLabel: "consumption accounts retain value",
      description:
        "External debits divided by external credits. A ratio pinned near 1.0 with high volume means funds only pass through.",
    });
  } else {
    F("pass_through_ratio", "Outflow / inflow ratio (pass-through)", "layering", passThrough, "gated", {
      gatedReason: "External inflows below 2,000 KWD.",
    });
  }

  // Dwell time: credit -> matched outflow.
  const bigCredits = extCredits.filter((t) => t.amountKwd >= 500);
  const debitPool = extDebits
    .filter((t) => t.amountKwd >= 250)
    .sort((a, b) => a.postingDate.localeCompare(b.postingDate));
  const usedDebits = new Set<number>();
  const quickOutMatches: Array<{ creditId: number; debitId: number; days: number }> = [];
  const dwellDays: number[] = [];
  let quickOutValue = 0;
  for (const c of bigCredits.sort((a, b) => a.postingDate.localeCompare(b.postingDate))) {
    let bestMatch: { d: Txn; gap: number } | null = null;
    for (const d of debitPool) {
      if (usedDebits.has(d.id)) continue;
      const gap = daysBetween(c.postingDate, d.postingDate);
      if (gap < 0) continue;
      if (gap > 30) break;
      const tol = Math.max(1, c.amountKwd * 0.05);
      if (Math.abs(d.amountKwd - c.amountKwd) <= tol) {
        bestMatch = { d, gap };
        break;
      }
    }
    if (bestMatch) {
      usedDebits.add(bestMatch.d.id);
      dwellDays.push(bestMatch.gap);
      if (bestMatch.gap <= 3) {
        quickOutMatches.push({ creditId: c.id, debitId: bestMatch.d.id, days: bestMatch.gap });
        quickOutValue += c.amountKwd;
      }
    }
  }
  if (dwellDays.length >= 5) {
    const med = median(dwellDays);
    F("dwell_median_days", "Median dwell time of matched inflows", "layering", med, zoneOf(med, 3, 1.5, true), {
      unit: "days",
      baseline: 7,
      description: `Median days between an external credit and a matching-magnitude outflow (${dwellDays.length} matched pairs). Laundering pipelines hold funds briefly.`,
    });
  } else {
    F("dwell_median_days", "Median dwell time of matched inflows", "layering", 0, "gated", {
      gatedReason: `Only ${dwellDays.length} matched credit-to-outflow pairs; needs 5.`,
    });
  }
  const bigCreditValue = sum(bigCredits);
  const quickShare = bigCreditValue > 0 ? quickOutValue / bigCreditValue : 0;
  F("quick_out_share", "Inflow value re-dispatched within 72 hours", "layering", quickShare, zoneOf(quickShare, 0.35, 0.6), {
    unit: "share",
    baseline: 0.1,
    description: "Share of sizeable inflow value matched to an outflow of similar magnitude within 3 days.",
  });

  // Relay chains: external credit @A -> internal A->B -> external debit @B.
  const relayChains: Array<{ txnIds: number[] }> = [];
  const txById = new Map(all.map((t) => [t.id, t]));
  for (const p of pairs) {
    const dTx = txById.get(p.debitTxnId);
    const cTx = txById.get(p.creditTxnId);
    if (!dTx || !cTx) continue;
    const feeder = extCredits.find(
      (t) =>
        t.bank === dTx.bank &&
        t.amountKwd >= 1000 &&
        Math.abs(t.amountKwd - p.amountKwd) <= Math.max(5, p.amountKwd * 0.1) &&
        daysBetween(t.postingDate, dTx.postingDate) >= 0 &&
        daysBetween(t.postingDate, dTx.postingDate) <= 3,
    );
    if (!feeder) continue;
    const exit = extDebits.find(
      (t) =>
        t.bank === cTx.bank &&
        Math.abs(t.amountKwd - p.amountKwd) <= Math.max(5, p.amountKwd * 0.15) &&
        daysBetween(cTx.postingDate, t.postingDate) >= 0 &&
        daysBetween(cTx.postingDate, t.postingDate) <= 3,
    );
    if (exit) relayChains.push({ txnIds: [feeder.id, p.debitTxnId, p.creditTxnId, exit.id] });
  }
  F("relay_chain_count", "Inter-bank relay chains (in, hop, out)", "cross_bank", relayChains.length, relayChains.length >= 4 ? "critical" : relayChains.length >= 2 ? "elevated" : "normal", {
    unit: "chains",
    baseline: 0,
    description:
      "External inflow at bank A, moved to own account at bank B, dispatched externally - each leg within 3 days and matching magnitude.",
  });

  // Internal circulation share. Matched two-leg pairs count twice (both legs
  // sit in turnover); single-leg movements the statement itself declares as
  // own-account transfers count once - the counterpart statement is simply
  // outside the delivered period.
  const internalValue = pairs.reduce((s, p) => s + p.amountKwd, 0);
  const selfDeclared = external.filter((t) => isSelfNarrative(t.narrative));
  const selfDeclaredValue = sum(selfDeclared);
  const circShare = turnoverAll > 0 ? (internalValue * 2 + selfDeclaredValue) / turnoverAll : 0;
  F("internal_circulation_share", "Turnover circulating between own accounts", "cross_bank", circShare, zoneOf(circShare, 0.25, 0.45), {
    unit: "share",
    baseline: 0.05,
    description: `${fmt(internalValue)} KWD in matched own-account pairs (${pairs.length}) plus ${fmt(selfDeclaredValue)} KWD of single-leg movements the narratives themselves declare as own transfers.`,
  });

  // --- Temporal ----------------------------------------------------------
  const burst = velocityBurst(external);
  if (burst.gated) {
    F("velocity_burst_z", "Velocity burst vs own history", "temporal", 0, "gated", {
      gatedReason: "Less than 6 months of history for a self-baseline.",
    });
  } else {
    F("velocity_burst_z", "Velocity burst vs own history", "temporal", burst.z, zoneOf(burst.z, 2.5, 3.5), {
      unit: "z-score",
      baseline: 0,
      description: `Peak 30-day turnover ${fmt(burst.peak)} KWD vs typical ${fmt(burst.mean)} KWD (window ${burst.start ?? ""} to ${burst.end ?? ""}).`,
    });
  }

  const dorm = dormancyReactivation(all);
  F("dormancy_reactivation", "Dormant account reactivated with heavy flows", "temporal", dorm ? 1 : 0, dorm ? "elevated" : "normal", {
    unit: "flag",
    baseline: 0,
    description: dorm
      ? `Account ${dorm.accountId} was inactive ${Math.round(dorm.gapDays)} days, then moved ${fmt(dorm.value)} KWD within 30 days.`
      : "No account showed a 180+ day silence followed by an activity surge.",
  });

  const weekendTxns = external.filter((t) => {
    const dow = new Date(`${t.postingDate}T00:00:00Z`).getUTCDay();
    return dow === 5 || dow === 6; // Fri, Sat - Kuwait weekend
  });
  const weekendShare = external.length > 0 ? weekendTxns.length / external.length : 0;
  if (external.length >= 50) {
    F("weekend_share", "Weekend share of activity", "temporal", weekendShare, zoneOf(weekendShare, 0.45, 0.6), {
      unit: "share",
      baseline: 0.28,
      description: "Friday/Saturday share of external transactions.",
    });
  }

  const monthly = groupBy(external, (t) => t.postingDate.slice(0, 7));
  if (monthly.size >= 4) {
    const totals = [...monthly.values()].map((ts) => sum(ts));
    const med = median(totals);
    const factor = med > 0 ? Math.max(...totals) / med : 0;
    F("structural_break_factor", "Peak month vs median month", "temporal", factor, zoneOf(factor, 4, 8), {
      unit: "x",
      baseline: 1.5,
      description: "A sudden regime shift in monthly turnover suggests an account repurposed as a conduit.",
    });
  }

  // --- Network -----------------------------------------------------------
  // Identity resolution: name variants cluster together and masked
  // account / rail references count as literal parties, so network features
  // measure PARTIES rather than spellings.
  const identity = buildIdentityIndex(external.map((t) => t.counterpartyName));
  const cpKeyOf = (t: Txn): string | null => identity.keyOf(t.counterpartyName);
  const named = external.filter((t) => cpKeyOf(t) != null);
  const byCp = groupBy(named, (t) => cpKeyOf(t)!);
  if (byCp.size >= 3) {
    const values = [...byCp.values()].map((ts) => sum(ts));
    const totalV = values.reduce((a, b) => a + b, 0);
    const hhi = totalV > 0 ? values.reduce((s, v) => s + (v / totalV) ** 2, 0) : 0;
    F("counterparty_concentration_hhi", "Counterparty concentration (HHI)", "network", hhi, zoneOf(hhi, 0.4, 0.65), {
      unit: "0-1",
      baseline: 0.15,
      description: `${byCp.size} resolved counterparties (name variants and masked references consolidated); high concentration plus high volume indicates a dedicated pipe rather than organic activity.`,
    });
  } else {
    F("counterparty_concentration_hhi", "Counterparty concentration (HHI)", "network", 0, "gated", {
      gatedReason: `Only ${byCp.size} resolved counterparties.`,
    });
  }

  const fanInCredits = extCredits.filter(
    (t) => cpKeyOf(t) != null && !isSelfNarrative(t.narrative),
  );
  const fanIn = new Set(fanInCredits.map((t) => cpKeyOf(t)!)).size;
  F("fan_in_count", "Distinct inflow counterparties", "network", fanIn, fanIn >= 40 ? "critical" : fanIn >= 15 ? "elevated" : "normal", {
    unit: "parties",
    baseline: 5,
    description: "Many unrelated payers feeding one subject is the funnel-account signature.",
  });

  const outByCp = groupBy(
    extDebits.filter((t) => cpKeyOf(t) != null),
    (t) => cpKeyOf(t)!,
  );
  let topOutflowCounterparty: { name: string; share: number } | null = null;
  if (outByCp.size > 0) {
    const outTotal = sum(extDebits.filter((t) => cpKeyOf(t) != null));
    let bestName = "";
    let bestV = 0;
    for (const [name, ts] of outByCp) {
      const v = sum(ts);
      if (v > bestV) {
        bestV = v;
        bestName = name;
      }
    }
    if (outTotal > 0) {
      topOutflowCounterparty = { name: identity.displayOf(bestName), share: bestV / outTotal };
    }
  }

  // --- Geography ---------------------------------------------------------
  const geoTxns: number[] = [];
  const geoBlackTxns: number[] = [];
  let geoValue = 0;
  for (const t of external) {
    const risk = countryRisk(t.counterpartyCountry);
    if (risk) {
      geoTxns.push(t.id);
      geoValue += t.amountKwd;
      if (risk === "black") geoBlackTxns.push(t.id);
    }
  }
  const geoShare = turnoverAll > 0 ? geoValue / turnoverAll : 0;
  F("high_risk_geo_share", "Value share touching FATF-listed jurisdictions", "geography", geoShare, geoBlackTxns.length > 0 ? "critical" : zoneOf(geoShare, 0.02, 0.1), {
    unit: "share",
    baseline: 0,
    description:
      geoTxns.length > 0
        ? `${geoTxns.length} transactions with counterparties in FATF call-for-action or increased-monitoring countries.`
        : "No exposure to FATF-listed jurisdictions detected. Routine remittance corridors are NOT treated as risk.",
  });

  // --- Narrative ---------------------------------------------------------
  const vagueValue = external
    .filter((t) => isVagueNarrative(t.narrative))
    .reduce((s, t) => s + t.amountKwd, 0);
  const vagueShare = turnoverAll > 0 ? vagueValue / turnoverAll : 0;
  F("narrative_vagueness_share", "Value with vague or empty narratives", "narrative", vagueShare, zoneOf(vagueShare, 0.5, 0.75), {
    unit: "share",
    baseline: 0.2,
    description: "Value-weighted share of movements whose descriptions carry no economic story.",
  });

  // A counterparty is only "identified" when the statement yields an actual
  // name - masked account fragments and payment-rail references do not tell
  // the analyst who the money came from.
  const identifiableName = (name: string | null): boolean => {
    if (!name) return false;
    const n = name.trim();
    if (/^(account|instapay)\b/i.test(n)) return false;
    if (/^[0-9X\s.-]+$/i.test(n)) return false;
    return n.length >= 3;
  };
  const unexplained = extCredits.filter(
    (t) =>
      t.channel !== "salary" &&
      t.channel !== "interest" &&
      t.channel !== "cash_deposit" &&
      !isSelfNarrative(t.narrative) &&
      !identifiableName(t.counterpartyName),
  );
  const unexplainedShare = totalCredits > 0 ? sum(unexplained) / totalCredits : 0;
  F("unexplained_inflow_share", "Inflow value with no attributable source", "narrative", unexplainedShare, zoneOf(unexplainedShare, 0.35, 0.55), {
    unit: "share",
    baseline: 0.1,
    description: `Non-cash credits whose sender cannot be identified from the statement (no name - at best a masked reference), excluding salary, interest and declared own-account moves. ${unexplained.length} credits totalling ${fmt(sum(unexplained))} KWD.`,
  });

  const vagueHighValueTxns = external
    .filter((t) => isVagueNarrative(t.narrative) && t.amountKwd >= 1000)
    .map((t) => t.id);

  // --- Virtual-asset exposure -------------------------------------------
  const cryptoTxns = external.filter((t) => isCryptoNarrative(t.narrative));
  const cryptoValue = sum(cryptoTxns);
  F(
    "crypto_exposure_count",
    "Virtual-asset touchpoints",
    "layering",
    cryptoTxns.length,
    cryptoTxns.length >= 6 ? "critical" : cryptoTxns.length >= 2 ? "elevated" : "normal",
    {
      unit: "txns",
      baseline: 0,
      description:
        cryptoTxns.length > 0
          ? `${cryptoTxns.length} movements totalling ${fmt(cryptoValue)} KWD reference virtual-asset platforms or crypto purchases in their narratives.`
          : "No virtual-asset references detected in transaction narratives.",
    },
  );

  return {
    features,
    aux: {
      nearThresholdTxns: nearThreshold.map((t) => t.id),
      multibankCashDays,
      splitDepositDays,
      quickOutMatches,
      relayChains,
      geoTxns,
      geoBlackTxns,
      vagueHighValueTxns,
      dormancyTxns: dorm?.txnIds ?? [],
      burstWindow: burst.gated ? null : { start: burst.start!, end: burst.end!, txnIds: burst.txnIds },
      roundCashTxns: roundCash.map((t) => t.id),
      topOutflowCounterparty,
      fanInCount: fanIn,
      fanInTxns: fanInCredits.map((t) => t.id),
      cryptoTxns: cryptoTxns.map((t) => t.id),
      cashDepositTxns: cashDeps.map((t) => t.id),
      benfordN: benfordEligible.length,
    },
  };
}

// ---------------------------------------------------------------------------

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function fmt(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function firstDigit(v: number): number {
  const s = Math.abs(v).toExponential();
  const d = parseInt(s[0]!, 10);
  return isNaN(d) ? 0 : d;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function maxWindowSum(txns: Txn[], windowDays: number): number {
  if (txns.length === 0) return 0;
  const sorted = [...txns].sort((a, b) => a.postingDate.localeCompare(b.postingDate));
  let best = 0;
  let start = 0;
  let acc = 0;
  for (let end = 0; end < sorted.length; end++) {
    acc += sorted[end]!.amountKwd;
    while (daysBetween(sorted[start]!.postingDate, sorted[end]!.postingDate) > windowDays) {
      acc -= sorted[start]!.amountKwd;
      start++;
    }
    if (acc > best) best = acc;
  }
  return best;
}

function velocityBurst(external: Txn[]): {
  gated: boolean;
  z: number;
  peak: number;
  mean: number;
  start: string | null;
  end: string | null;
  txnIds: number[];
} {
  if (external.length === 0) return { gated: true, z: 0, peak: 0, mean: 0, start: null, end: null, txnIds: [] };
  const sorted = [...external].sort((a, b) => a.postingDate.localeCompare(b.postingDate));
  const first = sorted[0]!.postingDate;
  const last = sorted[sorted.length - 1]!.postingDate;
  const span = daysBetween(first, last);
  if (span < 180) return { gated: true, z: 0, peak: 0, mean: 0, start: null, end: null, txnIds: [] };
  // 30-day windows stepped by 15 days.
  const windows: Array<{ start: string; end: string; total: number; ids: number[] }> = [];
  for (let off = 0; off <= span - 30; off += 15) {
    const ws = addDays(first, off);
    const we = addDays(first, off + 30);
    const inWin = sorted.filter((t) => t.postingDate >= ws && t.postingDate < we);
    windows.push({ start: ws, end: we, total: inWin.reduce((s, t) => s + t.amountKwd, 0), ids: inWin.map((t) => t.id) });
  }
  if (windows.length < 6) return { gated: true, z: 0, peak: 0, mean: 0, start: null, end: null, txnIds: [] };
  const totals = windows.map((w) => w.total);
  const peakIdx = totals.indexOf(Math.max(...totals));
  const rest = totals.filter((_, i) => i !== peakIdx);
  const mean = rest.reduce((a, b) => a + b, 0) / rest.length;
  const sd = Math.sqrt(rest.reduce((s, v) => s + (v - mean) ** 2, 0) / rest.length) || 1;
  const peak = totals[peakIdx]!;
  const z = (peak - mean) / sd;
  const w = windows[peakIdx]!;
  return { gated: false, z, peak, mean, start: w.start, end: w.end, txnIds: w.ids.slice(0, 60) };
}

function dormancyReactivation(all: Txn[]): { accountId: string; gapDays: number; value: number; txnIds: number[] } | null {
  const byAccount = groupBy(all, (t) => `${t.bank}|${t.accountId}`);
  for (const [key, ts] of byAccount) {
    const sorted = [...ts].sort((a, b) => a.postingDate.localeCompare(b.postingDate));
    if (sorted.length < 5) continue;
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1]!.postingDate, sorted[i]!.postingDate);
      if (gap >= 180) {
        const reactivationStart = sorted[i]!.postingDate;
        const windowEnd = addDays(reactivationStart, 30);
        const after = sorted.filter((t) => t.postingDate >= reactivationStart && t.postingDate < windowEnd);
        const value = after.reduce((s, t) => s + t.amountKwd, 0);
        const beforeSpanDays = Math.max(30, daysBetween(sorted[0]!.postingDate, sorted[i - 1]!.postingDate));
        const priorMonthly = sorted.slice(0, i).reduce((s, t) => s + t.amountKwd, 0) / (beforeSpanDays / 30.44);
        if (value >= 2000 && value > 3 * Math.max(1, priorMonthly)) {
          return { accountId: key.split("|")[1] ?? key, gapDays: gap, value, txnIds: after.map((t) => t.id).slice(0, 40) };
        }
      }
    }
  }
  return null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}
