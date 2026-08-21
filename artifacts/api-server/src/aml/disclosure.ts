/**
 * Financial disclosure (Nazaha "iqrar al-dhimma al-maliyya", Law No. 2 of
 * 2016) - storage helpers, AI extraction from the handwritten form, and
 * reconciliation-output coercion.
 *
 * Extraction sends the PDF itself to the model as a document content block
 * (no server-side rasterization). The model is explicitly instructed to skip
 * the form's pre-printed illustrative example rows and read only the
 * handwritten entries. All model output is untrusted and coerced before it
 * is persisted.
 */
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, disclosuresTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const MODEL = "claude-sonnet-4-6";
const EXTRACTION_TIMEOUT_MS = 5 * 60 * 1000;

const aiConfigured = (): boolean =>
  Boolean(
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  );

// ---------------------------------------------------------------------------
// Types (mirror the API spec's DisclosureExtraction shape)

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
}

export interface DisclosureChild {
  name: string;
  dateOfBirth: string | null;
  relation: string | null;
  idType: string | null;
  idNumber: string | null;
  notes: string | null;
  uncertain?: boolean;
}

export interface DisclosureRealEstate {
  ownerName: string | null;
  location: string;
  areaSqm: number | null;
  ownershipPct: number | null;
  propertyType: string | null;
  notes: string | null;
  uncertain?: boolean;
}

export interface DisclosureUsufruct {
  beneficiaryName: string | null;
  location: string;
  areaSqm: number | null;
  usageType: string | null;
  notes: string | null;
  uncertain?: boolean;
}

export interface DisclosureSecurity {
  ownerName: string | null;
  instrumentType: string | null;
  company: string;
  companyCountry: string | null;
  quantityOrPct: string | null;
  listed: boolean | null;
  notes: string | null;
  uncertain?: boolean;
}

export interface DisclosureAccount {
  ownerName: string | null;
  institution: string;
  institutionCountry: string | null;
  kind: string | null;
  valueKwd: number | null;
  notes: string | null;
  uncertain?: boolean;
}

export interface DisclosureDebt {
  debtorName: string | null;
  creditor: string;
  creditorCountry: string | null;
  amountKwd: number | null;
  finalRepaymentDate: string | null;
  notes: string | null;
  uncertain?: boolean;
}

export interface DisclosureMovable {
  ownerName: string | null;
  description: string;
  count: number | null;
  totalValueKwd: number | null;
  notes: string | null;
  uncertain?: boolean;
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

const SECTION_KEYS = [
  "minorChildren",
  "realEstate",
  "usufructRights",
  "securities",
  "bankAccountsAndDeposits",
  "debtsOwed",
  "valuableMovables",
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

const mark = (u?: boolean): string => (u ? " [uncertain reading]" : "");

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
      `Minor children / persons under guardianship (${x.minorChildren.length}): ${x.minorChildren.map((c) => `${c.name}${c.dateOfBirth ? ` (DOB ${c.dateOfBirth})` : ""}${mark(c.uncertain)}`).join("; ")}`,
    );
  else lines.push(`Minor children / dependents: ${none("minorChildren") ? "NONE DECLARED" : "none read"}`);

  if (x.realEstate.length) {
    lines.push(`Real estate (${x.realEstate.length}):`);
    for (const r of x.realEstate.slice(0, 10))
      lines.push(
        `- ${r.location}${r.propertyType ? `, ${r.propertyType}` : ""}${r.areaSqm != null ? `, ${r.areaSqm.toLocaleString("en-US")} sqm` : ""}${r.ownershipPct != null ? `, ${r.ownershipPct}% owned` : ""}${r.ownerName ? `, owner ${r.ownerName}` : ""}${r.notes ? ` (${r.notes})` : ""}${mark(r.uncertain)}`,
      );
  } else lines.push(`Real estate: ${none("realEstate") ? "NONE DECLARED" : "none read"}`);

  if (x.usufructRights.length) {
    lines.push(`Usufruct rights (${x.usufructRights.length}):`);
    for (const r of x.usufructRights.slice(0, 10))
      lines.push(
        `- ${r.location}${r.usageType ? `, ${r.usageType}` : ""}${r.areaSqm != null ? `, ${r.areaSqm.toLocaleString("en-US")} sqm` : ""}${r.beneficiaryName ? `, beneficiary ${r.beneficiaryName}` : ""}${mark(r.uncertain)}`,
      );
  } else lines.push(`Usufruct rights: ${none("usufructRights") ? "NONE DECLARED" : "none read"}`);

  if (x.securities.length) {
    lines.push(`Securities / company interests (${x.securities.length}):`);
    for (const s of x.securities.slice(0, 12))
      lines.push(
        `- ${s.instrumentType ?? "interest"} in ${s.company}${s.quantityOrPct ? `, ${s.quantityOrPct}` : ""}${s.companyCountry ? `, ${s.companyCountry}` : ""}${s.listed != null ? (s.listed ? ", listed" : ", unlisted") : ""}${s.ownerName ? `, owner ${s.ownerName}` : ""}${mark(s.uncertain)}`,
      );
  } else lines.push(`Securities / company interests: ${none("securities") ? "NONE DECLARED" : "none read"}`);

  if (x.bankAccountsAndDeposits.length) {
    lines.push(
      `Bank accounts, deposits, and debts in the declarant's favor (${x.bankAccountsAndDeposits.length}):`,
    );
    for (const a of x.bankAccountsAndDeposits.slice(0, 12))
      lines.push(
        `- ${a.institution}${a.institutionCountry ? ` (${a.institutionCountry})` : ""}${a.kind ? `, ${a.kind}` : ""}, ${kwd(a.valueKwd)}${a.ownerName ? `, holder ${a.ownerName}` : ""}${mark(a.uncertain)}`,
      );
  } else
    lines.push(
      `Bank accounts & deposits: ${none("bankAccountsAndDeposits") ? "NONE DECLARED" : "none read"}`,
    );

  if (x.debtsOwed.length) {
    lines.push(`Debts owed BY the declarant (${x.debtsOwed.length}):`);
    for (const d of x.debtsOwed.slice(0, 10))
      lines.push(
        `- creditor ${d.creditor}${d.creditorCountry ? ` (${d.creditorCountry})` : ""}, ${kwd(d.amountKwd)}${d.finalRepaymentDate ? `, final repayment ${d.finalRepaymentDate}` : ""}${d.debtorName ? `, debtor ${d.debtorName}` : ""}${mark(d.uncertain)}`,
      );
  } else lines.push(`Debts owed by declarant: ${none("debtsOwed") ? "NONE DECLARED" : "none read"}`);

  if (x.valuableMovables.length) {
    lines.push(`High-value movables, threshold 3,000 KWD (${x.valuableMovables.length}):`);
    for (const m of x.valuableMovables.slice(0, 10))
      lines.push(
        `- ${m.description}${m.count != null ? ` x${m.count}` : ""}, total ${kwd(m.totalValueKwd)}${m.ownerName ? `, owner ${m.ownerName}` : ""}${mark(m.uncertain)}`,
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
4. A section whose "la yujad" (none) checkbox is ticked, or whose table has no handwritten rows at all, was declared as none: include that section's key in sectionsMarkedNone and return an empty array for it.
5. Never invent entries or fill gaps by assumption. Reply with ONLY the JSON object - no prose, no code fences.`;

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
    "mobile": "...", "homePhone": "...", "email": "...", "monthlySalaryKwd": 2100
  },
  "minorChildren": [{"name": "...", "dateOfBirth": "...", "relation": "...", "idType": "...", "idNumber": "...", "notes": null, "uncertain": false}],
  "realEstate": [{"ownerName": "...", "location": "...", "areaSqm": 500, "ownershipPct": 50, "propertyType": "...", "notes": null, "uncertain": false}],
  "usufructRights": [{"beneficiaryName": "...", "location": "...", "areaSqm": 2000, "usageType": "...", "notes": null, "uncertain": false}],
  "securities": [{"ownerName": "...", "instrumentType": "...", "company": "...", "companyCountry": "...", "quantityOrPct": "...", "listed": true, "notes": null, "uncertain": false}],
  "bankAccountsAndDeposits": [{"ownerName": "...", "institution": "...", "institutionCountry": "...", "kind": "...", "valueKwd": 10000, "notes": null, "uncertain": false}],
  "debtsOwed": [{"debtorName": "...", "creditor": "...", "creditorCountry": "...", "amountKwd": 15000, "finalRepaymentDate": "...", "notes": null, "uncertain": false}],
  "valuableMovables": [{"ownerName": "...", "description": "...", "count": 2, "totalValueKwd": 25000, "notes": null, "uncertain": false}],
  "sectionsMarkedNone": ["realEstate"],
  "extractionWarnings": ["..."]
}
Use null for any field that is blank or unreadable. All monetary values are Kuwaiti dinars (KWD).`;

async function callExtraction(contentBase64: string, nudge?: string): Promise<string> {
  const resp = await anthropic.messages.create({
    model: MODEL,
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

export async function extractDisclosure(
  contentBase64: string,
): Promise<DisclosureExtraction> {
  const first = await callExtraction(contentBase64);
  try {
    return coerceDisclosureExtraction(extractJsonLoose(first));
  } catch {
    const retry = await callExtraction(
      contentBase64,
      "Your previous reply was not valid JSON. Respond again with ONLY the JSON object - no prose, no code fences.",
    );
    return coerceDisclosureExtraction(extractJsonLoose(retry));
  }
}

// ---------------------------------------------------------------------------
// Background extraction runner (mirrors the AI-run pattern: fire-and-forget,
// resumable after restarts, never leaves a row stuck in "processing").

// Maps disclosure id -> uploadedAt millis of the upload being extracted.
const activeExtractions = new Map<number, number>();

export async function runDisclosureExtraction(disclosureId: number): Promise<void> {
  const log = logger.child({ disclosureId, layer: "disclosure" });
  const [row] = await db
    .select()
    .from(disclosuresTable)
    .where(eq(disclosuresTable.id, disclosureId));
  if (!row || row.status !== "processing") return;
  // The upload timestamp identifies THIS upload. A replacement upload
  // rewrites the row with a fresh uploadedAt, and every write below is
  // conditional on it, so a stale in-flight extraction can never
  // overwrite the newer PDF's row.
  const token = row.uploadedAt.getTime();
  if (activeExtractions.get(disclosureId) === token) {
    log.warn("extraction already in progress for this upload; ignoring duplicate launch");
    return;
  }
  activeExtractions.set(disclosureId, token);
  const sameUpload = () =>
    and(
      eq(disclosuresTable.id, disclosureId),
      eq(disclosuresTable.uploadedAt, row.uploadedAt),
      eq(disclosuresTable.status, "processing"),
    );
  try {
    if (!aiConfigured()) {
      await db
        .update(disclosuresTable)
        .set({ status: "failed", error: "AI integration not configured" })
        .where(sameUpload());
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
      extraction = await Promise.race([extractDisclosure(row.contentBase64), timeout]);
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
      })
      .where(sameUpload())
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
      })
      .where(sameUpload())
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
