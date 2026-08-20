// Canonical shapes used across the AML pipeline.

export type Direction = "credit" | "debit";

export type Channel =
  | "cash_deposit"
  | "cash_withdrawal"
  | "transfer_in"
  | "transfer_out"
  | "salary"
  | "pos"
  | "cheque"
  | "fee"
  | "interest"
  | "other";

export interface ParsedTxn {
  rowIndex: number;
  postingDate: string; // YYYY-MM-DD
  direction: Direction;
  amount: number; // positive, original currency
  currency: string;
  amountKwd: number; // positive KWD countervalue
  channel: Channel;
  accountId: string;
  counterpartyName: string | null;
  counterpartyBank: string | null;
  counterpartyCountry: string | null;
  narrative: string | null;
  runningBalance: number | null;
}

export interface ParseFileResult {
  bankLabel: string;
  txns: ParsedTxn[];
  rowsSkipped: number;
  mappingNotes: string[];
  qualityIssues: string[];
  dataQuality: number; // 0-1
  accountIds: string[];
  periodStart: string | null;
  periodEnd: string | null;
  totalCreditsKwd: number;
  totalDebitsKwd: number;
}

// A transaction as loaded from the DB for pipeline work.
export interface Txn {
  id: number;
  fileId: number;
  bank: string;
  accountId: string;
  postingDate: string;
  direction: Direction;
  amountKwd: number;
  currency: string;
  channel: Channel;
  counterpartyName: string | null;
  counterpartyBank: string | null;
  counterpartyCountry: string | null;
  narrative: string | null;
  runningBalance: number | null;
  isInternalTransfer: boolean;
  internalPairId: number | null;
}

export type Zone = "normal" | "elevated" | "critical" | "gated";

export interface FeatureValue {
  key: string;
  label: string;
  group:
    | "placement"
    | "layering"
    | "geography"
    | "temporal"
    | "narrative"
    | "network"
    | "cross_bank";
  value: number;
  unit: string | null;
  baseline: number | null;
  baselineLabel: string | null;
  zone: Zone;
  description: string | null;
  gatedReason: string | null;
}

export interface RuleHit {
  ruleId: string;
  typologyId: string;
  typologyName: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  weightLogLr: number;
  fired: boolean;
  description: string;
  citation: string;
  detail: string | null;
  txnIds: number[];
}

export interface Driver {
  label: string;
  contribution: number;
  source: "rule" | "feature" | "data_quality" | "prior";
  ruleId: string | null;
  featureKey: string | null;
  txnIds: number[];
}

export interface InternalPair {
  id: number;
  debitTxnId: number;
  creditTxnId: number;
  amountKwd: number;
  dateGapDays: number;
  fromBank: string;
  toBank: string;
  matchBasis: string;
  confidence: number;
}

export interface BankBreakdown {
  bank: string;
  txnCount: number;
  creditsKwd: number;
  debitsKwd: number;
  periodStart: string | null;
  periodEnd: string | null;
  accountIds: string[];
}

export interface SubjectProfile {
  subjectName: string;
  declaredOccupation: string | null;
  declaredMonthlyIncomeKwd: number | null;
  declaredBusinessActivity: string | null;
  expectedCountries: string[];
  notes: string | null;
}

export interface DeterministicResult {
  probability: number;
  priorProbability: number;
  posteriorLogOdds: number;
  band: string;
  dataQualityScore: number;
  dataQualityIssues: string[];
  txnCount: number;
  totalCreditsKwd: number;
  totalDebitsKwd: number;
  internalTransferCount: number;
  internalValueKwd: number;
  periodStart: string | null;
  periodEnd: string | null;
  banks: BankBreakdown[];
  features: FeatureValue[];
  ruleHits: RuleHit[];
  drivers: Driver[];
  internalPairs: InternalPair[];
}

export const BAND_SCALE = [
  {
    band: "Low",
    minP: 0,
    maxP: 0.05,
    action: "No action; archive with periodic re-screening.",
  },
  {
    band: "Moderate",
    minP: 0.05,
    maxP: 0.2,
    action: "Monitoring list; re-score on new statement data.",
  },
  {
    band: "Elevated",
    minP: 0.2,
    maxP: 0.5,
    action: "Analyst review recommended within standard SLA.",
  },
  {
    band: "High",
    minP: 0.5,
    maxP: 0.8,
    action: "Priority analyst review; prepare STR draft material.",
  },
  {
    band: "Critical",
    minP: 0.8,
    maxP: 1,
    action: "Immediate senior review; STR filing decision required.",
  },
] as const;

export function bandFor(p: number): string {
  if (p < 0.05) return "Low";
  if (p < 0.2) return "Moderate";
  if (p < 0.5) return "Elevated";
  if (p < 0.8) return "High";
  return "Critical";
}
