import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, casesTable, disclosuresTable, declarantsTable } from "@workspace/db";
import {
  ConfirmDeclarationIntakeBody,
  ConfirmDeclarationIntakeParams,
  DiscardDeclarationIntakeParams,
  GetCaseDeclarationParams,
  GetDeclarationIntakeParams,
  StartDeclarationIntakeBody,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import {
  coerceDisclosureExtraction,
  runDisclosureExtraction,
  sectionRowCountsMatch,
} from "../aml/disclosure";
import {
  caseProfileFromDeclaration,
  loadDeclarationRecords,
  projectDeclarationRecordsWith,
} from "../aml/declarationRecords";
import {
  declarantToApi,
  declarationIntakeToApi,
  declarationItemToApi,
} from "../aml/serialize";
import { logger } from "../lib/logger";
import { h, withStats } from "./util";

/**
 * Case registration from a handwritten Nazaha financial declaration.
 *
 * Flow: upload PDF -> a pending case (status "intake") is opened with the
 * PDF attached as its disclosure and the dual-reader AI extraction starts ->
 * the investigator reviews the Arabic reading against the ink -> confirm
 * saves the reviewed reading, writes the structured declarant / item records
 * and fills the case profile from them, moving the case to "draft".
 *
 * Pending cases never appear in the case registry or dashboard counts; they
 * live only on the intake screen until confirmed or discarded.
 */

const router: IRouter = Router();

/** Shown in place of the subject's name until the reading is confirmed. */
const PENDING_SUBJECT_NAME = "إقرار ذمة مالية قيد التسجيل";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

function checkPdfUpload(body: { filename: string; contentBase64: string }):
  | { ok: true; bytes: number }
  | { ok: false; error: string } {
  // Reject oversized payloads from the base64 length alone, before
  // allocating the decoded copy (base64 packs 3 bytes into 4 chars).
  if (body.contentBase64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 + 8) {
    return { ok: false, error: "file exceeds the 20 MB limit" };
  }
  const buffer = Buffer.from(body.contentBase64, "base64");
  if (buffer.length === 0) return { ok: false, error: "uploaded file is empty" };
  if (buffer.length > MAX_PDF_BYTES) return { ok: false, error: "file exceeds the 20 MB limit" };
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return {
      ok: false,
      error: `"${body.filename}" is not a PDF. Upload the scanned declaration form as a PDF file.`,
    };
  }
  return { ok: true, bytes: buffer.length };
}

async function loadIntake(caseId: number) {
  const rows = await db
    .select({
      caseRow: { id: casesTable.id, status: casesTable.status },
      disclosure: disclosuresTable,
      declarant: {
        fullName: declarantsTable.fullName,
        civilId: declarantsTable.civilId,
        declarationType: declarantsTable.declarationType,
      },
    })
    .from(casesTable)
    .innerJoin(disclosuresTable, eq(disclosuresTable.caseId, casesTable.id))
    .leftJoin(declarantsTable, eq(declarantsTable.caseId, casesTable.id))
    .where(eq(casesTable.id, caseId));
  return rows[0] ?? null;
}

router.get(
  "/intake/declarations",
  h(async (_req, res) => {
    const rows = await db
      .select({
        caseRow: { id: casesTable.id, status: casesTable.status },
        disclosure: disclosuresTable,
        declarant: {
          fullName: declarantsTable.fullName,
          civilId: declarantsTable.civilId,
          declarationType: declarantsTable.declarationType,
        },
      })
      .from(casesTable)
      .innerJoin(disclosuresTable, eq(disclosuresTable.caseId, casesTable.id))
      .leftJoin(declarantsTable, eq(declarantsTable.caseId, casesTable.id))
      .where(eq(casesTable.status, "intake"))
      .orderBy(desc(disclosuresTable.uploadedAt), desc(casesTable.id));
    res.json(rows.map((r) => declarationIntakeToApi(r.caseRow, r.disclosure, r.declarant ?? null)));
  }),
);

router.post(
  "/intake/declarations",
  h(async (req, res) => {
    const body = StartDeclarationIntakeBody.parse(req.body);
    const check = checkPdfUpload(body);
    if (!check.ok) {
      res.status(422).json({ error: check.error });
      return;
    }
    const { caseRow, disclosure } = await db.transaction(async (tx) => {
      const [caseRow] = await tx
        .insert(casesTable)
        .values({ subjectName: PENDING_SUBJECT_NAME, status: "intake" })
        .returning();
      const [disclosure] = await tx
        .insert(disclosuresTable)
        .values({
          caseId: caseRow!.id,
          filename: body.filename,
          contentBase64: body.contentBase64,
          fileSizeBytes: check.bytes,
          status: "processing",
          phase: "reading_primary",
          error: null,
          extraction: null,
          uploadedAt: new Date(),
          extractedAt: null,
          correctedAt: null,
          runToken: randomUUID(),
        })
        .returning();
      return { caseRow: caseRow!, disclosure: disclosure! };
    });
    void runDisclosureExtraction(disclosure.id).catch((err) =>
      logger.error({ err, disclosureId: disclosure.id }, "background extraction launch failed"),
    );
    res.status(201).json(declarationIntakeToApi(caseRow, disclosure, null));
  }),
);

router.get(
  "/intake/declarations/:caseId",
  h(async (req, res) => {
    const { caseId } = GetDeclarationIntakeParams.parse(req.params);
    const row = await loadIntake(caseId);
    if (!row) {
      res.status(404).json({ error: "intake not found" });
      return;
    }
    res.json(declarationIntakeToApi(row.caseRow, row.disclosure, row.declarant ?? null));
  }),
);

router.delete(
  "/intake/declarations/:caseId",
  h(async (req, res) => {
    const { caseId } = DiscardDeclarationIntakeParams.parse(req.params);
    const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
    if (!caseRow) {
      res.status(404).json({ error: "intake not found" });
      return;
    }
    if (caseRow.status !== "intake") {
      res.status(409).json({
        error: "this case is already registered - delete it from the case registry instead",
      });
      return;
    }
    // Cascade removes the disclosure PDF and any projected records.
    await db
      .delete(casesTable)
      .where(and(eq(casesTable.id, caseId), eq(casesTable.status, "intake")));
    res.status(204).end();
  }),
);

router.post(
  "/intake/declarations/:caseId/confirm",
  h(async (req, res) => {
    const { caseId } = ConfirmDeclarationIntakeParams.parse(req.params);
    const body = ConfirmDeclarationIntakeBody.parse(req.body);
    const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
    if (!caseRow) {
      res.status(404).json({ error: "intake not found" });
      return;
    }
    if (caseRow.status !== "intake") {
      res.status(409).json({ error: "this case is already registered" });
      return;
    }
    const [disclosure] = await db
      .select()
      .from(disclosuresTable)
      .where(eq(disclosuresTable.caseId, caseId));
    if (!disclosure) {
      res.status(404).json({ error: "no declaration uploaded for this intake" });
      return;
    }
    if (disclosure.status !== "ready") {
      res.status(409).json({
        error:
          disclosure.status === "processing"
            ? "the AI is still reading the declaration"
            : "the reading failed - re-read the declaration or discard this intake",
      });
      return;
    }
    // Same coercer that guards AI output guards the investigator's review.
    const extraction = coerceDisclosureExtraction(body);
    if (extraction.locations === undefined && disclosure.extraction) {
      // Carry the stored ink locations forward when the row structure is
      // unchanged (see the corrections endpoint for the rationale).
      const stored = coerceDisclosureExtraction(disclosure.extraction);
      if (stored.locations && sectionRowCountsMatch(stored, extraction)) {
        extraction.locations = stored.locations;
      }
    }
    const profile = caseProfileFromDeclaration(extraction);
    if (!profile.subjectName) {
      res.status(422).json({
        error: "the declarant's name (إسم مقدم الإقرار) is required to register the case",
      });
      return;
    }
    const registered = await db.transaction(async (tx) => {
      const saved = await tx
        .update(disclosuresTable)
        .set({ extraction: extraction as unknown, correctedAt: new Date(), error: null })
        // status="ready" keeps this atomic against a re-read starting
        // between the check above and this write.
        .where(and(eq(disclosuresTable.caseId, caseId), eq(disclosuresTable.status, "ready")))
        .returning({ id: disclosuresTable.id });
      if (saved.length === 0) return null;
      await projectDeclarationRecordsWith(tx, {
        caseId,
        disclosureId: saved[0]!.id,
        extraction,
        source: "investigator",
      });
      const [updated] = await tx
        .update(casesTable)
        .set({
          subjectName: profile.subjectName!,
          subjectReference: profile.subjectReference,
          declaredOccupation: profile.declaredOccupation,
          declaredMonthlyIncomeKwd: profile.declaredMonthlyIncomeKwd,
          expectedCountries: profile.expectedCountries,
          notes: profile.notes,
          status: "draft",
        })
        .where(and(eq(casesTable.id, caseId), eq(casesTable.status, "intake")))
        .returning();
      return updated ?? null;
    });
    if (!registered) {
      res.status(409).json({
        error: "the declaration changed while you were reviewing it - reload and confirm again",
      });
      return;
    }
    logger.info({ caseId, subjectName: registered.subjectName }, "case registered from declaration");
    const [api] = await withStats([registered]);
    res.json(api);
  }),
);

router.get(
  "/cases/:caseId/declaration",
  h(async (req, res) => {
    const { caseId } = GetCaseDeclarationParams.parse(req.params);
    const { declarant, items } = await loadDeclarationRecords(caseId);
    if (!declarant && items.length === 0) {
      res.status(404).json({ error: "no declaration records for this case" });
      return;
    }
    res.json({
      caseId,
      declarant: declarant ? declarantToApi(declarant) : null,
      items: items.map(declarationItemToApi),
    });
  }),
);

export default router;
