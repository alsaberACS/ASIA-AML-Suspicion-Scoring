import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, analysisRunsTable, dispositionsTable } from "@workspace/db";
import {
  AnalyzeCaseParams,
  CreateDispositionBody,
  CreateDispositionParams,
  GetAnalysisRunParams,
  GetLatestAnalysisParams,
} from "@workspace/api-zod";
import { runAnalysis } from "../aml/pipeline";
import { dispositionToApi, runToApi } from "../aml/serialize";
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
      })
      .onConflictDoUpdate({
        target: dispositionsTable.runId,
        set: {
          decision: body.decision,
          analystName: body.analystName ?? null,
          notes: body.notes ?? null,
        },
      })
      .returning();
    res.status(201).json(dispositionToApi(row!));
  }),
);

export default router;
