import * as XLSX from "xlsx";
import type { Direction, ParsedTxn, ParseFileResult } from "./types";
import {
  BIC_BANKS,
  FILENAME_BANKS,
  FX_TO_KWD,
  classifyChannel,
  extractCounterpartyFromNarrative,
} from "./vocab";

/**
 * Adaptive bank-statement parser.
 *
 * Every bank exports a different layout: different header rows, column names,
 * date formats, and direction conventions (separate debit/credit columns,
 * C/D indicator columns, signed amounts, or textual type columns). This module
 * detects the layout heuristically and normalizes everything into the
 * canonical transaction schema. When heuristics cannot find the essential
 * columns it throws MappingError carrying the header + sample rows so the
 * caller can ask the LLM mapping assistant for a column map and retry.
 */

export class MappingError extends Error {
  headers: string[];
  sampleRows: unknown[][];
  constructor(message: string, headers: string[], sampleRows: unknown[][]) {
    super(message);
    this.name = "MappingError";
    this.headers = headers;
    this.sampleRows = sampleRows;
  }
}

export interface ForcedMapping {
  dateHeader?: string;
  amountHeader?: string;
  debitHeader?: string;
  creditHeader?: string;
  dcIndicatorHeader?: string;
  creditIndicatorValues?: string[];
  typeTextHeader?: string;
  balanceHeader?: string;
  narrativeHeaders?: string[];
  accountHeader?: string;
  currencyHeader?: string;
}

interface ColMap {
  date: number;
  amount: number | null;
  cvAmount: number | null;
  debit: number | null;
  credit: number | null;
  dcIndicator: number | null;
  typeText: number | null;
  balance: number | null;
  narrative: number[];
  account: number | null;
  currency: number | null;
  code: number | null;
  fromName: number | null;
  toName: number | null;
  genericName: number | null;
  fromBank: number | null;
  toBank: number | null;
  genericBank: number | null;
  fromCountry: number | null;
  toCountry: number | null;
  genericCountry: number | null;
}

const norm = (v: unknown): string =>
  String(v ?? "")
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function fmtDate(y: number, m: number, d: number): string | null {
  if (y < 100) y = y < 50 ? 2000 + y : 1900 + y;
  if (y < 1990 || y > 2035 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;
}

export function parseDateCell(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return fmtDate(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    return fmtDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fmtDate(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/);
  if (m) {
    const mon = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    if (mon) return fmtDate(+m[3]!, mon, +m[1]!);
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = +m[3]!;
    // Day-first (Kuwait convention); fall back to month-first when impossible.
    if (b <= 12 && a <= 31) {
      if (a > 12) return fmtDate(y, b, a);
      return fmtDate(y, b, a) ?? fmtDate(y, a, b);
    }
    if (a <= 12) return fmtDate(y, a, b);
  }
  return null;
}

export function parseAmountCell(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\bdr\b\.?$/i.test(s)) sign = -1;
  s = s.replace(/\b(cr|dr)\b\.?/gi, "");
  s = s.replace(/[^\d.,\-+]/g, "");
  if (!s) return null;
  // Handle thousands separators: remove commas unless comma is the decimal sep.
  if (/,\d{3}(\D|$)/.test(s) || /\d,\d{3}/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(/,/g, ".");
  const n = parseFloat(s);
  return isFinite(n) ? n * sign : null;
}

function headerScore(cells: unknown[]): number {
  let score = 0;
  for (const c of cells) {
    const h = norm(c);
    if (!h || h.length > 60) continue;
    if (/date/.test(h)) score += 2;
    else if (/amount|debit|credit|balance/.test(h)) score += 2;
    else if (/desc|narrat|remark|detail|particular|type|account|currency|reference|country|bank|name|code|num\b/.test(h))
      score += 1;
  }
  return score;
}

function isDcIndicatorHeader(h: string): boolean {
  if (/^(d c|dc|d\/c|dr cr|drcr|c d|cd)$/.test(h)) return true;
  if (/indicator/.test(h) && /(d|debit)/.test(h)) return true;
  if (/debit/.test(h) && /credit/.test(h)) return true;
  if (/\bdc\b/.test(h)) return true;
  return false;
}

function buildColMap(headers: string[], notes: string[]): ColMap | null {
  const H = headers.map(norm);
  const used = new Set<number>();
  const find = (pred: (h: string, i: number) => boolean): number | null => {
    for (let i = 0; i < H.length; i++) {
      if (used.has(i)) continue;
      const h = H[i]!;
      if (!h) continue;
      if (pred(h, i)) {
        used.add(i);
        return i;
      }
    }
    return null;
  };

  // Order matters: most specific roles claim their columns first.
  const dcIndicator = find((h) => isDcIndicatorHeader(h));
  const cvAmount = find(
    (h) =>
      /amount|amnt|value/.test(h) &&
      /(\bcv\b|\bkd\b|kwd|local|equiv|counter)/.test(h),
  );
  const debit = find((h) => /debit/.test(h) && !/credit|card/.test(h) && !/date/.test(h));
  const credit = find((h) => /credit/.test(h) && !/debit|card/.test(h) && !/date/.test(h));
  const amount = find((h) => /(^|\s)(amount|amnt|amt)(\s|$)|transaction amount|trans amount|txn amount/.test(h) && !/fee|charge/.test(h));
  const date = find((h) => /(operation|transaction|trans|txn|post|posting|entry|process)\s?date/.test(h))
    ?? find((h) => /date/.test(h) && !/value date|birth|maturity|expiry/.test(h))
    ?? find((h) => /value date/.test(h));
  const balance = find((h) => /balance|\bbal\b/.test(h) && !/available/.test(h)) ?? find((h) => /balance/.test(h));
  const currency = find((h) => /currenc|\bccy\b|\bcurr\b/.test(h));
  const account = find((h) => /(account|acct|\bac\b|acc)\s?(num|no|number|id)|iban/.test(h))
    ?? find((h) => /^account$/.test(h));
  const code = find((h) => /(tran|trans|transaction|txn|operation)\s?code|^code$/.test(h));
  const fromName = find((h) => /(from|order|sender|payer|remit)[a-z ]*name/.test(h));
  const toName = find((h) => /(to|benef|receiv|payee)[a-z ]*name/.test(h));
  const genericName = find(
    (h) =>
      /counterpart|benefic|payee|payer|second party/.test(h) ||
      (/name/.test(h) && !/account name|customer name|file name|bank name|holder/.test(h)),
  );
  const fromBank = find((h) => /(from|order|sender|remit)[a-z ]*(bank|bic|swift)/.test(h));
  const toBank = find((h) => /(to|benef|receiv)[a-z ]*(bank|bic|swift)/.test(h));
  const genericBank = find((h) => /(bank|bic|swift)/.test(h) && !/date|amount/.test(h));
  const fromCountry = find((h) => /(from|order|sender|remit)[a-z ]*countr/.test(h));
  const toCountry = find((h) => /(to|benef|receiv)[a-z ]*countr/.test(h));
  const genericCountry = find((h) => /countr/.test(h));
  // Type text: e.g. "Transaction_Type" with Debit/Credit values, or bank 4's
  // bare "Transaction" column holding channel text.
  const typeText = find((h) => /(transaction|trans|txn)?\s?type$/.test(h) && !/code/.test(h))
    ?? find((h) => /^transaction$/.test(h) || /^operation$/.test(h));
  const narrative: number[] = [];
  for (let i = 0; i < H.length; i++) {
    if (used.has(i)) continue;
    const h = H[i]!;
    if (/desc|narrat|remark|detail|particular|purpose|memo|statement text/.test(h)) {
      narrative.push(i);
      used.add(i);
    }
  }

  if (date == null) return null;
  if (amount == null && debit == null && credit == null && cvAmount == null) return null;

  const label = (i: number | null) => (i == null ? null : headers[i]);
  notes.push(
    `Column map: date=${label(date)}` +
      (amount != null ? `, amount=${label(amount)}` : "") +
      (cvAmount != null ? `, kwdAmount=${label(cvAmount)}` : "") +
      (debit != null ? `, debit=${label(debit)}` : "") +
      (credit != null ? `, credit=${label(credit)}` : "") +
      (dcIndicator != null ? `, directionIndicator=${label(dcIndicator)}` : "") +
      (typeText != null ? `, typeText=${label(typeText)}` : "") +
      (balance != null ? `, balance=${label(balance)}` : "") +
      (narrative.length ? `, narrative=[${narrative.map((i) => headers[i]).join(", ")}]` : "") +
      (account != null ? `, account=${label(account)}` : "") +
      (currency != null ? `, currency=${label(currency)}` : ""),
  );

  return {
    date,
    amount,
    cvAmount,
    debit,
    credit,
    dcIndicator,
    typeText,
    balance,
    narrative,
    account,
    currency,
    code,
    fromName,
    toName,
    genericName,
    fromBank,
    toBank,
    genericBank,
    fromCountry,
    toCountry,
    genericCountry,
  };
}

function forcedToColMap(headers: string[], forced: ForcedMapping, notes: string[]): ColMap | null {
  const H = headers.map(norm);
  const idx = (name?: string): number | null => {
    if (!name) return null;
    const n = norm(name);
    const i = H.findIndex((h) => h === n);
    return i >= 0 ? i : null;
  };
  const map: ColMap = {
    date: idx(forced.dateHeader) ?? -1,
    amount: idx(forced.amountHeader),
    cvAmount: null,
    debit: idx(forced.debitHeader),
    credit: idx(forced.creditHeader),
    dcIndicator: idx(forced.dcIndicatorHeader),
    typeText: idx(forced.typeTextHeader),
    balance: idx(forced.balanceHeader),
    narrative: (forced.narrativeHeaders ?? [])
      .map((h) => idx(h))
      .filter((i): i is number => i != null),
    account: idx(forced.accountHeader),
    currency: idx(forced.currencyHeader),
    code: null,
    fromName: null,
    toName: null,
    genericName: null,
    fromBank: null,
    toBank: null,
    genericBank: null,
    fromCountry: null,
    toCountry: null,
    genericCountry: null,
  };
  if (map.date < 0) return null;
  if (map.amount == null && map.debit == null && map.credit == null) return null;
  notes.push("Column map supplied by AI mapping assistant.");
  return map;
}

const CREDIT_WORDS = /^(c|cr|credit|dep|deposit|in)$/i;
const DEBIT_WORDS = /^(d|dr|debit|wd|withdrawal|out)$/i;

interface SheetParse {
  txns: ParsedTxn[];
  rowsSkipped: number;
  skipNotes: Map<string, number>;
  mappingNotes: string[];
  headerRowIndex: number;
  headers: string[];
  balanceChecked: number;
  balanceBreaks: number;
}

function parseSheet(
  rows: unknown[][],
  forced: ForcedMapping | undefined,
  creditIndicatorValues: string[] | undefined,
): SheetParse | null {
  // Locate header row.
  let headerRowIndex = -1;
  let best = 0;
  const scanLimit = Math.min(rows.length, 25);
  for (let i = 0; i < scanLimit; i++) {
    const s = headerScore(rows[i] ?? []);
    if (s > best) {
      best = s;
      headerRowIndex = i;
    }
  }
  if (headerRowIndex < 0 || best < 4) return null;
  const headers = (rows[headerRowIndex] ?? []).map((c) => String(c ?? "").trim());
  const notes: string[] = [];
  if (headerRowIndex > 0) notes.push(`Header detected on sheet row ${headerRowIndex + 1}.`);
  const map = forced ? forcedToColMap(headers, forced, notes) : buildColMap(headers, notes);
  if (!map) return null;

  const txns: ParsedTxn[] = [];
  const skipNotes = new Map<string, number>();
  const skip = (reason: string) => {
    skipNotes.set(reason, (skipNotes.get(reason) ?? 0) + 1);
  };
  let dirFromSign = 0;
  let balanceChecked = 0;
  let balanceBreaks = 0;
  const balanceSeq = new Map<string, Array<{ signed: number; bal: number }>>();
  let emptyStreak = 0;

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const cell = (i: number | null): unknown => (i == null ? null : row[i]);
    const isEmptyRow = row.every((c) => c == null || String(c).trim() === "");
    if (isEmptyRow) {
      emptyStreak++;
      if (emptyStreak > 80) break;
      continue;
    }
    emptyStreak = 0;

    const dateStr = parseDateCell(cell(map.date));
    const debitVal = parseAmountCell(cell(map.debit));
    const creditVal = parseAmountCell(cell(map.credit));
    const amountVal = parseAmountCell(cell(map.amount));
    const cvVal = parseAmountCell(cell(map.cvAmount));

    if (!dateStr) {
      if (debitVal != null || creditVal != null || amountVal != null) skip("row without a parsable date (subtotal/footer)");
      continue;
    }

    // Resolve direction + amount.
    let direction: Direction | null = null;
    let amount: number | null = null;
    if (debitVal != null && Math.abs(debitVal) > 0 && (creditVal == null || Math.abs(creditVal) === 0)) {
      direction = "debit";
      amount = Math.abs(debitVal);
    } else if (creditVal != null && Math.abs(creditVal) > 0 && (debitVal == null || Math.abs(debitVal) === 0)) {
      direction = "credit";
      amount = Math.abs(creditVal);
    } else if (debitVal != null && creditVal != null && Math.abs(debitVal) > 0 && Math.abs(creditVal) > 0) {
      skip("row with both debit and credit amounts");
      continue;
    } else {
      const base = amountVal ?? cvVal;
      if (base == null || Math.abs(base) === 0) {
        skip("row without a monetary amount (non-financial entry)");
        continue;
      }
      amount = Math.abs(base);
      const ind = String(cell(map.dcIndicator) ?? "").trim();
      const typeVal = String(cell(map.typeText) ?? "").trim();
      if (ind) {
        if (creditIndicatorValues && creditIndicatorValues.length > 0) {
          direction = creditIndicatorValues.some((v) => v.toLowerCase() === ind.toLowerCase())
            ? "credit"
            : "debit";
        } else if (CREDIT_WORDS.test(ind)) direction = "credit";
        else if (DEBIT_WORDS.test(ind)) direction = "debit";
        else if (/credit|إيداع|دائن/i.test(ind)) direction = "credit";
        else if (/debit|سحب|مدين/i.test(ind)) direction = "debit";
      }
      if (!direction && typeVal) {
        if (/credit|دائن/i.test(typeVal)) direction = "credit";
        else if (/debit|مدين/i.test(typeVal)) direction = "debit";
      }
      if (!direction && base !== 0) {
        direction = base < 0 ? "debit" : "credit";
        dirFromSign++;
      }
    }
    if (!direction || amount == null) {
      skip("row with no direction evidence");
      continue;
    }

    const narrative =
      map.narrative.length > 0
        ? map.narrative
            .map((i) => String(row[i] ?? "").trim())
            .filter(Boolean)
            .join(" | ") || null
        : null;
    const currencyRaw = String(cell(map.currency) ?? "").trim().toUpperCase();
    const currency = currencyRaw || "KWD";
    let amountKwd: number;
    if (cvVal != null && Math.abs(cvVal) > 0 && map.amount !== map.cvAmount) {
      amountKwd = Math.abs(cvVal);
    } else if (currency && currency !== "KWD" && currency !== "KD") {
      const fx = FX_TO_KWD[currency];
      amountKwd = fx ? amount * fx : amount;
    } else {
      amountKwd = amount;
    }

    const fromName = String(cell(map.fromName) ?? "").trim() || null;
    const toName = String(cell(map.toName) ?? "").trim() || null;
    const genericName = String(cell(map.genericName) ?? "").trim() || null;
    let counterpartyName =
      (direction === "credit" ? fromName ?? genericName : toName ?? genericName) || null;
    // Settlement rails are transit infrastructure, not beneficial counterparties.
    if (counterpartyName && /central bank/i.test(counterpartyName)) counterpartyName = null;
    if (!counterpartyName) counterpartyName = extractCounterpartyFromNarrative(narrative);
    const fromBank = String(cell(map.fromBank) ?? "").trim() || null;
    const toBank = String(cell(map.toBank) ?? "").trim() || null;
    const genericBank = String(cell(map.genericBank) ?? "").trim() || null;
    const counterpartyBank =
      (direction === "credit" ? fromBank ?? genericBank : toBank ?? genericBank) || null;
    const fromCountry = String(cell(map.fromCountry) ?? "").trim() || null;
    const toCountry = String(cell(map.toCountry) ?? "").trim() || null;
    const genericCountry = String(cell(map.genericCountry) ?? "").trim() || null;
    const counterpartyCountry =
      (direction === "credit" ? fromCountry ?? genericCountry : toCountry ?? genericCountry) ||
      null;

    const codeVal = String(cell(map.code) ?? "").trim() || null;
    const typeTextVal = String(cell(map.typeText) ?? "").trim() || null;
    const accountId = String(cell(map.account) ?? "").trim() || "";
    const balance = parseAmountCell(cell(map.balance));

    const channel = classifyChannel({
      narrative,
      extra: [codeVal, typeTextVal].filter(Boolean).join(" ") || null,
      direction,
      hasCounterparty: Boolean(counterpartyName),
    });

    // Collected for order-aware reconciliation after the scan.
    if (balance != null) {
      const key = accountId || "single";
      const seq = balanceSeq.get(key) ?? [];
      seq.push({ signed: direction === "credit" ? amountKwd : -amountKwd, bal: balance });
      balanceSeq.set(key, seq);
    }

    txns.push({
      rowIndex: r + 1,
      postingDate: dateStr,
      direction,
      amount,
      currency: currency === "KD" ? "KWD" : currency,
      amountKwd,
      channel,
      accountId,
      counterpartyName,
      counterpartyBank,
      counterpartyCountry,
      narrative,
      runningBalance: balance,
    });
  }

  if (dirFromSign > 0)
    notes.push(`Direction inferred from amount sign for ${dirFromSign} rows (signed-amount format).`);

  // Order-aware balance reconciliation: exports arrive oldest-first or
  // newest-first. The methodology requires balance[i-1] + signed[i] =
  // balance[i] in ledger order, so both orders are evaluated per account and
  // the better fit is kept.
  let reversedAccounts = 0;
  for (const seq of balanceSeq.values()) {
    if (seq.length < 2) continue;
    const breaksIn = (s: Array<{ signed: number; bal: number }>) => {
      let b = 0;
      for (let i = 1; i < s.length; i++) {
        if (Math.abs(s[i - 1]!.bal + s[i]!.signed - s[i]!.bal) > 0.01) b++;
      }
      return b;
    };
    const fwd = breaksIn(seq);
    const rev = breaksIn([...seq].reverse());
    balanceChecked += seq.length - 1;
    if (rev < fwd) {
      balanceBreaks += rev;
      reversedAccounts++;
    } else {
      balanceBreaks += fwd;
    }
  }
  if (reversedAccounts > 0)
    notes.push("Statement rows run newest-first; running balance reconciled in reverse ledger order.");

  let rowsSkipped = 0;
  for (const n of skipNotes.values()) rowsSkipped += n;
  return {
    txns,
    rowsSkipped,
    skipNotes,
    mappingNotes: notes,
    headerRowIndex,
    headers,
    balanceChecked,
    balanceBreaks,
  };
}

function inferBankLabel(
  filename: string,
  headers: string[],
  txns: ParsedTxn[],
  sheetName: string,
): string | null {
  const hay = [filename, sheetName, ...headers.slice(0, 40)].join(" ");
  for (const [rx, name] of FILENAME_BANKS) if (rx.test(hay)) return name;
  const bics = txns
    .slice(0, 200)
    .map((t) => t.counterpartyBank ?? "")
    .join(" ");
  for (const [rx, name] of BIC_BANKS) {
    if (rx.test(hay)) return name;
    if (rx.test(bics)) return name;
  }
  return null;
}

export function parseWorkbook(
  buffer: Buffer,
  filename: string,
  opts?: { bankLabel?: string; forced?: ForcedMapping; creditIndicatorValues?: string[] },
): ParseFileResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { cellDates: true });
  } catch {
    throw new MappingError(`Could not read ${filename} as a spreadsheet`, [], []);
  }

  let bestParse: SheetParse | null = null;
  let bestSheet = "";
  let firstHeaders: string[] = [];
  let firstSamples: unknown[][] = [];
  for (const sheetName of wb.SheetNames.slice(0, 10)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
    });
    if (rows.length < 2) continue;
    if (firstHeaders.length === 0 && rows.length > 0) {
      let hIdx = 0;
      let hBest = 0;
      for (let i = 0; i < Math.min(rows.length, 25); i++) {
        const s = headerScore(rows[i] ?? []);
        if (s > hBest) {
          hBest = s;
          hIdx = i;
        }
      }
      firstHeaders = (rows[hIdx] ?? []).map((c) => String(c ?? "").trim());
      firstSamples = rows.slice(hIdx + 1, hIdx + 6);
    }
    const parsed = parseSheet(rows, opts?.forced, opts?.creditIndicatorValues);
    if (parsed && (!bestParse || parsed.txns.length > bestParse.txns.length)) {
      bestParse = parsed;
      bestSheet = sheetName;
    }
  }

  if (!bestParse || bestParse.txns.length === 0) {
    throw new MappingError(
      `Could not locate transaction columns in ${filename}`,
      firstHeaders,
      firstSamples,
    );
  }

  const p = bestParse;
  const notes = [...p.mappingNotes];
  if (wb.SheetNames.length > 1) notes.push(`Parsed sheet "${bestSheet}" (of ${wb.SheetNames.length} sheets).`);
  for (const [reason, count] of p.skipNotes) notes.push(`Skipped ${count} ${count === 1 ? "row" : "rows"}: ${reason}.`);

  const bankLabel =
    opts?.bankLabel?.trim() ||
    inferBankLabel(filename, p.headers, p.txns, bestSheet) ||
    filename.replace(/\.(xlsx?|csv)$/i, "");

  // Fill blank account ids.
  const accounts = new Set<string>();
  for (const t of p.txns) {
    if (!t.accountId) t.accountId = `${bankLabel} - main account`;
    accounts.add(t.accountId);
  }

  const qualityIssues: string[] = [];
  const total = p.txns.length + p.rowsSkipped;
  const parseRate = total > 0 ? p.txns.length / total : 0;
  let balanceScore: number | null = null;
  if (p.balanceChecked > 0) {
    balanceScore = (p.balanceChecked - p.balanceBreaks) / p.balanceChecked;
    if (p.balanceBreaks > 0)
      qualityIssues.push(
        `${p.balanceBreaks} balance reconciliation break${p.balanceBreaks === 1 ? "" : "s"} across ${p.balanceChecked} checked rows - the running balance does not always match debits/credits, so the ledger may be incomplete or altered.`,
      );
  } else {
    qualityIssues.push("No running-balance column: ledger completeness cannot be independently verified.");
  }
  // Duplicates.
  const seen = new Map<string, number>();
  for (const t of p.txns) {
    const k = `${t.postingDate}|${t.direction}|${t.amountKwd.toFixed(3)}|${t.narrative ?? ""}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let dups = 0;
  for (const c of seen.values()) if (c > 1) dups += c - 1;
  if (dups > 0) qualityIssues.push(`${dups} potential duplicate row${dups === 1 ? "" : "s"} (same date, direction, amount, narrative).`);
  if (p.rowsSkipped > 0 && parseRate < 0.98)
    qualityIssues.push(`${p.rowsSkipped} of ${total} rows could not be converted into transactions.`);

  const nonKwd = p.txns.filter((t) => t.currency !== "KWD").length;
  if (nonKwd > 0)
    notes.push(`${nonKwd} transactions in foreign currency converted to KWD with static reference rates.`);

  const dupPenalty = Math.min(1, dups / Math.max(1, p.txns.length * 0.05));
  const dataQuality = Math.max(
    0.05,
    Math.min(
      1,
      0.55 * parseRate + 0.3 * (balanceScore ?? 0.85) + 0.15 * (1 - dupPenalty),
    ),
  );

  const dates = p.txns.map((t) => t.postingDate).sort();
  let creditsKwd = 0;
  let debitsKwd = 0;
  for (const t of p.txns) {
    if (t.direction === "credit") creditsKwd += t.amountKwd;
    else debitsKwd += t.amountKwd;
  }

  return {
    bankLabel,
    txns: p.txns,
    rowsSkipped: p.rowsSkipped,
    mappingNotes: notes,
    qualityIssues,
    dataQuality,
    accountIds: [...accounts],
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    totalCreditsKwd: creditsKwd,
    totalDebitsKwd: debitsKwd,
  };
}
