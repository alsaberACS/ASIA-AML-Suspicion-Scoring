import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, disclosuresTable, casesTable } from "@workspace/db";
import {
  DeleteCaseDisclosureParams,
  GetCaseDisclosureParams,
  UploadCaseDisclosureBody,
  UploadCaseDisclosureParams,
} from "@workspace/api-zod";
import { runDisclosureExtraction } from "../aml/disclosure";
import { disclosureToApi } from "../aml/serialize";
import { logger } from "../lib/logger";
import { h } from "./util";

const router: IRouter = Router();

router.get(
  "/cases/:caseId/disclosure",
  h(async (req, res) => {
    const { caseId } = GetCaseDisclosureParams.parse(req.params);
    const [row] = await db
      .select()
      .from(disclosuresTable)
      .where(eq(disclosuresTable.caseId, caseId));
    if (!row) {
      res.status(404).json({ error: "no disclosure uploaded for this case" });
      return;
    }
    res.json(disclosureToApi(row));
  }),
);

router.post(
  "/cases/:caseId/disclosure",
  h(async (req, res) => {
    const { caseId } = UploadCaseDisclosureParams.parse(req.params);
    const body = UploadCaseDisclosureBody.parse(req.body);
    const caseRows = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
    if (caseRows.length === 0) {
      res.status(404).json({ error: "case not found" });
      return;
    }
    const MAX_PDF_BYTES = 20 * 1024 * 1024;
    // Reject oversized payloads from the base64 string length alone,
    // before allocating the decoded copy (base64 packs 3 bytes into 4
    // chars).
    if (body.contentBase64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 + 8) {
      res.status(422).json({ error: "file exceeds the 20 MB limit" });
      return;
    }
    const buffer = Buffer.from(body.contentBase64, "base64");
    if (buffer.length === 0) {
      res.status(422).json({ error: "uploaded file is empty" });
      return;
    }
    if (buffer.length > MAX_PDF_BYTES) {
      res.status(422).json({ error: "file exceeds the 20 MB limit" });
      return;
    }
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      res.status(422).json({
        error: `"${body.filename}" is not a PDF. The self report must be the scanned disclosure form as a PDF file.`,
      });
      return;
    }
    // One disclosure per case: replace any previous upload and restart
    // extraction from scratch.
    const [row] = await db
      .insert(disclosuresTable)
      .values({
        caseId,
        filename: body.filename,
        contentBase64: body.contentBase64,
        fileSizeBytes: buffer.length,
        status: "processing",
        error: null,
        extraction: null,
        uploadedAt: new Date(),
        extractedAt: null,
      })
      .onConflictDoUpdate({
        target: disclosuresTable.caseId,
        set: {
          filename: body.filename,
          contentBase64: body.contentBase64,
          fileSizeBytes: buffer.length,
          status: "processing",
          error: null,
          extraction: null,
          uploadedAt: new Date(),
          extractedAt: null,
        },
      })
      .returning();
    void runDisclosureExtraction(row.id).catch((err) =>
      logger.error({ err, disclosureId: row.id }, "background extraction launch failed"),
    );
    res.status(201).json(disclosureToApi(row));
  }),
);

router.delete(
  "/cases/:caseId/disclosure",
  h(async (req, res) => {
    const { caseId } = DeleteCaseDisclosureParams.parse(req.params);
    const rows = await db
      .delete(disclosuresTable)
      .where(eq(disclosuresTable.caseId, caseId))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "no disclosure uploaded for this case" });
      return;
    }
    res.status(204).end();
  }),
);

export default router;
