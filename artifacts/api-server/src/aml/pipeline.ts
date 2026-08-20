import {
  db,
  analysisRunsTable,
  bankFilesTable,
  casesTable,
  transactionsTable,
  type AnalysisRunRow,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { aiAvailable, runAiLayers } from "./ai";
import { computeFeatures } from "./features";
import { findInternalPairs } from "./netting";
import { evaluateRules } from "./rules";
import { aggregate } from "./scoring";
import { BAND_SCALE, type BankBreakdown, type SubjectProfile, type Txn } from "./types";

/**
 * Deterministic analysis pipeline orchestrator:
 * consolidation -> netting -> features -> rules (M1) -> Bayesian score (M2),
 * persisted as an analysis run; the async LLM analyst layers (P3/P5/P4) are
 * kicked off afterwards and update the run as they complete.
 */
export async function runAnalysis(caseId: number): Promise<AnalysisRunRow> {
  const log = logger.child({ caseId, layer: "pipeline" });
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (!caseRow) throw Object.assign(new Error("case not found"), { statusCode: 404 });

  const txnRows = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.caseId, caseId));
  if (txnRows.length === 0)
    throw Object.assign(new Error("no transactions ingested for this case"), { statusCode: 422 });
  const fileRows = await db
    .select()
    .from(bankFilesTable)
    .where(eq(bankFilesTable.caseId, caseId));

  await db.update(casesTable).set({ status: "analyzing" }).where(eq(casesTable.id, caseId));

  const txns: Txn[] = txnRows.map((r) => ({
    id: r.id,
    fileId: r.fileId,
    bank: r.bank,
    accountId: r.accountId,
    postingDate: r.postingDate,
    direction: r.direction as Txn["direction"],
    amountKwd: r.amountKwd,
    currency: r.currency,
    channel: r.channel as Txn["channel"],
    counterpartyName: r.counterpartyName,
    counterpartyBank: r.counterpartyBank,
    counterpartyCountry: r.counterpartyCountry,
    narrative: r.narrative,
    runningBalance: r.runningBalance,
    isInternalTransfer: false,
    internalPairId: null,
  }));

  const profile: SubjectProfile = {
    subjectName: caseRow.subjectName,
    declaredOccupation: caseRow.declaredOccupation,
    declaredMonthlyIncomeKwd: caseRow.declaredMonthlyIncomeKwd,
    declaredBusinessActivity: caseRow.declaredBusinessActivity,
    expectedCountries: caseRow.expectedCountries ?? [],
    notes: caseRow.notes,
  };

  // 1. Cross-bank netting.
  const pairs = findInternalPairs(txns, caseRow.subjectName);
  const internalIds = new Map<number, number>();
  for (const p of pairs) {
    internalIds.set(p.debitTxnId, p.id);
    internalIds.set(p.creditTxnId, p.id);
  }
  for (const t of txns) {
    const pid = internalIds.get(t.id);
    if (pid != null) {
      t.isInternalTransfer = true;
      t.internalPairId = pid;
    }
  }
  log.info({ pairs: pairs.length }, "netting complete");

  // 2. Case-level data quality (transaction-weighted across files).
  let dqWeighted = 0;
  let dqWeight = 0;
  const dqIssues: string[] = [];
  for (const f of fileRows) {
    const w = Math.max(1, f.rowsParsed);
    dqWeighted += f.dataQuality * w;
    dqWeight += w;
    for (const issue of f.qualityIssues ?? []) dqIssues.push(`${f.bankLabel}: ${issue}`);
  }
  const dataQuality = dqWeight > 0 ? dqWeighted / dqWeight : 1;
  if (dataQuality < 0.7)
    dqIssues.push(
      `Consolidated data quality ${dataQuality.toFixed(2)} is below the 0.70 gate - evidence contributions are shrunk toward the prior and any alert carries a reliability caveat.`,
    );

  // 3-5. Features, rules, Bayesian aggregation.
  const bundle = computeFeatures(txns, pairs, profile);
  const hits = evaluateRules(bundle, txns, profile);
  const score = aggregate(hits, bundle.features, dataQuality);
  log.info(
    { probability: score.probability, band: score.band, fired: hits.filter((h) => h.fired).length },
    "deterministic scoring complete",
  );

  // Bank breakdowns.
  const byBank = new Map<string, Txn[]>();
  for (const t of txns) {
    const arr = byBank.get(t.bank);
    if (arr) arr.push(t);
    else byBank.set(t.bank, [t]);
  }
  const banks: BankBreakdown[] = [...byBank.entries()].map(([bank, ts]) => {
    const dates = ts.map((t) => t.postingDate).sort();
    return {
      bank,
      txnCount: ts.length,
      creditsKwd: r2(ts.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amountKwd, 0)),
      debitsKwd: r2(ts.filter((t) => t.direction === "debit").reduce((s, t) => s + t.amountKwd, 0)),
      periodStart: dates[0] ?? null,
      periodEnd: dates[dates.length - 1] ?? null,
      accountIds: [...new Set(ts.map((t) => t.accountId))],
    };
  });
  const allDates = txns.map((t) => t.postingDate).sort();
  const totalCredits = txns.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amountKwd, 0);
  const totalDebits = txns.filter((t) => t.direction === "debit").reduce((s, t) => s + t.amountKwd, 0);
  const internalValue = pairs.reduce((s, p) => s + p.amountKwd, 0);

  const [run] = await db
    .insert(analysisRunsTable)
    .values({
      caseId,
      status: "complete",
      aiStatus: aiAvailable() ? "pending" : "skipped",
      aiError: aiAvailable() ? null : "AI integration not configured",
      probability: score.probability,
      priorProbability: score.priorProbability,
      posteriorLogOdds: score.posteriorLogOdds,
      band: score.band,
      dataQualityScore: r3(dataQuality),
      dataQualityIssues: dqIssues,
      txnCount: txns.length,
      totalCreditsKwd: r2(totalCredits),
      totalDebitsKwd: r2(totalDebits),
      internalTransferCount: pairs.length,
      internalValueKwd: r2(internalValue),
      periodStart: allDates[0] ?? null,
      periodEnd: allDates[allDates.length - 1] ?? null,
      banks: banks as unknown[],
      features: bundle.features as unknown[],
      ruleHits: hits as unknown[],
      drivers: score.drivers as unknown[],
      internalTransfers: pairs as unknown[],
      bandScale: BAND_SCALE as unknown as unknown[],
    })
    .returning();
  if (!run) throw new Error("failed to insert analysis run");

  // 6. Write netting + rule citations back onto transactions.
  const flagMap = new Map<number, string[]>();
  for (const h of hits) {
    if (!h.fired) continue;
    for (const id of h.txnIds) {
      const arr = flagMap.get(id);
      if (arr) arr.push(h.ruleId);
      else flagMap.set(id, [h.ruleId]);
    }
  }
  await db
    .update(transactionsTable)
    .set({ isInternalTransfer: false, internalPairId: null, flags: [] })
    .where(eq(transactionsTable.caseId, caseId));
  const pairedIds = [...internalIds.keys()];
  if (pairedIds.length > 0) {
    for (const p of pairs) {
      await db
        .update(transactionsTable)
        .set({ isInternalTransfer: true, internalPairId: p.id })
        .where(inArray(transactionsTable.id, [p.debitTxnId, p.creditTxnId]));
    }
  }
  const flagEntries = [...flagMap.entries()];
  for (let i = 0; i < flagEntries.length; i += 25) {
    await Promise.all(
      flagEntries
        .slice(i, i + 25)
        .map(([id, flags]) =>
          db
            .update(transactionsTable)
            .set({ flags: [...new Set(flags)] })
            .where(eq(transactionsTable.id, id)),
        ),
    );
  }

  await db.update(casesTable).set({ status: "scored" }).where(eq(casesTable.id, caseId));

  // 7. Async LLM analyst layers.
  if (run.aiStatus === "pending") {
    setImmediate(() => {
      runAiLayers(run.id).catch((err) => log.error({ err }, "AI layer crash"));
    });
  }
  return run;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
