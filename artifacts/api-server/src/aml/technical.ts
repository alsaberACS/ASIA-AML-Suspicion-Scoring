import type {
  Channel,
  GatedTechnicalTest,
  InternalPair,
  TechnicalAnalysis,
  TechnicalFinding,
  TechnicalSeverity,
  Txn,
} from "./types";

const ENGINE_VERSION = "forensic-v1.1";
const TESTS = [
  "robust_amount_outliers",
  "behavioral_change_point",
  "counterparty_concentration",
  "rapid_pass_through_sequences",
  "network_circulation",
  "cross_bank_counterparty_bridging",
  "cross_bank_burst_synchronization",
  "cross_bank_role_specialization",
  "cross_bank_amount_echoes",
] as const;

interface AmountCandidate {
  txn: Txn;
  z: number;
}

export function computeTechnicalAnalysis(
  all: Txn[],
  pairs: InternalPair[],
  dataQuality: number,
): TechnicalAnalysis {
  const internalIds = new Set(pairs.flatMap((p) => [p.debitTxnId, p.creditTxnId]));
  const external = all.filter((t) => !internalIds.has(t.id));
  const findings: TechnicalFinding[] = [];
  const gatedTests: GatedTechnicalTest[] = [];
  const qualityCaveat =
    dataQuality < 0.85
      ? `Data quality is ${(dataQuality * 100).toFixed(0)}%; treat magnitudes and sequence completeness as provisional until source breaks are resolved.`
      : null;

  findAmountOutliers(external, findings, gatedTests, qualityCaveat);
  findBehaviorChange(external, findings, gatedTests, qualityCaveat);
  findCounterpartyConcentration(external, findings, gatedTests, qualityCaveat);
  findPassThroughSequences(external, findings, gatedTests, qualityCaveat);
  findNetworkAndCirculation(external, all, pairs, findings, gatedTests, qualityCaveat);
  findCrossBankPatterns(external, findings, gatedTests, qualityCaveat);

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return {
    engineVersion: ENGINE_VERSION,
    testedTransactionCount: all.length,
    dataQualityScore: round3(dataQuality),
    testsExecuted: [...TESTS],
    gatedTests,
    findings,
  };
}

function findAmountOutliers(
  txns: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const groups = groupBy(txns, (t) => `${t.bank}|${t.direction}`);
  const candidates: AmountCandidate[] = [];
  let eligibleGroups = 0;
  for (const group of groups.values()) {
    if (group.length < 6) continue;
    const amounts = group.map((t) => t.amountKwd);
    const med = median(amounts);
    const mad = median(amounts.map((v) => Math.abs(v - med)));
    if (mad <= 0) continue;
    eligibleGroups++;
    for (const txn of group) {
      const z = (0.6745 * Math.abs(txn.amountKwd - med)) / mad;
      if (z >= 4 && txn.amountKwd >= 500) candidates.push({ txn, z });
    }
  }
  if (eligibleGroups === 0) {
    gated.push({
      testId: "robust_amount_outliers",
      reason: "No bank-and-direction peer group had at least 6 non-identical observations.",
    });
    return;
  }
  if (candidates.length === 0) return;
  candidates.sort((a, b) => b.z - a.z);
  const selected = candidates.slice(0, 12);
  const max = selected[0]!;
  findings.push({
    findingId: "TECH-AMT-01",
    category: "amount_outlier",
    title: "Robust amount outliers within bank behavior",
    severity: severity(max.z >= 8, max.z >= 6),
    summary: `${candidates.length} transaction${candidates.length === 1 ? "" : "s"} sit far outside the subject's own amount distribution; the strongest is ${fmt(max.txn.amountKwd)} KWD at a modified z-score of ${max.z.toFixed(1)}.`,
    metricValue: round3(max.z),
    benchmark: "Modified z-score >= 4.0 within the same bank and direction",
    methodology:
      "Median absolute deviation (MAD), grouped by bank and credit/debit direction. This is robust to a few extreme values and uses the subject's own history rather than a population blacklist.",
    caveat,
    txnIds: selected.map((c) => c.txn.id),
  });
}

function findBehaviorChange(
  txns: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const byMonth = groupBy(txns, (t) => t.postingDate.slice(0, 7));
  const months = [...byMonth.entries()]
    .map(([month, monthTxns]) => ({
      month,
      txns: monthTxns,
      total: sum(monthTxns),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (months.length < 6) {
    gated.push({
      testId: "behavioral_change_point",
      reason: `Only ${months.length} active months; at least 6 are required for a before/after comparison.`,
    });
    return;
  }

  let best:
    | {
        split: number;
        before: number;
        after: number;
        ratio: number;
      }
    | undefined;
  for (let split = 3; split <= months.length - 3; split++) {
    const before = median(months.slice(0, split).map((m) => m.total));
    const after = median(months.slice(split).map((m) => m.total));
    if (before <= 0 || after <= before) continue;
    const ratio = after / before;
    if (!best || ratio > best.ratio) best = { split, before, after, ratio };
  }
  if (!best || best.ratio < 3 || best.after - best.before < 2_000) return;

  const postMonths = months.slice(best.split);
  const evidence = postMonths
    .flatMap((m) => m.txns)
    .sort((a, b) => b.amountKwd - a.amountKwd)
    .slice(0, 25);
  const discontinuous = months.some((m, i) => {
    if (i === 0) return false;
    return monthDistance(months[i - 1]!.month, m.month) > 2;
  });
  findings.push({
    findingId: "TECH-TMP-01",
    category: "behavior_change",
    title: "Sustained behavioral regime shift",
    severity: severity(best.ratio >= 8, best.ratio >= 5),
    summary: `Median active-month turnover changed from ${fmt(best.before)} KWD to ${fmt(best.after)} KWD after ${postMonths[0]!.month}, a ${best.ratio.toFixed(1)}x increase.`,
    metricValue: round3(best.ratio),
    benchmark: "Post-change median >= 3x prior median and at least 2,000 KWD higher",
    methodology:
      "Exhaustive median before/after split over active months, requiring at least three observations on each side. Median comparison reduces sensitivity to a single burst month.",
    caveat: joinCaveats(
      caveat,
      discontinuous
        ? "Statement coverage contains gaps longer than two months; the split compares active months and does not assume continuous observation."
        : null,
    ),
    txnIds: evidence.map((t) => t.id),
  });
}

function findCounterpartyConcentration(
  txns: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const candidates: Array<{
    direction: Txn["direction"];
    hhi: number;
    topShare: number;
    total: number;
    topName: string;
    topTxns: Txn[];
  }> = [];
  for (const direction of ["credit", "debit"] as const) {
    const named = txns.filter(
      (t) => t.direction === direction && identifiableCounterparty(t.counterpartyName),
    );
    const byCp = groupBy(named, (t) => normalizeCounterparty(t.counterpartyName!));
    if (byCp.size < 3) continue;
    const values = [...byCp.entries()].map(([name, cpTxns]) => ({
      name,
      txns: cpTxns,
      value: sum(cpTxns),
    }));
    const total = values.reduce((s, v) => s + v.value, 0);
    if (total < 3_000) continue;
    values.sort((a, b) => b.value - a.value);
    const hhi = values.reduce((s, v) => s + (v.value / total) ** 2, 0);
    candidates.push({
      direction,
      hhi,
      topShare: values[0]!.value / total,
      total,
      topName: values[0]!.name,
      topTxns: values[0]!.txns,
    });
  }
  if (candidates.length === 0) {
    gated.push({
      testId: "counterparty_concentration",
      reason: "No direction had at least 3 identifiable counterparties and 3,000 KWD of attributable value.",
    });
    return;
  }
  candidates.sort((a, b) => Math.max(b.hhi, b.topShare) - Math.max(a.hhi, a.topShare));
  const best = candidates[0]!;
  if (best.hhi < 0.35 && best.topShare < 0.5) return;
  findings.push({
    findingId: "TECH-NET-01",
    category: "counterparty_concentration",
    title: `${best.direction === "credit" ? "Inflow" : "Outflow"} counterparty concentration`,
    severity: severity(best.topShare >= 0.75 && best.total >= 10_000, best.hhi >= 0.5),
    summary: `${best.topName} accounts for ${(best.topShare * 100).toFixed(0)}% of named ${best.direction === "credit" ? "inflow" : "outflow"} value; HHI is ${best.hhi.toFixed(2)} across attributable counterparties.`,
    metricValue: round3(best.hhi),
    benchmark: "HHI >= 0.35 or top counterparty share >= 50%",
    methodology:
      "Value-weighted Herfindahl-Hirschman concentration by direction after excluding masked account references and unidentified payment-rail labels.",
    caveat,
    txnIds: best.topTxns
      .sort((a, b) => b.amountKwd - a.amountKwd)
      .slice(0, 20)
      .map((t) => t.id),
  });
}

function findPassThroughSequences(
  txns: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const credits = txns
    .filter((t) => t.direction === "credit" && t.amountKwd >= 500)
    .sort(byDateThenId);
  const debits = txns
    .filter((t) => t.direction === "debit" && t.amountKwd >= 475)
    .sort(byDateThenId);
  if (credits.length < 2 || debits.length < 2) {
    gated.push({
      testId: "rapid_pass_through_sequences",
      reason: "Fewer than 2 sizeable credits or debits were available for sequence matching.",
    });
    return;
  }
  const used = new Set<number>();
  const matches: Array<{ credit: Txn; debit: Txn; gap: number }> = [];
  for (const credit of credits) {
    const match = debits.find((debit) => {
      if (used.has(debit.id)) return false;
      const gap = dayDiff(credit.postingDate, debit.postingDate);
      // Statement dates do not preserve intraday ordering, so same-day rows
      // cannot establish that a debit followed a credit.
      if (gap <= 0 || gap > 3) return false;
      return Math.abs(debit.amountKwd - credit.amountKwd) <= credit.amountKwd * 0.05;
    });
    if (match) {
      used.add(match.id);
      matches.push({ credit, debit: match, gap: dayDiff(credit.postingDate, match.postingDate) });
    }
  }
  const value = matches.reduce((s, m) => s + Math.min(m.credit.amountKwd, m.debit.amountKwd), 0);
  if (matches.length < 2 || value < 3_000) return;
  const evidence = matches.slice(0, 12).flatMap((m) => [m.credit.id, m.debit.id]);
  findings.push({
    findingId: "TECH-SEQ-01",
    category: "sequence_pattern",
    title: "Rapid amount-matched pass-through sequences",
    severity: severity(matches.length >= 8 || value >= 30_000, matches.length >= 4 || value >= 10_000),
    summary: `${matches.length} sizeable credits were followed within 72 hours by debits within 5% of the incoming amount, representing ${fmt(value)} KWD of matched flow.`,
    metricValue: matches.length,
    benchmark: "At least 2 matched credit-to-debit pairs and 3,000 KWD within 72 hours",
    methodology:
      "Greedy one-to-one temporal matching of external credits to later external debits within 3 days and 5% amount tolerance. Each debit can support only one sequence.",
    caveat,
    txnIds: evidence,
  });
}

function findNetworkAndCirculation(
  external: Txn[],
  all: Txn[],
  pairs: InternalPair[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const inflow = external.filter(
    (t) => t.direction === "credit" && identifiableCounterparty(t.counterpartyName),
  );
  const fanIn = new Set(inflow.map((t) => normalizeCounterparty(t.counterpartyName!))).size;
  const namedOut = external.filter(
    (t) => t.direction === "debit" && identifiableCounterparty(t.counterpartyName),
  );
  const outByCp = groupBy(namedOut, (t) => normalizeCounterparty(t.counterpartyName!));
  const outTotal = sum(namedOut);
  const topOut = [...outByCp.entries()]
    .map(([name, cpTxns]) => ({ name, txns: cpTxns, value: sum(cpTxns) }))
    .sort((a, b) => b.value - a.value)[0];
  const topShare = topOut && outTotal > 0 ? topOut.value / outTotal : 0;

  if (fanIn >= 8 && topOut && topShare >= 0.4) {
    const evidence = [
      ...inflow.sort((a, b) => b.amountKwd - a.amountKwd).slice(0, 18),
      ...topOut.txns.sort((a, b) => b.amountKwd - a.amountKwd).slice(0, 12),
    ];
    findings.push({
      findingId: "TECH-NET-02",
      category: "network_circulation",
      title: "Many-to-one funnel network structure",
      severity: severity(fanIn >= 30 && topShare >= 0.7, fanIn >= 15 && topShare >= 0.5),
      summary: `${fanIn} identifiable counterparties feed the subject while ${(topShare * 100).toFixed(0)}% of named outflow value converges on ${topOut.name}.`,
      metricValue: fanIn,
      benchmark: "At least 8 inflow counterparties plus >= 40% of named outflow to one beneficiary",
      methodology:
        "Directed transaction-graph centralization: distinct inbound counterparties are compared with value concentration on the dominant outbound edge.",
      caveat,
      txnIds: unique(evidence.map((t) => t.id)).slice(0, 30),
    });
  }

  const loops = findOwnAccountReturnLoops(all, pairs);
  const loopValue = loops.reduce((total, loop) => total + loop.value, 0);
  if (loops.length > 0 && loopValue >= 3_000) {
    findings.push({
      findingId: "TECH-NET-03",
      category: "network_circulation",
      title: "Reversed circulation across own accounts",
      severity: severity(loops.length >= 4 || loopValue >= 50_000, loops.length >= 2 || loopValue >= 15_000),
      summary: `${loops.length} amount-matched own-account transfer loop${loops.length === 1 ? "" : "s"} returned funds to the originating account within 30 days, representing ${fmt(loopValue)} KWD of returned value.`,
      metricValue: loops.length,
      benchmark: "At least 1 reversed own-account route, >= 3,000 KWD returned within 30 days, and <= 10% amount variance",
      methodology:
        "High-confidence matched own-account transfers are converted to directed account-to-account edges. A signal requires a later reverse edge back to the original account, rather than ordinary one-way account consolidation.",
      caveat,
      txnIds: unique(
        loops.flatMap((loop) => [
          loop.first.debitTxnId,
          loop.first.creditTxnId,
          loop.returnPair.debitTxnId,
          loop.returnPair.creditTxnId,
        ]),
      ).slice(0, 30),
    });
  }

  if (inflow.length < 8 && loops.length === 0) {
    gated.push({
      testId: "network_circulation",
      reason:
        pairs.length === 0
          ? "Insufficient identifiable fan-in and no matched own-account transfers."
          : "Insufficient identifiable fan-in and no later reversed own-account transfer loop.",
    });
  }
}

function findOwnAccountReturnLoops(
  all: Txn[],
  pairs: InternalPair[],
): Array<{ first: InternalPair; returnPair: InternalPair; value: number }> {
  const byId = new Map(all.map((txn) => [txn.id, txn]));
  const edges = pairs
    .map((pair) => {
      const debit = byId.get(pair.debitTxnId);
      const credit = byId.get(pair.creditTxnId);
      if (!debit || !credit) return null;
      return {
        pair,
        source: `${debit.bank}|${debit.accountId}`,
        destination: `${credit.bank}|${credit.accountId}`,
        date: debit.postingDate,
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
    .sort((a, b) => a.date.localeCompare(b.date) || a.pair.id - b.pair.id);
  const usedEdgePairs = new Set<number>();
  const loops: Array<{ first: InternalPair; returnPair: InternalPair; value: number }> = [];

  for (let i = 0; i < edges.length; i++) {
    const first = edges[i]!;
    if (usedEdgePairs.has(first.pair.id)) continue;
    if (first.source === first.destination) continue;
    const reverse = edges.slice(i + 1).find((candidate) => {
      if (usedEdgePairs.has(candidate.pair.id)) return false;
      if (candidate.source !== first.destination || candidate.destination !== first.source) {
        return false;
      }
      const gap = dayDiff(first.date, candidate.date);
      if (gap <= 0 || gap > 30) return false;
      const variance =
        Math.abs(candidate.pair.amountKwd - first.pair.amountKwd) /
        Math.max(candidate.pair.amountKwd, first.pair.amountKwd);
      return variance <= 0.1;
    });
    if (!reverse) continue;
    usedEdgePairs.add(first.pair.id);
    usedEdgePairs.add(reverse.pair.id);
    loops.push({
      first: first.pair,
      returnPair: reverse.pair,
      value: Math.min(first.pair.amountKwd, reverse.pair.amountKwd),
    });
  }
  return loops;
}

// ---------------------------------------------------------------------------
// Cross-bank pattern measurement. These tests compare the institutions against
// each other rather than pooling all activity; they never touch the score path.

const CASH_IN: ReadonlySet<Channel> = new Set(["cash_deposit"]);
const CASH_OUT: ReadonlySet<Channel> = new Set(["cash_withdrawal"]);
const XFER_IN: ReadonlySet<Channel> = new Set(["transfer_in"]);
const XFER_OUT: ReadonlySet<Channel> = new Set(["transfer_out"]);
const MOVEMENT_DEBIT: ReadonlySet<Channel> = new Set([
  "cash_withdrawal",
  "transfer_out",
  "cheque",
  "other",
]);
const MOVEMENT_CREDIT: ReadonlySet<Channel> = new Set([
  "cash_deposit",
  "transfer_in",
  "cheque",
  "other",
]);

function findCrossBankPatterns(
  external: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const banks = new Set(external.map((t) => t.bank));
  if (banks.size < 2) {
    for (const testId of [
      "cross_bank_counterparty_bridging",
      "cross_bank_burst_synchronization",
      "cross_bank_role_specialization",
      "cross_bank_amount_echoes",
    ]) {
      gated.push({
        testId,
        reason: "Fewer than 2 institutions have external activity; cross-bank comparison is not possible.",
      });
    }
    return;
  }
  findCounterpartyBridging(external, findings, gated, caveat);
  findBurstSynchronization(external, findings, gated, caveat);
  findRoleSpecialization(external, findings, gated, caveat);
  findAmountEchoes(external, findings, gated, caveat);
}

function findCounterpartyBridging(
  txns: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const named = txns.filter((t) => identifiableCounterparty(t.counterpartyName));
  if (new Set(named.map((t) => t.bank)).size < 2) {
    gated.push({
      testId: "cross_bank_counterparty_bridging",
      reason: "Identifiable counterparties are present at fewer than 2 institutions.",
    });
    return;
  }
  const byCp = groupBy(named, (t) => normalizeCounterparty(t.counterpartyName!));
  const bridges = [...byCp.entries()]
    .map(([name, cpTxns]) => ({
      name,
      txns: cpTxns,
      bankCount: new Set(cpTxns.map((t) => t.bank)).size,
      value: sum(cpTxns),
    }))
    .filter((bridge) => bridge.bankCount >= 2 && bridge.value >= 1_000)
    .sort((a, b) => b.value - a.value);
  if (bridges.length === 0) return;
  const top = bridges[0]!;
  const totalValue = bridges.reduce((s, b) => s + b.value, 0);
  const maxBanks = Math.max(...bridges.map((b) => b.bankCount));
  findings.push({
    findingId: "TECH-XB-01",
    category: "cross_bank_pattern",
    title: "Counterparties bridging multiple banks",
    severity: severity(maxBanks >= 3 || totalValue >= 20_000, bridges.length >= 2 || totalValue >= 8_000),
    summary: `${bridges.length} counterpart${bridges.length === 1 ? "y transacts" : "ies transact"} with the subject at 2+ banks; the largest, ${top.name}, moves ${fmt(top.value)} KWD across ${top.bankCount} institutions.`,
    metricValue: bridges.length,
    benchmark: "Same normalized counterparty at >= 2 institutions with >= 1,000 KWD combined value",
    methodology:
      "Counterparty names are normalized and matched across institutions after excluding recognized internal transfers. Splitting one relationship across several banks fragments each institution's independent view of that relationship.",
    caveat: joinCaveats(
      caveat,
      "Name-based matching can merge or miss counterparties that appear under transliteration variants.",
    ),
    txnIds: unique(
      bridges.flatMap((bridge) =>
        [...bridge.txns].sort((a, b) => b.amountKwd - a.amountKwd).map((t) => t.id),
      ),
    ).slice(0, 30),
  });
}

interface BankMonthProfile {
  bank: string;
  monthValues: Map<string, number>;
  medianMonthly: number;
  txnsByMonth: Map<string, Txn[]>;
}

function findBurstSynchronization(
  txns: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const byBank = groupBy(txns, (t) => t.bank);
  const profiles: BankMonthProfile[] = [];
  for (const [bank, bankTxns] of byBank) {
    const txnsByMonth = groupBy(bankTxns, (t) => t.postingDate.slice(0, 7));
    if (txnsByMonth.size < 6) continue;
    const monthValues = new Map<string, number>();
    for (const [month, monthTxns] of txnsByMonth) monthValues.set(month, sum(monthTxns));
    const medianMonthly = median([...monthValues.values()]);
    if (medianMonthly <= 0) continue;
    profiles.push({ bank, monthValues, medianMonthly, txnsByMonth });
  }
  if (profiles.length < 2) {
    gated.push({
      testId: "cross_bank_burst_synchronization",
      reason: "Fewer than 2 institutions have at least 6 active months to establish burst baselines.",
    });
    return;
  }

  let comparablePairs = 0;
  let best:
    | { a: BankMonthProfile; b: BankMonthProfile; coincident: string[]; lift: number; jointMonths: number }
    | undefined;
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i]!;
      const b = profiles[j]!;
      // Only months in which BOTH banks demonstrably transacted form the comparison
      // sample space. Statement coverage cannot be inferred from first/last activity;
      // using an inclusive calendar interval would inflate the independence lift for
      // sparse or gapped accounts.
      const jointMonths = [...a.monthValues.keys()].filter((month) => b.monthValues.has(month));
      if (jointMonths.length < 6) continue;
      comparablePairs++;
      const jointSet = new Set(jointMonths);
      const burstMonths = (profile: BankMonthProfile): string[] =>
        [...profile.monthValues.entries()]
          .filter(
            ([month, value]) =>
              jointSet.has(month) && value >= 2 * profile.medianMonthly && value >= 1_000,
          )
          .map(([month]) => month);
      const burstsA = burstMonths(a);
      const burstsB = new Set(burstMonths(b));
      if (burstsA.length === 0 || burstsB.size === 0) continue;
      const coincident = burstsA.filter((month) => burstsB.has(month)).sort();
      if (coincident.length < 2) continue;
      const lift = (coincident.length * jointMonths.length) / (burstsA.length * burstsB.size);
      if (lift < 3) continue;
      if (!best || lift > best.lift) best = { a, b, coincident, lift, jointMonths: jointMonths.length };
    }
  }
  if (!best) {
    if (comparablePairs === 0) {
      gated.push({
        testId: "cross_bank_burst_synchronization",
        reason:
          "No bank pair shares at least 6 jointly active months (both institutions transacting in the same calendar month).",
      });
    }
    return;
  }
  const chosen = best;
  const evidence = chosen.coincident
    .flatMap((month) => [
      ...(chosen.a.txnsByMonth.get(month) ?? []),
      ...(chosen.b.txnsByMonth.get(month) ?? []),
    ])
    .sort((x, y) => y.amountKwd - x.amountKwd);
  findings.push({
    findingId: "TECH-XB-02",
    category: "cross_bank_pattern",
    title: "Synchronized turnover bursts across banks",
    severity: severity(
      chosen.coincident.length >= 3 && chosen.lift >= 8,
      chosen.coincident.length >= 3 || chosen.lift >= 5,
    ),
    summary: `${chosen.a.bank} and ${chosen.b.bank} burst in the same months (${chosen.coincident.join(", ")}); coincidence is ${chosen.lift.toFixed(1)}x what independent timing would produce across ${chosen.jointMonths} jointly active months.`,
    metricValue: round3(chosen.lift),
    benchmark: ">= 2 coincident burst months and >= 3x lift over independent timing within jointly active months",
    methodology:
      "A burst month is at least 2x that institution's own median monthly turnover (minimum 1,000 KWD). Only calendar months in which both institutions actually transacted form the comparison window, so coverage gaps cannot inflate the result. Observed same-month bursts are compared with the count expected if the two banks timed bursts independently.",
    caveat: joinCaveats(
      caveat,
      "Statement coverage windows differ by institution; only jointly active months are compared, and month-level timing cannot show which account moved first.",
    ),
    txnIds: unique(evidence.map((t) => t.id)).slice(0, 30),
  });
}

function channelShare(list: Txn[], total: number, channels: ReadonlySet<Channel>): number {
  if (total <= 0) return 0;
  return list.filter((t) => channels.has(t.channel)).reduce((s, t) => s + t.amountKwd, 0) / total;
}

function findRoleSpecialization(
  txns: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const byBank = groupBy(txns, (t) => t.bank);
  const archetypes: Array<{ bank: string; role: string; value: number; evidence: Txn[] }> = [];
  let profiledBanks = 0;
  for (const [bank, bankTxns] of byBank) {
    const inflow = bankTxns.filter((t) => t.direction === "credit");
    const outflow = bankTxns.filter((t) => t.direction === "debit");
    if (inflow.length < 3 || outflow.length < 3) continue;
    const inValue = sum(inflow);
    const outValue = sum(outflow);
    if (inValue < 1_000 || outValue < 1_000) continue;
    profiledBanks++;
    const cashIn = channelShare(inflow, inValue, CASH_IN);
    const transferIn = channelShare(inflow, inValue, XFER_IN);
    const cashOut = channelShare(outflow, outValue, CASH_OUT);
    const transferOut = channelShare(outflow, outValue, XFER_OUT);
    if (cashIn >= 0.6 && transferOut >= 0.6) {
      archetypes.push({
        bank,
        role: "placement entry (cash in, transfers out)",
        value: inValue + outValue,
        evidence: [
          ...inflow.filter((t) => CASH_IN.has(t.channel)),
          ...outflow.filter((t) => XFER_OUT.has(t.channel)),
        ],
      });
    } else if (transferIn >= 0.6 && cashOut >= 0.6) {
      archetypes.push({
        bank,
        role: "extraction endpoint (transfers in, cash out)",
        value: inValue + outValue,
        evidence: [
          ...inflow.filter((t) => XFER_IN.has(t.channel)),
          ...outflow.filter((t) => CASH_OUT.has(t.channel)),
        ],
      });
    }
  }
  if (profiledBanks < 2) {
    gated.push({
      testId: "cross_bank_role_specialization",
      reason: "Fewer than 2 institutions have enough two-sided activity to profile a functional role.",
    });
    return;
  }
  if (archetypes.length === 0) return;
  const totalValue = archetypes.reduce((s, a) => s + a.value, 0);
  const distinctRoles = new Set(archetypes.map((a) => a.role)).size;
  findings.push({
    findingId: "TECH-XB-03",
    category: "cross_bank_pattern",
    title: "Functional role specialization across banks",
    severity: severity(distinctRoles >= 2 && totalValue >= 30_000, distinctRoles >= 2 || totalValue >= 15_000),
    summary: `${archetypes.length} bank${archetypes.length === 1 ? " operates" : "s operate"} as dedicated pipeline stages: ${archetypes.map((a) => `${a.bank} as ${a.role}`).join("; ")}.`,
    metricValue: archetypes.length,
    benchmark: ">= 60% of a bank's inflow value and >= 60% of its outflow value in complementary placement/extraction channels",
    methodology:
      "Each institution's value mix is profiled by direction and channel. Cash-funded transfer dispatch and transfer-funded cash extraction are the placement and extraction archetypes of a multi-institution pipeline; normal mixed-use accounts do not concentrate both sides at once.",
    caveat: joinCaveats(
      caveat,
      "Channel attribution depends on statement parsing quality, and cash-heavy personal habits can imitate an endpoint role.",
    ),
    txnIds: unique(
      archetypes
        .flatMap((a) => a.evidence)
        .sort((a, b) => b.amountKwd - a.amountKwd)
        .map((t) => t.id),
    ).slice(0, 30),
  });
}

function findAmountEchoes(
  txns: Txn[],
  findings: TechnicalFinding[],
  gated: GatedTechnicalTest[],
  caveat: string | null,
): void {
  const debits = txns
    .filter((t) => t.direction === "debit" && t.amountKwd >= 500 && MOVEMENT_DEBIT.has(t.channel))
    .sort(byDateThenId);
  const credits = txns
    .filter((t) => t.direction === "credit" && t.amountKwd >= 500 && MOVEMENT_CREDIT.has(t.channel))
    .sort(byDateThenId);
  if (debits.length === 0 || credits.length === 0) {
    gated.push({
      testId: "cross_bank_amount_echoes",
      reason: "No sizeable movement-capable debit and credit legs exist at different institutions to compare.",
    });
    return;
  }
  const used = new Set<number>();
  const echoes: Array<{ debit: Txn; credit: Txn }> = [];
  for (const debit of debits) {
    const match = credits.find((credit) => {
      if (used.has(credit.id)) return false;
      if (credit.bank === debit.bank) return false;
      const gap = dayDiff(debit.postingDate, credit.postingDate);
      if (gap < 0 || gap > 3) return false;
      return Math.abs(credit.amountKwd - debit.amountKwd) <= debit.amountKwd * 0.02;
    });
    if (match) {
      used.add(match.id);
      echoes.push({ debit, credit: match });
    }
  }
  const value = echoes.reduce((s, e) => s + Math.min(e.debit.amountKwd, e.credit.amountKwd), 0);
  if (echoes.length < 2 || value < 3_000) return;
  findings.push({
    findingId: "TECH-XB-04",
    category: "cross_bank_pattern",
    title: "Unexplained amount echoes between banks",
    severity: severity(echoes.length >= 5 || value >= 30_000, echoes.length >= 3 || value >= 10_000),
    summary: `${echoes.length} debit/credit pairs at different banks mirror each other within 2% and 3 days, totalling ${fmt(value)} KWD outside recognized own-account transfers.`,
    metricValue: echoes.length,
    benchmark: ">= 2 mirrored pairs and >= 3,000 KWD within 3 days at <= 2% amount variance",
    methodology:
      "Movement-capable debits are matched one-to-one to same-day-or-later credits at other institutions, after recognized internal transfers are excluded. Echoes are candidate covert own-account routes, such as cash withdrawn at one bank and deposited at another.",
    caveat: joinCaveats(
      caveat,
      "Statement dates cannot establish which leg of a same-day echo occurred first; echoes are correspondence evidence, not confirmed routes.",
    ),
    txnIds: echoes.slice(0, 15).flatMap((e) => [e.debit.id, e.credit.id]),
  });
}

function severity(critical: boolean, high: boolean): TechnicalSeverity {
  return critical ? "critical" : high ? "high" : "medium";
}

function severityRank(value: TechnicalSeverity): number {
  return value === "critical" ? 4 : value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function identifiableCounterparty(name: string | null): boolean {
  if (!name) return false;
  const normalized = name.trim();
  if (normalized.length < 3) return false;
  if (/^(account|instapay)\b/i.test(normalized)) return false;
  return !/^[0-9X\s.-]+$/i.test(normalized);
}

function normalizeCounterparty(name: string): string {
  return name.toUpperCase().replace(/\s+/g, " ").trim();
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = result.get(k);
    if (bucket) bucket.push(item);
    else result.set(k, [item]);
  }
  return result;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function sum(txns: Txn[]): number {
  return txns.reduce((total, txn) => total + txn.amountKwd, 0);
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function fmt(value: number): string {
  return value.toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function dayDiff(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

function monthDistance(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

function byDateThenId(a: Txn, b: Txn): number {
  return a.postingDate.localeCompare(b.postingDate) || a.id - b.id;
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

function joinCaveats(...values: Array<string | null>): string | null {
  const active = values.filter((value): value is string => Boolean(value));
  return active.length > 0 ? active.join(" ") : null;
}