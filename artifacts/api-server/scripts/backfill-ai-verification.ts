/**
 * One-off backfill: verify AI citations for every run whose AI layers are
 * complete but which has no verification report yet.
 */
import { db, analysisRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runAiVerification } from "../src/aml/ai-verification";

async function main() {
  const runs = await db
    .select({ id: analysisRunsTable.id, caseId: analysisRunsTable.caseId, aiVerification: analysisRunsTable.aiVerification })
    .from(analysisRunsTable)
    .where(eq(analysisRunsTable.aiStatus, "complete"));
  for (const run of runs) {
    if (run.aiVerification && !process.env.FORCE) {
      console.log(`run ${run.id} (case ${run.caseId}): already verified, skipping`);
      continue;
    }
    await runAiVerification(run.id);
    const [after] = await db
      .select({ v: analysisRunsTable.aiVerification })
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.id, run.id));
    const report = after?.v as { overall?: string; totalChecked?: number; totalValid?: number } | null;
    console.log(
      `run ${run.id} (case ${run.caseId}): ${report?.overall} - ${report?.totalValid}/${report?.totalChecked} citations valid`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
