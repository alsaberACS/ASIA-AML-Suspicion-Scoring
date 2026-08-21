import type {
  AnalysisRunRow,
  BankFileRow,
  CaseRow,
  DispositionRow,
  DisclosureRow,
} from "@workspace/db";
import type { TechnicalAnalysis } from "./types";

const iso = (d: Date | string | null): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : String(d);

function normalizeTechnicalAnalysis(
  value: unknown,
  testedTransactionCount: number,
  dataQualityScore: number,
): TechnicalAnalysis {
  const candidate = value as Partial<TechnicalAnalysis> | null;
  if (
    candidate &&
    typeof candidate.engineVersion === "string" &&
    typeof candidate.testedTransactionCount === "number" &&
    typeof candidate.dataQualityScore === "number" &&
    Array.isArray(candidate.testsExecuted) &&
    Array.isArray(candidate.gatedTests) &&
    Array.isArray(candidate.findings)
  ) {
    return candidate as TechnicalAnalysis;
  }
  return {
    engineVersion: "legacy-unavailable",
    testedTransactionCount,
    dataQualityScore,
    testsExecuted: [],
    gatedTests: [
      {
        testId: "legacy_analysis_run",
        reason:
          "Technical forensics was not available when this analysis was created. Re-run analysis to generate it.",
      },
    ],
    findings: [],
  };
}

export function dispositionToApi(row: DispositionRow) {
  return {
    id: row.id,
    runId: row.runId,
    decision: row.decision as "escalate" | "watchlist" | "close",
    analystName: row.analystName,
    notes: row.notes,
    hypothesisReviews: (row.hypothesisReviews ?? null) as
      | { hypothesisId: string; verdict: "accepted" | "dismissed" | "undetermined"; note?: string | null }[]
      | null,
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
    technicalAnalysis: normalizeTechnicalAnalysis(
      run.technicalAnalysis,
      run.txnCount,
      run.dataQualityScore,
    ) as never,
    internalTransfers: (run.internalTransfers ?? []) as never[],
    bandScale: (run.bandScale ?? []) as never[],
    typologyFindings: (run.typologyFindings ?? undefined) as never[] | undefined,
    profileConsistency: (run.profileConsistency ?? null) as never,
    informationGaps: run.informationGaps ?? undefined,
    criticScenarios: (run.criticScenarios ?? undefined) as never[] | undefined,
    methodologicalObjections: (run.methodologicalObjections ?? undefined) as never[] | undefined,
    residualUnexplained: run.residualUnexplained ?? undefined,
    aiInvestigation: (run.aiInvestigation ?? null) as never,
    caseMemo: run.caseMemo,
    aiProgress: (run.aiProgress ?? null) as never,
    sanctionsScreening: (run.sanctionsScreening ?? null) as never,
    profilePrediction: (run.profilePrediction ?? null) as never,
    disclosureReconciliation: (run.disclosureReconciliation ?? null) as never,
    disposition: disposition ? dispositionToApi(disposition) : null,
  };
}

export function disclosureToApi(row: DisclosureRow) {
  return {
    id: row.id,
    caseId: row.caseId,
    filename: row.filename,
    fileSizeBytes: row.fileSizeBytes,
    status: row.status as "processing" | "ready" | "failed",
    phase: row.phase,
    error: row.error,
    extraction: (row.extraction ?? null) as never,
    uploadedAt: iso(row.uploadedAt)!,
    extractedAt: iso(row.extractedAt),
    correctedAt: iso(row.correctedAt),
  };
}
