import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  timestamp,
  jsonb,
  date,
} from "drizzle-orm/pg-core";
import { casesTable } from "./cases";

export const bankFilesTable = pgTable("bank_files", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .notNull()
    .references(() => casesTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  bankLabel: text("bank_label").notNull(),
  status: text("status").notNull().default("parsed"),
  rowsParsed: integer("rows_parsed").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  dataQuality: doublePrecision("data_quality").notNull().default(1),
  qualityIssues: jsonb("quality_issues")
    .$type<string[]>()
    .notNull()
    .default([]),
  mappingNotes: jsonb("mapping_notes").$type<string[]>().notNull().default([]),
  accountIds: jsonb("account_ids").$type<string[]>().notNull().default([]),
  periodStart: date("period_start", { mode: "string" }),
  periodEnd: date("period_end", { mode: "string" }),
  totalCreditsKwd: doublePrecision("total_credits_kwd").notNull().default(0),
  totalDebitsKwd: doublePrecision("total_debits_kwd").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BankFileRow = typeof bankFilesTable.$inferSelect;
export type InsertBankFile = typeof bankFilesTable.$inferInsert;
