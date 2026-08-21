import test from "node:test";
import assert from "node:assert/strict";

import { findInternalPairs } from "./netting.ts";
import { computeFeatures } from "./features.ts";
import { evaluateRules } from "./rules.ts";
import { aggregate } from "./scoring.ts";
import { GOLDEN_CASES } from "./golden-fixtures.ts";

/**
 * Golden case regression suite.
 *
 * Each synthetic subject has a known correct outcome. The suite mirrors the
 * production orchestration exactly (netting -> flag mutation -> features ->
 * rules -> aggregation, dataQuality = 1) and pins:
 *   - which rules fire (exact set - no more, no less),
 *   - the resulting band,
 *   - cross-case severity ordering.
 * A failing golden case means the scoring behavior changed. That is either a
 * regression or a deliberate re-elicitation; the latter must update these
 * expectations together with a stated rationale.
 */

function scoreCase(gc) {
  const txns = gc.txns.map((t) => ({ ...t }));
  const pairs = findInternalPairs(txns, gc.profile.subjectName);
  const internalIds = new Map();
  for (const p of pairs) {
    internalIds.set(p.debitTxnId, p.id);
    internalIds.set(p.creditTxnId, p.id);
  }
  for (const t of txns) {
    const pid = internalIds.get(t.id);
    if (pid != null) {
      t.isInternalTransfer = true;
      t.internalPairId = pid;
    }
  }
  const bundle = computeFeatures(txns, pairs, gc.profile);
  const hits = evaluateRules(bundle, txns, gc.profile);
  const score = aggregate(hits, bundle.features, 1);
  return { score, hits, bundle, pairs };
}

const results = new Map(GOLDEN_CASES.map((gc) => [gc.name, scoreCase(gc)]));

// Transparency: print the whole landscape whenever the suite runs.
for (const gc of GOLDEN_CASES) {
  const r = results.get(gc.name);
  const fired = r.hits.filter((h) => h.fired).map((h) => h.ruleId);
  console.log(
    `[golden] ${gc.name.padEnd(22)} p=${r.score.probability.toFixed(4)} ${r.score.band.padEnd(9)} fired=[${fired.join(", ")}] pairs=${r.pairs.length}`,
  );
}

function firedSet(name) {
  return results
    .get(name)
    .hits.filter((h) => h.fired)
    .map((h) => h.ruleId)
    .sort();
}

test("clean salary account stays quiet on every axis", () => {
  const r = results.get("clean-salary");
  assert.deepEqual(firedSet("clean-salary"), []);
  assert.equal(r.score.band, "Low");
  assert.ok(r.score.probability < 0.05);
  const hot = r.bundle.features.filter((f) => f.zone === "elevated" || f.zone === "critical");
  assert.deepEqual(hot.map((f) => f.key), []);
});

test("retiree pension account stays quiet", () => {
  const r = results.get("clean-retiree");
  assert.deepEqual(firedSet("clean-retiree"), []);
  assert.equal(r.score.band, "Low");
  assert.ok(r.score.probability < 0.05);
});

test("structuring archetype fires exactly the threshold typology", () => {
  const r = results.get("structuring");
  assert.deepEqual(firedSet("structuring"), ["R-CASH-01", "R-STRUCT-01", "R-STRUCT-02"]);
  assert.equal(r.score.band, "Elevated");
  assert.ok(r.score.probability >= 0.35 && r.score.probability < 0.5);
});

test("funnel archetype fires funnel, pass-through and narrative rules", () => {
  const r = results.get("funnel");
  assert.deepEqual(firedSet("funnel"), ["R-FUNNEL-01", "R-LAYER-01", "R-NARR-01"]);
  assert.ok(r.score.probability >= 0.2 && r.score.probability < 0.5);
  assert.equal(r.score.band, "Elevated");
});

test("layering relay fires the full layering family and nets 4 internal pairs", () => {
  const r = results.get("layering-relay");
  assert.equal(r.pairs.length, 4);
  assert.deepEqual(firedSet("layering-relay"), ["R-CIRC-01", "R-LAYER-01", "R-LAYER-02", "R-LAYER-03"]);
  assert.ok(r.score.probability >= 0.2 && r.score.probability < 0.5);
  assert.equal(r.score.band, "Elevated");
});

test("dormant reactivation is flagged but stays proportionate (Moderate)", () => {
  const r = results.get("dormant-reactivation");
  assert.deepEqual(firedSet("dormant-reactivation"), ["R-DORM-01", "R-VEL-01"]);
  assert.equal(r.score.band, "Moderate");
  assert.ok(r.score.probability >= 0.05 && r.score.probability < 0.2);
});

test("compound abuse reaches Critical through four independent families", () => {
  const r = results.get("compound");
  assert.deepEqual(firedSet("compound"), ["R-CASH-01", "R-GEO-01", "R-LAYER-03", "R-STRUCT-01", "R-STRUCT-02"]);
  assert.equal(r.score.band, "Critical");
  assert.ok(r.score.probability >= 0.8);
});

test("severity ordering across the landscape is monotone", () => {
  const p = (name) => results.get(name).score.probability;
  assert.ok(p("clean-salary") < 0.05);
  assert.ok(p("clean-retiree") < 0.05);
  assert.ok(p("clean-salary") < p("dormant-reactivation"));
  assert.ok(p("clean-retiree") < p("dormant-reactivation"));
  assert.ok(p("dormant-reactivation") < p("funnel"));
  assert.ok(p("dormant-reactivation") < p("layering-relay"));
  assert.ok(p("funnel") < p("compound"));
  assert.ok(p("layering-relay") < p("compound"));
  assert.ok(p("structuring") < p("compound"));
});
