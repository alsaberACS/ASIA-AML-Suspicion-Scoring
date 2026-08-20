import { db, bankFilesTable, transactionsTable, casesTable, type BankFileRow } from "@workspace/db";
import { eq } from "drizzle-orm";
import { MappingError, parseWorkbook, type ForcedMapping } from "./parse";
import { llmMapColumns } from "./ai";
import { logger } from "../lib/logger";

/**
 * File ingestion: adaptive parse (heuristic first, LLM mapping assist as a
 * fallback), then persistence of the file record and its normalized
 * transactions.
 */
export async function ingestFile(args: {
  caseId: number;
  filename: string;
  buffer: Buffer;
  bankLabel?: string;
}): Promise<BankFileRow> {
  const { caseId, filename, buffer } = args;
  let result;
  try {
    result = parseWorkbook(buffer, filename, { bankLabel: args.bankLabel });
  } catch (err) {
    if (err instanceof MappingError && err.headers.length > 0) {
      logger.warn({ filename }, "heuristic mapping failed; consulting AI mapping assistant");
      const forced: ForcedMapping | null = await llmMapColumns(err.headers, err.sampleRows);
      if (!forced) throw err;
      result = parseWorkbook(buffer, filename, {
        bankLabel: args.bankLabel,
        forced,
        creditIndicatorValues: forced.creditIndicatorValues,
      });
      result.mappingNotes.unshift(
        "Heuristic mapping was inconclusive; column map provided by the AI mapping assistant.",
      );
    } else {
      throw err;
    }
  }

  const [fileRow] = await db
    .insert(bankFilesTable)
    .values({
      caseId,
      filename,
      bankLabel: result.bankLabel,
      status: "parsed",
      rowsParsed: result.txns.length,
      rowsSkipped: result.rowsSkipped,
      dataQuality: result.dataQuality,
      qualityIssues: result.qualityIssues,
      mappingNotes: result.mappingNotes,
      accountIds: result.accountIds,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      totalCreditsKwd: result.totalCreditsKwd,
      totalDebitsKwd: result.totalDebitsKwd,
    })
    .returning();
  if (!fileRow) throw new Error("failed to insert bank file row");

  const rows = result.txns.map((t) => ({
    caseId,
    fileId: fileRow.id,
    bank: result.bankLabel,
    accountId: t.accountId,
    rowIndex: t.rowIndex,
    postingDate: t.postingDate,
    direction: t.direction,
    amount: t.amount,
    currency: t.currency,
    amountKwd: t.amountKwd,
    channel: t.channel,
    counterpartyName: t.counterpartyName,
    counterpartyBank: t.counterpartyBank,
    counterpartyCountry: t.counterpartyCountry,
    narrative: t.narrative,
    runningBalance: t.runningBalance,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(transactionsTable).values(rows.slice(i, i + 500));
  }

  await db
    .update(casesTable)
    .set({ status: "ready" })
    .where(eq(casesTable.id, caseId));

  return fileRow;
}
