import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  timestamp,
  jsonb,
  date,
  index,
} from "drizzle-orm/pg-core";
import { casesTable } from "./cases";

export const analysisRunsTable = pgTable(
  "analysis_runs",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("complete"),
    aiStatus: text("ai_status").notNull().default("pending"),
    aiError: text("ai_error"),
    probability: doublePrecision("probability").notNull(),
    priorProbability: doublePrecision("prior_probability").notNull(),
    posteriorLogOdds: doublePrecision("posterior_log_odds").notNull(),
    band: text("band").notNull(),
    dataQualityScore: doublePrecision("data_quality_score").notNull(),
    dataQualityIssues: jsonb("data_quality_issues")
      .$type<string[]>()
      .notNull()
      .default([]),
    txnCount: integer("txn_count").notNull(),
    totalCreditsKwd: doublePrecision("total_credits_kwd").notNull(),
    totalDebitsKwd: doublePrecision("total_debits_kwd").notNull(),
    internalTransferCount: integer("internal_transfer_count").notNull(),
    internalValueKwd: doublePrecision("internal_value_kwd").notNull(),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    banks: jsonb("banks").$type<unknown[]>().notNull().default([]),
    features: jsonb("features").$type<unknown[]>().notNull().default([]),
    ruleHits: jsonb("rule_hits").$type<unknown[]>().notNull().default([]),
    drivers: jsonb("drivers").$type<unknown[]>().notNull().default([]),
    technicalAnalysis: jsonb("technical_analysis")
      .$type<unknown>()
      .notNull()
      .default({
        engineVersion: "legacy-unavailable",
        testedTransactionCount: 0,
        dataQualityScore: 0,
        testsExecuted: [],
        gatedTests: [
          {
            testId: "legacy_analysis_run",
            reason:
              "Technical forensics was not available when this analysis was created. Re-run analysis to generate it.",
          },
        ],
        findings: [],
      }),
    internalTransfers: jsonb("internal_transfers")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    bandScale: jsonb("band_scale").$type<unknown[]>().notNull().default([]),
    typologyFindings: jsonb("typology_findings").$type<unknown[]>(),
    profileConsistency: jsonb("profile_consistency").$type<unknown>(),
    informationGaps: jsonb("information_gaps").$type<string[]>(),
    criticScenarios: jsonb("critic_scenarios").$type<unknown[]>(),
    methodologicalObjections: jsonb("methodological_objections").$type<
      unknown[]
    >(),
    residualUnexplained: jsonb("residual_unexplained").$type<string[]>(),
    aiInvestigation: jsonb("ai_investigation").$type<unknown>(),
    caseMemo: text("case_memo"),
  },
  (t) => [index("analysis_runs_case_idx").on(t.caseId)],
);

export type AnalysisRunRow = typeof analysisRunsTable.$inferSelect;
export type InsertAnalysisRun = typeof analysisRunsTable.$inferInsert;
