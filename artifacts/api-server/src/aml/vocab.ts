import type { Channel, Direction } from "./types";

// Static FX table to KWD (heuristic cold-start countervalues; flagged in mapping notes when used).
export const FX_TO_KWD: Record<string, number> = {
  KWD: 1,
  KD: 1,
  USD: 0.307,
  EUR: 0.334,
  GBP: 0.388,
  SAR: 0.0819,
  AED: 0.0836,
  QAR: 0.0843,
  BHD: 0.814,
  OMR: 0.798,
  EGP: 0.0063,
  INR: 0.0037,
  PKR: 0.0011,
  PHP: 0.0053,
  LKR: 0.001,
  BDT: 0.0026,
  NPR: 0.0023,
  JOD: 0.433,
  TRY: 0.0075,
  CNY: 0.0424,
  JPY: 0.002,
};

// Correspondent BIC prefixes -> bank names (Kuwait retail banks).
export const BIC_BANKS: Array<[RegExp, string]> = [
  [/BOUB/i, "Boubyan Bank"],
  [/NBOK|NBKK/i, "National Bank of Kuwait"],
  [/KFIN|KFHK/i, "Kuwait Finance House"],
  [/GULB/i, "Gulf Bank"],
  [/CBKU|COMB/i, "Commercial Bank of Kuwait"],
  [/ABKK/i, "Al Ahli Bank of Kuwait"],
  [/BRGN|BURG/i, "Burgan Bank"],
  [/KWIB/i, "Kuwait International Bank"],
  [/WRBA|WARB/i, "Warba Bank"],
];

export const FILENAME_BANKS: Array<[RegExp, string]> = [
  [/بوبيان|boubyan/i, "Boubyan Bank"],
  [/الوطني|\bnbk\b/i, "National Bank of Kuwait"],
  [/بيتك|التمويل|\bkfh\b/i, "Kuwait Finance House"],
  [/الخليج|gulf/i, "Gulf Bank"],
  [/التجاري|commercial|\bcbk\b/i, "Commercial Bank of Kuwait"],
  [/الأهلي|الاهلي|ahli/i, "Al Ahli Bank of Kuwait"],
  [/برقان|burgan/i, "Burgan Bank"],
  [/وربة|warba/i, "Warba Bank"],
];

// FATF call-for-action + selected increased-monitoring jurisdictions (2025 snapshot).
export const FATF_BLACK = new Set(["IRAN", "IR", "NORTH KOREA", "DPRK", "KP", "MYANMAR", "MM"]);
export const FATF_GREY = new Set([
  "SYRIA", "SY", "YEMEN", "YE", "SOUTH SUDAN", "SS", "DR CONGO", "DRC", "CD",
  "HAITI", "HT", "VENEZUELA", "VE", "MONACO", "MC", "CROATIA", "HR",
  "MALI", "ML", "MOZAMBIQUE", "MZ", "NAMIBIA", "NA", "NIGERIA", "NG",
  "BURKINA FASO", "BF", "CAMEROON", "CM", "VIETNAM", "VN", "ALGERIA", "DZ",
  "ANGOLA", "AO", "COTE D'IVOIRE", "CI", "LEBANON", "LB", "BULGARIA", "BG",
]);

export function countryRisk(country: string | null): "black" | "grey" | null {
  if (!country) return null;
  const c = country.trim().toUpperCase();
  if (FATF_BLACK.has(c)) return "black";
  if (FATF_GREY.has(c)) return "grey";
  return null;
}

const RX = {
  cashDeposit: /cash\s?dep|cdm|cash in|deposit.*cash|إيداع نقد|ايداع نقد|ايداع كاش/i,
  deposit: /deposit|إيداع|ايداع/i,
  atm: /\batm\b|cash\s?w(?:ithdrawal|d)|\bcwd\b|\bwdl\b|سحب نقدي|سحب الي|سحب آلي/i,
  withdrawal: /withdraw|سحب/i,
  salary: /salary|payroll|راتب|رواتب|wages/i,
  pos: /\bpos\b|point of sale|knet|purchase|مشتريات|نقطة بيع/i,
  cheque: /cheque|chq|\bcheck\b|شيك/i,
  fee: /\bfee\b|charge|commission|\bcomm\b|عمولة|رسوم|svc chg|service chg/i,
  interest: /interest|profit share|murabaha|dividend|فوائد|فائدة|أرباح|ارباح/i,
  transfer: /transfer|\btrf\b|\btt\b|swift|wire|remit|instapay|insta pay|instant pay|\biban\b|حوالة|تحويل|مناقلة/i,
  self: /own account|own transfer|self|same customer|بين حساباته|حسابه الآخر|تحويل ذاتي|لنفس العميل/i,
};

export function classifyChannel(args: {
  narrative: string | null;
  extra: string | null; // tran code / type text etc.
  direction: Direction;
  hasCounterparty: boolean;
}): Channel {
  const text = [args.narrative ?? "", args.extra ?? ""].join(" ").toLowerCase();
  const t = text.trim();
  if (t.length > 0) {
    if (args.direction === "credit" && RX.cashDeposit.test(t)) return "cash_deposit";
    if (args.direction === "debit" && RX.atm.test(t)) return "cash_withdrawal";
    if (RX.salary.test(t) && args.direction === "credit") return "salary";
    if (RX.pos.test(t) && args.direction === "debit") return "pos";
    if (RX.cheque.test(t)) return "cheque";
    if (RX.interest.test(t)) return "interest";
    if (RX.fee.test(t) && args.direction === "debit") return "fee";
    if (RX.transfer.test(t)) return args.direction === "credit" ? "transfer_in" : "transfer_out";
    // generic cash mentions
    if (/cash|نقد/i.test(t)) {
      if (args.direction === "credit" && RX.deposit.test(t)) return "cash_deposit";
      if (args.direction === "debit" && RX.withdrawal.test(t)) return "cash_withdrawal";
      return args.direction === "credit" ? "cash_deposit" : "cash_withdrawal";
    }
    if (RX.deposit.test(t) && args.direction === "credit" && !args.hasCounterparty) return "cash_deposit";
    if (RX.withdrawal.test(t) && args.direction === "debit" && !args.hasCounterparty) return "cash_withdrawal";
  }
  if (args.hasCounterparty) return args.direction === "credit" ? "transfer_in" : "transfer_out";
  return "other";
}

const NAME_STOPWORDS = /^(from|fro|ref|kwd|usd|eur|through|via|the|own|self|transfer|to)\b/i;

const CRYPTO_RX =
  /\b(binance|usdt|usdc|btc|eth\b|bitcoin|ethereum|crypto|digital currency|virtual currency|coinbase|kraken|kucoin|okx|bybit|bitoasis|rain exchange|nft)\b/i;

/** Narrative references a virtual-asset service provider or crypto purchase. */
export function isCryptoNarrative(narrative: string | null): boolean {
  return narrative != null && CRYPTO_RX.test(narrative);
}

/**
 * Statements frequently bury the counterparty inside the narrative instead of
 * a dedicated column ("Transfer from  01326XXXXX ANWAR H", "InstaPay Credit :
 * 865887-663XXXXX", "Transfer From: 100600XXXX"). Extracting these unlocks the
 * fan-in / concentration features that a column-only reader would miss.
 */
export function extractCounterpartyFromNarrative(narrative: string | null): string | null {
  if (!narrative) return null;
  const n = narrative.replace(/\s+/g, " ").trim();

  let m = n.match(/instapay[^:]*:\s*\d+\s*[-\u2013]\s*([0-9X]{4,})/i);
  if (m) return `InstaPay ${m[1]}`;

  m = n.match(/transfer\s+from[:\s]+(?:([0-9X]{5,})\s+)?([A-Z][A-Za-z .'-]{3,40})/i);
  if (m?.[2] && !NAME_STOPWORDS.test(m[2].trim())) {
    const name = m[2].trim().replace(/[.,#|].*$/, "").trim();
    if (name.length >= 4 && !/^[0-9X\s.-]+$/i.test(name)) return name.slice(0, 40);
  }

  m = n.match(/transfer\s+(?:from|to)[:\s]+([0-9X]{4,})/i);
  if (m) return `Account ${m[1]}`;

  m = n.match(/account transfer\s+(?:from|to)\s+([0-9X]{4,})/i);
  if (m) return `Account ${m[1]}`;

  m = n.match(/operations\s+to\s+#\s*([0-9X]{4,})/i);
  if (m) return `Account ${m[1]}`;

  // Inward SWIFT lines repeat a party name between the amount and a pipe:
  // "INWARD SWIFT PAYMENT # X,  46000.000 KWD,FAHAD | ...". The name may be
  // the beneficiary rather than the remitter; ingestion suppresses it again
  // when it matches the subject.
  m = n.match(/swift[^|]*\|[^|]*KWD\s*,\s*([A-Z][A-Za-z .'-]{2,40}?)\s*\|/i);
  if (m?.[1]) {
    const name = m[1].trim();
    if (
      name.length >= 3 &&
      !NAME_STOPWORDS.test(name) &&
      !/^(normal|kwd|usd|eur)$/i.test(name) &&
      !/^[0-9X\s.-]+$/i.test(name)
    ) {
      return name.slice(0, 40);
    }
  }

  // POS narratives carry the merchant on the line after "POS PRCH" (or after
  // a "POS-" prefix), wide-space padded before the city column.
  const rawLines = narrative.split(/\r?\n/).map((line) => line.trim());
  let merchantLine: string | null = null;
  if (/^POS\s*PRCH/i.test(rawLines[0] ?? "") && rawLines.length > 1) {
    merchantLine = rawLines[1] ?? null;
  } else {
    const pm = (rawLines[0] ?? "").match(/^POS-(.{3,})$/i);
    if (pm) merchantLine = pm[1] ?? null;
  }
  if (merchantLine) {
    const merchant = merchantLine.split(/\s{2,}/)[0]?.trim() ?? "";
    if (
      merchant.length >= 4 &&
      /[A-Za-z]{3}/.test(merchant) &&
      !NAME_STOPWORDS.test(merchant) &&
      !/^(purchase|kuwait|kwt|visa|mastercard|knet)$/i.test(merchant)
    ) {
      return merchant.slice(0, 40);
    }
  }

  return null;
}

export function isSelfNarrative(narrative: string | null): boolean {
  if (!narrative) return false;
  return RX.self.test(narrative);
}

const VAGUE_TERMS = /^(transfer|trf|payment|pmt|misc|general|other|deposit|credit|debit|حوالة|تحويل|دفعة|ايداع|إيداع|مبلغ|عام)\.?$/i;

export function isVagueNarrative(narrative: string | null): boolean {
  if (!narrative) return true;
  const t = narrative.replace(/[0-9\-_/:#.]+/g, " ").trim();
  if (t.length < 6) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && words.every((w) => VAGUE_TERMS.test(w))) return true;
  return false;
}

export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bAL[-\s]/g, "AL")
    .replace(/[^A-Z\u0621-\u064A ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Token-overlap fuzzy match for person names (handles order + partial).
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(" ").filter((w) => w.length > 1));
  const tb = new Set(normalizeName(b).split(" ").filter((w) => w.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return common / Math.min(ta.size, tb.size);
}
