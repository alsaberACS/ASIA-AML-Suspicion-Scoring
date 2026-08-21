import assert from "node:assert/strict";
import test from "node:test";
import { coerceAiInvestigation } from "./investigation-output.ts";

test("rejects invented evidence and enforces the score-language boundary", () => {
  const result = coerceAiInvestigation(
    {
      aiInvestigation: {
        executiveAssessment:
          "The suspicion probability is 88%, an Elevated risk band, risk is High, rating: Critical, or eighty percent based on [txn 999].",
        hypotheses: [
          {
            hypothesisId: "AI-HYP-01",
            title: "Possible funnel",
            priority: "high",
            status: "supported",
            rationale:
              "Supported by [txn 1] and fabricated [txn 999], transaction 999, and TECH-FAKE-01.",
            supportingTxnIds: [1, 999],
            contradictoryTxnIds: [2, 888],
            technicalFindingIds: ["TECH-NET-02", "FAKE-01"],
            benignExplanations: ["Documented collections activity"],
            unresolvedQuestions: ["Who controls [txn 999]?"],
          },
          {
            hypothesisId: "AI-HYP-02",
            title: "Unsupported assertion",
            priority: "unknown",
            status: "supported",
            rationale: "No cited evidence.",
            supportingTxnIds: [999],
          },
        ],
        recommendedActions: [
          {
            priority: "high",
            action: "Obtain source-of-funds records",
            rationale: "Test [txn 1]",
            evidenceNeeded: "Invoices",
          },
        ],
        limitations: ["Only 88% of records were available."],
      },
    },
    new Set([1, 2]),
    new Set(["TECH-NET-02"]),
  );

  assert.deepEqual(result.hypotheses[0].supportingTxnIds, [1]);
  assert.deepEqual(result.hypotheses[0].contradictoryTxnIds, [2]);
  assert.deepEqual(result.hypotheses[0].technicalFindingIds, ["TECH-NET-02"]);
  assert.match(result.hypotheses[0].rationale, /unsupported transaction reference removed/);
  assert.equal(result.hypotheses[1].status, "inconclusive");
  assert.equal(result.hypotheses[1].priority, "medium");
  assert.doesNotMatch(
    result.executiveAssessment,
    /\b88%|\bprobability\b|\belevated risk\b|\brisk is high\b|\brating: critical\b|\beighty percent\b/i,
  );
  assert.doesNotMatch(result.hypotheses[0].rationale, /transaction 999|TECH-FAKE-01|tech-fake-01/i);
  assert.match(result.executiveAssessment, /\[txn 1\]/);
  assert.doesNotMatch(result.limitations[0], /\b88%/);
});