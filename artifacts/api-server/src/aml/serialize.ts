import type {
  AnalysisRunRow,
  BankFileRow,
  CaseRow,
  DispositionRow,
} from "@workspace/db";

const iso = (d: Date | string | null): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : String(d);

export function dispositionToApi(row: DispositionRow) {
  return {
    id: row.id,
    runId: row.runId,
    decision: row.decision as "escalate" | "watchlist" | "close",
    analystName: row.analystName,
    notes: row.notes,
    createdAt: iso(row.createdAt)!,
  };
}

export function runSummary(
  run: AnalysisRunRow,
  subjectName: string,
  disposition: DispositionRow | null,
) {
  return {
    runId: run.id,
    caseId: run.caseId,
    subjectName,
    probability: run.probability,
    band: run.band,
    createdAt: iso(run.createdAt)!,
    disposition: disposition ? disposition.decision : null,
  };
}

export interface CaseStats {
  fileCount: number;
  txnCount: number;
  bankCount: number;
  latestRun: ReturnType<typeof runSummary> | null;
}

export function caseToApi(row: CaseRow, stats: CaseStats) {
  return {
    id: row.id,
    subjectName: row.subjectName,
    subjectReference: row.subjectReference,
    declaredOccupation: row.declaredOccupation,
    declaredMonthlyIncomeKwd: row.declaredMonthlyIncomeKwd,
    declaredBusinessActivity: row.declaredBusinessActivity,
    expectedCountries: row.expectedCountries ?? [],
    notes: row.notes,
    status: row.status as "draft" | "ready" | "analyzing" | "scored",
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    fileCount: stats.fileCount,
    txnCount: stats.txnCount,
    bankCount: stats.bankCount,
    latestRun: stats.latestRun,
  };
}

export function fileToApi(row: BankFileRow) {
  return {
    id: row.id,
    caseId: row.caseId,
    filename: row.filename,
    bankLabel: row.bankLabel,
    status: row.status as "parsed" | "error",
    rowsParsed: row.rowsParsed,
    rowsSkipped: row.rowsSkipped,
    dataQuality: row.dataQuality,
    qualityIssues: row.qualityIssues ?? [],
    mappingNotes: row.mappingNotes ?? [],
    accountIds: row.accountIds ?? [],
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    totalCreditsKwd: row.totalCreditsKwd,
    totalDebitsKwd: row.totalDebitsKwd,
    createdAt: iso(row.createdAt)!,
  };
}

export function txnToApi(row: {
  id: number;
  caseId: number;
  fileId: number;
  bank: string;
  accountId: string;
  postingDate: string;
  direction: string;
  amountKwd: number;
  currency: string;
  channel: string;
  counterpartyName: string | null;
  counterpartyBank: string | null;
  counterpartyCountry: string | null;
  narrative: string | null;
  runningBalance: number | null;
  isInternalTransfer: boolean;
  internalPairId: number | null;
  flags: string[];
}) {
  return {
    id: row.id,
    caseId: row.caseId,
    fileId: row.fileId,
    bank: row.bank,
    accountId: row.accountId,
    postingDate: row.postingDate,
    direction: row.direction as "credit" | "debit",
    amountKwd: row.amountKwd,
    currency: row.currency,
    channel: row.channel,
    counterpartyName: row.counterpartyName,
    counterpartyBank: row.counterpartyBank,
    counterpartyCountry: row.counterpartyCountry,
    narrative: row.narrative,
    runningBalance: row.runningBalance,
    isInternalTransfer: row.isInternalTransfer,
    internalPairId: row.internalPairId,
    flags: row.flags ?? [],
  };
}

export function runToApi(run: AnalysisRunRow, disposition: DispositionRow | null) {
  return {
    id: run.id,
    caseId: run.caseId,
    createdAt: iso(run.createdAt)!,
    status: "complete" as const,
    aiStatus: run.aiStatus as "pending" | "running" | "complete" | "failed" | "skipped",
    aiError: run.aiError,
    probability: run.probability,
    band: run.band as "Low" | "Moderate" | "Elevated" | "High" | "Critical",
    priorProbability: run.priorProbability,
    posteriorLogOdds: run.posteriorLogOdds,
    dataQualityScore: run.dataQualityScore,
    dataQualityIssues: run.dataQualityIssues ?? [],
    txnCount: run.txnCount,
    totalCreditsKwd: run.totalCreditsKwd,
    totalDebitsKwd: run.totalDebitsKwd,
    internalTransferCount: run.internalTransferCount,
    internalValueKwd: run.internalValueKwd,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    banks: (run.banks ?? []) as never[],
    features: (run.features ?? []) as never[],
    ruleHits: (run.ruleHits ?? []) as never[],
    drivers: (run.drivers ?? []) as never[],
    internalTransfers: (run.internalTransfers ?? []) as never[],
    bandScale: (run.bandScale ?? []) as never[],
    typologyFindings: (run.typologyFindings ?? undefined) as never[] | undefined,
    profileConsistency: (run.profileConsistency ?? null) as never,
    informationGaps: run.informationGaps ?? undefined,
    criticScenarios: (run.criticScenarios ?? undefined) as never[] | undefined,
    methodologicalObjections: (run.methodologicalObjections ?? undefined) as never[] | undefined,
    residualUnexplained: run.residualUnexplained ?? undefined,
    caseMemo: run.caseMemo,
    disposition: disposition ? dispositionToApi(disposition) : null,
  };
}
