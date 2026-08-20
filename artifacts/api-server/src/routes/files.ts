import { Router, type IRouter } from "express";
import { asc, and, eq } from "drizzle-orm";
import { db, bankFilesTable, casesTable } from "@workspace/db";
import {
  DeleteCaseFileParams,
  ListCaseFilesParams,
  UploadCaseFileBody,
  UploadCaseFileParams,
} from "@workspace/api-zod";
import { MappingError } from "../aml/parse";
import { ingestFile } from "../aml/ingest";
import { fileToApi } from "../aml/serialize";
import { h } from "./util";

const router: IRouter = Router();

router.get(
  "/cases/:caseId/files",
  h(async (req, res) => {
    const { caseId } = ListCaseFilesParams.parse(req.params);
    const rows = await db
      .select()
      .from(bankFilesTable)
      .where(eq(bankFilesTable.caseId, caseId))
      .orderBy(asc(bankFilesTable.id));
    res.json(rows.map(fileToApi));
  }),
);

router.post(
  "/cases/:caseId/files",
  h(async (req, res) => {
    const { caseId } = UploadCaseFileParams.parse(req.params);
    const body = UploadCaseFileBody.parse(req.body);
    const caseRows = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
    if (caseRows.length === 0) {
      res.status(404).json({ error: "case not found" });
      return;
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.contentBase64, "base64");
    } catch {
      res.status(422).json({ error: "contentBase64 is not valid base64" });
      return;
    }
    if (buffer.length === 0) {
      res.status(422).json({ error: "uploaded file is empty" });
      return;
    }
    if (buffer.length > 30 * 1024 * 1024) {
      res.status(422).json({ error: "file exceeds the 30 MB limit" });
      return;
    }
    try {
      const fileRow = await ingestFile({
        caseId,
        filename: body.filename,
        buffer,
        bankLabel: body.bankLabel,
      });
      res.status(201).json(fileToApi(fileRow));
    } catch (err) {
      if (err instanceof MappingError) {
        res.status(422).json({
          error: `Could not recognize the statement layout in "${body.filename}". Detected headers: ${err.headers.filter(Boolean).slice(0, 12).join(", ") || "none"}. Supported inputs are xlsx exports containing a date column and amount information.`,
        });
        return;
      }
      throw err;
    }
  }),
);

router.delete(
  "/cases/:caseId/files/:fileId",
  h(async (req, res) => {
    const { caseId, fileId } = DeleteCaseFileParams.parse(req.params);
    const rows = await db
      .delete(bankFilesTable)
      .where(and(eq(bankFilesTable.id, fileId), eq(bankFilesTable.caseId, caseId)))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    res.status(204).end();
  }),
);

export default router;
