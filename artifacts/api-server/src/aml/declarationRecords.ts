import { eq } from "drizzle-orm";
import {
  db,
  declarantsTable,
  declarationItemsTable,
  type DeclarantRow,
  type DeclarationItemRow,
  type InsertDeclarationItem,
} from "@workspace/db";
import type { DisclosureExtraction } from "./disclosure";

/**
 * Relational projection of a disclosure reading.
 *
 * The AI reading is stored as JSON on the disclosure row; this module writes
 * the same facts into typed tables (`declarants`, `declaration_items`) so the
 * declaration can be queried like any other case data. Everything is kept in
 * Arabic exactly as written on the form - no translation, no transliteration.
 *
 * The projection is a pure function of (caseId, disclosureId, extraction):
 * every call replaces the previous rows for the case, so the tables always
 * mirror the latest stored reading.
 */

export type DeclarationSection =
  | "minorChildren"
  | "realEstate"
  | "usufructRights"
  | "securities"
  | "bankAccountsAndDeposits"
  | "debtsOwed"
  | "valuableMovables";

export const DECLARATION_SECTIONS: DeclarationSection[] = [
  "minorChildren",
  "realEstate",
  "usufructRights",
  "securities",
  "bankAccountsAndDeposits",
  "debtsOwed",
  "valuableMovables",
];

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Flatten every section of the reading into item rows (without ids). */
export function declarationItemsFromExtraction(
  x: DisclosureExtraction,
  ids: { caseId: number; disclosureId: number },
): InsertDeclarationItem[] {
  const rows: InsertDeclarationItem[] = [];
  const base = (section: DeclarationSection, rowIndex: number, r: {
    uncertain?: boolean;
    corrected?: boolean;
    page?: number | null;
    asWritten?: string | null;
    alternates?: string[];
    notes?: string | null;
  }) => ({
    caseId: ids.caseId,
    disclosureId: ids.disclosureId,
    section,
    rowIndex,
    notes: clean(r.notes),
    uncertain: r.uncertain === true,
    corrected: r.corrected === true,
    page: typeof r.page === "number" ? r.page : null,
    asWritten: clean(r.asWritten),
    alternates: Array.isArray(r.alternates) ? r.alternates : [],
  });

  x.minorChildren.forEach((r, i) => {
    const label = clean(r.name);
    if (!label) return;
    rows.push({
      ...base("minorChildren", i, r),
      label,
      kind: clean(r.relation),
      idType: clean(r.idType),
      idNumber: clean(r.idNumber),
      dateText: clean(r.dateOfBirth),
    });
  });
  x.realEstate.forEach((r, i) => {
    const label = clean(r.location);
    if (!label) return;
    rows.push({
      ...base("realEstate", i, r),
      ownerName: clean(r.ownerName),
      label,
      kind: clean(r.propertyType),
      areaSqm: num(r.areaSqm),
      ownershipPct: num(r.ownershipPct),
    });
  });
  x.usufructRights.forEach((r, i) => {
    const label = clean(r.location);
    if (!label) return;
    rows.push({
      ...base("usufructRights", i, r),
      ownerName: clean(r.beneficiaryName),
      label,
      kind: clean(r.usageType),
      areaSqm: num(r.areaSqm),
    });
  });
  x.securities.forEach((r, i) => {
    const label = clean(r.company);
    if (!label) return;
    rows.push({
      ...base("securities", i, r),
      ownerName: clean(r.ownerName),
      label,
      kind: clean(r.instrumentType),
      country: clean(r.companyCountry),
      quantityOrPct: clean(r.quantityOrPct),
      listed: typeof r.listed === "boolean" ? r.listed : null,
    });
  });
  x.bankAccountsAndDeposits.forEach((r, i) => {
    const label = clean(r.institution);
    if (!label) return;
    rows.push({
      ...base("bankAccountsAndDeposits", i, r),
      ownerName: clean(r.ownerName),
      label,
      kind: clean(r.kind),
      country: clean(r.institutionCountry),
      valueKwd: num(r.valueKwd),
    });
  });
  x.debtsOwed.forEach((r, i) => {
    const label = clean(r.creditor);
    if (!label) return;
    rows.push({
      ...base("debtsOwed", i, r),
      ownerName: clean(r.debtorName),
      label,
      country: clean(r.creditorCountry),
      valueKwd: num(r.amountKwd),
      dateText: clean(r.finalRepaymentDate),
    });
  });
  x.valuableMovables.forEach((r, i) => {
    const label = clean(r.description);
    if (!label) return;
    rows.push({
      ...base("valuableMovables", i, r),
      ownerName: clean(r.ownerName),
      label,
      itemCount: num(r.count),
      valueKwd: num(r.totalValueKwd),
    });
  });
  return rows;
}

export interface ProjectDeclarationInput {
  caseId: number;
  disclosureId: number;
  extraction: DisclosureExtraction;
  /** "ai" = fresh machine reading; "investigator" = reviewed against the ink. */
  source: "ai" | "investigator";
}

/** The drizzle client or a transaction handle from `db.transaction`. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Replace the structured records for a case with the given reading.
 * Runs in one transaction so readers never observe a half-written projection.
 */
export async function projectDeclarationRecords(input: ProjectDeclarationInput): Promise<void> {
  await db.transaction((tx) => projectDeclarationRecordsWith(tx, input));
}

/**
 * Same as projectDeclarationRecords but on a caller-owned executor, so the
 * projection can share a transaction with other writes (case registration).
 */
export async function projectDeclarationRecordsWith(
  tx: DbExecutor,
  input: ProjectDeclarationInput,
): Promise<void> {
  const { caseId, disclosureId, extraction: x, source } = input;
  const d = x.declarant;
  const now = new Date();
  const declarant = {
    caseId,
    disclosureId,
    declarationType: x.declarationType,
    declarationDate: clean(x.declarationDate),
    fullName: clean(d?.name),
    gender: clean(d?.gender),
    nationality: clean(d?.nationality),
    residenceCountry: clean(d?.residenceCountry),
    civilId: clean(d?.civilId),
    passportNo: clean(d?.passportNo),
    jobTitle: clean(d?.jobTitle),
    employer: clean(d?.employer),
    jobStartDate: clean(d?.jobStartDate),
    jobEndDate: clean(d?.jobEndDate),
    workPhone: clean(d?.workPhone),
    mobile: clean(d?.mobile),
    homePhone: clean(d?.homePhone),
    email: clean(d?.email),
    homeAddress: clean(d?.homeAddress),
    monthlySalaryKwd: num(d?.monthlySalaryKwd),
    generalNotes: clean(x.generalNotes),
    sectionsMarkedNone: Array.isArray(x.sectionsMarkedNone) ? x.sectionsMarkedNone : [],
    uncertainFields: Array.isArray(d?.uncertainFields) ? d!.uncertainFields! : [],
    source,
    verifiedAt: source === "investigator" ? now : null,
    updatedAt: now,
  };
  const items = declarationItemsFromExtraction(x, { caseId, disclosureId });
  await tx
    .insert(declarantsTable)
    .values(declarant)
    .onConflictDoUpdate({ target: declarantsTable.caseId, set: declarant });
  await tx.delete(declarationItemsTable).where(eq(declarationItemsTable.caseId, caseId));
  if (items.length > 0) await tx.insert(declarationItemsTable).values(items);
}

export async function loadDeclarationRecords(caseId: number): Promise<{
  declarant: DeclarantRow | null;
  items: DeclarationItemRow[];
}> {
  const [declarantRows, items] = await Promise.all([
    db.select().from(declarantsTable).where(eq(declarantsTable.caseId, caseId)),
    db
      .select()
      .from(declarationItemsTable)
      .where(eq(declarationItemsTable.caseId, caseId))
      .orderBy(declarationItemsTable.section, declarationItemsTable.rowIndex),
  ]);
  return { declarant: declarantRows[0] ?? null, items };
}

/**
 * Case profile fields derived from a reviewed declaration. Arabic values are
 * carried over verbatim; nothing is invented when the form left a box empty.
 */
export function caseProfileFromDeclaration(x: DisclosureExtraction): {
  subjectName: string | null;
  subjectReference: string | null;
  declaredOccupation: string | null;
  declaredMonthlyIncomeKwd: number | null;
  expectedCountries: string[];
  notes: string | null;
} {
  const d = x.declarant;
  const subjectName = clean(d?.name);
  const subjectReference = clean(d?.civilId) ?? clean(d?.passportNo);
  const occupationParts = [clean(d?.jobTitle), clean(d?.employer)].filter(
    (p): p is string => p !== null,
  );
  const salary = num(d?.monthlySalaryKwd);
  const countries = new Set<string>();
  const addCountry = (value: string | null | undefined) => {
    const c = clean(value);
    if (c) countries.add(c);
  };
  addCountry(d?.nationality);
  addCountry(d?.residenceCountry);
  for (const r of x.securities) addCountry(r.companyCountry);
  for (const r of x.bankAccountsAndDeposits) addCountry(r.institutionCountry);
  for (const r of x.debtsOwed) addCountry(r.creditorCountry);
  return {
    subjectName,
    subjectReference,
    declaredOccupation: occupationParts.length > 0 ? occupationParts.join(" - ") : null,
    declaredMonthlyIncomeKwd: salary !== null && salary > 0 ? salary : null,
    expectedCountries: [...countries],
    notes: clean(x.generalNotes),
  };
}
