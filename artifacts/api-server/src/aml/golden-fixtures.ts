import type { Channel, Direction, SubjectProfile, Txn } from "./types";

/**
 * Golden case library.
 *
 * Seven synthetic subjects with KNOWN correct outcomes, run through the real
 * scoring chain (netting -> features -> rules -> Bayesian aggregation) by
 * golden-cases.test.mjs. They pin the discriminative behavior of the engine:
 * clean profiles must stay quiet, each laundering archetype must fire exactly
 * its own typology rules, and severity must rank compound abuse above single
 * patterns. Any tuning change that breaks these expectations is a regression
 * (or a deliberate re-elicitation that must update this file with rationale).
 *
 * Fixtures use dataQuality = 1 so scores reflect evidence, not shrinkage.
 */

export interface GoldenCase {
  name: string;
  description: string;
  profile: SubjectProfile;
  txns: Txn[];
}

interface TxnSpec {
  bank: string;
  accountId: string;
  postingDate: string;
  direction: Direction;
  amountKwd: number;
  channel: Channel;
  narrative?: string;
  counterpartyName?: string;
  counterpartyBank?: string;
  counterpartyCountry?: string;
}

function makeFactory(): (spec: TxnSpec) => Txn {
  let id = 0;
  return (spec) => ({
    id: ++id,
    fileId: 1,
    bank: spec.bank,
    accountId: spec.accountId,
    postingDate: spec.postingDate,
    direction: spec.direction,
    amountKwd: spec.amountKwd,
    currency: "KWD",
    channel: spec.channel,
    counterpartyName: spec.counterpartyName ?? null,
    counterpartyBank: spec.counterpartyBank ?? null,
    counterpartyCountry: spec.counterpartyCountry ?? null,
    narrative: spec.narrative ?? null,
    runningBalance: null,
    isInternalTransfer: false,
    internalPairId: null,
  });
}

function profile(
  subjectName: string,
  declaredMonthlyIncomeKwd: number,
  declaredOccupation: string,
): SubjectProfile {
  return {
    subjectName,
    declaredOccupation,
    declaredMonthlyIncomeKwd,
    declaredBusinessActivity: null,
    expectedCountries: ["Kuwait"],
    notes: null,
  };
}

/** ["2024-01", "2024-02", ...] */
function months(startYear: number, startMonth: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = startMonth - 1 + i;
    const y = startYear + Math.floor(m / 12);
    out.push(`${y}-${String((m % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Clean salary account - the specificity anchor. Nothing may fire.
// ---------------------------------------------------------------------------

function cleanSalary(): GoldenCase {
  const mk = makeFactory();
  const txns: Txn[] = [];
  for (const m of months(2024, 1, 24)) {
    txns.push(
      mk({ bank: "National Bank of Kuwait", accountId: "10001", postingDate: `${m}-25`, direction: "credit", amountKwd: 2500, channel: "salary", narrative: "SALARY PAYMENT ACME ENGINEERING CO", counterpartyName: "ACME ENGINEERING CO" }),
      mk({ bank: "National Bank of Kuwait", accountId: "10001", postingDate: `${m}-03`, direction: "debit", amountKwd: 412.35, channel: "pos", narrative: "KNET POS LULU HYPERMARKET SALMIYA" }),
      mk({ bank: "National Bank of Kuwait", accountId: "10001", postingDate: `${m}-09`, direction: "debit", amountKwd: 187.1, channel: "pos", narrative: "KNET POS SULTAN CENTER FARWANIYA" }),
      mk({ bank: "National Bank of Kuwait", accountId: "10001", postingDate: `${m}-14`, direction: "debit", amountKwd: 95.75, channel: "pos", narrative: "KNET POS CARREFOUR THE AVENUES" }),
      mk({ bank: "National Bank of Kuwait", accountId: "10001", postingDate: `${m}-18`, direction: "debit", amountKwd: 180.5, channel: "cash_withdrawal", narrative: "ATM CASH WITHDRAWAL SALMIYA BRANCH" }),
      mk({ bank: "National Bank of Kuwait", accountId: "10001", postingDate: `${m}-06`, direction: "debit", amountKwd: 95.25, channel: "transfer_out", narrative: "ELECTRICITY AND WATER BILL MEW", counterpartyName: "MINISTRY OF ELECTRICITY AND WATER" }),
    );
  }
  return {
    name: "clean-salary",
    description: "Salaried engineer, income matches inflows, ordinary consumption.",
    profile: profile("ABDULLA AL HOUTI", 2500, "Mechanical engineer"),
    txns,
  };
}

// ---------------------------------------------------------------------------
// 2. Retiree on a pension - low volume, modest cash use. Nothing may fire.
// ---------------------------------------------------------------------------

function cleanRetiree(): GoldenCase {
  const mk = makeFactory();
  const txns: Txn[] = [];
  for (const m of months(2024, 1, 18)) {
    txns.push(
      mk({ bank: "Burgan Bank", accountId: "20002", postingDate: `${m}-27`, direction: "credit", amountKwd: 1200, channel: "salary", narrative: "PENSION PAYMENT PIFSS MONTHLY", counterpartyName: "PUBLIC INSTITUTION FOR SOCIAL SECURITY" }),
      mk({ bank: "Burgan Bank", accountId: "20002", postingDate: `${m}-05`, direction: "debit", amountKwd: 89.4, channel: "pos", narrative: "KNET POS COOP SOCIETY HAWALLI" }),
      mk({ bank: "Burgan Bank", accountId: "20002", postingDate: `${m}-12`, direction: "debit", amountKwd: 34.6, channel: "pos", narrative: "KNET POS DAWAA PHARMACY" }),
      mk({ bank: "Burgan Bank", accountId: "20002", postingDate: `${m}-15`, direction: "debit", amountKwd: 150.25, channel: "cash_withdrawal", narrative: "ATM CASH WITHDRAWAL HAWALLI BRANCH" }),
      mk({ bank: "Burgan Bank", accountId: "20002", postingDate: `${m}-20`, direction: "debit", amountKwd: 60, channel: "transfer_out", narrative: "MONTHLY FAMILY SUPPORT AHMAD", counterpartyName: "AHMAD AL RASHED" }),
    );
  }
  return {
    name: "clean-retiree",
    description: "Pensioner, stable low-value consumption pattern.",
    profile: profile("UMM KHALED AL RASHED", 1200, "Retired teacher"),
    txns,
  };
}

// ---------------------------------------------------------------------------
// 3. Structuring - cash clustered under the KD 3,000 trigger, two banks,
//    including two coordinated same-day multi-bank placements.
//    Expected: R-STRUCT-01 + R-STRUCT-02 + R-CASH-01, Elevated.
// ---------------------------------------------------------------------------

function structuring(): GoldenCase {
  const mk = makeFactory();
  const A = { bank: "Gulf Bank", accountId: "30003" };
  const B = { bank: "Warba Bank", accountId: "30004" };
  const dep = (loc: typeof A, date: string, amountKwd: number) =>
    mk({ ...loc, postingDate: date, direction: "credit", amountKwd, channel: "cash_deposit", narrative: "CASH DEPOSIT BRANCH COUNTER" });
  const txns: Txn[] = [
    dep(A, "2025-01-04", 2465.5),
    dep(A, "2025-01-16", 2890.5),
    dep(A, "2025-01-22", 745.5),
    dep(A, "2025-02-03", 2540.25),
    dep(A, "2025-02-18", 2610.75),
    dep(A, "2025-03-08", 2620.5),
    dep(B, "2025-03-08", 2705.25), // same-day second bank, combined 5,325.75
    dep(A, "2025-03-21", 2480.5),
    dep(A, "2025-04-06", 2755.5),
    dep(B, "2025-04-25", 2830.25),
    dep(A, "2025-05-11", 2590.75),
    dep(B, "2025-05-11", 2660.5), // same-day second bank, combined 5,251.25
    dep(A, "2025-05-27", 2915.25),
    dep(A, "2025-06-05", 2585.25),
    dep(A, "2025-06-19", 640.75),
  ];
  for (const m of months(2025, 1, 6)) {
    txns.push(
      mk({ ...A, postingDate: `${m}-28`, direction: "debit", amountKwd: 2400.5, channel: "transfer_out", narrative: "MONTHLY TRANSFER TO AL TIJARI EXCHANGE", counterpartyName: "AL TIJARI EXCHANGE CO" }),
    );
  }
  return {
    name: "structuring",
    description: "Cash deposits clustered at 2,400-2,999 KWD, twice split across two banks on the same day.",
    profile: profile("SULTAN AL QASSAR", 1500, "Sales supervisor"),
    txns,
  };
}

// ---------------------------------------------------------------------------
// 4. Funnel account - many unrelated payers in, one collector out, vague
//    narratives. Expected: R-FUNNEL-01 + R-LAYER-01 + R-NARR-01.
// ---------------------------------------------------------------------------

const PAYERS = [
  "FAISAL AL MUTAIRI", "NOURA AL AJMI", "KHALED AL ENEZI", "MARIAM AL SHAMMARI",
  "YOUSEF AL RASHIDI", "DALAL AL HARBI", "SAAD AL DHAFEERI", "HESSA AL OTAIBI",
  "BADER AL AZMI", "LULWA AL KANDARI", "TALAL AL SUBAIE", "AISHA AL FADHLI",
  "NASSER AL MUTAWA", "SARA AL QATTAN", "HAMAD AL BUAIJAN", "GHALIA AL SANEA",
  "MISHAL AL THUWAINI", "FARAH AL BAHAR",
];

function funnel(): GoldenCase {
  const mk = makeFactory();
  const loc = { bank: "Commercial Bank of Kuwait", accountId: "40005" };
  const txns: Txn[] = [];
  const days = ["03", "09", "16", "23"];
  const ms = months(2025, 1, 8);
  let idx = 0;
  for (const m of ms) {
    for (const d of days) {
      const payer = PAYERS[idx % PAYERS.length]!;
      txns.push(
        mk({ ...loc, postingDate: `${m}-${d}`, direction: "credit", amountKwd: 610.5 + idx * 11.25, channel: "transfer_in", narrative: `TRANSFER FROM ${payer} INVOICE ${1000 + idx}`, counterpartyName: payer }),
      );
      idx++;
    }
  }
  // Six sizeable inflows carrying no economic story at all.
  const bigVague: Array<[string, number]> = [
    ["2025-01-12", 1150.5], ["2025-02-12", 1275.25], ["2025-03-12", 1330.75],
    ["2025-05-12", 1180.25], ["2025-06-12", 1420.5], ["2025-07-12", 1255.75],
  ];
  let p = 0;
  for (const [date, amountKwd] of bigVague) {
    txns.push(
      mk({ ...loc, postingDate: date, direction: "credit", amountKwd, channel: "transfer_in", narrative: "TRANSFER", counterpartyName: PAYERS[p++ % PAYERS.length]! }),
    );
  }
  const outAmounts = [3960.5, 3985.25, 3940.75, 3975.5, 3952.25, 3988.75, 3945.25, 3998.5];
  ms.forEach((m, i) => {
    txns.push(
      mk({ ...loc, postingDate: `${m}-26`, direction: "debit", amountKwd: outAmounts[i]!, channel: "transfer_out", narrative: "TRF", counterpartyName: "COLLECTOR GENERAL TRADING CO" }),
    );
  });
  return {
    name: "funnel",
    description: "18 unrelated payers feed one account; value passes through to a single collector.",
    profile: profile("SALEM AL AWADHI", 800, "Storekeeper"),
    txns,
  };
}

// ---------------------------------------------------------------------------
// 5. Layering relay - external credit at bank A, own-account hop A->B,
//    external exit at bank B, four times. Expected: all-layering rule set.
// ---------------------------------------------------------------------------

function layeringRelay(): GoldenCase {
  const mk = makeFactory();
  const A = { bank: "Gulf Bank", accountId: "50006" };
  const B = { bank: "Boubyan Bank", accountId: "50007" };
  const feeders = [5037.5, 5075.25, 5112.75, 5150.5];
  const exits = [4936.75, 4973.75, 5010.5, 5047.5];
  const shells = ["SHELLCORP ONE FZE", "SHELLCORP TWO FZE", "SHELLCORP THREE FZE", "SHELLCORP FOUR FZE"];
  const txns: Txn[] = [];
  months(2025, 1, 4).forEach((m, i) => {
    txns.push(
      mk({ ...A, postingDate: `${m}-06`, direction: "credit", amountKwd: feeders[i]!, channel: "transfer_in", narrative: `INCOMING SWIFT TRANSFER ${shells[i]} CONSULTING FEES`, counterpartyName: shells[i]! }),
      mk({ ...A, postingDate: `${m}-07`, direction: "debit", amountKwd: feeders[i]!, channel: "transfer_out", narrative: "TRANSFER TO OWN ACCOUNT BOUBYAN" }),
      mk({ ...B, postingDate: `${m}-08`, direction: "credit", amountKwd: feeders[i]!, channel: "transfer_in", narrative: "TRANSFER FROM OWN ACCOUNT GULF BANK" }),
      mk({ ...B, postingDate: `${m}-09`, direction: "debit", amountKwd: exits[i]!, channel: "transfer_out", narrative: "OUTGOING TRANSFER EXIT GENERAL TRADING", counterpartyName: "EXIT GENERAL TRADING CO" }),
    );
  });
  txns.push(
    mk({ ...A, postingDate: "2025-05-10", direction: "debit", amountKwd: 45.5, channel: "pos", narrative: "KNET POS SULTAN CENTER" }),
    mk({ ...A, postingDate: "2025-05-20", direction: "debit", amountKwd: 62.25, channel: "pos", narrative: "KNET POS LULU HYPERMARKET" }),
  );
  return {
    name: "layering-relay",
    description: "In-hop-out chains across two banks, each leg within days at matching magnitude.",
    profile: profile("BADER AL HAJRI", 2000, "Logistics coordinator"),
    txns,
  };
}

// ---------------------------------------------------------------------------
// 6. Dormant account reactivated as a conduit for one intense month.
//    Expected: R-DORM-01 + R-VEL-01, Moderate.
// ---------------------------------------------------------------------------

function dormantReactivation(): GoldenCase {
  const mk = makeFactory();
  const loc = { bank: "National Bank of Kuwait", accountId: "60008" };
  const txns: Txn[] = [];
  for (const m of months(2024, 1, 3)) {
    txns.push(
      mk({ ...loc, postingDate: `${m}-10`, direction: "credit", amountKwd: 300.5, channel: "transfer_in", narrative: "FAMILY SUPPORT KHALED", counterpartyName: "KHALED AL DABBOUS" }),
      mk({ ...loc, postingDate: `${m}-15`, direction: "debit", amountKwd: 120.25, channel: "pos", narrative: "KNET POS COOP SOCIETY" }),
    );
  }
  // 231 silent days, then a burst.
  const burst: Array<[string, Direction, number, Channel, string, string | undefined]> = [
    ["2024-11-01", "credit", 1850.5, "transfer_in", "INCOMING TRANSFER OMAR URGENT", "OMAR AL SHATTI"],
    ["2024-11-04", "credit", 2240.25, "transfer_in", "INCOMING TRANSFER REEM URGENT", "REEM AL BAGHLI"],
    ["2024-11-05", "debit", 1650.5, "cash_withdrawal", "ATM CASH WITHDRAWAL FAHAHEEL", undefined],
    ["2024-11-08", "credit", 1780.75, "transfer_in", "INCOMING TRANSFER SALEH URGENT", "SALEH AL QALLAF"],
    ["2024-11-09", "debit", 1900.25, "cash_withdrawal", "ATM CASH WITHDRAWAL FAHAHEEL", undefined],
    ["2024-11-11", "credit", 2005.5, "transfer_in", "INCOMING TRANSFER HUDA URGENT", "HUDA AL MULLA"],
    ["2024-11-13", "debit", 2100.75, "transfer_out", "TRANSFER TO EXCHANGE HOUSE", "GOLDEN EXCHANGE CO"],
    ["2024-11-16", "debit", 1950.5, "transfer_out", "TRANSFER TO EXCHANGE HOUSE", "GOLDEN EXCHANGE CO"],
  ];
  for (const [postingDate, direction, amountKwd, channel, narrative, counterpartyName] of burst) {
    txns.push(mk({ ...loc, postingDate, direction, amountKwd, channel, narrative, counterpartyName }));
  }
  return {
    name: "dormant-reactivation",
    description: "Seven quiet months, then 15,000 KWD moved through in two weeks.",
    profile: profile("MUNIRA AL SALEH", 600, "Homemaker"),
    txns,
  };
}

// ---------------------------------------------------------------------------
// 7. Compound abuse - structuring + relay layering + FATF-grey corridor.
//    The severity ceiling exemplar. Expected: five rules across four
//    families, Critical.
// ---------------------------------------------------------------------------

function compound(): GoldenCase {
  const mk = makeFactory();
  const A = { bank: "Gulf Bank", accountId: "70009" };
  const B = { bank: "Warba Bank", accountId: "70010" };
  const C = { bank: "Boubyan Bank", accountId: "70011" };
  const dep = (loc: typeof A, date: string, amountKwd: number) =>
    mk({ ...loc, postingDate: date, direction: "credit", amountKwd, channel: "cash_deposit", narrative: "CASH DEPOSIT BRANCH COUNTER" });
  const txns: Txn[] = [
    dep(A, "2025-01-05", 2610.5),
    dep(A, "2025-01-19", 2885.25),
    dep(A, "2025-02-04", 2540.75),
    dep(A, "2025-02-17", 2760.5),
    dep(A, "2025-03-09", 2650.25),
    dep(B, "2025-03-09", 2725.5), // same-day multibank placement
    dep(A, "2025-04-07", 2590.75),
    dep(A, "2025-05-12", 2680.25),
    dep(B, "2025-05-12", 2755.75), // same-day multibank placement
    dep(A, "2025-06-06", 2870.5),
  ];
  const relays: Array<{ m: string; feeder: number; exit: number; shell: string }> = [
    { m: "2025-02", feeder: 4850.5, exit: 4753.5, shell: "REGIONAL PARTNERS LLC" },
    { m: "2025-04", feeder: 4790.25, exit: 4694.25, shell: "LEVANT HOLDINGS SAL" },
  ];
  for (const r of relays) {
    txns.push(
      mk({ ...A, postingDate: `${r.m}-20`, direction: "credit", amountKwd: r.feeder, channel: "transfer_in", narrative: `INCOMING SWIFT TRANSFER ${r.shell}`, counterpartyName: r.shell, counterpartyCountry: "LEBANON" }),
      mk({ ...A, postingDate: `${r.m}-21`, direction: "debit", amountKwd: r.feeder, channel: "transfer_out", narrative: "TRANSFER TO OWN ACCOUNT BOUBYAN" }),
      mk({ ...C, postingDate: `${r.m}-22`, direction: "credit", amountKwd: r.feeder, channel: "transfer_in", narrative: "TRANSFER FROM OWN ACCOUNT GULF BANK" }),
      mk({ ...C, postingDate: `${r.m}-23`, direction: "debit", amountKwd: r.exit, channel: "transfer_out", narrative: "OUTGOING TRANSFER BEIRUT TRADING HOUSE", counterpartyName: "BEIRUT TRADING HOUSE", counterpartyCountry: "LEBANON" }),
    );
  }
  for (const m of months(2025, 1, 6)) {
    txns.push(
      mk({ ...A, postingDate: `${m}-26`, direction: "debit", amountKwd: 3200.5, channel: "transfer_out", narrative: "MONTHLY TRANSFER AL DIRWAZA EXCHANGE", counterpartyName: "AL DIRWAZA EXCHANGE CO" }),
    );
  }
  return {
    name: "compound",
    description: "Structured cash placement, own-account relay hops, and a FATF-grey exit corridor combined.",
    profile: profile("JASSIM AL FARSI", 1200, "Freelance broker"),
    txns,
  };
}

export const GOLDEN_CASES: GoldenCase[] = [
  cleanSalary(),
  cleanRetiree(),
  structuring(),
  funnel(),
  layeringRelay(),
  dormantReactivation(),
  compound(),
];
