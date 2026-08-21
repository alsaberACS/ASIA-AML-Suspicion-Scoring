import assert from "node:assert/strict";
import test from "node:test";
import { computeTechnicalAnalysis } from "./technical.ts";

function txn(id, overrides = {}) {
  return {
    id,
    fileId: 1,
    bank: "Test Bank",
    accountId: "ACC-1",
    postingDate: "2026-01-01",
    direction: "credit",
    amountKwd: 500,
    currency: "KWD",
    channel: "transfer",
    counterpartyName: `Counterparty ${id}`,
    counterpartyBank: null,
    counterpartyCountry: "Kuwait",
    narrative: "Test transfer",
    runningBalance: null,
    isInternalTransfer: false,
    internalPairId: null,
    ...overrides,
  };
}

test("finds robust amount, concentration, sequence, and funnel signals", () => {
  const credits = [500, 510, 520, 530, 540, 550, 560, 570, 580, 5_000].map((amount, i) =>
    txn(i + 1, {
      postingDate: `2026-01-${String(i + 1).padStart(2, "0")}`,
      amountKwd: amount,
      counterpartyName: `Sender ${i + 1}`,
    }),
  );
  const debits = [500, 510, 520, 530, 540, 550].map((amount, i) =>
    txn(100 + i, {
      postingDate: `2026-01-${String(i + 2).padStart(2, "0")}`,
      direction: "debit",
      amountKwd: amount,
      counterpartyName: "Collector Trading",
    }),
  );

  const result = computeTechnicalAnalysis([...credits, ...debits], [], 0.92);
  const ids = new Set(result.findings.map((finding) => finding.findingId));
  assert.equal(result.engineVersion, "forensic-v1.1");
  assert.equal(result.testedTransactionCount, 16);
  assert.ok(ids.has("TECH-AMT-01"));
  assert.ok(ids.has("TECH-NET-01"));
  assert.ok(ids.has("TECH-SEQ-01"));
  assert.ok(ids.has("TECH-NET-02"));
  assert.ok(
    result.findings
      .flatMap((finding) => finding.txnIds)
      .every((id) => [...credits, ...debits].some((candidate) => candidate.id === id)),
  );
});

test("detects a sustained active-month behavior change", () => {
  const amounts = [1_000, 1_100, 900, 5_000, 5_200, 4_800];
  const txns = amounts.map((amount, i) =>
    txn(i + 1, {
      postingDate: `2026-${String(i + 1).padStart(2, "0")}-15`,
      amountKwd: amount,
    }),
  );

  const result = computeTechnicalAnalysis(txns, [], 1);
  const finding = result.findings.find((item) => item.findingId === "TECH-TMP-01");
  assert.ok(finding);
  assert.equal(finding.category, "behavior_change");
  assert.ok(finding.metricValue >= 4);
});

test("gates methods when there is not enough evidence", () => {
  const result = computeTechnicalAnalysis([txn(1), txn(2)], [], 0.6);
  const gated = new Set(result.gatedTests.map((item) => item.testId));
  assert.equal(result.findings.length, 0);
  assert.ok(gated.has("robust_amount_outliers"));
  assert.ok(gated.has("behavioral_change_point"));
  assert.ok(gated.has("counterparty_concentration"));
  assert.ok(gated.has("rapid_pass_through_sequences"));
  assert.ok(gated.has("network_circulation"));
  assert.ok(gated.has("cross_bank_counterparty_bridging"));
  assert.ok(gated.has("cross_bank_burst_synchronization"));
  assert.ok(gated.has("cross_bank_role_specialization"));
  assert.ok(gated.has("cross_bank_amount_echoes"));
});

test("does not infer pass-through ordering from same-day statement rows", () => {
  const txns = [
    txn(1, { postingDate: "2026-01-10", amountKwd: 1_000 }),
    txn(2, { postingDate: "2026-01-10", amountKwd: 2_000 }),
    txn(3, { postingDate: "2026-01-10", direction: "debit", amountKwd: 1_000 }),
    txn(4, { postingDate: "2026-01-10", direction: "debit", amountKwd: 2_000 }),
  ];
  const result = computeTechnicalAnalysis(txns, [], 1);
  assert.equal(
    result.findings.some((finding) => finding.findingId === "TECH-SEQ-01"),
    false,
  );
});

test("requires a reversed own-account route for circulation", () => {
  const txns = [
    txn(1, { bank: "Bank A", accountId: "A", direction: "debit", amountKwd: 5_000 }),
    txn(2, { bank: "Bank B", accountId: "B", amountKwd: 5_000 }),
    txn(3, {
      bank: "Bank B",
      accountId: "B",
      postingDate: "2026-01-08",
      direction: "debit",
      amountKwd: 4_900,
    }),
    txn(4, {
      bank: "Bank A",
      accountId: "A",
      postingDate: "2026-01-08",
      amountKwd: 4_900,
    }),
  ];
  const pair = (id, debitTxnId, creditTxnId, amountKwd) => ({
    id,
    debitTxnId,
    creditTxnId,
    amountKwd,
    dateGapDays: 0,
    confidence: 1,
    reason: "test",
  });
  const loopResult = computeTechnicalAnalysis(
    txns,
    [pair(1, 1, 2, 5_000), pair(2, 3, 4, 4_900)],
    1,
  );
  assert.ok(loopResult.findings.some((finding) => finding.findingId === "TECH-NET-03"));

  const oneWayResult = computeTechnicalAnalysis(
    txns,
    [pair(1, 1, 2, 5_000), pair(2, 4, 3, 4_900)],
    1,
  );
  assert.equal(
    oneWayResult.findings.some((finding) => finding.findingId === "TECH-NET-03"),
    false,
  );
});

test("does not reuse a transfer edge across overlapping return loops", () => {
  const txns = [
    txn(1, { bank: "Bank A", accountId: "A", direction: "debit", amountKwd: 5_000 }),
    txn(2, { bank: "Bank B", accountId: "B", amountKwd: 5_000 }),
    txn(3, { bank: "Bank B", accountId: "B", postingDate: "2026-01-08", direction: "debit", amountKwd: 5_000 }),
    txn(4, { bank: "Bank A", accountId: "A", postingDate: "2026-01-08", amountKwd: 5_000 }),
    txn(5, { bank: "Bank A", accountId: "A", postingDate: "2026-01-14", direction: "debit", amountKwd: 5_000 }),
    txn(6, { bank: "Bank B", accountId: "B", postingDate: "2026-01-14", amountKwd: 5_000 }),
  ];
  const pairs = [
    { id: 1, debitTxnId: 1, creditTxnId: 2, amountKwd: 5_000, dateGapDays: 0, confidence: 1, reason: "test" },
    { id: 2, debitTxnId: 3, creditTxnId: 4, amountKwd: 5_000, dateGapDays: 0, confidence: 1, reason: "test" },
    { id: 3, debitTxnId: 5, creditTxnId: 6, amountKwd: 5_000, dateGapDays: 0, confidence: 1, reason: "test" },
  ];
  const finding = computeTechnicalAnalysis(txns, pairs, 1).findings.find(
    (item) => item.findingId === "TECH-NET-03",
  );
  assert.ok(finding);
  assert.equal(finding.metricValue, 1);
});

test("measures counterparty bridging across banks with name normalization", () => {
  const txns = [
    txn(1, { bank: "Bank A", counterpartyName: "AL RASHID TRADING", amountKwd: 1_000 }),
    txn(2, { bank: "Bank A", postingDate: "2026-01-05", counterpartyName: "AL RASHID TRADING", amountKwd: 1_000 }),
    txn(3, { bank: "Bank A", postingDate: "2026-01-09", counterpartyName: "AL RASHID TRADING", amountKwd: 1_000 }),
    txn(4, { bank: "Bank B", postingDate: "2026-02-01", counterpartyName: "Al Rashid  Trading", amountKwd: 1_500 }),
    txn(5, { bank: "Bank B", postingDate: "2026-02-11", counterpartyName: "Al Rashid  Trading", amountKwd: 1_500 }),
  ];
  const result = computeTechnicalAnalysis(txns, [], 1);
  const finding = result.findings.find((item) => item.findingId === "TECH-XB-01");
  assert.ok(finding);
  assert.equal(finding.category, "cross_bank_pattern");
  assert.equal(finding.metricValue, 1);
  assert.deepEqual([...finding.txnIds].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("measures synchronized bursts only inside overlapping coverage", () => {
  const txns = [];
  let id = 1;
  for (let month = 1; month <= 8; month++) {
    const mm = String(month).padStart(2, "0");
    txns.push(
      txn(id++, {
        bank: "Bank A",
        postingDate: `2026-${mm}-10`,
        amountKwd: month === 3 || month === 6 ? 6_000 : 1_000,
      }),
    );
    txns.push(
      txn(id++, {
        bank: "Bank B",
        postingDate: `2026-${mm}-12`,
        amountKwd: month === 3 || month === 6 ? 5_000 : 800,
      }),
    );
  }
  const synced = computeTechnicalAnalysis(txns, [], 1);
  const finding = synced.findings.find((item) => item.findingId === "TECH-XB-02");
  assert.ok(finding);
  assert.equal(finding.metricValue, 4);

  const disjoint = txns.map((t) =>
    t.bank === "Bank B" ? { ...t, postingDate: t.postingDate.replace("2026-", "2027-") } : t,
  );
  const gatedResult = computeTechnicalAnalysis(disjoint, [], 1);
  assert.equal(
    gatedResult.findings.some((item) => item.findingId === "TECH-XB-02"),
    false,
  );
  assert.ok(gatedResult.gatedTests.some((item) => item.testId === "cross_bank_burst_synchronization"));
});

test("does not inflate burst lift across sparse coverage gaps", () => {
  // Two banks each active in the same 8 scattered months spanning 2021-2024.
  // Under an inclusive-interval window (40 calendar months) the lift would be
  // ~13x; over the 8 jointly active months it is 2.7x, below the 3x bar.
  const txns = [];
  let id = 1;
  const months = ["2021-01", "2021-02", "2021-03", "2021-04", "2024-01", "2024-02", "2024-03", "2024-04"];
  for (const month of months) {
    txns.push(
      txn(id++, {
        bank: "Bank A",
        postingDate: `${month}-10`,
        amountKwd: month === "2021-02" || month === "2024-02" ? 6_000 : 1_000,
      }),
    );
    txns.push(
      txn(id++, {
        bank: "Bank B",
        postingDate: `${month}-12`,
        amountKwd: ["2021-02", "2024-02", "2024-03"].includes(month) ? 5_000 : 800,
      }),
    );
  }
  const result = computeTechnicalAnalysis(txns, [], 1);
  assert.equal(
    result.findings.some((item) => item.findingId === "TECH-XB-02"),
    false,
  );
  // The pair WAS comparable (8 jointly active months), so this is an honest
  // negative, not a gate.
  assert.equal(
    result.gatedTests.some((item) => item.testId === "cross_bank_burst_synchronization"),
    false,
  );
});

test("detects placement and extraction role specialization across banks", () => {
  const txns = [];
  let id = 1;
  for (let i = 0; i < 5; i++) {
    txns.push(txn(id++, { bank: "Bank A", postingDate: `2026-01-0${i + 1}`, channel: "cash_deposit", amountKwd: 2_000 }));
    txns.push(txn(id++, { bank: "Bank A", postingDate: `2026-01-1${i}`, direction: "debit", channel: "transfer_out", amountKwd: 1_900 }));
    txns.push(txn(id++, { bank: "Bank B", postingDate: `2026-02-0${i + 1}`, channel: "transfer_in", amountKwd: 1_800 }));
    txns.push(txn(id++, { bank: "Bank B", postingDate: `2026-02-1${i}`, direction: "debit", channel: "cash_withdrawal", amountKwd: 1_700 }));
  }
  const result = computeTechnicalAnalysis(txns, [], 1);
  const finding = result.findings.find((item) => item.findingId === "TECH-XB-03");
  assert.ok(finding);
  assert.equal(finding.metricValue, 2);
});

test("flags cross-bank amount echoes but not recognized internal transfers", () => {
  const txns = [
    txn(1, { bank: "Bank A", postingDate: "2026-01-10", direction: "debit", channel: "cash_withdrawal", amountKwd: 2_000 }),
    txn(2, { bank: "Bank B", postingDate: "2026-01-11", channel: "cash_deposit", amountKwd: 1_990 }),
    txn(3, { bank: "Bank A", postingDate: "2026-02-01", direction: "debit", channel: "transfer_out", amountKwd: 1_500 }),
    txn(4, { bank: "Bank B", postingDate: "2026-02-02", channel: "transfer_in", amountKwd: 1_485 }),
  ];
  const result = computeTechnicalAnalysis(txns, [], 1);
  const finding = result.findings.find((item) => item.findingId === "TECH-XB-04");
  assert.ok(finding);
  assert.deepEqual([...finding.txnIds].sort((a, b) => a - b), [1, 2, 3, 4]);

  const pair = (id, debitTxnId, creditTxnId, amountKwd) => ({
    id,
    debitTxnId,
    creditTxnId,
    amountKwd,
    dateGapDays: 1,
    confidence: 1,
    reason: "test",
  });
  const excluded = computeTechnicalAnalysis(txns, [pair(1, 1, 2, 2_000), pair(2, 3, 4, 1_500)], 1);
  assert.equal(
    excluded.findings.some((item) => item.findingId === "TECH-XB-04"),
    false,
  );
});