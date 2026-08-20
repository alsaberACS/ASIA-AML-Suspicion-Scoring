import type { NextFunction, Request, Response } from "express";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  analysisRunsTable,
  bankFilesTable,
  dispositionsTable,
  transactionsTable,
  type AnalysisRunRow,
  type CaseRow,
  type DispositionRow,
} from "@workspace/db";
import { caseToApi, runSummary, type CaseStats } from "../aml/serialize";

/** Async handler wrapper so rejections reach the error middleware (Express 5). */
export const h =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** Assembles computed Case stats (fileCount/txnCount/bankCount/latestRun) in bulk. */
export async function withStats(cases: CaseRow[]) {
  if (cases.length === 0) return [];
  const ids = cases.map((c) => c.id);
  const [fileCounts, txnCounts, runs] = await Promise.all([
    db
      .select({ caseId: bankFilesTable.caseId, n: sql<number>`count(*)::int` })
      .from(bankFilesTable)
      .where(inArray(bankFilesTable.caseId, ids))
      .groupBy(bankFilesTable.caseId),
    db
      .select({
        caseId: transactionsTable.caseId,
        n: sql<number>`count(*)::int`,
        banks: sql<number>`count(distinct ${transactionsTable.bank})::int`,
      })
      .from(transactionsTable)
      .where(inArray(transactionsTable.caseId, ids))
      .groupBy(transactionsTable.caseId),
    db
      .select()
      .from(analysisRunsTable)
      .where(inArray(analysisRunsTable.caseId, ids)),
  ]);
  const latestByCase = new Map<number, AnalysisRunRow>();
  for (const r of runs) {
    const cur = latestByCase.get(r.caseId);
    if (!cur || r.createdAt > cur.createdAt) latestByCase.set(r.caseId, r);
  }
  const runIds = [...latestByCase.values()].map((r) => r.id);
  const dispositions: DispositionRow[] =
    runIds.length > 0
      ? await db.select().from(dispositionsTable).where(inArray(dispositionsTable.runId, runIds))
      : [];
  const dispByRun = new Map(dispositions.map((d) => [d.runId, d]));
  const fileByCase = new Map(fileCounts.map((f) => [f.caseId, f.n]));
  const txnByCase = new Map(txnCounts.map((t) => [t.caseId, t]));

  return cases.map((c) => {
    const run = latestByCase.get(c.id) ?? null;
    const stats: CaseStats = {
      fileCount: fileByCase.get(c.id) ?? 0,
      txnCount: txnByCase.get(c.id)?.n ?? 0,
      bankCount: txnByCase.get(c.id)?.banks ?? 0,
      latestRun: run ? runSummary(run, c.subjectName, dispByRun.get(run.id) ?? null) : null,
    };
    return caseToApi(c, stats);
  });
}
