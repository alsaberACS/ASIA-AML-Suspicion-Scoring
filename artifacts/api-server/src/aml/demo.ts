import fs from "node:fs";
import path from "node:path";
import { db, casesTable, type CaseRow } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ingestFile } from "./ingest";
import { runAnalysis } from "./pipeline";

const DEMO_REF = "DEMO-FAHAD-001";

const DEMO_FILES: Array<{ file: string; bankLabel: string; displayName: string }> = [
  { file: "bank1.xlsx", bankLabel: "Boubyan Bank", displayName: "بنك واحد - compliance export.xlsx" },
  { file: "bank2.xlsx", bankLabel: "Commercial Bank of Kuwait", displayName: "بنك اثنين - core banking dump.xlsx" },
  { file: "bank3.xlsx", bankLabel: "Gulf Bank", displayName: "بنك ثلاثة - query result.xlsx" },
  { file: "bank4.xlsx", bankLabel: "Burgan Bank", displayName: "بنك اربعة - classic statement.xlsx" },
  { file: "bank5.xlsx", bankLabel: "National Bank of Kuwait", displayName: "بنك خمسة - report extract.xlsx" },
];

function resolveDemoDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "demo-data"),
    path.resolve(process.cwd(), "artifacts/api-server/demo-data"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/**
 * Builds the demonstration case: one subject ("FAHAD") holding accounts at
 * five banks, each bank exporting a completely different statement format.
 * Idempotent - returns the existing case if already seeded.
 */
export async function seedDemoCase(): Promise<{ caseRow: CaseRow; created: boolean }> {
  const existing = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.subjectReference, DEMO_REF));
  if (existing.length > 0) return { caseRow: existing[0]!, created: false };

  const dir = resolveDemoDir();
  if (!dir)
    throw Object.assign(new Error("demo data directory not found on server"), { statusCode: 500 });

  const [caseRow] = await db
    .insert(casesTable)
    .values({
      subjectName: "FAHAD",
      subjectReference: DEMO_REF,
      declaredOccupation: "Government sector employee (administrative)",
      declaredMonthlyIncomeKwd: 2500,
      declaredBusinessActivity: "None declared",
      expectedCountries: ["Kuwait"],
      notes:
        "Demonstration case assembled from five sample bank statement exports, each in a different format (compliance export, core-banking dump, query extract, classic statement, signed-amount report). Subject name is masked to a first name for the demo.",
      status: "draft",
    })
    .returning();
  if (!caseRow) throw new Error("failed to create demo case");

  for (const spec of DEMO_FILES) {
    const filePath = path.join(dir, spec.file);
    if (!fs.existsSync(filePath)) {
      logger.warn({ filePath }, "demo file missing; skipping");
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    await ingestFile({
      caseId: caseRow.id,
      filename: spec.displayName,
      buffer,
      bankLabel: spec.bankLabel,
    });
    logger.info({ file: spec.file, bank: spec.bankLabel }, "demo file ingested");
  }

  await runAnalysis(caseRow.id);
  const [fresh] = await db.select().from(casesTable).where(eq(casesTable.id, caseRow.id));
  return { caseRow: fresh ?? caseRow, created: true };
}
