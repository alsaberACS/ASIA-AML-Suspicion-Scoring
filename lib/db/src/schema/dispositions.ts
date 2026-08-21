import {
  pgTable,
  serial,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { analysisRunsTable } from "./analysisRuns";

export const dispositionsTable = pgTable(
  "dispositions",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => analysisRunsTable.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    analystName: text("analyst_name"),
    notes: text("notes"),
    hypothesisReviews: jsonb("hypothesis_reviews"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("dispositions_run_unique").on(t.runId)],
);

export type DispositionRow = typeof dispositionsTable.$inferSelect;
export type InsertDisposition = typeof dispositionsTable.$inferInsert;
