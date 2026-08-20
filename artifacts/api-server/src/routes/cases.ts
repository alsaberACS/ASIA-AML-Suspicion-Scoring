import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, casesTable } from "@workspace/db";
import { CreateCaseBody, GetCaseParams, UpdateCaseBody, UpdateCaseParams, DeleteCaseParams } from "@workspace/api-zod";
import { h, withStats } from "./util";

const router: IRouter = Router();

router.get(
  "/cases",
  h(async (_req, res) => {
    const rows = await db.select().from(casesTable).orderBy(desc(casesTable.createdAt));
    res.json(await withStats(rows));
  }),
);

router.post(
  "/cases",
  h(async (req, res) => {
    const body = CreateCaseBody.parse(req.body);
    const [row] = await db
      .insert(casesTable)
      .values({
        subjectName: body.subjectName,
        subjectReference: body.subjectReference ?? null,
        declaredOccupation: body.declaredOccupation ?? null,
        declaredMonthlyIncomeKwd: body.declaredMonthlyIncomeKwd ?? null,
        declaredBusinessActivity: body.declaredBusinessActivity ?? null,
        expectedCountries: body.expectedCountries ?? [],
        notes: body.notes ?? null,
      })
      .returning();
    const [api] = await withStats([row!]);
    res.status(201).json(api);
  }),
);

router.get(
  "/cases/:caseId",
  h(async (req, res) => {
    const { caseId } = GetCaseParams.parse(req.params);
    const rows = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
    if (rows.length === 0) {
      res.status(404).json({ error: "case not found" });
      return;
    }
    const [api] = await withStats(rows);
    res.json(api);
  }),
);

router.patch(
  "/cases/:caseId",
  h(async (req, res) => {
    const { caseId } = UpdateCaseParams.parse(req.params);
    const body = UpdateCaseBody.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.subjectName !== undefined) patch.subjectName = body.subjectName;
    if (body.subjectReference !== undefined) patch.subjectReference = body.subjectReference;
    if (body.declaredOccupation !== undefined) patch.declaredOccupation = body.declaredOccupation;
    if (body.declaredMonthlyIncomeKwd !== undefined)
      patch.declaredMonthlyIncomeKwd = body.declaredMonthlyIncomeKwd;
    if (body.declaredBusinessActivity !== undefined)
      patch.declaredBusinessActivity = body.declaredBusinessActivity;
    if (body.expectedCountries !== undefined) patch.expectedCountries = body.expectedCountries;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (Object.keys(patch).length === 0) {
      const rows = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
      if (rows.length === 0) {
        res.status(404).json({ error: "case not found" });
        return;
      }
      const [api] = await withStats(rows);
      res.json(api);
      return;
    }
    const rows = await db.update(casesTable).set(patch).where(eq(casesTable.id, caseId)).returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "case not found" });
      return;
    }
    const [api] = await withStats(rows);
    res.json(api);
  }),
);

router.delete(
  "/cases/:caseId",
  h(async (req, res) => {
    const { caseId } = DeleteCaseParams.parse(req.params);
    const rows = await db.delete(casesTable).where(eq(casesTable.id, caseId)).returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "case not found" });
      return;
    }
    res.status(204).end();
  }),
);

export default router;
