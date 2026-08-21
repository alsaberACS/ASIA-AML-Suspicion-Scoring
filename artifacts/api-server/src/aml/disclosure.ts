/**
 * Financial disclosure (Nazaha "iqrar al-dhimma al-maliyya", Law No. 2 of
 * 2016) - storage helpers, AI extraction from the handwritten form, and
 * reconciliation-output coercion.
 *
 * Extraction is a dual-reader pipeline over the PDF itself (no server-side
 * rasterization):
 *   1. reading_primary   - Claude reads the whole PDF as a document block.
 *   2. reading_secondary - Gemini independently reads the same PDF.
 *   3. adjudicating      - Claude re-examines the PDF with both readings and
 *                          merges them: agreements settle, disagreements are
 *                          re-checked against the ink and the rejected
 *                          reading is preserved in `alternates`.
 * If the secondary reader or the adjudication fails, the pipeline degrades
 * to the primary reading and records a warning. Every row carries
 * provenance: the PDF page it came from and the verbatim handwriting
 * (`asWritten`). All model output is untrusted and coerced before it is
 * persisted. Investigator corrections (via PUT) set `corrected` flags and
 * never touch this pipeline.
 */
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ai as gemini } from "@workspace/integrations-gemini-ai";
import { db, disclosuresTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";

const PRIMARY_MODEL = "claude-sonnet-4-6";
const PRIMARY_READER_LABEL = "Claude Sonnet 4.6";
const SECONDARY_MODEL = "gemini-3.1-pro-preview";
const SECONDARY_READER_LABEL = "Gemini 3.1 Pro";
// Three sequential model passes over a ~13-page scan need more headroom
// than the old single-pass watchdog.
const EXTRACTION_TIMEOUT_MS = 10 * 60 * 1000;

const aiConfigured = (): boolean =>
  Boolean(
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  );

const geminiConfigured = (): boolean =>
  Boolean(
    process.env.AI_INTEGRATIONS_GEMINI_BASE_URL &&
      process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  );

// ---------------------------------------------------------------------------
// Types (mirror the API spec's DisclosureExtraction shape)

/**
 * Provenance and review state shared by every extracted row.
 * - page: 1-based PDF page the handwritten entry appears on.
 * - asWritten: short verbatim transcription of the ink (original Arabic).
 * - alternates: readings the adjudicator rejected ("Reader B: 70,100").
 * - corrected: an investigator manually fixed this row after extraction.
 */
export interface DisclosureRowProvenance {
  uncertain?: boolean;
  page?: number | null;
  asWritten?: string | null;
  alternates?: string[];
  corrected?: boolean;
}

export interface DisclosureDeclarant {
  name: string | null;
  nationality: string | null;
  residenceCountry: string | null;
  gender: string | null;
  civilId: string | null;
  passportNo: string | null;
  jobTitle: string | null;
  employer: string | null;
  jobStartDate: string | null;
  jobEndDate: string | null;
  workPhone: string | null;
  homeAddress: string | null;
  mobile: string | null;
  homePhone: string | null;
  email: string | null;
  monthlySalaryKwd: number | null;
  page?: number | null;
  uncertainFields?: string[];
  correctedFields?: string[];
  alternates?: string[];
}

export interface DisclosureChild extends DisclosureRowProvenance {
  name: string;
  dateOfBirth: string | null;
  relation: string | null;
  idType: string | null;
  idNumber: string | null;
  notes: string | null;
}

export interface DisclosureRealEstate extends DisclosureRowProvenance {
  ownerName: string | null;
  location: string;
  areaSqm: number | null;
  ownershipPct: number | null;
  propertyType: string | null;
  notes: string | null;
}

export interface DisclosureUsufruct extends DisclosureRowProvenance {
  beneficiaryName: string | null;
  location: string;
  areaSqm: number | null;
  usageType: string | null;
  notes: string | null;
}

export interface DisclosureSecurity extends DisclosureRowProvenance {
  ownerName: string | null;
  instrumentType: string | null;
  company: string;
  companyCountry: string | null;
  quantityOrPct: string | null;
  listed: boolean | null;
  notes: string | null;
}

export interface DisclosureAccount extends DisclosureRowProvenance {
  ownerName: string | null;
  institution: string;
  institutionCountry: string | null;
  kind: string | null;
  valueKwd: number | null;
  notes: string | null;
}

export interface DisclosureDebt extends DisclosureRowProvenance {
  debtorName: string | null;
  creditor: string;
  creditorCountry: string | null;
  amountKwd: number | null;
  finalRepaymentDate: string | null;
  notes: string | null;
}

export interface DisclosureMovable extends DisclosureRowProvenance {
  ownerName: string | null;
  description: string;
  count: number | null;
  totalValueKwd: number | null;
  notes: string | null;
}

export interface DisclosureReaders {
  primary: string;
  secondary: string | null;
  adjudicated: boolean;
}

export interface DisclosureExtraction {
  declarationType: "first" | "update" | "final" | "unknown";
  declarationDate: string | null;
  pageCount: number | null;
  summaryEn: string | null;
  generalNotes: string | null;
  declarant: DisclosureDeclarant | null;
  minorChildren: DisclosureChild[];
  realEstate: DisclosureRealEstate[];
  usufructRights: DisclosureUsufruct[];
  securities: DisclosureSecurity[];
  bankAccountsAndDeposits: DisclosureAccount[];
  debtsOwed: DisclosureDebt[];
  valuableMovables: DisclosureMovable[];
  sectionsMarkedNone: string[];
  extractionWarnings: string[];
  readers: DisclosureReaders | null;
}

export interface DisclosureReconciliationFinding {
  findingId: string;
  category: string;
  severity: "info" | "notable" | "significant";
  title: string;
  detail: string;
  txnIds: number[];
  disclosureRefs: string[];
}

export interface DisclosureReconciliation {
  generatedAt: string;
  summary: string;
  findings: DisclosureReconciliationFinding[];
}

// ---------------------------------------------------------------------------
// Coercion - model output is untrusted; clamp everything to schema shapes.

const MAX_MONEY_KWD = 100_000_000;
const MAX_AREA_SQM = 10_000_000;
const MAX_COUNT = 10_000;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const reqStr = (v: unknown, max: number, fallback: string): string =>
  str(v, max) ?? fallback;

const num = (v: unknown, min: number, max: number): number | null => {
  const n =
    typeof v === "string" ? Number(v.replace(/[,\s\u066c\u060c]/g, "")) : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const boolOrNull = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const strArr = (v: unknown, maxItems: number, maxLen: number): string[] =>
  arr(v)
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, maxItems);

const uncertainOf = (o: Record<string, unknown>): { uncertain?: boolean } =>
  o.uncertain === true ? { uncertain: true } : {};

/** Row provenance passthrough - only keeps well-formed values. */
const provenanceOf = (
  o: Record<string, unknown>,
): Pick<DisclosureRowProvenance, "page" | "asWritten" | "alternates" | "corrected"> => {
  const out: Pick<
    DisclosureRowProvenance,
    "page" | "asWritten" | "alternates" | "corrected"
  > = {};
  const page = num(o.page, 1, 500);
  if (page != null) out.page = Math.round(page);
  const asWritten = str(o.asWritten, 300);
  if (asWritten) out.asWritten = asWritten;
  const alternates = strArr(o.alternates, 4, 200);
  if (alternates.length) out.alternates = alternates;
  if (o.corrected === true) out.corrected = true;
  return out;
};

const readersOf = (v: unknown): DisclosureReaders | null => {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const primary = str(r.primary, 80);
  if (!primary) return null;
  return {
    primary,
    secondary: str(r.secondary, 80),
    adjudicated: r.adjudicated === true,
  };
};

const SECTION_KEYS = [
  "minorChildren",
  "realEstate",
  "usufructRights",
  "securities",
  "bankAccountsAndDeposits",
  "debtsOwed",
  "valuableMovables",
] as const;

const DECLARANT_FIELD_KEYS = [
  "name",
  "nationality",
  "residenceCountry",
  "gender",
  "civilId",
  "passportNo",
  "jobTitle",
  "employer",
  "jobStartDate",
  "jobEndDate",
  "workPhone",
  "homeAddress",
  "mobile",
  "homePhone",
  "email",
  "monthlySalaryKwd",
] as const;

export function coerceDisclosureExtraction(raw: unknown): DisclosureExtraction {
  const o = (raw ?? {}) as Record<string, unknown>;
  const d = (o.declarant ?? null) as Record<string, unknown> | null;
  const declarant: DisclosureDeclarant | null =
    d && typeof d === "object"
      ? {
          name: str(d.name, 160),
          nationality: str(d.nationality, 80),
          residenceCountry: str(d.residenceCountry, 80),
          gender: str(d.gender, 30),
          civilId: str(d.civilId, 40),
          passportNo: str(d.passportNo, 40),
          jobTitle: str(d.jobTitle, 160),
          employer: str(d.employer, 160),
          jobStartDate: str(d.jobStartDate, 40),
          jobEndDate: str(d.jobEndDate, 40),
          workPhone: str(d.workPhone, 40),
          homeAddress: str(d.homeAddress, 240),
          mobile: str(d.mobile, 40),
          homePhone: str(d.homePhone, 40),
          email: str(d.email, 120),
          monthlySalaryKwd: num(d.monthlySalaryKwd, 0, 1_000_000),
        }
      : null;
  if (declarant && d) {
    const page = num(d.page, 1, 500);
    if (page != null) declarant.page = Math.round(page);
    const knownKey = (k: string) =>
      (DECLARANT_FIELD_KEYS as readonly string[]).includes(k);
    const uncertainFields = strArr(d.uncertainFields, 20, 40).filter(knownKey);
    if (uncertainFields.length) declarant.uncertainFields = uncertainFields;
    const correctedFields = strArr(d.correctedFields, 20, 40).filter(knownKey);
    if (correctedFields.length) declarant.correctedFields = correctedFields;
    const alternates = strArr(d.alternates, 8, 200);
    if (alternates.length) declarant.alternates = alternates;
  }

  const children: DisclosureChild[] = arr(o.minorChildren)
    .slice(0, 15)
    .map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      return {
        name: reqStr(x.name, 160, "(name illegible)"),
        dateOfBirth: str(x.dateOfBirth, 40),
        relation: str(x.relation, 60),
        idType: str(x.idType, 60),
        idNumber: str(x.idNumber, 60),
        notes: str(x.notes, 240),
        ...uncertainOf(x),
        ...provenanceOf(x),
      };
    });

  const realEstate: DisclosureRealEstate[] = arr(o.realEstate)
    .slice(0, 25)
    .map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return {
        ownerName: str(x.ownerName, 160),
        location: reqStr(x.location, 200, "(location illegible)"),
        areaSqm: num(x.areaSqm, 0, MAX_AREA_SQM),
        ownershipPct: num(x.ownershipPct, 0, 100),
        propertyType: str(x.propertyType, 80),
        notes: str(x.notes, 240),
        ...uncertainOf(x),
        ...provenanceOf(x),
      };
    });

  const usufruct: DisclosureUsufruct[] = arr(o.usufructRights)
    .slice(0, 25)
    .map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return {
        beneficiaryName: str(x.beneficiaryName, 160),
        location: reqStr(x.location, 200, "(location illegible)"),
        areaSqm: num(x.areaSqm, 0, MAX_AREA_SQM),
        usageType: str(x.usageType, 80),
        notes: str(x.notes, 240),
        ...uncertainOf(x),
        ...provenanceOf(x),
      };
    });

  const securities: DisclosureSecurity[] = arr(o.securities)
    .slice(0, 30)
    .map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return {
        ownerName: str(x.ownerName, 160),
        instrumentType: str(x.instrumentType, 80),
        company: reqStr(x.company, 200, "(issuer illegible)"),
        companyCountry: str(x.companyCountry, 80),
        quantityOrPct: str(x.quantityOrPct, 60),
        listed: boolOrNull(x.listed),
        notes: str(x.notes, 240),
        ...uncertainOf(x),
        ...provenanceOf(x),
      };
    });

  const accounts: DisclosureAccount[] = arr(o.bankAccountsAndDeposits)
    .slice(0, 30)
    .map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return {
        ownerName: str(x.ownerName, 160),
        institution: reqStr(x.institution, 200, "(institution illegible)"),
        institutionCountry: str(x.institutionCountry, 80),
        kind: str(x.kind, 60),
        valueKwd: num(x.valueKwd, 0, MAX_MONEY_KWD),
        notes: str(x.notes, 240),
        ...uncertainOf(x),
        ...provenanceOf(x),
      };
    });

  const debts: DisclosureDebt[] = arr(o.debtsOwed)
    .slice(0, 25)
    .map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return {
        debtorName: str(x.debtorName, 160),
        creditor: reqStr(x.creditor, 200, "(creditor illegible)"),
        creditorCountry: str(x.creditorCountry, 80),
        amountKwd: num(x.amountKwd, 0, MAX_MONEY_KWD),
        finalRepaymentDate: str(x.finalRepaymentDate, 40),
        notes: str(x.notes, 240),
        ...uncertainOf(x),
        ...provenanceOf(x),
      };
    });

  const movables: DisclosureMovable[] = arr(o.valuableMovables)
    .slice(0, 25)
    .map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return {
        ownerName: str(x.ownerName, 160),
        description: reqStr(x.description, 200, "(description illegible)"),
        count: num(x.count, 0, MAX_COUNT),
        totalValueKwd: num(x.totalValueKwd, 0, MAX_MONEY_KWD),
        notes: str(x.notes, 240),
        ...uncertainOf(x),
        ...provenanceOf(x),
      };
    });

  const declType = ["first", "update", "final"].includes(
    o.declarationType as string,
  )
    ? (o.declarationType as "first" | "update" | "final")
    : "unknown";

  const markedNone = strArr(o.sectionsMarkedNone, 10, 60).filter((k) =>
    (SECTION_KEYS as readonly string[]).includes(k),
  );

  return {
    declarationType: declType,
    declarationDate: str(o.declarationDate, 40),
    pageCount: num(o.pageCount, 1, 500),
    summaryEn: str(o.summaryEn, 900),
    generalNotes: str(o.generalNotes, 1500),
    declarant,
    minorChildren: children,
    realEstate,
    usufructRights: usufruct,
    securities,
    bankAccountsAndDeposits: accounts,
    debtsOwed: debts,
    valuableMovables: movables,
    sectionsMarkedNone: markedNone,
    extractionWarnings: strArr(o.extractionWarnings, 15, 300),
    readers: readersOf(o.readers),
  };
}

export function coerceDisclosureReconciliation(
  raw: unknown,
  validIds: Set<number>,
  generatedAt: string,
): DisclosureReconciliation {
  const container = ((raw as Record<string, unknown>)?.disclosureReconciliation ??
    raw ??
    {}) as Record<string, unknown>;
  const CATEGORIES = [
    "undeclared_account",
    "declared_account_activity",
    "income_mismatch",
    "wealth_inconsistency",
    "asset_transaction",
    "debt_service",
    "rental_or_usufruct_income",
    "securities_activity",
    "dependent_activity",
    "corroboration",
    "coverage_gap",
    "other",
  ];
  const findings: DisclosureReconciliationFinding[] = arr(container.findings)
    .slice(0, 14)
    .map((f, i) => {
      const x = (f ?? {}) as Record<string, unknown>;
      return {
        findingId: reqStr(x.findingId, 20, `DR-${String(i + 1).padStart(2, "0")}`),
        category: CATEGORIES.includes(x.category as string)
          ? (x.category as string)
          : "other",
        severity: (["info", "notable", "significant"] as const).includes(
          x.severity as "info",
        )
          ? (x.severity as "info" | "notable" | "significant")
          : "info",
        title: reqStr(x.title, 160, "Untitled finding"),
        detail: reqStr(x.detail, 1200, ""),
        txnIds: arr(x.txnIds)
          .map((n) => Number(n))
          .filter((n) => validIds.has(n))
          .slice(0, 25),
        disclosureRefs: strArr(x.disclosureRefs, 6, 80),
      };
    });
  // Always return a non-null object: this is the stage's resume sentinel.
  return {
    generatedAt,
    summary: reqStr(container.summary, 2000, ""),
    findings,
  };
}

// ---------------------------------------------------------------------------
// Evidence rendering - compact text block appended to AI prompts.

const kwd = (n: number | null): string =>
  n == null ? "value not stated" : `${n.toLocaleString("en-US")} KWD`;

const mark = (r: { uncertain?: boolean; corrected?: boolean }): string =>
  r.corrected
    ? " [corrected by investigator]"
    : r.uncertain
      ? " [uncertain reading]"
      : "";

export function renderDisclosureEvidence(x: DisclosureExtraction): string {
  const lines: string[] = [];
  const typeLabel =
    x.declarationType === "first"
      ? "first declaration (iqrar awwal)"
      : x.declarationType;
  lines.push(
    "FINANCIAL DISCLOSURE - SUBJECT SELF-REPORT (official Nazaha declaration of financial interests, Law No. 2 of 2016; AI-extracted from the handwritten form; content is the subject's own claim, not verified fact)",
  );
  lines.push(
    `Declaration type: ${typeLabel}${x.declarationDate ? `; dated ${x.declarationDate}` : ""}${x.extractionWarnings.length ? `; ${x.extractionWarnings.length} extraction warning(s)` : ""}`,
  );
  if (x.readers?.adjudicated) {
    lines.push(
      "Reading quality: extracted independently by two AI models and adjudicated against the original handwriting.",
    );
  }
  const correctedRows = SECTION_KEYS.reduce(
    (acc, key) =>
      acc +
      (x[key] as DisclosureRowProvenance[]).filter((r) => r.corrected).length,
    0,
  );
  const correctedDeclarant = x.declarant?.correctedFields?.length ?? 0;
  if (correctedRows + correctedDeclarant > 0) {
    lines.push(
      `Investigator corrections: ${correctedRows + correctedDeclarant} item(s) manually verified/corrected after AI reading - treat corrected values as authoritative.`,
    );
  }
  if (x.declarant) {
    const d = x.declarant;
    const bits = [d.name, d.jobTitle, d.employer].filter(Boolean).join(" | ");
    lines.push(
      `Declarant: ${bits || "not read"}${d.monthlySalaryKwd != null ? ` | declared fixed monthly salary: ${d.monthlySalaryKwd.toLocaleString("en-US")} KWD` : ""}`,
    );
  }
  const none = (key: string): boolean => x.sectionsMarkedNone.includes(key);

  if (x.minorChildren.length)
    lines.push(
      `Minor children / persons under guardianship (${x.minorChildren.length}): ${x.minorChildren.map((c) => `${c.name}${c.dateOfBirth ? ` (DOB ${c.dateOfBirth})` : ""}${mark(c)}`).join("; ")}`,
    );
  else lines.push(`Minor children / dependents: ${none("minorChildren") ? "NONE DECLARED" : "none read"}`);

  if (x.realEstate.length) {
    lines.push(`Real estate (${x.realEstate.length}):`);
    for (const r of x.realEstate.slice(0, 10))
      lines.push(
        `- ${r.location}${r.propertyType ? `, ${r.propertyType}` : ""}${r.areaSqm != null ? `, ${r.areaSqm.toLocaleString("en-US")} sqm` : ""}${r.ownershipPct != null ? `, ${r.ownershipPct}% owned` : ""}${r.ownerName ? `, owner ${r.ownerName}` : ""}${r.notes ? ` (${r.notes})` : ""}${mark(r)}`,
      );
  } else lines.push(`Real estate: ${none("realEstate") ? "NONE DECLARED" : "none read"}`);

  if (x.usufructRights.length) {
    lines.push(`Usufruct rights (${x.usufructRights.length}):`);
    for (const r of x.usufructRights.slice(0, 10))
      lines.push(
        `- ${r.location}${r.usageType ? `, ${r.usageType}` : ""}${r.areaSqm != null ? `, ${r.areaSqm.toLocaleString("en-US")} sqm` : ""}${r.beneficiaryName ? `, beneficiary ${r.beneficiaryName}` : ""}${mark(r)}`,
      );
  } else lines.push(`Usufruct rights: ${none("usufructRights") ? "NONE DECLARED" : "none read"}`);

  if (x.securities.length) {
    lines.push(`Securities / company interests (${x.securities.length}):`);
    for (const s of x.securities.slice(0, 12))
      lines.push(
        `- ${s.instrumentType ?? "interest"} in ${s.company}${s.quantityOrPct ? `, ${s.quantityOrPct}` : ""}${s.companyCountry ? `, ${s.companyCountry}` : ""}${s.listed != null ? (s.listed ? ", listed" : ", unlisted") : ""}${s.ownerName ? `, owner ${s.ownerName}` : ""}${mark(s)}`,
      );
  } else lines.push(`Securities / company interests: ${none("securities") ? "NONE DECLARED" : "none read"}`);

  if (x.bankAccountsAndDeposits.length) {
    lines.push(
      `Bank accounts, deposits, and debts in the declarant's favor (${x.bankAccountsAndDeposits.length}):`,
    );
    for (const a of x.bankAccountsAndDeposits.slice(0, 12))
      lines.push(
        `- ${a.institution}${a.institutionCountry ? ` (${a.institutionCountry})` : ""}${a.kind ? `, ${a.kind}` : ""}, ${kwd(a.valueKwd)}${a.ownerName ? `, holder ${a.ownerName}` : ""}${mark(a)}`,
      );
  } else
    lines.push(
      `Bank accounts & deposits: ${none("bankAccountsAndDeposits") ? "NONE DECLARED" : "none read"}`,
    );

  if (x.debtsOwed.length) {
    lines.push(`Debts owed BY the declarant (${x.debtsOwed.length}):`);
    for (const d of x.debtsOwed.slice(0, 10))
      lines.push(
        `- creditor ${d.creditor}${d.creditorCountry ? ` (${d.creditorCountry})` : ""}, ${kwd(d.amountKwd)}${d.finalRepaymentDate ? `, final repayment ${d.finalRepaymentDate}` : ""}${d.debtorName ? `, debtor ${d.debtorName}` : ""}${mark(d)}`,
      );
  } else lines.push(`Debts owed by declarant: ${none("debtsOwed") ? "NONE DECLARED" : "none read"}`);

  if (x.valuableMovables.length) {
    lines.push(`High-value movables, threshold 3,000 KWD (${x.valuableMovables.length}):`);
    for (const m of x.valuableMovables.slice(0, 10))
      lines.push(
        `- ${m.description}${m.count != null ? ` x${m.count}` : ""}, total ${kwd(m.totalValueKwd)}${m.ownerName ? `, owner ${m.ownerName}` : ""}${mark(m)}`,
      );
  } else lines.push(`High-value movables: ${none("valuableMovables") ? "NONE DECLARED" : "none read"}`);

  if (x.generalNotes) lines.push(`Declarant notes: ${x.generalNotes}`);
  if (x.extractionWarnings.length)
    lines.push(`Extraction warnings: ${x.extractionWarnings.join("; ")}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// AI extraction from the PDF.

function extractJsonLoose(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

const EXTRACT_SYSTEM = `You extract structured data from a scanned Kuwaiti financial disclosure form (iqrar al-dhimma al-maliyya) issued by the Kuwait Anti-Corruption Authority (Nazaha) under Law No. 2 of 2016 and its Executive Regulations. The genuine filled-in content is HANDWRITTEN (typically blue ink) on a printed Arabic form.
Hard rules:
1. The form contains pre-printed ILLUSTRATIVE EXAMPLE rows: typed text on gray-shaded rows, outlined with red dashed borders and small red arrows labeled "mithal tawdihi" in Arabic. These are part of the blank form. NEVER extract them as entries. Extract ONLY genuine handwritten entries.
2. Keep Arabic text exactly as written - never translate or transliterate names of people, companies, banks, or places. Write numbers as plain digits.
3. If handwriting is ambiguous, give your best reading, set "uncertain": true on that item, and add a short note to extractionWarnings describing the doubt.
4. PROVENANCE: on every extracted row AND on the declarant object, set "page" to the 1-based page number of the PDF where that entry is handwritten. On every row also set "asWritten" to a short verbatim transcription (max ~25 words, original Arabic script, digits as inked) of the key handwritten cells you read for that row - the raw ink before any normalization.
5. If any individual declarant field is an uncertain reading, list that field's JSON key in declarant.uncertainFields (for example ["civilId","mobile"]).
6. A section whose "la yujad" (none) checkbox is ticked, or whose table has no handwritten rows at all, was declared as none: include that section's key in sectionsMarkedNone and return an empty array for it.
7. Never invent entries or fill gaps by assumption. Reply with ONLY the JSON object - no prose, no code fences.`;

const EXTRACT_USER = `Read this declaration page by page. The form's layout:
- An instructions page with a small table of declaration types (first declaration / update / final declaration) where one row is ticked by hand - that tick is the declarationType (iqrar awwal = first, tahdith = update, iqrar nihai = final).
- A declarant-data page (bayanat 'an al-muqirr): name, gender, nationality, civil ID number, passport number, country of residence, job/capacity, employing entity, date started, date left, work phone, home address, mobile, home phone, email, and total fixed monthly salary in KWD (ijmali al-ratib al-thabit shahriyyan).
- Section 1: minor children and persons under the declarant's guardianship/custody (name, date of birth, relation ticked as wali/wasi/qayyim, ID type civil card or passport, ID number, notes).
- Section 2: owned real estate (owner name, property location, area in square meters, ownership percentage, property type ticked sakani/istithmari/tijari/other, notes).
- Section 3: usufruct rights (beneficiary name, location, area, type such as agricultural land, chalet, industrial, livestock pens, production shares, notes).
- Section 4: securities and interests in companies (owner name, type such as shares/bonds/sukuk/fund units/company interest, count or percentage, company or issuer name, company country, listed vs unlisted tick, notes).
- Section 5: deposits, bank accounts, and debts in the declarant's FAVOR (owner name, bank or debtor name, country, type ticked dayn/wadi'a/hisab banki, value in KWD, notes).
- Section 6: debts ON the declarant (debtor name, creditor bank or entity, creditor country, debt value in KWD, final repayment date, notes).
- Section 7: high-value movables worth over 3,000 KWD (owner name, description such as vehicles/machinery/jewelry/watches, count, total value in KWD, notes).
- A final notes page (al-mulahazat) with free-text remarks, the declarant's name, the date written (tahriran fi), and signature.

Return ONLY this JSON object:
{
  "declarationType": "first|update|final|unknown",
  "declarationDate": "date from tahriran fi, as YYYY-MM-DD when unambiguous, else as written, else null",
  "pageCount": 13,
  "summaryEn": "2-3 English sentences summarizing who declared and the overall declared position",
  "generalNotes": "handwritten free text from the notes page, as written, else null",
  "declarant": {
    "name": "...", "nationality": "...", "residenceCountry": "...", "gender": "...",
    "civilId": "...", "passportNo": "...", "jobTitle": "...", "employer": "...",
    "jobStartDate": "...", "jobEndDate": null, "workPhone": "...", "homeAddress": "...",
    "mobile": "...", "homePhone": "...", "email": "...", "monthlySalaryKwd": 2100,
    "page": 2, "uncertainFields": []
  },
  "minorChildren": [{"name": "...", "dateOfBirth": "...", "relation": "...", "idType": "...", "idNumber": "...", "notes": null, "uncertain": false, "page": 4, "asWritten": "..."}],
  "realEstate": [{"ownerName": "...", "location": "...", "areaSqm": 500, "ownershipPct": 50, "propertyType": "...", "notes": null, "uncertain": false, "page": 5, "asWritten": "..."}],
  "usufructRights": [{"beneficiaryName": "...", "location": "...", "areaSqm": 2000, "usageType": "...", "notes": null, "uncertain": false, "page": 6, "asWritten": "..."}],
  "securities": [{"ownerName": "...", "instrumentType": "...", "company": "...", "companyCountry": "...", "quantityOrPct": "...", "listed": true, "notes": null, "uncertain": false, "page": 7, "asWritten": "..."}],
  "bankAccountsAndDeposits": [{"ownerName": "...", "institution": "...", "institutionCountry": "...", "kind": "...", "valueKwd": 10000, "notes": null, "uncertain": false, "page": 8, "asWritten": "..."}],
  "debtsOwed": [{"debtorName": "...", "creditor": "...", "creditorCountry": "...", "amountKwd": 15000, "finalRepaymentDate": "...", "notes": null, "uncertain": false, "page": 9, "asWritten": "..."}],
  "valuableMovables": [{"ownerName": "...", "description": "...", "count": 2, "totalValueKwd": 25000, "notes": null, "uncertain": false, "page": 10, "asWritten": "..."}],
  "sectionsMarkedNone": ["realEstate"],
  "extractionWarnings": ["..."]
}
Use null for any field that is blank or unreadable. All monetary values are Kuwaiti dinars (KWD).`;

async function callPrimaryExtraction(
  contentBase64: string,
  nudge?: string,
): Promise<string> {
  const resp = await anthropic.messages.create({
    model: PRIMARY_MODEL,
    max_tokens: 8192,
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: contentBase64,
            },
          },
          { type: "text", text: nudge ? `${EXTRACT_USER}\n\n${nudge}` : EXTRACT_USER },
        ],
      },
    ],
  });
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");
}

async function extractPrimary(contentBase64: string): Promise<DisclosureExtraction> {
  const first = await callPrimaryExtraction(contentBase64);
  try {
    return coerceDisclosureExtraction(extractJsonLoose(first));
  } catch {
    const retry = await callPrimaryExtraction(
      contentBase64,
      "Your previous reply was not valid JSON. Respond again with ONLY the JSON object - no prose, no code fences.",
    );
    return coerceDisclosureExtraction(extractJsonLoose(retry));
  }
}

/** Independent second reading of the same PDF by Gemini. */
async function callSecondaryExtraction(contentBase64: string): Promise<string> {
  const resp = await gemini.models.generateContent({
    model: SECONDARY_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: contentBase64,
            },
          },
          { text: `${EXTRACT_SYSTEM}\n\n${EXTRACT_USER}` },
        ],
      },
    ],
    config: {
      maxOutputTokens: 16384,
      responseMimeType: "application/json",
    },
  });
  return resp.text ?? "";
}

const ADJUDICATE_SYSTEM = `You are the senior reviewer reconciling two INDEPENDENT AI readings of the same scanned handwritten Kuwaiti financial disclosure form (iqrar al-dhimma al-maliyya). You have the original PDF plus Reader A's JSON and Reader B's JSON. Re-examine the actual handwriting yourself wherever they differ - the PDF is the only ground truth.
Rules:
1. Agreement: when both readers give the same value, keep it and clear "uncertain" unless the reading is still genuinely doubtful in the ink.
2. Disagreement: look at that spot in the PDF yourself, choose the more plausible reading, set "uncertain": true, and record each rejected plausible reading in that item's "alternates" array as a short note like "second reader saw: 70,100".
3. Declarant fields: same logic. List still-doubtful field keys in declarant.uncertainFields and put rejected readings in declarant.alternates prefixed by the field key, e.g. "mobile - second reader saw: 99887766".
4. Rows found by only one reader: include them ONLY if you can see a genuine handwritten row in the PDF at that spot. NEVER include the form's pre-printed example rows (typed text, gray shading, red dashed border, "mithal tawdihi").
5. Keep "page" and "asWritten" (verbatim Arabic, max ~25 words) accurate on every row - fix them if a reader got them wrong.
6. Keep Arabic text exactly as written - never translate or transliterate names. Numbers as plain digits.
7. Rebuild extractionWarnings: keep only doubts that remain after cross-checking; mention materially resolved conflicts in one short note each; no duplicates.
8. Output the SAME JSON schema as the readings (do not add new keys). Reply with ONLY the JSON object - no prose, no code fences.`;

async function callAdjudication(
  contentBase64: string,
  primary: DisclosureExtraction,
  secondary: DisclosureExtraction,
  nudge?: string,
): Promise<string> {
  const text = `Reader A (primary) JSON:
${JSON.stringify(primary)}

Reader B (secondary) JSON:
${JSON.stringify(secondary)}

Compare them against the attached PDF and produce the final adjudicated JSON now.${nudge ? `\n\n${nudge}` : ""}`;
  const resp = await anthropic.messages.create({
    model: PRIMARY_MODEL,
    max_tokens: 8192,
    system: ADJUDICATE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: contentBase64,
            },
          },
          { type: "text", text },
        ],
      },
    ],
  });
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");
}

async function adjudicate(
  contentBase64: string,
  primary: DisclosureExtraction,
  secondary: DisclosureExtraction,
): Promise<DisclosureExtraction> {
  const first = await callAdjudication(contentBase64, primary, secondary);
  try {
    return coerceDisclosureExtraction(extractJsonLoose(first));
  } catch {
    const retry = await callAdjudication(
      contentBase64,
      primary,
      secondary,
      "Your previous reply was not valid JSON. Respond again with ONLY the JSON object - no prose, no code fences.",
    );
    return coerceDisclosureExtraction(extractJsonLoose(retry));
  }
}

/** Minimal logger surface the pipeline needs (avoids pino generic friction). */
interface ExtractionLog {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

/**
 * Full dual-reader pipeline. Degrades gracefully: if the secondary reader or
 * the adjudication fails, the primary reading is returned with a warning.
 */
async function runDualExtraction(
  contentBase64: string,
  setPhase: (phase: string) => Promise<void>,
  log: ExtractionLog,
): Promise<DisclosureExtraction> {
  await setPhase("reading_primary");
  const primary = await extractPrimary(contentBase64);
  log.info(
    { accounts: primary.bankAccountsAndDeposits.length, warnings: primary.extractionWarnings.length },
    "primary reading complete",
  );

  let secondary: DisclosureExtraction | null = null;
  if (geminiConfigured()) {
    await setPhase("reading_secondary");
    try {
      secondary = coerceDisclosureExtraction(
        extractJsonLoose(await callSecondaryExtraction(contentBase64)),
      );
      log.info(
        { accounts: secondary.bankAccountsAndDeposits.length, warnings: secondary.extractionWarnings.length },
        "secondary reading complete",
      );
    } catch (err) {
      log.warn({ err }, "secondary reader failed; continuing with single reading");
    }
  } else {
    log.warn("secondary reader not configured; single-model reading");
  }

  if (!secondary) {
    return {
      ...primary,
      readers: { primary: PRIMARY_READER_LABEL, secondary: null, adjudicated: false },
      extractionWarnings: [
        ...primary.extractionWarnings,
        "Second AI reader was unavailable for this run; values reflect a single reading.",
      ].slice(0, 16),
    };
  }

  await setPhase("adjudicating");
  try {
    const final = await adjudicate(contentBase64, primary, secondary);
    return {
      ...final,
      readers: {
        primary: PRIMARY_READER_LABEL,
        secondary: SECONDARY_READER_LABEL,
        adjudicated: true,
      },
    };
  } catch (err) {
    log.warn({ err }, "adjudication failed; keeping primary reading");
    return {
      ...primary,
      readers: {
        primary: PRIMARY_READER_LABEL,
        secondary: SECONDARY_READER_LABEL,
        adjudicated: false,
      },
      extractionWarnings: [
        ...primary.extractionWarnings,
        "Cross-check between the two AI readers could not be completed; values reflect the primary reading.",
      ].slice(0, 16),
    };
  }
}

// ---------------------------------------------------------------------------
// Background extraction runner (mirrors the AI-run pattern: fire-and-forget,
// resumable after restarts, never leaves a row stuck in "processing").

// Maps disclosure id -> run token of the extraction currently in flight.
const activeExtractions = new Map<number, string>();

export async function runDisclosureExtraction(disclosureId: number): Promise<void> {
  const log = logger.child({ disclosureId, layer: "disclosure" });
  const [row] = await db
    .select()
    .from(disclosuresTable)
    .where(eq(disclosuresTable.id, disclosureId));
  if (!row || row.status !== "processing") return;
  // Every upload AND every reprocess rotates run_token, and every write
  // below is conditional on it (plus uploadedAt and status=processing), so
  // a stale in-flight extraction - including a zombie run that outlived
  // the watchdog - can never write over a newer run's row.
  const token = row.runToken ?? `legacy:${row.uploadedAt.getTime()}`;
  if (activeExtractions.get(disclosureId) === token) {
    log.warn("extraction already in progress for this upload; ignoring duplicate launch");
    return;
  }
  activeExtractions.set(disclosureId, token);
  const sameRun = () =>
    and(
      eq(disclosuresTable.id, disclosureId),
      eq(disclosuresTable.uploadedAt, row.uploadedAt),
      row.runToken === null
        ? isNull(disclosuresTable.runToken)
        : eq(disclosuresTable.runToken, row.runToken),
      eq(disclosuresTable.status, "processing"),
    );
  const setPhase = async (phase: string): Promise<void> => {
    await db.update(disclosuresTable).set({ phase }).where(sameRun());
    log.info({ phase }, "extraction phase");
  };
  try {
    if (!aiConfigured()) {
      await db
        .update(disclosuresTable)
        .set({ status: "failed", error: "AI integration not configured", phase: null })
        .where(sameRun());
      return;
    }
    log.info({ filename: row.filename, bytes: row.fileSizeBytes }, "extraction starting");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Disclosure extraction exceeded the ${Math.round(EXTRACTION_TIMEOUT_MS / 60000)}-minute watchdog limit`,
            ),
          ),
        EXTRACTION_TIMEOUT_MS,
      );
    });
    let extraction: DisclosureExtraction;
    try {
      extraction = await Promise.race([
        runDualExtraction(row.contentBase64, setPhase, log),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const updated = await db
      .update(disclosuresTable)
      .set({
        status: "ready",
        extraction: extraction as unknown,
        error: null,
        extractedAt: new Date(),
        phase: null,
        // A fresh AI reading supersedes any older manual corrections.
        correctedAt: null,
      })
      .where(sameRun())
      .returning({ id: disclosuresTable.id });
    if (updated.length === 0) {
      log.warn("disclosure was replaced mid-extraction; stale result discarded");
      return;
    }
    log.info(
      {
        accounts: extraction.bankAccountsAndDeposits.length,
        realEstate: extraction.realEstate.length,
        warnings: extraction.extractionWarnings.length,
        adjudicated: extraction.readers?.adjudicated ?? false,
      },
      "extraction complete",
    );
  } catch (err) {
    logger.error({ err, disclosureId }, "disclosure extraction failed");
    const updated = await db
      .update(disclosuresTable)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        phase: null,
      })
      .where(sameRun())
      .returning({ id: disclosuresTable.id })
      .catch(() => []);
    if (updated.length === 0) {
      log.warn("disclosure was replaced mid-extraction; stale failure discarded");
    }
  } finally {
    if (activeExtractions.get(disclosureId) === token) {
      activeExtractions.delete(disclosureId);
    }
  }
}

/** On startup, resume extractions that a restart interrupted. */
export async function reconcileInterruptedDisclosures(): Promise<void> {
  const stuck = await db
    .select({ id: disclosuresTable.id })
    .from(disclosuresTable)
    .where(eq(disclosuresTable.status, "processing"));
  if (stuck.length === 0) return;
  logger.info(
    { disclosureIds: stuck.map((r) => r.id) },
    "reconciling disclosure extractions interrupted by a restart",
  );
  void (async () => {
    for (const row of stuck) {
      await runDisclosureExtraction(row.id).catch((err) =>
        logger.error({ err, disclosureId: row.id }, "reconciled extraction failed"),
      );
    }
  })();
}
