import { Router, type IRouter } from "express";
import { desc, inArray, sql } from "drizzle-orm";
import {
  db,
  analysisRunsTable,
  bankFilesTable,
  casesTable,
  dispositionsTable,
  transactionsTable,
} from "@workspace/db";
import { seedDemoCase } from "../aml/demo";
import { runSummary } from "../aml/serialize";
import { h, withStats } from "./util";

const router: IRouter = Router();

const BANDS = ["Low", "Moderate", "Elevated", "High", "Critical"];

router.get(
  "/dashboard/summary",
  h(async (_req, res) => {
    const [caseCount, fileAgg, txnAgg, runs] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(casesTable),
      db
        .select({ n: sql<number>`count(*)::int`, dq: sql<number | null>`avg(${bankFilesTable.dataQuality})` })
        .from(bankFilesTable),
      db
        .select({ n: sql<number>`count(*)::int`, v: sql<number | null>`sum(${transactionsTable.amountKwd})` })
        .from(transactionsTable),
      db.select().from(analysisRunsTable).orderBy(desc(analysisRunsTable.createdAt), desc(analysisRunsTable.id)),
    ]);

    const latestByCase = new Map<number, (typeof runs)[number]>();
    for (const r of runs) if (!latestByCase.has(r.caseId)) latestByCase.set(r.caseId, r);
    const bandCounts = BANDS.map((band) => ({
      band,
      count: [...latestByCase.values()].filter((r) => r.band === band).length,
    }));

    const recent = runs.slice(0, 8);
    const caseIds = [...new Set(recent.map((r) => r.caseId))];
    const caseRows = caseIds.length
      ? await db.select().from(casesTable).where(inArray(casesTable.id, caseIds))
      : [];
    const nameByCase = new Map(caseRows.map((c) => [c.id, c.subjectName]));
    const runIds = recent.map((r) => r.id);
    const disps = runIds.length
      ? await db.select().from(dispositionsTable).where(inArray(dispositionsTable.runId, runIds))
      : [];
    const dispByRun = new Map(disps.map((d) => [d.runId, d]));

    res.json({
      totalCases: caseCount[0]?.n ?? 0,
      totalFiles: fileAgg[0]?.n ?? 0,
      totalTransactions: txnAgg[0]?.n ?? 0,
      totalValueKwd: Math.round((txnAgg[0]?.v ?? 0) * 100) / 100,
      avgDataQuality:
        fileAgg[0]?.dq == null ? null : Math.round(Number(fileAgg[0].dq) * 1000) / 1000,
      bandCounts,
      recentRuns: recent.map((r) =>
        runSummary(r, nameByCase.get(r.caseId) ?? `Case ${r.caseId}`, dispByRun.get(r.id) ?? null),
      ),
    });
  }),
);

router.post(
  "/demo/seed",
  h(async (req, res) => {
    req.log.info("demo seed requested");
    const { caseRow } = await seedDemoCase();
    const [api] = await withStats([caseRow]);
    res.json(api);
  }),
);

export default router;
