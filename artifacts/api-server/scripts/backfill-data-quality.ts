/**
 * One-off backfill: compute the structured data quality report for the LATEST
 * analysis run of each case that does not have one yet, so existing cases get
 * the panel without burning a full re-analysis (and its AI cycle).
 */
import { db, analysisRunsTable, bankFilesTable, transactionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { buildDataQualityReport } from "../src/aml/data-quality";

async function main() {
  const runs = await db
    .select()
    .from(analysisRunsTable)
    .orderBy(desc(analysisRunsTable.createdAt));
  const latestByCase = new Map<number, (typeof runs)[number]>();
  for (const r of runs) if (!latestByCase.has(r.caseId)) latestByCase.set(r.caseId, r);

  for (const run of latestByCase.values()) {
    if (run.dataQualityReport) {
      console.log(`case ${run.caseId} run ${run.id}: already has a report, skipping`);
      continue;
    }
    const txnRows = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.caseId, run.caseId));
    const fileRows = await db
      .select()
      .from(bankFilesTable)
      .where(eq(bankFilesTable.caseId, run.caseId));
    if (txnRows.length === 0) {
      console.log(`case ${run.caseId} run ${run.id}: no transactions, skipping`);
      continue;
    }
    const txns = txnRows.map((r) => ({
      id: r.id,
      fileId: r.fileId,
      accountId: r.accountId,
      postingDate: r.postingDate,
      direction: r.direction as "credit" | "debit",
      amountKwd: r.amountKwd,
      currency: r.currency,
      narrative: r.narrative,
      runningBalance: r.runningBalance,
    }));
    const report = buildDataQualityReport(txns, fileRows, run.dataQualityScore);
    await db
      .update(analysisRunsTable)
      .set({ dataQualityReport: report as unknown })
      .where(eq(analysisRunsTable.id, run.id));
    const nonPass = report.checks.filter((c) => c.status !== "pass");
    console.log(
      `case ${run.caseId} run ${run.id}: report written (${nonPass.length} non-pass: ${nonPass.map((c) => `${c.id}=${c.status}`).join(", ") || "none"})`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
