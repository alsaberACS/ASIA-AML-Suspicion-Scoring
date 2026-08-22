/**
 * Case-level data quality assessment.
 *
 * Deterministic cross-file checks computed at analysis time and persisted on
 * the run, so the evidence pack can show WHY the quality score is what it is
 * and whether the inputs can be trusted:
 *
 *  - parse coverage        rows parsed vs skipped, per file
 *  - balance integrity     parser running-balance reconciliation results
 *  - statement overlap     same account covered by two files in the same window
 *  - cross-file duplicates same transaction ingested from two different files
 *  - coverage gaps         long silent stretches inside an account's span
 *  - FX normalization      share of activity converted into KWD
 *
 * Everything here is derived from already-persisted parser metadata and the
 * transaction table; no model calls, no heuristics that cannot be explained
 * to a regulator in one sentence.
 */

export interface DqTxnInput {
  id: number;
  fileId: number;
  accountId: string;
  postingDate: string;
  direction: "credit" | "debit";
  amountKwd: number;
  currency: string;
  narrative: string | null;
  runningBalance: number | null;
}

export interface DqFileInput {
  id: number;
  filename: string;
  bankLabel: string;
  rowsParsed: number;
  rowsSkipped: number;
  dataQuality: number;
  qualityIssues: string[] | null;
  accountIds: string[] | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface DataQualityCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  items: string[];
  txnIds: number[];
}

export interface DataQualityFileSummary {
  bankLabel: string;
  filename: string;
  rowsParsed: number;
  rowsSkipped: number;
  dataQuality: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface DataQualityReport {
  generatedAt: string;
  score: number;
  filesAssessed: number;
  txnsAssessed: number;
  checks: DataQualityCheck[];
  files: DataQualityFileSummary[];
}

const MAX_ITEMS = 8;
const MAX_TXN_IDS = 12;
const GAP_DAYS = 45;
const MIN_SPAN_FOR_GAP_CHECK = 60;

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function parseCoverage(files: DqFileInput[]): DataQualityCheck {
  const parsed = files.reduce((s, f) => s + f.rowsParsed, 0);
  const skipped = files.reduce((s, f) => s + f.rowsSkipped, 0);
  const total = parsed + skipped;
  const rate = total > 0 ? parsed / total : 1;
  return {
    id: "parse_coverage",
    label: "Statement parse coverage",
    status: rate >= 0.98 ? "pass" : rate >= 0.9 ? "warn" : "fail",
    summary: `${parsed} of ${total} statement rows parsed (${(rate * 100).toFixed(1)}%)`,
    items: files
      .filter((f) => f.rowsSkipped > 0)
      .map((f) => `${f.bankLabel}: ${f.rowsSkipped} rows skipped (${f.filename})`)
      .slice(0, MAX_ITEMS),
    txnIds: [],
  };
}

function balanceIntegrity(files: DqFileInput[]): DataQualityCheck {
  const items: string[] = [];
  let status: DataQualityCheck["status"] = "pass";
  for (const f of files) {
    for (const issue of f.qualityIssues ?? []) {
      if (!/balance/i.test(issue)) continue;
      items.push(`${f.bankLabel}: ${issue}`);
      const severe = /break/i.test(issue) && f.dataQuality < 0.7;
      if (severe) status = "fail";
      else if (status !== "fail") status = "warn";
    }
  }
  return {
    id: "balance_integrity",
    label: "Running-balance integrity",
    status,
    summary:
      status === "pass"
        ? "Running balances reconcile in every statement that provides them"
        : status === "warn"
          ? "Some statements could not be fully balance-checked"
          : "Balance breaks undermine statement integrity in at least one file",
    items: items.slice(0, MAX_ITEMS),
    txnIds: [],
  };
}

function statementOverlap(files: DqFileInput[]): DataQualityCheck {
  const items: string[] = [];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i];
      const b = files[j];
      if (!a.periodStart || !a.periodEnd || !b.periodStart || !b.periodEnd) continue;
      const shared = (a.accountIds ?? []).filter((acct) => (b.accountIds ?? []).includes(acct));
      if (shared.length === 0) continue;
      const overlapStart = a.periodStart > b.periodStart ? a.periodStart : b.periodStart;
      const overlapEnd = a.periodEnd < b.periodEnd ? a.periodEnd : b.periodEnd;
      if (overlapStart > overlapEnd) continue;
      const days = dayDiff(overlapStart, overlapEnd);
      if (days <= 1) continue; // boundary-day handover between consecutive statements
      for (const acct of shared) {
        items.push(
          `${acct}: ${a.bankLabel} (${a.periodStart} to ${a.periodEnd}) overlaps ${b.bankLabel} (${b.periodStart} to ${b.periodEnd}) by ${days} days`,
        );
      }
    }
  }
  return {
    id: "statement_overlap",
    label: "Statement period overlap",
    status: items.length > 0 ? "warn" : "pass",
    summary:
      items.length > 0
        ? `${items.length} account/file pair(s) cover overlapping periods - check for double ingestion`
        : "No two files cover the same account over the same period",
    items: items.slice(0, MAX_ITEMS),
    txnIds: [],
  };
}

function crossFileDuplicates(txns: DqTxnInput[]): DataQualityCheck {
  const groups = new Map<string, DqTxnInput[]>();
  for (const t of txns) {
    const narrative = (t.narrative ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    let discriminator: string;
    if (narrative.length >= 6) discriminator = `n:${narrative.slice(0, 80)}`;
    else if (t.runningBalance != null) discriminator = `rb:${t.runningBalance.toFixed(3)}`;
    else continue; // too weak a signature to call two rows the same
    const key = `${t.accountId}|${t.postingDate}|${t.direction}|${t.amountKwd.toFixed(3)}|${discriminator}`;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }
  const dupGroups = [...groups.values()].filter(
    (g) => g.length > 1 && new Set(g.map((t) => t.fileId)).size > 1,
  );
  const items = dupGroups
    .slice(0, MAX_ITEMS)
    .map((g) => {
      const t = g[0];
      return `${t.accountId} ${t.postingDate} ${t.direction} ${t.amountKwd.toFixed(3)} KWD - appears in ${new Set(g.map((x) => x.fileId)).size} files (${g.length} rows)`;
    });
  const txnIds = dupGroups.flatMap((g) => g.map((t) => t.id)).slice(0, MAX_TXN_IDS);
  return {
    id: "cross_file_duplicates",
    label: "Cross-file duplicate transactions",
    status: dupGroups.length > 0 ? "fail" : "pass",
    summary:
      dupGroups.length > 0
        ? `${dupGroups.length} transaction group(s) appear in more than one uploaded file - totals and velocity features are inflated`
        : "No transaction appears in more than one uploaded file",
    items,
    txnIds,
  };
}

function coverageGaps(txns: DqTxnInput[]): DataQualityCheck {
  const byAccount = new Map<string, string[]>();
  for (const t of txns) {
    const arr = byAccount.get(t.accountId);
    if (arr) arr.push(t.postingDate);
    else byAccount.set(t.accountId, [t.postingDate]);
  }
  const items: string[] = [];
  for (const [acct, dates] of byAccount) {
    const sorted = [...new Set(dates)].sort();
    if (sorted.length < 2) continue;
    const span = dayDiff(sorted[0], sorted[sorted.length - 1]);
    if (span < MIN_SPAN_FOR_GAP_CHECK) continue;
    for (let i = 1; i < sorted.length; i++) {
      const gap = dayDiff(sorted[i - 1], sorted[i]);
      if (gap > GAP_DAYS) items.push(`${acct}: no activity ${sorted[i - 1]} to ${sorted[i]} (${gap} days)`);
    }
  }
  return {
    id: "coverage_gaps",
    label: "Account coverage gaps",
    status: items.length > 0 ? "warn" : "pass",
    summary:
      items.length > 0
        ? `${items.length} silent stretch(es) longer than ${GAP_DAYS} days - statements may be missing, velocity features may be distorted`
        : "No unexplained gaps inside any account's covered period",
    items: items.slice(0, MAX_ITEMS),
    txnIds: [],
  };
}

function fxNormalization(txns: DqTxnInput[]): DataQualityCheck {
  const byCurrency = new Map<string, number>();
  for (const t of txns) {
    const cur = (t.currency || "KWD").toUpperCase();
    if (cur === "KWD") continue;
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + 1);
  }
  const fxCount = [...byCurrency.values()].reduce((s, n) => s + n, 0);
  const share = txns.length > 0 ? fxCount / txns.length : 0;
  return {
    id: "fx_normalization",
    label: "Foreign-currency normalization",
    status: share > 0.5 ? "warn" : "pass",
    summary:
      fxCount === 0
        ? "All amounts are native KWD - no conversion assumptions in play"
        : `${fxCount} transactions (${(share * 100).toFixed(1)}%) converted to KWD - amounts depend on conversion rates`,
    items: [...byCurrency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cur, n]) => `${cur}: ${n} transactions`)
      .slice(0, MAX_ITEMS),
    txnIds: [],
  };
}

export function buildDataQualityReport(
  txns: DqTxnInput[],
  files: DqFileInput[],
  score: number,
): DataQualityReport {
  return {
    generatedAt: new Date().toISOString(),
    score,
    filesAssessed: files.length,
    txnsAssessed: txns.length,
    checks: [
      parseCoverage(files),
      balanceIntegrity(files),
      statementOverlap(files),
      crossFileDuplicates(txns),
      coverageGaps(txns),
      fxNormalization(txns),
    ],
    files: files.map((f) => ({
      bankLabel: f.bankLabel,
      filename: f.filename,
      rowsParsed: f.rowsParsed,
      rowsSkipped: f.rowsSkipped,
      dataQuality: f.dataQuality,
      periodStart: f.periodStart,
      periodEnd: f.periodEnd,
    })),
  };
}
