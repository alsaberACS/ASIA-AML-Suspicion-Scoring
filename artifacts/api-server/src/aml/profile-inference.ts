import { guardedText } from "./investigation-output";

export type PredictionConfidence = "low" | "medium" | "high";

export interface PredictedTextField {
  value: string;
  confidence: PredictionConfidence;
  rationale: string;
}

export interface PredictedIncomeField {
  value: number;
  confidence: PredictionConfidence;
  rationale: string;
}

export interface PredictedCountriesField {
  value: string[];
  confidence: PredictionConfidence;
  rationale: string;
}

/**
 * AI-estimated values for declared KYC profile fields that the subject has
 * not provided. These are working hypotheses stored on the analysis run for
 * analyst review - they are NEVER written into the case profile automatically,
 * because the scoring engine's declared-vs-observed comparison would become
 * circular if observed activity silently populated the declared side.
 */
export interface ProfilePrediction {
  generatedAt: string;
  basis: string;
  declaredOccupation: PredictedTextField | null;
  declaredMonthlyIncomeKwd: PredictedIncomeField | null;
  declaredBusinessActivity: PredictedTextField | null;
  expectedCountries: PredictedCountriesField | null;
}

export interface MissingProfileFields {
  occupation: boolean;
  income: boolean;
  business: boolean;
  countries: boolean;
}

export function missingProfileFields(caseRow: {
  declaredOccupation: string | null;
  declaredMonthlyIncomeKwd: number | null;
  declaredBusinessActivity: string | null;
  expectedCountries: string[] | null;
}): MissingProfileFields {
  return {
    occupation: !caseRow.declaredOccupation?.trim(),
    income: caseRow.declaredMonthlyIncomeKwd == null || caseRow.declaredMonthlyIncomeKwd <= 0,
    business: !caseRow.declaredBusinessActivity?.trim(),
    countries: !caseRow.expectedCountries || caseRow.expectedCountries.length === 0,
  };
}

export function anyProfileFieldMissing(missing: MissingProfileFields): boolean {
  return missing.occupation || missing.income || missing.business || missing.countries;
}

const NO_FINDING_IDS = new Set<string>();
const CONFIDENCES = ["low", "medium", "high"] as const;

function confidenceOf(value: unknown): PredictionConfidence {
  return CONFIDENCES.includes(value as PredictionConfidence)
    ? (value as PredictionConfidence)
    : "low";
}

function textField(value: unknown, validIds: Set<number>): PredictedTextField | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const text = String(item.value ?? "").trim().slice(0, 120);
  if (!text) return null;
  return {
    value: text,
    confidence: confidenceOf(item.confidence),
    rationale: guardedText(item.rationale, validIds, NO_FINDING_IDS).slice(0, 500),
  };
}

/** Domain ceiling for a plausible declared monthly income. A model output
 * above this is treated as junk and dropped rather than clamped - clamping
 * would fabricate a number nobody produced. */
const MAX_MONTHLY_INCOME_KWD = 1_000_000;

function incomeField(value: unknown, validIds: Set<number>): PredictedIncomeField | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const amount = Number(item.value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONTHLY_INCOME_KWD) return null;
  return {
    value: Math.round(amount),
    confidence: confidenceOf(item.confidence),
    rationale: guardedText(item.rationale, validIds, NO_FINDING_IDS).slice(0, 500),
  };
}

function countriesField(value: unknown, validIds: Set<number>): PredictedCountriesField | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const list = (Array.isArray(item.value) ? item.value : [])
    .map((entry) => String(entry).trim().slice(0, 40))
    .filter(Boolean);
  const deduped = [...new Set(list)].slice(0, 8);
  if (deduped.length === 0) return null;
  return {
    value: deduped,
    confidence: confidenceOf(item.confidence),
    rationale: guardedText(item.rationale, validIds, NO_FINDING_IDS).slice(0, 500),
  };
}

/**
 * Coerce raw model output into a ProfilePrediction. Fields the case already
 * declares are dropped unconditionally - a prediction may only fill gaps.
 * Always returns an object (possibly with all fields null) so the stage is
 * marked done and never re-runs in a resume loop.
 */
export function coerceProfilePrediction(
  raw: unknown,
  missing: MissingProfileFields,
  validIds: Set<number>,
  generatedAt: string,
): ProfilePrediction {
  const root = ((raw as Record<string, unknown>)?.profilePrediction ?? raw ?? {}) as Record<
    string,
    unknown
  >;
  const basis = guardedText(root.basis, validIds, NO_FINDING_IDS).slice(0, 300);
  return {
    generatedAt,
    basis: basis || "Estimated from observed transaction activity.",
    declaredOccupation: missing.occupation ? textField(root.declaredOccupation, validIds) : null,
    declaredMonthlyIncomeKwd: missing.income
      ? incomeField(root.declaredMonthlyIncomeKwd, validIds)
      : null,
    declaredBusinessActivity: missing.business
      ? textField(root.declaredBusinessActivity, validIds)
      : null,
    expectedCountries: missing.countries ? countriesField(root.expectedCountries, validIds) : null,
  };
}
