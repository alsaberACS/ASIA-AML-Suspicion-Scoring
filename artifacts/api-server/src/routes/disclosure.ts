import { Router, type IRouter } from "express";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db, disclosuresTable, casesTable } from "@workspace/db";
import {
  DeleteCaseDisclosureParams,
  GetCaseDisclosureParams,
  GetCaseDisclosurePdfParams,
  LocateCaseDisclosureSourcesParams,
  ReprocessCaseDisclosureParams,
  UpdateCaseDisclosureExtractionBody,
  UpdateCaseDisclosureExtractionParams,
  UploadCaseDisclosureBody,
  UploadCaseDisclosureParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import {
  coerceDisclosureExtraction,
  locateDisclosureSources,
  runDisclosureExtraction,
  sectionRowCountsMatch,
} from "../aml/disclosure";
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

router.get(
  "/cases/:caseId/disclosure/pdf",
  h(async (req, res) => {
    const { caseId } = GetCaseDisclosurePdfParams.parse(req.params);
    const [row] = await db
      .select()
      .from(disclosuresTable)
      .where(eq(disclosuresTable.caseId, caseId));
    if (!row) {
      res.status(404).json({ error: "no disclosure uploaded for this case" });
      return;
    }
    const buffer = Buffer.from(row.contentBase64, "base64");
    // Header values must stay ASCII-safe; Arabic filenames collapse to
    // underscores, which is fine for an inline viewer.
    const safeName =
      row.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_").trim() ||
      "disclosure.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(buffer);
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
        phase: "reading_primary",
        error: null,
        extraction: null,
        uploadedAt: new Date(),
        extractedAt: null,
        correctedAt: null,
        runToken: randomUUID(),
      })
      .onConflictDoUpdate({
        target: disclosuresTable.caseId,
        set: {
          filename: body.filename,
          contentBase64: body.contentBase64,
          fileSizeBytes: buffer.length,
          status: "processing",
          phase: "reading_primary",
          error: null,
          extraction: null,
          uploadedAt: new Date(),
          extractedAt: null,
          correctedAt: null,
          runToken: randomUUID(),
        },
      })
      .returning();
    void runDisclosureExtraction(row.id).catch((err) =>
      logger.error({ err, disclosureId: row.id }, "background extraction launch failed"),
    );
    res.status(201).json(disclosureToApi(row));
  }),
);

router.put(
  "/cases/:caseId/disclosure/extraction",
  h(async (req, res) => {
    const { caseId } = UpdateCaseDisclosureExtractionParams.parse(req.params);
    const body = UpdateCaseDisclosureExtractionBody.parse(req.body);
    const [row] = await db
      .select({
        id: disclosuresTable.id,
        status: disclosuresTable.status,
        extraction: disclosuresTable.extraction,
      })
      .from(disclosuresTable)
      .where(eq(disclosuresTable.caseId, caseId));
    if (!row) {
      res.status(404).json({ error: "no disclosure uploaded for this case" });
      return;
    }
    // Same coercer that guards AI output guards investigator edits.
    const extraction = coerceDisclosureExtraction(body);
    if (extraction.locations === undefined && row.extraction) {
      // A client that loaded before the locator finished saves a body
      // with no location data and would erase the stored mapping. Carry
      // it forward while the row structure is unchanged; on structural
      // change drop it instead, so the next workbench visit re-maps
      // against the corrected rows. (A locator commit inside the
      // milliseconds between this read and the update below can still
      // be lost - acceptable next to the seconds-wide window this
      // closes.)
      const stored = coerceDisclosureExtraction(row.extraction);
      if (stored.locations && sectionRowCountsMatch(stored, extraction)) {
        extraction.locations = stored.locations;
      }
    }
    const [updated] = await db
      .update(disclosuresTable)
      .set({
        extraction: extraction as unknown,
        correctedAt: new Date(),
        error: null,
      })
      // status="ready" in the WHERE keeps this atomic against a re-read
      // starting between our check and the write.
      .where(and(eq(disclosuresTable.caseId, caseId), eq(disclosuresTable.status, "ready")))
      .returning();
    if (!updated) {
      res.status(409).json({
        error:
          "corrections can only be saved on a completed reading (the AI is still reading, or the reading failed)",
      });
      return;
    }
    res.json(disclosureToApi(updated));
  }),
);

router.post(
  "/cases/:caseId/disclosure/reprocess",
  h(async (req, res) => {
    const { caseId } = ReprocessCaseDisclosureParams.parse(req.params);
    const [row] = await db
      .select({ id: disclosuresTable.id, status: disclosuresTable.status })
      .from(disclosuresTable)
      .where(eq(disclosuresTable.caseId, caseId));
    if (!row) {
      res.status(404).json({ error: "no disclosure uploaded for this case" });
      return;
    }
    // ne(status, processing) in the WHERE makes the takeover atomic; a
    // concurrent reprocess gets 0 rows and a 409.
    const [updated] = await db
      .update(disclosuresTable)
      .set({
        status: "processing",
        phase: "reading_primary",
        error: null,
        // Fresh token per run: a zombie runner from a timed-out previous
        // run can no longer satisfy the conditional writes.
        runToken: randomUUID(),
      })
      .where(
        and(eq(disclosuresTable.caseId, caseId), ne(disclosuresTable.status, "processing")),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "extraction is already running" });
      return;
    }
    void runDisclosureExtraction(updated.id).catch((err) =>
      logger.error({ err, disclosureId: updated.id }, "background re-extraction launch failed"),
    );
    res.status(202).json(disclosureToApi(updated));
  }),
);

router.post(
  "/cases/:caseId/disclosure/locate",
  h(async (req, res) => {
    const { caseId } = LocateCaseDisclosureSourcesParams.parse(req.params);
    const [row] = await db
      .select()
      .from(disclosuresTable)
      .where(eq(disclosuresTable.caseId, caseId));
    if (!row) {
      res.status(404).json({ error: "no disclosure uploaded for this case" });
      return;
    }
    if (row.status !== "ready" || !row.extraction) {
      res.status(409).json({ error: "reading is not complete" });
      return;
    }
    const extraction = coerceDisclosureExtraction(row.extraction);
    if (extraction.locations) {
      // Locator already ran for this extraction (even if it mapped
      // nothing); stay idempotent instead of re-billing a model pass.
      res.json(disclosureToApi(row));
      return;
    }
    const log = logger.child({ scope: "disclosure-locate", caseId, disclosureId: row.id });
    let locations: Awaited<ReturnType<typeof locateDisclosureSources>>;
    try {
      locations = await locateDisclosureSources(row.contentBase64, extraction, log);
    } catch (err) {
      log.warn({ err }, "on-demand source locating failed");
      res.status(502).json({ error: "source mapping failed; page-level provenance still works" });
      return;
    }
    // Guarded write: if the investigator corrected the extraction or
    // re-uploaded while the locator ran, drop this result rather than
    // clobber their newer data.
    const [updated] = await db
      .update(disclosuresTable)
      .set({ extraction: { ...extraction, locations } })
      .where(
        and(
          eq(disclosuresTable.caseId, caseId),
          eq(disclosuresTable.status, "ready"),
          eq(disclosuresTable.uploadedAt, row.uploadedAt),
          // Concurrent locates race to this write; only the first may
          // land, so a second model result can never overwrite it.
          sql`(${disclosuresTable.extraction} -> 'locations') IS NULL`,
          row.runToken == null
            ? isNull(disclosuresTable.runToken)
            : eq(disclosuresTable.runToken, row.runToken),
          row.correctedAt == null
            ? isNull(disclosuresTable.correctedAt)
            : eq(disclosuresTable.correctedAt, row.correctedAt),
        ),
      )
      .returning();
    if (!updated) {
      // Either the row changed under us, or a concurrent locate won the
      // write. The latter is a success: hand back the stored mapping.
      const [fresh] = await db
        .select()
        .from(disclosuresTable)
        .where(eq(disclosuresTable.caseId, caseId));
      if (
        fresh &&
        fresh.status === "ready" &&
        fresh.extraction &&
        coerceDisclosureExtraction(fresh.extraction).locations
      ) {
        res.json(disclosureToApi(fresh));
        return;
      }
      res.status(409).json({ error: "disclosure changed while mapping sources; reload the case" });
      return;
    }
    res.json(disclosureToApi(updated));
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
