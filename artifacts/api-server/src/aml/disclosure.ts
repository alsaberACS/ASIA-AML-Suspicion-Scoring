/**
 * Financial disclosure (Nazaha "iqrar al-dhimma al-maliyya", Law No. 2 of
 * 2016) - storage helpers, AI extraction from the handwritten form, and
 * reconciliation-output coercion.
 *
 * Extraction is a dual-reader pipeline over the PDF itself (no server-side
 * rasterization):
 *   0. orientation       - scanners often store the landscape form sideways;
 *                          a 4-way probe finds the upright rotation and the
 *                          readers get a copy with /Rotate set so the Arabic
 *                          is read upright. The stored PDF is untouched.
 *   1. reading_primary   - Claude reads the whole PDF as a document block.
 *   2. reading_secondary - Gemini independently reads the same PDF.
 *   3. adjudicating      - Claude re-examines the PDF with both readings and
 *                          merges them: agreements settle, disagreements are
 *                          re-checked against the ink and the rejected
 *                          reading is preserved in `alternates`.
 * Every reading passes through a deterministic sanitizer (printed example
 * rows dropped, dates normalized, implausible identifiers flagged) before it
 * is used or stored. If the secondary reader or the adjudication fails, the
 * pipeline degrades to the primary reading and records a warning. Every row
 * carries provenance: the PDF page it came from and the verbatim handwriting
 * (`asWritten`). All model output is untrusted and coerced before it is
 * persisted. Investigator corrections (via PUT) set `corrected` flags and
 * never touch this pipeline.
 */
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ai as gemini } from "@workspace/integrations-gemini-ai";
import { db, disclosuresTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { projectDeclarationRecords } from "./declarationRecords";
import { normalizeFormDate, sanitizeExtraction } from "./disclosure-sanitize";
import {
  buildOrientationProbe,
  countPdfPages,
  extractPage,
  isPageRotation,
  rotatePdfPages,
  rotationFromProbeAnswer,
  type PageRotation,
} from "./pdf-orient";

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

/**
 * Page-region provenance for one extracted item, produced by the locator
 * pass. Coordinates are normalized 0-1 with a top-left origin, relative to
 * the page box. key is "declarant", "declarant.<field>", or
 * "<sectionKey>.<rowIndex>".
 */
export interface DisclosureSourceLocation {
  key: string;
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  // undefined = locator pass never ran; [] = ran and mapped nothing.
  locations?: DisclosureSourceLocation[];
  /**
   * Clockwise degrees the stored pages must be turned to read upright, as
   * detected before reading. Absent when detection never ran or failed.
   */
  pageRotation?: PageRotation;
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

const LOCATION_KEY_RE =
  /^(declarant(\.[a-zA-Z]{1,40})?|(minorChildren|realEstate|usufructRights|securities|bankAccountsAndDeposits|debtsOwed|valuableMovables)\.\d{1,3})$/;

/**
 * Locator output is optional region provenance. The undefined-vs-empty
 * distinction must survive coercion: investigator PUTs round-trip the whole
 * extraction and must neither fake nor erase a locator attempt.
 */
const locationsOf = (v: unknown): DisclosureSourceLocation[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out: DisclosureSourceLocation[] = [];
  const seen = new Set<string>();
  for (const item of v.slice(0, 300)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    if (!LOCATION_KEY_RE.test(key) || seen.has(key)) continue;
    const page = num(o.page, 1, 500);
    const x0 = num(o.x0, 0, 1);
    const y0 = num(o.y0, 0, 1);
    const x1 = num(o.x1, 0, 1);
    const y1 = num(o.y1, 0, 1);
    if (page == null || x0 == null || y0 == null || x1 == null || y1 == null) continue;
    if (x1 <= x0 || y1 <= y0) continue;
    seen.add(key);
    out.push({ key, page: Math.round(page), x0, y0, x1, y1 });
  }
  return out.slice(0, 250);
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

/**
 * True when two extractions have identical row counts in every table
 * section. Location keys index into section arrays, so a stored mapping
 * stays aligned only while the structure is unchanged.
 */
export function sectionRowCountsMatch(
  a: DisclosureExtraction,
  b: DisclosureExtraction,
): boolean {
  return SECTION_KEYS.every(
    (k) =>
      ((a[k] as unknown[] | undefined)?.length ?? 0) ===
      ((b[k] as unknown[] | undefined)?.length ?? 0),
  );
}

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

  const locations = locationsOf(o.locations);

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
    ...(locations ? { locations } : {}),
    ...(isPageRotation(o.pageRotation) ? { pageRotation: o.pageRotation } : {}),
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

/**
 * What both readers and the adjudicator must know about the printed form.
 * Written from the actual Nazaha form: every table opens with typed example
 * rows, every section has a "none" tick box, continuation pages repeat the
 * tables, and the handwriting conventions (ditto marks, scrawled owner
 * names, day-first dates) are what trip a naive reading.
 */
const FORM_KNOWLEDGE = `HOW THIS FORM IS BUILT - read before transcribing anything:
A. PRINTED EXAMPLE ROWS. Every table begins with one or two pre-printed example rows: TYPED (not handwritten) text on grey-shaded rows, outlined by a red dashed border, with a red arrow labelled "مثال توضيحي". They always use the fictitious family "أحمد محمد فهد" (also خالد أحمد محمد فهد and بدر أحمد محمد فهد), placeholders such as 20xx or xxxx, and these sample assets: حطين - الكويت 500 م 50%; لندن - بريطانيا 200 م 25%; الجليعة - الكويت 2000 م; الفحيحيل - الكويت 500 م; شركة زين 2000 أسهم; شركة أولاد محمد فهد 50%; البنك الوطني 10,000 and 15,000; بنك بوبيان 50,000; بنك الائتمان 60,000; سيارات 2 25,000; ساعات 5 12,000; and on the notes page a sample sentence about a توكيل from السيد عبدالعزيز أحمد عبدالله and an income from a property in لندن. These rows are part of the BLANK form and must NEVER be output. A genuine entry is handwriting (pen strokes, usually blue ink) in a white row. Before you output any row ask: is this typed or handwritten? If it is typed, or it matches an example above, it is not an entry.
B. THE "لا يوجد" (NONE) BOX. Beside each table title is a small box labelled لا يوجد. A handwritten tick or cross in that box on the section's FIRST page means the section is declared empty - even though the typed example rows are still visible below it. Pages whose title ends with "(يتبع)" are CONTINUATION pages of the previous section; a tick in the box there only means "no further rows" and neither adds nor removes anything. A section is none when its first-page box is ticked or when none of its pages has a handwritten row.
C. CHECKBOX COLUMNS (ولي / وصي / قيم; بطاقة مدنية / جواز سفر; سكني / استثماري / تجاري / أخرى; شاليه / صناعي / زراعي / حظائر ثروة حيوانية / أخرى; دين / وديعة / حساب بنكي; مدرجة / غير مدرجة). In a handwritten row exactly one option carries a tick or cross. Output only that option's printed label. Never output two options joined by "/"; if you genuinely cannot see which box is marked, output null and flag the row uncertain.
D. DITTO MARKS. A short wavy stroke, "〃", "~", "=" or a dash written under a cell means "same as the cell above". Copy the value from the row above and note the mark in asWritten.
E. NAME CELLS (المالك, المنتفع, المدين, الإسم). The declarant normally writes their OWN name in every owner cell, usually as a quick compressed scrawl of the full name written clearly on the declarant page. When the strokes are that same name, output the declarant's full name exactly as read on the declarant page. If a different person is named (for example a child from section 1), transcribe that name. Name cells never contain digits or Latin letters - if your reading has any, the reading is wrong: re-read it or flag it uncertain.
F. DATES. Handwritten dates are DAY / MONTH / YEAR: "10|05|2018" is 10 May 2018, "1/1/2010" is 1 January 2010, "10/5/2012" is 10 May 2012. When a 4-digit year is written first the order is YEAR / MONTH / DAY: "2026/10/1" is 1 October 2026. Never read a date month-first. Output ISO YYYY-MM-DD when every part is legible, otherwise the digits exactly as written. The declarationDate is ONLY the date written beside "تحريراً في" on the final notes page - never substitute the job start date or any other date.
G. NUMBERS. Transcribe digit by digit and convert Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) to Western digits. Commas, Arabic commas and dots inside amounts are thousands separators ("70,112" is 70112; "50,000" is 50000). A Kuwaiti civil ID is exactly 12 digits and phone numbers are 8 digits: if your reading has a different length, re-check the ink and flag the field uncertain rather than padding or guessing.
H. FIDELITY. Keep Arabic exactly as written - never translate, transliterate, or "correct" a word into a more common one (if the ink says الوفرة do not write الروضة; if it says مدير ادارة do not write مدير إداري). Read every page in its upright orientation; if a page still appears rotated, turn it mentally so the Arabic reads right-to-left.
I. PROPER NOUNS MUST BE REAL. Institutions, companies and places written on this form are real Kuwaiti names, so a reading that is not a real word or name (for example تلصورس) is always a misread - look at the strokes again. Banks written here are almost always one of: بنك بوبيان, بيت التمويل الكويتي (often written بيت التمويل or بيتك), بنك الكويت الوطني (البنك الوطني), بنك الخليج, البنك التجاري الكويتي, بنك برقان, البنك الأهلي الكويتي, البنك الأهلي المتحد, بنك الكويت الدولي, بنك وربة, بنك الائتمان الكويتي, البنك الصناعي. Places are Kuwaiti areas (الوفرة, الجابرية, حطين, الفحيحيل, الجليعة, كبد, العبدلي ...) or foreign cities. When the strokes fit one such real name, output that name and flag the cell uncertain if the fit is not certain; when they fit none, output null with the uncertain flag. Rule H still applies: choose among real names that match the ink, never the most common name.`;

const EXTRACT_SYSTEM = `You extract structured data from a scanned Kuwaiti financial disclosure form (إقرار الذمة المالية) issued by the Kuwait Anti-Corruption Authority (Nazaha) under Law No. 2 of 2016 and its Executive Regulations. The genuine filled-in content is HANDWRITTEN (typically blue ink) on a printed Arabic form. Your output feeds an official case file: a faithful transcription of the ink matters far more than completeness.

${FORM_KNOWLEDGE}

HARD RULES:
1. Extract ONLY genuine handwritten entries. Never invent entries or fill gaps by assumption; leave blank or unreadable cells null.
2. If handwriting is ambiguous, give your best reading, set "uncertain": true on that item, and add a short note to extractionWarnings describing the doubt.
3. PROVENANCE: on every extracted row AND on the declarant object, set "page" to the 1-based page number of the PDF where that entry is handwritten. On every row also set "asWritten" to a short verbatim transcription (max ~25 words, original Arabic script, digits as inked) of the key handwritten cells you read for that row - the raw ink before any normalization.
4. If any individual declarant field is an uncertain reading, list that field's JSON key in declarant.uncertainFields (for example ["civilId","mobile"]).
5. A section declared as none (rule B): include its key in sectionsMarkedNone and return an empty array for it.
6. Write numbers as plain digits. Reply with ONLY the JSON object - no prose, no code fences.`;

const EXTRACT_USER = `Read this declaration page by page. The form's layout (section pages may be followed by "(يتبع)" continuation pages that repeat the same table):
- An instructions page with a small table of declaration types (الإقرار الأول / تحديث / الإقرار النهائي) where one row is ticked by hand - that tick is the declarationType (first / update / final).
- A declarant-data page (بيانات عن المقر): name, gender, nationality, civil ID number, passport number, country of residence, job/capacity, employing entity, date started, date left, work phone, home address, mobile, home phone, email, and total fixed monthly salary in KWD (إجمالي الراتب الثابت شهرياً).
- Section 1: minor children and persons under the declarant's guardianship/custody (name, date of birth, relation ticked ولي / وصي / قيم, ID type ticked بطاقة مدنية / جواز سفر, ID number, notes).
- Section 2: owned real estate (owner name, property location, area in square meters, ownership percentage, property type ticked سكني / استثماري / تجاري / أخرى, notes).
- Section 3: usufruct rights (beneficiary name, location, area, type ticked شاليه / صناعي / زراعي / حظائر ثروة حيوانية / أخرى, notes).
- Section 4: securities and interests in companies (owner name, type such as أسهم / سندات / صكوك / وحدات صناديق / حصة في شركة, count or percentage, company or issuer name, company country, listed ticked مدرجة / غير مدرجة, notes).
- Section 5: deposits, bank accounts, and debts in the declarant's FAVOR (owner name, bank or debtor name, country, type ticked دين / وديعة / حساب بنكي, value in KWD, notes).
- Section 6: debts ON the declarant (debtor name, creditor bank or entity, creditor country, debt value in KWD, final repayment date, notes).
- Section 7: high-value movables worth over 3,000 KWD (owner name, description such as سيارات / آلات / مجوهرات / ساعات, count, total value in KWD, notes).
- A final notes page (الملاحظات) with free-text remarks, the declarant's name, the date written (تحريراً في), and signature.

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

const ADJUDICATE_SYSTEM = `You are the senior reviewer reconciling two INDEPENDENT AI readings of the same scanned handwritten Kuwaiti financial disclosure form (إقرار الذمة المالية). You have the original PDF plus Reader A's JSON and Reader B's JSON. The PDF is the only ground truth: re-examine the actual handwriting yourself wherever the readers differ, and spot-check what they agree on - two readers can share the same mistake.

${FORM_KNOWLEDGE}

RULES:
1. Agreement: when both readers give the same value, keep it and clear "uncertain" unless the reading is still genuinely doubtful in the ink.
2. Disagreement: look at that spot in the PDF yourself and output the reading that matches the strokes. You are the final reader: if neither reader's value matches the ink, output your own reading rather than the "more plausible" of two wrong ones. Set "uncertain": true when doubt remains and record each rejected reading in that item's "alternates" array as a short note like "second reader saw: 70,100".
3. Declarant fields: same logic. List still-doubtful field keys in declarant.uncertainFields and put rejected readings in declarant.alternates prefixed by the field key, e.g. "mobile - second reader saw: 99887766".
4. Rows found by only one reader: include them ONLY if you can see a genuine handwritten row in the PDF at that spot. Drop any row that is a printed example row (rule A) and honour the لا يوجد boxes (rule B): a section whose first-page box is ticked goes in sectionsMarkedNone with an empty array, whatever either reader returned.
5. Checkbox values must be a single printed option (rule C); if a reader joined two options with "/", resolve it from the ink.
6. Keep "page" and "asWritten" (verbatim Arabic, max ~25 words) accurate on every row - fix them if a reader got them wrong.
7. Keep Arabic text exactly as written - never translate, transliterate or normalize names. Numbers as plain digits; dates per rule F.
8. Rebuild extractionWarnings: keep only doubts that remain after cross-checking; mention materially resolved conflicts in one short note each; no duplicates.
9. Output the SAME JSON schema as the readings (do not add new keys). Reply with ONLY the JSON object - no prose, no code fences.`;

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

// ---------------------------------------------------------------------------
// Source locating - maps every extracted item back to the region of the page
// where its handwriting sits, so the workbench can point at the ink. Runs as
// a best-effort pass after extraction; failure degrades to page-level
// provenance and never fails the reading.

const LOCATE_TIMEOUT_MS = 3 * 60 * 1000;

const LOCATE_SYSTEM = `You map already-extracted data items back to their physical location on a scanned Kuwaiti financial disclosure form (iqrar al-dhimma al-maliyya). The form is printed Arabic (right-to-left) with HANDWRITTEN entries, typically in blue ink.
CRITICAL - coordinate frame: box_2d is [ymin, xmin, ymax, xmax], integers 0-1000, normalized to the page EXACTLY AS STORED in the PDF (raw pixel axes, top-left origin). These scans are often stored SIDEWAYS (content rotated 90 degrees). Do NOT mentally de-rotate: if writing runs vertically on the stored page, its box must be tall and narrow (large y-span, small x-span). First determine each page's content rotation, then place every box in the raw stored axes.
You are given the PDF and an inventory of items. Each inventory line is: key | main value | ink transcription (if any) | page hint.
For every item you can confidently place, output its page and a bounding box around the HANDWRITTEN content:
- Row items (like realEstate.0): box that single row's band of written cells. On an upright page a row band is wide and short; on a sideways page the same row appears as a TALL NARROW strip - box the strip as it appears in the raw axes.
- Declarant field items (like declarant.civilId): box the handwritten answer area next to that field's printed label, as it appears in the raw axes.
- The whole-block item "declarant": box the entire declarant-data table region on its page.
Rules:
1. Page hints come from an earlier reading and are usually right - verify against the ink; correct the page if the hint is wrong.
2. SKIP any item you cannot confidently locate. A missing item is better than a wrong box.
3. NEVER box the form's pre-printed illustrative example row/column (typed text, gray shading, red dashed border, "mithal tawdihi").
4. Distinct rows get distinct boxes; never give two rows the same coordinates.
5. page_rotations is REQUIRED: for every page number that appears in locations, report how many degrees CLOCKWISE the stored page must be turned so its printed text reads normally (0, 90, 180 or 270).
Reply with ONLY this JSON object - no prose, no code fences:
{"page_rotations":{"4":90},"locations":[{"key":"realEstate.0","page":4,"box_2d":[312,55,368,940]},{"key":"realEstate.1","page":4,"box_2d":[55,372,940,428]}]}`;

function buildLocateInventory(x: DisclosureExtraction): string {
  const lines: string[] = [];
  const hint = (p?: number | null): string => (p ? ` | page hint ${p}` : "");
  if (x.declarant) {
    lines.push(`declarant | whole declarant-data block (bayanat 'an al-muqirr)${hint(x.declarant.page)}`);
    for (const key of DECLARANT_FIELD_KEYS) {
      const v = (x.declarant as unknown as Record<string, unknown>)[key];
      if (v == null || v === "") continue;
      lines.push(`declarant.${key} | ${String(v).slice(0, 80)}${hint(x.declarant.page)}`);
    }
  }
  for (const section of SECTION_KEYS) {
    (x[section] as DisclosureRowProvenance[]).forEach((r, i) => {
      const rec = r as unknown as Record<string, unknown>;
      const main = [rec.name, rec.location, rec.company, rec.institution, rec.creditor, rec.description]
        .find((v): v is string => typeof v === "string" && v.length > 0);
      lines.push(
        `${section}.${i} | ${main ? main.slice(0, 60) : "row"}${r.asWritten ? ` | ink: ${r.asWritten.slice(0, 80)}` : ""}${hint(r.page)}`,
      );
    });
  }
  return lines.join("\n");
}

/**
 * Parse the first balanced JSON object in a string. Locator responses
 * sometimes carry trailing junk after the object (a duplicate copy or
 * stray text), which breaks first-brace-to-last-brace extraction.
 */
function parseFirstJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in locator response");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
      }
    }
  }
  throw new Error("unterminated JSON object in locator response");
}

/**
 * Last-resort recovery for a truncated locator response: pull out every
 * complete flat {"key":...,"box_2d":[...]} object and drop the cut-off
 * tail. A partial mapping still beats none for an approximate overlay.
 */
function salvageLocationObjects(text: string): Record<string, unknown> {
  const fragments = text.match(/\{[^{}]*"key"[^{}]*"box_2d"[^{}]*\}/g) ?? [];
  const locations: unknown[] = [];
  for (const frag of fragments) {
    try {
      locations.push(JSON.parse(frag));
    } catch {
      // Skip the malformed fragment; neighbors are still usable.
    }
  }
  if (locations.length === 0) {
    throw new Error("no salvageable location objects in locator response");
  }
  return { locations };
}

/** One Gemini pass; throws on model/parse failure so callers can degrade. */
export async function locateDisclosureSources(
  contentBase64: string,
  extraction: DisclosureExtraction,
  log: ExtractionLog,
): Promise<DisclosureSourceLocation[]> {
  const inventory = buildLocateInventory(extraction);
  if (!inventory) return [];
  const call = async (): Promise<DisclosureSourceLocation[]> => {
    const resp = await gemini.models.generateContent({
      model: SECONDARY_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: contentBase64 } },
            { text: `${LOCATE_SYSTEM}\n\nItems to locate:\n${inventory}` },
          ],
        },
      ],
      config: {
        // Generous cap: thinking tokens share this budget, and running
        // out mid-array is the locator's most common failure mode.
        maxOutputTokens: 32768,
        responseMimeType: "application/json",
      },
    });
    const raw = resp.text ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonLoose(raw) as Record<string, unknown>;
    } catch {
      try {
        parsed = parseFirstJsonObject(raw);
      } catch {
        parsed = salvageLocationObjects(raw);
      }
    }
    // Convert Gemini's box_2d [ymin,xmin,ymax,xmax] 0-1000 into the stored
    // normalized shape, then reuse the shared coercer for validation.
    const candidates = arr(parsed.locations)
      .slice(0, 300)
      .map((item) => {
        const o = (item ?? {}) as Record<string, unknown>;
        const box = arr(o.box_2d).map((n) => Number(n));
        if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return null;
        const [ymin, xmin, ymax, xmax] = box;
        return {
          key: o.key,
          page: o.page,
          x0: xmin / 1000,
          y0: ymin / 1000,
          x1: xmax / 1000,
          y1: ymax / 1000,
        };
      })
      .filter((c) => c !== null);
    // Deterministic repair for the model's most common geometry slip: on
    // a sideways-stored page (content rotated 90/270), a table row is a
    // tall narrow strip, but the model sometimes emits the row box with
    // its axes transposed (reading-frame order). Its own per-page
    // rotation report is far more reliable than its coordinate-frame
    // discipline, so trust the report and swap contradicting row boxes.
    const rotations = new Map<number, number>();
    if (parsed.page_rotations && typeof parsed.page_rotations === "object") {
      for (const [pg, deg] of Object.entries(parsed.page_rotations as Record<string, unknown>)) {
        const p = Number(pg);
        const d = Number(deg);
        if (Number.isInteger(p) && (d === 0 || d === 90 || d === 180 || d === 270)) {
          rotations.set(p, d);
        }
      }
    }
    for (const c of candidates) {
      if (typeof c.key !== "string" || !/\.\d+$/.test(c.key)) continue;
      const rot = rotations.get(Number(c.page));
      if (rot !== 90 && rot !== 270) continue;
      if (c.x1 - c.x0 > c.y1 - c.y0) {
        const { x0, y0, x1, y1 } = c;
        c.x0 = y0;
        c.x1 = y1;
        c.y0 = x0;
        c.y1 = x1;
      }
    }
    return locationsOf(candidates) ?? [];
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Source locating exceeded the 3-minute watchdog limit")),
      LOCATE_TIMEOUT_MS,
    );
  });
  const attempt = async (): Promise<DisclosureSourceLocation[]> => {
    try {
      return await call();
    } catch (err) {
      // Locator flakes are stochastic (truncated or junk-suffixed JSON);
      // a second pass usually lands within seconds.
      log.warn({ err }, "locator attempt failed; retrying once");
      return call();
    }
  };
  try {
    const locations = await Promise.race([attempt(), timeout]);
    log.info({ located: locations.length }, "source locating complete");
    return locations;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Page orientation. Scanners store the landscape form as portrait pages with
// the content on its side, and sideways Arabic handwriting reads badly.
// Asking a model for the angle of a single page is unreliable (it mentally
// normalizes the page and answers "0"); asking it to pick the upright one of
// four rotated copies is consistent, so that is the probe.

const ORIENTATION_QUESTION = `The attached PDF has 4 pages: the same scanned page of an Arabic government form shown in four different orientations (each page is turned a further 90 degrees). Exactly one page is upright: its printed Arabic text lines run horizontally and read right-to-left, the letters are not upside down or sideways, and the header with the logo is at the top of the page. Which page is upright? Answer with only the page number: 1, 2, 3 or 4.`;

async function detectUprightRotation(
  contentBase64: string,
  log: ExtractionLog,
): Promise<PageRotation | null> {
  const probe = await buildOrientationProbe(contentBase64);
  const resp = await anthropic.messages.create({
    model: PRIMARY_MODEL,
    max_tokens: 10,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: probe },
          },
          { type: "text", text: ORIENTATION_QUESTION },
        ],
      },
    ],
  });
  const answer = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  const rotation = rotationFromProbeAnswer(answer);
  if (rotation === null) log.warn({ answer }, "orientation probe gave no usable answer");
  return rotation;
}

/**
 * The PDF the readers should see: a copy rotated upright when the probe
 * found the scan sideways, otherwise the original. Never throws - a failed
 * probe just means the readers get the stored pages as they are.
 */
async function prepareReadablePdf(
  contentBase64: string,
  log: ExtractionLog,
): Promise<{ readable: string; rotation: PageRotation | null }> {
  try {
    const rotation = await detectUprightRotation(contentBase64, log);
    if (rotation === null) return { readable: contentBase64, rotation: null };
    const readable = await rotatePdfPages(contentBase64, rotation);
    log.info({ rotation }, "page orientation detected");
    return { readable, rotation };
  } catch (err) {
    log.warn({ err }, "orientation step failed; reading pages as stored");
    return { readable: contentBase64, rotation: null };
  }
}

// ---------------------------------------------------------------------------
// Signature-line date. Whole-form readers keep substituting the job start
// date (which they met on page 2) for the date written beside "تحريراً في"
// on the last page, and the adjudicator sometimes sides with them. A model
// that only sees the last page cannot make that substitution, so the date
// is re-read there and overrides the full-form value.

const SIGNATURE_DATE_QUESTION = `This is the last page (جدول الملاحظات) of a scanned Kuwaiti financial disclosure form. Near the bottom are three handwritten lines: الإسم (name), تحريراً في (the date the declaration was written) and توقيع المقر (signature). Read ONLY the handwritten date beside تحريراً في, digit by digit, exactly as inked. Handwritten dates on this form are DAY | MONTH | YEAR. Report it with the tool.`;

// A forced tool call is the only way to get a bare answer: this model
// rejects assistant prefill, and "JSON only" instructions still yield
// paragraphs of digit-by-digit deliberation that overflow the token budget.
const SIGNATURE_DATE_TOOL = {
  name: "report_signature_date",
  description: "Report the handwritten date beside تحريراً في on the last page of the form.",
  input_schema: {
    type: "object" as const,
    properties: {
      asWritten: {
        type: ["string", "null"],
        description: "The digits exactly as inked, e.g. 10|07|2018; null when nothing is written there.",
      },
      iso: {
        type: ["string", "null"],
        description: "The same date as YYYY-MM-DD (day-first reading); null when any part is unreadable.",
      },
    },
    required: ["asWritten", "iso"],
  },
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function readSignatureDate(
  readableBase64: string,
): Promise<{ asWritten: string | null; iso: string | null }> {
  const lastPage = await extractPage(readableBase64, -1);
  const resp = await anthropic.messages.create({
    model: PRIMARY_MODEL,
    max_tokens: 200,
    tools: [SIGNATURE_DATE_TOOL],
    tool_choice: { type: "tool", name: SIGNATURE_DATE_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: lastPage },
          },
          { type: "text", text: SIGNATURE_DATE_QUESTION },
        ],
      },
    ],
  });
  const call = resp.content.find((b) => b.type === "tool_use") as
    | { type: "tool_use"; input: unknown }
    | undefined;
  const parsed = (call?.input ?? {}) as { asWritten?: unknown; iso?: unknown };
  const asWritten = typeof parsed.asWritten === "string" ? parsed.asWritten.trim() : null;
  const isoRaw = typeof parsed.iso === "string" ? parsed.iso.trim() : null;
  const iso = normalizeFormDate(isoRaw ?? asWritten);
  return { asWritten, iso: iso && ISO_DATE_RE.test(iso) ? iso : null };
}

/** Overrides declarationDate with the signature-line reading. Never throws. */
async function applySignatureDate(
  readableBase64: string,
  extraction: DisclosureExtraction,
  log: ExtractionLog,
): Promise<void> {
  try {
    const { asWritten, iso } = await readSignatureDate(readableBase64);
    if (!iso) {
      log.info({ asWritten }, "signature-line date not legible; keeping full-form reading");
      return;
    }
    if (extraction.declarationDate === iso) return;
    const was = extraction.declarationDate;
    log.info({ was, now: iso, asWritten }, "declaration date corrected from signature line");
    extraction.declarationDate = iso;
    extraction.extractionWarnings = [
      ...extraction.extractionWarnings.filter((w) => !/declaration ?date/i.test(w)),
      `Declaration date taken from the signature line (تحريراً في) on the last page: "${asWritten ?? iso}" = ${iso}; the full-form reading had ${was ?? "none"}.`,
    ].slice(0, 16);
  } catch (err) {
    log.warn({ err }, "signature-line date re-read failed; keeping full-form reading");
  }
}

/** Runs the deterministic clean-up and logs what it changed. */
function sanitized(
  extraction: DisclosureExtraction,
  stage: string,
  log: ExtractionLog,
): DisclosureExtraction {
  const { extraction: clean, notes } = sanitizeExtraction(extraction);
  if (notes.length) log.info({ stage, notes }, "reading sanitized");
  return clean;
}

/**
 * Full dual-reader pipeline. Degrades gracefully: if the secondary reader or
 * the adjudication fails, the primary reading is returned with a warning.
 * `contentBase64` must be the upright (readable) copy of the PDF.
 */
async function runDualExtraction(
  contentBase64: string,
  setPhase: (phase: string) => Promise<void>,
  log: ExtractionLog,
): Promise<DisclosureExtraction> {
  await setPhase("reading_primary");
  const primary = sanitized(await extractPrimary(contentBase64), "primary", log);
  log.info(
    { accounts: primary.bankAccountsAndDeposits.length, warnings: primary.extractionWarnings.length },
    "primary reading complete",
  );

  let secondary: DisclosureExtraction | null = null;
  if (geminiConfigured()) {
    await setPhase("reading_secondary");
    try {
      secondary = sanitized(
        coerceDisclosureExtraction(extractJsonLoose(await callSecondaryExtraction(contentBase64))),
        "secondary",
        log,
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
    const final = sanitized(await adjudicate(contentBase64, primary, secondary), "adjudicated", log);
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
        (async () => {
          // Orientation is part of the first reading phase from the UI's
          // point of view; it takes a few seconds.
          await setPhase("reading_primary");
          const { readable, rotation } = await prepareReadablePdf(row.contentBase64, log);
          const result = await runDualExtraction(readable, setPhase, log);
          await applySignatureDate(readable, result, log);
          if (rotation !== null) result.pageRotation = rotation;
          const pages = await countPdfPages(row.contentBase64);
          if (pages !== null) result.pageCount = pages;
          return result;
        })(),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    // Best-effort locator pass: map items to page regions so the workbench
    // can point at the ink. Never fails the reading.
    if (geminiConfigured()) {
      try {
        await setPhase("locating");
        extraction.locations = await locateDisclosureSources(
          row.contentBase64,
          extraction,
          log,
        );
      } catch (err) {
        log.warn({ err }, "source locating failed; keeping page-level provenance");
      }
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
    // Mirror the reading into the queryable declarant / item tables. A
    // failure here must not fail the reading - the JSON on the row stays
    // authoritative and the next save re-projects it.
    try {
      await projectDeclarationRecords({
        caseId: row.caseId,
        disclosureId,
        extraction,
        source: "ai",
      });
    } catch (err) {
      log.warn({ err }, "structured declaration records could not be written");
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
