import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { casesTable } from "./cases";

/**
 * One official financial disclosure form (Nazaha "iqrar al-dhimma al-maliyya",
 * Law No. 2 of 2016) per case - the subject's self-reported wealth position.
 * The uploaded PDF is retained so extraction can be re-run; the AI-extracted
 * structured content lives in `extraction` (shape: DisclosureExtraction in the
 * API spec). Extraction runs asynchronously after upload:
 * status processing -> ready | failed.
 */
export const disclosuresTable = pgTable("disclosures", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .notNull()
    .unique()
    .references(() => casesTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentBase64: text("content_base64").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  status: text("status").notNull().default("processing"),
  error: text("error"),
  extraction: jsonb("extraction").$type<unknown>(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  // Live progress note while status="processing":
  // reading_primary | reading_secondary | adjudicating. Null when idle.
  phase: text("phase"),
  // Set when an investigator saves manual corrections to the extraction.
  correctedAt: timestamp("corrected_at", { withTimezone: true }),
  // Rotated on every upload AND every reprocess. Background-runner writes
  // are conditional on it, so a zombie run that outlived the watchdog can
  // never write over a newer run's result.
  runToken: text("run_token"),
});

export type DisclosureRow = typeof disclosuresTable.$inferSelect;
export type InsertDisclosure = typeof disclosuresTable.$inferInsert;
