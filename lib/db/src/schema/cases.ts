import {
  pgTable,
  serial,
  text,
  doublePrecision,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  subjectName: text("subject_name").notNull(),
  subjectReference: text("subject_reference"),
  declaredOccupation: text("declared_occupation"),
  declaredMonthlyIncomeKwd: doublePrecision("declared_monthly_income_kwd"),
  declaredBusinessActivity: text("declared_business_activity"),
  expectedCountries: jsonb("expected_countries")
    .$type<string[]>()
    .notNull()
    .default([]),
  notes: text("notes"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type CaseRow = typeof casesTable.$inferSelect;
