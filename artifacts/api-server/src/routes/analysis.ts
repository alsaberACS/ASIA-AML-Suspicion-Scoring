import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, analysisRunsTable, casesTable, dispositionsTable, transactionsTable } from "@workspace/db";
import {
  AnalyzeCaseParams,
  CreateDispositionBody,
  CreateDispositionParams,
  DownloadAnalysisReportParams,
  GetAnalysisRunParams,
  GetLatestAnalysisParams,
  ListAnalysisRunsParams,
  RetryAiAnalysisParams,
} from "@workspace/api-zod";
import { runAnalysis } from "../aml/pipeline";
import { aiRunActive, runAiLayers } from "../aml/ai";
import { dispositionToApi, runToApi } from "../aml/serialize";
import { renderAnalysisReport } from "../aml/report";
import { h } from "./util";

const router: IRouter = Router();

router.post(
  "/cases/:caseId/analyze",
  h(async (req, res) => {
    const { caseId } = AnalyzeCaseParams.parse(req.params);
    const run = await runAnalysis(caseId);
    res.status(201).json(runToApi(run, null));
  }),
);

router.get(
  "/cases/:caseId/analysis",
  h(async (req, res) => {
    const { caseId } = GetLatestAnalysisParams.parse(req.params);
    const runs = await db
      .select()
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.caseId, caseId))
      .orderBy(desc(analysisRunsTable.createdAt), desc(analysisRunsTable.id))
      .limit(1);
    if (runs.length === 0) {
      res.status(404).json({ error: "no analysis run for this case yet" });
      return;
    }
    const run = runs[0]!;
    const disp = await db
      .select()
      .from(dispositionsTable)
      .where(eq(dispositionsTable.runId, run.id));
    res.json(runToApi(run, disp[0] ?? null));
  }),
);

router.get(
  "/cases/:caseId/analysis-runs",
  h(async (req, res) => {
    const { caseId } = ListAnalysisRunsParams.parse(req.params);
    const rows = await db
      .select({
        id: analysisRunsTable.id,
        caseId: analysisRunsTable.caseId,
        createdAt: analysisRunsTable.createdAt,
        probability: analysisRunsTable.probability,
        band: analysisRunsTable.band,
        aiStatus: analysisRunsTable.aiStatus,
        dataQualityScore: analysisRunsTable.dataQualityScore,
        txnCount: analysisRunsTable.txnCount,
        ruleHits: analysisRunsTable.ruleHits,
      })
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.caseId, caseId))
      .orderBy(desc(analysisRunsTable.createdAt), desc(analysisRunsTable.id));
    res.json(
      rows.map((r) => ({
        id: r.id,
        caseId: r.caseId,
        createdAt: r.createdAt.toISOString(),
        probability: r.probability,
        band: r.band,
        aiStatus: r.aiStatus,
        dataQualityScore: r.dataQualityScore,
        txnCount: r.txnCount,
        rulesFired: Array.isArray(r.ruleHits)
          ? r.ruleHits.filter((h) => (h as { fired?: boolean }).fired === true).length
          : 0,
      })),
    );
  }),
);

router.get(
  "/analysis-runs/:runId",
  h(async (req, res) => {
    const { runId } = GetAnalysisRunParams.parse(req.params);
    const runs = await db
      .select()
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.id, runId));
    if (runs.length === 0) {
      res.status(404).json({ error: "analysis run not found" });
      return;
    }
    const disp = await db
      .select()
      .from(dispositionsTable)
      .where(eq(dispositionsTable.runId, runId));
    res.json(runToApi(runs[0]!, disp[0] ?? null));
  }),
);

router.post(
  "/analysis-runs/:runId/disposition",
  h(async (req, res) => {
    const { runId } = CreateDispositionParams.parse(req.params);
    const body = CreateDispositionBody.parse(req.body);
    const runs = await db
      .select({ id: analysisRunsTable.id })
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.id, runId));
    if (runs.length === 0) {
      res.status(404).json({ error: "analysis run not found" });
      return;
    }
    const [row] = await db
      .insert(dispositionsTable)
      .values({
        runId,
        decision: body.decision,
        analystName: body.analystName ?? null,
        notes: body.notes ?? null,
        hypothesisReviews: body.hypothesisReviews ?? null,
      })
      .onConflictDoUpdate({
        target: dispositionsTable.runId,
        set: {
          decision: body.decision,
          analystName: body.analystName ?? null,
          notes: body.notes ?? null,
          hypothesisReviews: body.hypothesisReviews ?? null,
        },
      })
      .returning();
    res.status(201).json(dispositionToApi(row!));
  }),
);

router.get(
  "/analysis-runs/:runId/report.pdf",
  h(async (req, res) => {
    const { runId } = DownloadAnalysisReportParams.parse(req.params);
    const runs = await db
      .select()
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.id, runId));
    if (runs.length === 0) {
      res.status(404).json({ error: "analysis run not found" });
      return;
    }
    const run = runs[0]!;
    const disp = await db
      .select()
      .from(dispositionsTable)
      .where(eq(dispositionsTable.runId, runId));
    const caseRows = await db
      .select()
      .from(casesTable)
      .where(eq(casesTable.id, run.caseId));
    const caseRow = caseRows[0];
    // Monthly flow aggregation for the report's behavioural timeline figure,
    // done in SQL so large cases never stream full rows into the server.
    const monthExpr = sql<string>`to_char(${transactionsTable.postingDate}, 'YYYY-MM')`;
    const flowRows = await db
      .select({
        month: monthExpr,
        creditsKwd: sql<number>`coalesce(sum(case when ${transactionsTable.direction} = 'credit' then ${transactionsTable.amountKwd} else 0 end), 0)::float`,
        debitsKwd: sql<number>`coalesce(sum(case when ${transactionsTable.direction} = 'debit' then ${transactionsTable.amountKwd} else 0 end), 0)::float`,
        cashInKwd: sql<number>`coalesce(sum(case when ${transactionsTable.direction} = 'credit' and ${transactionsTable.channel} = 'cash_deposit' then ${transactionsTable.amountKwd} else 0 end), 0)::float`,
        cashOutKwd: sql<number>`coalesce(sum(case when ${transactionsTable.direction} = 'debit' and ${transactionsTable.channel} = 'cash_withdrawal' then ${transactionsTable.amountKwd} else 0 end), 0)::float`,
        txnCount: sql<number>`count(*)::int`,
      })
      .from(transactionsTable)
      .where(eq(transactionsTable.caseId, run.caseId))
      .groupBy(monthExpr)
      .orderBy(monthExpr);
    // Truthfulness guard: every other number in the report is this run's
    // frozen snapshot. The timeline may only be drawn from the live ledger if
    // that ledger is still exactly the one this run analyzed; if statements
    // were added or re-ingested since, omit the timeline section rather than
    // print figures that contradict the snapshot.
    const ledgerTxnCount = flowRows.reduce((s, r) => s + r.txnCount, 0);
    const monthlyFlows = ledgerTxnCount === run.txnCount ? flowRows : [];
    const pdf = await renderAnalysisReport(
      runToApi(run, disp[0] ?? null),
      caseRow
        ? {
            id: caseRow.id,
            subjectName: caseRow.subjectName,
            subjectReference: caseRow.subjectReference,
            declaredOccupation: caseRow.declaredOccupation,
            declaredMonthlyIncomeKwd:
              caseRow.declaredMonthlyIncomeKwd === null
                ? null
                : Number(caseRow.declaredMonthlyIncomeKwd),
            declaredBusinessActivity: caseRow.declaredBusinessActivity,
          }
        : null,
      monthlyFlows,
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ASIA-AML-Report-Case' + run.caseId + "-Run" + run.id + '.pdf"',
    );
    res.send(pdf);
  }),
);

router.post(
  "/analysis-runs/:runId/retry-ai",
  h(async (req, res) => {
    const { runId } = RetryAiAnalysisParams.parse(req.params);
    const runs = await db
      .select()
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.id, runId));
    if (runs.length === 0) {
      res.status(404).json({ error: "analysis run not found" });
      return;
    }
    const run = runs[0]!;
    if (run.aiStatus === "complete") {
      res.status(409).json({ error: "AI analysis is already complete for this run" });
      return;
    }
    if (aiRunActive(runId)) {
      res.status(409).json({ error: "AI analysis is currently in progress for this run" });
      return;
    }
    await db
      .update(analysisRunsTable)
      .set({ aiStatus: "pending", aiError: null })
      .where(eq(analysisRunsTable.id, runId));
    setImmediate(() => {
      void runAiLayers(runId);
    });
    const [fresh] = await db
      .select()
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.id, runId));
    const disp = await db
      .select()
      .from(dispositionsTable)
      .where(eq(dispositionsTable.runId, runId));
    res.status(202).json(runToApi(fresh!, disp[0] ?? null));
  }),
);

export default router;
