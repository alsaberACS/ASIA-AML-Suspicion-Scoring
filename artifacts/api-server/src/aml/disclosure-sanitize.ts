import type {
  DisclosureAccount,
  DisclosureChild,
  DisclosureDebt,
  DisclosureExtraction,
  DisclosureMovable,
  DisclosureRealEstate,
  DisclosureSecurity,
  DisclosureUsufruct,
} from "./disclosure";

/**
 * Deterministic clean-up of an AI reading of the Nazaha declaration form.
 *
 * The models are told how the form works, but a prompt is not a guarantee.
 * This pass enforces the rules that can be checked mechanically:
 *   - the form's pre-printed illustrative rows (مثال توضيحي) are never
 *     declared assets, so rows that match them are dropped;
 *   - handwritten dates on the form are day/month/year and are normalized
 *     to ISO when unambiguous;
 *   - identifiers, phone numbers and name cells that cannot be right as
 *     read are flagged uncertain so the reviewer's eye lands on them.
 * Nothing here invents data: values are only dropped (example rows),
 * normalized (digits, dates) or flagged.
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Arabic-Indic and Persian digits to Western digits. */
export function toWesternDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const a = ARABIC_INDIC.indexOf(ch);
    const b = EXTENDED_ARABIC_INDIC.indexOf(ch);
    out += a >= 0 ? String(a) : b >= 0 ? String(b) : ch;
  }
  return out;
}

/** Loose Arabic key for matching: digits unified, diacritics/tatweel and spaces removed, letter variants folded. */
export function arabicKey(s: string | null | undefined): string {
  if (!s) return "";
  return toWesternDigits(s)
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s\-_,،.:;/()]+/g, "")
    .toLowerCase();
}

const EXAMPLE_FAMILY_KEY = arabicKey("أحمد محمد فهد");
const PLACEHOLDER_RE = /[xX×٭]{2,}/;

const hasPlaceholder = (s: string | null | undefined): boolean =>
  typeof s === "string" && PLACEHOLDER_RE.test(toWesternDigits(s));

const includesKey = (value: string | null | undefined, needle: string): boolean => {
  const v = arabicKey(value);
  return v.length > 0 && v.includes(arabicKey(needle));
};

const isExampleOwner = (name: string | null | undefined): boolean =>
  arabicKey(name).includes(EXAMPLE_FAMILY_KEY);

const numEq = (a: number | null | undefined, b: number): boolean =>
  typeof a === "number" && Math.abs(a - b) < 0.5;

/**
 * True when a row reproduces one of the form's printed example rows. The
 * example owner is always the fictitious "أحمد محمد فهد" family; a row is
 * dropped when that owner appears together with at least two more cells
 * copied from the printed example, when every one of three or more
 * fingerprint cells matches (the owner scrawl is the cell readers most
 * often garble, so a full match on the rest is still decisive), or when it
 * carries a placeholder the form uses only in examples (xxxx identifiers,
 * 20xx dates, the example company name). Handwritten rows with a genuinely
 * similar asset differ in at least one of those cells and survive.
 */
export function isPrintedExampleRow(
  section: keyof Pick<
    DisclosureExtraction,
    | "minorChildren"
    | "realEstate"
    | "usufructRights"
    | "securities"
    | "bankAccountsAndDeposits"
    | "debtsOwed"
    | "valuableMovables"
  >,
  row: unknown,
): boolean {
  const ownerPlusTwo = (owner: string | null | undefined, cellMatches: boolean[]): boolean => {
    const hits = cellMatches.filter(Boolean).length;
    if (isExampleOwner(owner) && hits >= 2) return true;
    return cellMatches.length >= 3 && hits === cellMatches.length;
  };

  switch (section) {
    case "minorChildren": {
      const r = row as DisclosureChild;
      if (hasPlaceholder(r.idNumber) || hasPlaceholder(r.dateOfBirth)) return true;
      return (
        isExampleOwner(r.name) &&
        (includesKey(r.name, "خالد") || includesKey(r.name, "بدر"))
      );
    }
    case "realEstate": {
      const r = row as DisclosureRealEstate;
      return (
        ownerPlusTwo(r.ownerName, [
          includesKey(r.location, "حطين"),
          numEq(r.areaSqm, 500),
          numEq(r.ownershipPct, 50),
        ]) ||
        ownerPlusTwo(r.ownerName, [
          includesKey(r.location, "لندن"),
          numEq(r.areaSqm, 200),
          numEq(r.ownershipPct, 25),
        ])
      );
    }
    case "usufructRights": {
      const r = row as DisclosureUsufruct;
      return (
        ownerPlusTwo(r.beneficiaryName, [
          includesKey(r.location, "الجليعة"),
          numEq(r.areaSqm, 2000),
        ]) ||
        ownerPlusTwo(r.beneficiaryName, [
          includesKey(r.location, "الفحيحيل"),
          numEq(r.areaSqm, 500),
        ])
      );
    }
    case "securities": {
      const r = row as DisclosureSecurity;
      if (includesKey(r.company, "أولاد محمد فهد")) return true;
      const qty = arabicKey(r.quantityOrPct);
      return (
        ownerPlusTwo(r.ownerName, [
          includesKey(r.company, "زين"),
          qty === "2000",
          includesKey(r.instrumentType, "اسهم") || includesKey(r.instrumentType, "أسهم"),
        ]) ||
        ownerPlusTwo(r.ownerName, [
          qty === "50%" || qty === "50",
          includesKey(r.instrumentType, "حصة"),
        ])
      );
    }
    case "bankAccountsAndDeposits": {
      const r = row as DisclosureAccount;
      return (
        ownerPlusTwo(r.ownerName, [
          includesKey(r.institution, "الوطني"),
          numEq(r.valueKwd, 10000),
          includesKey(r.kind, "حساب"),
        ]) ||
        ownerPlusTwo(r.ownerName, [
          includesKey(r.institution, "بوبيان"),
          numEq(r.valueKwd, 50000),
          includesKey(r.kind, "وديعة"),
        ])
      );
    }
    case "debtsOwed": {
      const r = row as DisclosureDebt;
      if (hasPlaceholder(r.finalRepaymentDate)) return true;
      return (
        ownerPlusTwo(r.debtorName, [
          includesKey(r.creditor, "الوطني"),
          numEq(r.amountKwd, 15000),
        ]) ||
        ownerPlusTwo(r.debtorName, [
          includesKey(r.creditor, "الائتمان"),
          numEq(r.amountKwd, 60000),
        ])
      );
    }
    case "valuableMovables": {
      const r = row as DisclosureMovable;
      return (
        ownerPlusTwo(r.ownerName, [
          includesKey(r.description, "سيارات"),
          numEq(r.count, 2),
          numEq(r.totalValueKwd, 25000),
        ]) ||
        ownerPlusTwo(r.ownerName, [
          includesKey(r.description, "ساعات"),
          numEq(r.count, 5),
          numEq(r.totalValueKwd, 12000),
        ])
      );
    }
    default:
      return false;
  }
}

const SEP = "\\s*[/|\\\\.\\-]\\s*";
const DMY_RE = new RegExp(`^(\\d{1,2})${SEP}(\\d{1,2})${SEP}(\\d{4})$`);
const YMD_RE = new RegExp(`^(\\d{4})${SEP}(\\d{1,2})${SEP}(\\d{1,2})$`);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const validYmd = (y: number, m: number, d: number): boolean =>
  y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/**
 * Handwritten dates on the form are day/month/year ("10|05|2018"); when the
 * year is written first the order is year/month/day ("2026/10/1"). Returns
 * the ISO form when the text parses that way, otherwise the input (with
 * digits westernized) so nothing is lost.
 */
export function normalizeFormDate(value: string | null): string | null {
  if (!value) return null;
  const t = toWesternDigits(value).trim();
  if (ISO_RE.test(t)) return t;
  const dmy = t.match(DMY_RE);
  if (dmy) {
    const [, d, m, y] = dmy.map(Number) as [number, number, number, number];
    if (validYmd(y, m, d))
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const ymd = t.match(YMD_RE);
  if (ymd) {
    const [, y, m, d] = ymd.map(Number) as [number, number, number, number];
    if (validYmd(y, m, d))
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return t;
}

const digitsOf = (s: string): string => toWesternDigits(s).replace(/\D/g, "");

/** Kuwaiti civil ID: exactly 12 digits. Returns the clean digits or null. */
export function normalizeCivilId(value: string | null): string | null {
  if (!value) return null;
  const d = digitsOf(value);
  return d.length === 12 ? d : null;
}

/** Kuwaiti subscriber numbers are 8 digits (optionally prefixed +965). */
export function isPlausibleKuwaitPhone(value: string): boolean {
  let d = digitsOf(value);
  if (d.length === 11 && d.startsWith("965")) d = d.slice(3);
  return d.length === 8;
}

/** Name cells hold Arabic script only; digits or Latin letters mean a misread. */
export function looksLikeMisreadName(value: string | null | undefined): boolean {
  if (!value) return false;
  return /[0-9٠-٩A-Za-z]/.test(value);
}

/** "دين / حساب بنكي" - the reader could not pick the ticked option. */
const looksLikeTwoOptions = (value: string | null | undefined): boolean =>
  typeof value === "string" && /\/|\bأو\b|\bاو\b/.test(value);

const uniq = (items: string[]): string[] => [...new Set(items)];

const addUncertain = <T extends { uncertain?: boolean }>(row: T): T => ({ ...row, uncertain: true });

const PLACEHOLDER_WORD_RE =
  /\b(illegible|unreadable|unclear|not\s+(?:legible|readable|clear)|unknown|n\/a|null|undefined)\b|غير\s*مقروء|غير\s*واضح/i;

/**
 * "(issuer illegible)", "unknown", "غير مقروء": the reader wrote a note in
 * place of a value. Such text is not ink and must not reach the record;
 * the uncertain flag already tells the reviewer to look at the page.
 */
export function isPlaceholderText(value: string): boolean {
  const t = value.trim();
  if (t.length === 0 || t.length > 48 || !PLACEHOLDER_WORD_RE.test(t)) return false;
  const arabicLetters = t.replace(/غير\s*(مقروء|واضح)/g, "").match(/[\u0621-\u064A]/g)?.length ?? 0;
  const bracketed = /^[(\[].*[)\]]$/.test(t);
  return bracketed || arabicLetters === 0;
}

/** Returns a copy with placeholder strings nulled; counts how many cells changed. */
function scrubPlaceholders<T extends object>(obj: T, counter: { n: number }): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string" && isPlaceholderText(value)) {
      out[key] = null;
      counter.n += 1;
      if (key !== "asWritten" && key !== "notes" && "uncertain" in out) out.uncertain = true;
    }
  }
  return out as T;
}

export interface SanitizeResult {
  extraction: DisclosureExtraction;
  /** Human-readable notes about what was changed, for the log. */
  notes: string[];
}

/**
 * Applies the mechanical checks above to a reading. Pure: returns a new
 * extraction and never mutates the input. Any locator mapping is dropped
 * when rows were removed, because location keys index into the arrays.
 */
export function sanitizeExtraction(input: DisclosureExtraction): SanitizeResult {
  const notes: string[] = [];
  const warnings: string[] = [...input.extractionWarnings];
  const x: DisclosureExtraction = {
    ...input,
    minorChildren: [...input.minorChildren],
    realEstate: [...input.realEstate],
    usufructRights: [...input.usufructRights],
    securities: [...input.securities],
    bankAccountsAndDeposits: [...input.bankAccountsAndDeposits],
    debtsOwed: [...input.debtsOwed],
    valuableMovables: [...input.valuableMovables],
    sectionsMarkedNone: [...input.sectionsMarkedNone],
    declarant: input.declarant ? { ...input.declarant } : null,
  };

  // 0. Reader notes written in place of values.
  const placeholders = { n: 0 };
  if (x.declarant) {
    const before = x.declarant.uncertainFields ?? [];
    const cleared: string[] = [];
    for (const [key, value] of Object.entries(x.declarant)) {
      if (typeof value === "string" && isPlaceholderText(value)) cleared.push(key);
    }
    if (cleared.length) {
      x.declarant = scrubPlaceholders(x.declarant, placeholders);
      x.declarant.uncertainFields = uniq([...before, ...cleared]);
    }
  }
  for (const key of [
    "minorChildren",
    "realEstate",
    "usufructRights",
    "securities",
    "bankAccountsAndDeposits",
    "debtsOwed",
    "valuableMovables",
  ] as const) {
    (x as unknown as Record<string, unknown>)[key] = (x[key] as object[]).map((row) =>
      scrubPlaceholders(row, placeholders),
    );
  }
  if (x.generalNotes && isPlaceholderText(x.generalNotes)) {
    x.generalNotes = null;
    placeholders.n += 1;
  }
  if (x.declarationDate && isPlaceholderText(x.declarationDate)) {
    x.declarationDate = null;
    placeholders.n += 1;
  }
  if (placeholders.n > 0) notes.push(`placeholders: ${placeholders.n} cell(s) cleared`);

  // 1. Printed example rows.
  let droppedRows = 0;
  const dropExamples = <K extends Parameters<typeof isPrintedExampleRow>[0]>(key: K) => {
    const rows = x[key] as unknown[];
    const kept = rows.filter((r) => !isPrintedExampleRow(key, r));
    const dropped = rows.length - kept.length;
    if (dropped > 0) {
      droppedRows += dropped;
      notes.push(`${key}: dropped ${dropped} printed example row(s)`);
      (x as unknown as Record<string, unknown>)[key] = kept;
    }
  };
  dropExamples("minorChildren");
  dropExamples("realEstate");
  dropExamples("usufructRights");
  dropExamples("securities");
  dropExamples("bankAccountsAndDeposits");
  dropExamples("debtsOwed");
  dropExamples("valuableMovables");
  if (droppedRows > 0) {
    warnings.push(
      `${droppedRows} row(s) that copied the form's printed example rows (مثال توضيحي) were removed - verify the affected tables against the ink.`,
    );
    if (x.locations) delete x.locations;
  }

  // Example sentences on the notes page.
  if (x.generalNotes) {
    const lines = x.generalNotes.split(/\r?\n|(?<=\.)\s+-\s*/);
    const kept = lines.filter(
      (l) =>
        !hasPlaceholder(l) &&
        !includesKey(l, "عبدالعزيز أحمد عبدالله") &&
        !(includesKey(l, "دخلا سنويا") && includesKey(l, "لندن")),
    );
    if (kept.length !== lines.length) {
      notes.push("generalNotes: removed printed example sentence(s)");
      const joined = kept.join("\n").trim();
      x.generalNotes = joined.length > 0 ? joined : null;
    }
  }

  // 2. Dates in day/month/year order.
  x.declarationDate = normalizeFormDate(x.declarationDate);
  if (x.declarant) {
    x.declarant.jobStartDate = normalizeFormDate(x.declarant.jobStartDate);
    x.declarant.jobEndDate = normalizeFormDate(x.declarant.jobEndDate);
  }
  x.minorChildren = x.minorChildren.map((c) => ({
    ...c,
    dateOfBirth: normalizeFormDate(c.dateOfBirth),
  }));
  x.debtsOwed = x.debtsOwed.map((d) => ({
    ...d,
    finalRepaymentDate: normalizeFormDate(d.finalRepaymentDate),
  }));

  // 3. Identifier, phone and name plausibility on the declarant.
  if (x.declarant) {
    const d = x.declarant;
    const uncertain = new Set(d.uncertainFields ?? []);
    if (d.civilId) {
      const clean = normalizeCivilId(d.civilId);
      if (clean) d.civilId = clean;
      else {
        uncertain.add("civilId");
        warnings.push(
          `Civil ID was read as "${d.civilId}", which is not 12 digits - check it digit by digit against the ink.`,
        );
      }
    }
    for (const key of ["mobile", "homePhone", "workPhone"] as const) {
      const v = d[key];
      if (v && !isPlausibleKuwaitPhone(v)) {
        d[key] = toWesternDigits(v);
        uncertain.add(key);
      }
    }
    if (looksLikeMisreadName(d.name)) {
      uncertain.add("name");
      warnings.push("The declarant's name contains digits or Latin letters - the handwriting was probably misread.");
    }
    if (uncertain.size > 0) d.uncertainFields = uniq([...uncertain]);
    if (d.monthlySalaryKwd != null && d.monthlySalaryKwd === 0) d.monthlySalaryKwd = null;
  }

  // 4. Row-level plausibility: names with digits, civil IDs, two-option kinds.
  const flagName = <T extends { uncertain?: boolean }>(
    rows: T[],
    nameOf: (r: T) => string | null | undefined,
    label: string,
  ): T[] => {
    let flagged = 0;
    const out = rows.map((r) => {
      if (looksLikeMisreadName(nameOf(r))) {
        flagged += 1;
        return addUncertain(r);
      }
      return r;
    });
    if (flagged > 0) notes.push(`${label}: ${flagged} name cell(s) flagged`);
    return out;
  };
  x.minorChildren = flagName(x.minorChildren, (r) => r.name, "minorChildren").map((c) => {
    if (c.idNumber && includesKey(c.idType, "مدنية")) {
      const clean = normalizeCivilId(c.idNumber);
      return clean ? { ...c, idNumber: clean } : addUncertain(c);
    }
    return c;
  });
  x.realEstate = flagName(x.realEstate, (r) => r.ownerName, "realEstate");
  x.usufructRights = flagName(x.usufructRights, (r) => r.beneficiaryName, "usufructRights");
  x.securities = flagName(x.securities, (r) => r.ownerName, "securities");
  x.bankAccountsAndDeposits = flagName(
    x.bankAccountsAndDeposits,
    (r) => r.ownerName,
    "bankAccountsAndDeposits",
  ).map((a) => (looksLikeTwoOptions(a.kind) ? addUncertain(a) : a));
  x.debtsOwed = flagName(x.debtsOwed, (r) => r.debtorName, "debtsOwed");
  x.valuableMovables = flagName(x.valuableMovables, (r) => r.ownerName, "valuableMovables");
  x.realEstate = x.realEstate.map((r) =>
    looksLikeTwoOptions(r.propertyType) ? addUncertain(r) : r,
  );

  // 5. A section with no rows left is "none" only if the reader said so;
  //    never claim a tick that was not read. But an explicit none-tick with
  //    leftover rows is contradictory, so keep the rows and drop the tick.
  x.sectionsMarkedNone = uniq(
    x.sectionsMarkedNone.filter((key) => {
      const rows = (x as unknown as Record<string, unknown[]>)[key];
      return !Array.isArray(rows) || rows.length === 0;
    }),
  );

  x.extractionWarnings = uniq(warnings).slice(0, 15);
  return { extraction: x, notes };
}
