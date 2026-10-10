import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { casesTable } from "./cases";
import { disclosuresTable } from "./disclosures";

/**
 * Structured, queryable projection of a financial disclosure (Nazaha "iqrar
 * al-dhimma al-maliyya"). The AI reading itself lives as JSON on the
 * disclosure row; these tables hold the SAME facts normalised into typed
 * columns so declarants and declared items can be searched, joined and
 * aggregated in SQL. Values are kept in Arabic exactly as written on the form.
 *
 * Rows are (re)written from the current extraction whenever it changes: after
 * an AI reading completes (source "ai", unverified), when an investigator
 * saves corrections, and when a case is registered from a declaration
 * (both source "investigator", verifiedAt set).
 */
export const declarantsTable = pgTable("declarants", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .notNull()
    .unique()
    .references(() => casesTable.id, { onDelete: "cascade" }),
  disclosureId: integer("disclosure_id")
    .notNull()
    .references(() => disclosuresTable.id, { onDelete: "cascade" }),
  // first | update | final | unknown
  declarationType: text("declaration_type").notNull().default("unknown"),
  declarationDate: text("declaration_date"),
  fullName: text("full_name"),
  gender: text("gender"),
  nationality: text("nationality"),
  residenceCountry: text("residence_country"),
  civilId: text("civil_id"),
  passportNo: text("passport_no"),
  jobTitle: text("job_title"),
  employer: text("employer"),
  jobStartDate: text("job_start_date"),
  jobEndDate: text("job_end_date"),
  workPhone: text("work_phone"),
  mobile: text("mobile"),
  homePhone: text("home_phone"),
  email: text("email"),
  homeAddress: text("home_address"),
  monthlySalaryKwd: doublePrecision("monthly_salary_kwd"),
  generalNotes: text("general_notes"),
  // Section keys the declarant ticked as "none" (لا يوجد).
  sectionsMarkedNone: jsonb("sections_marked_none")
    .$type<string[]>()
    .notNull()
    .default([]),
  // Declarant fields the reader flagged as uncertain handwriting.
  uncertainFields: jsonb("uncertain_fields")
    .$type<string[]>()
    .notNull()
    .default([]),
  // ai | investigator
  source: text("source").notNull().default("ai"),
  // Set once an investigator has reviewed the reading against the ink.
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per declared item across all seven form tables. `section` names
 * the form table; the typed columns are a superset - each section fills the
 * ones its form columns map to (see declarationRecords.ts in the API server).
 */
export const declarationItemsTable = pgTable(
  "declaration_items",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    disclosureId: integer("disclosure_id")
      .notNull()
      .references(() => disclosuresTable.id, { onDelete: "cascade" }),
    // minorChildren | realEstate | usufructRights | securities |
    // bankAccountsAndDeposits | debtsOwed | valuableMovables
    section: text("section").notNull(),
    rowIndex: integer("row_index").notNull(),
    // Owner / beneficiary / debtor / child name as written.
    ownerName: text("owner_name"),
    // The row's main subject: child name, property location, usufruct
    // location, issuing company, bank or debtor, creditor, item description.
    label: text("label").notNull(),
    // Form tick-box category: relation, property type, usage type,
    // instrument type, account kind.
    kind: text("kind"),
    country: text("country"),
    idType: text("id_type"),
    idNumber: text("id_number"),
    areaSqm: doublePrecision("area_sqm"),
    ownershipPct: doublePrecision("ownership_pct"),
    quantityOrPct: text("quantity_or_pct"),
    itemCount: doublePrecision("item_count"),
    listed: boolean("listed"),
    valueKwd: doublePrecision("value_kwd"),
    // Date of birth / final repayment date, as written.
    dateText: text("date_text"),
    notes: text("notes"),
    uncertain: boolean("uncertain").notNull().default(false),
    corrected: boolean("corrected").notNull().default(false),
    page: integer("page"),
    asWritten: text("as_written"),
    alternates: jsonb("alternates").$type<string[]>().notNull().default([]),
  },
  (t) => [index("declaration_items_case_section_idx").on(t.caseId, t.section)],
);

export type DeclarantRow = typeof declarantsTable.$inferSelect;
export type InsertDeclarant = typeof declarantsTable.$inferInsert;
export type DeclarationItemRow = typeof declarationItemsTable.$inferSelect;
export type InsertDeclarationItem = typeof declarationItemsTable.$inferInsert;
