/**
 * Deterministic verification of AI-produced evidence citations.
 *
 * After the AI layers finish, every checkable claim they made is re-checked
 * against the case data that actually exists:
 *
 *  - typology findings: cited transaction ids (structured + inline [txn N])
 *  - typology findings: cited feature values vs the engineered features
 *  - critic scenarios: referenced finding names vs real findings/rules/tests
 *  - investigation hypotheses: supporting/contradictory transaction ids
 *  - case memo: inline [txn N] citations
 *
 * The result is persisted on the run so the console can state, honestly,
 * how much of the narrative is anchored to verifiable records. A citation
 * failure never blocks the run - it is surfaced, not silently dropped.
 */
import { db, analysisRunsTable, transactionsTable, type AnalysisRunRow } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AiVerificationSection {
  section: string;
  label: string;
  citationsChecked: number;
  citationsValid: number;
  issues: string[];
}

export interface AiVerification {
  verifiedAt: string;
  overall: "verified" | "issues";
  totalChecked: number;
  totalValid: number;
  sections: AiVerificationSection[];
}

const MAX_ISSUES = 10;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Extract every transaction id cited inline as [txn 123] / [txn 12, 14]. */
function extractInlineTxnIds(text: string): number[] {
  const ids: number[] = [];
  for (const m of text.matchAll(/\[txn[^\]]*\]/gi)) {
    for (const d of m[0].match(/\d+/g) ?? []) ids.push(Number(d));
  }
  return ids;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function checkIds(
  ids: number[],
  txnIds: Set<number>,
  context: string,
  section: { citationsChecked: number; citationsValid: number; issues: string[] },
) {
  for (const id of ids) {
    section.citationsChecked++;
    if (txnIds.has(id)) section.citationsValid++;
    else if (section.issues.length < MAX_ISSUES)
      section.issues.push(`${context}: cites transaction ${id}, which does not exist in this case`);
  }
}

export function buildAiVerification(run: AnalysisRunRow, txnIds: Set<number>): AiVerification {
  const sections: AiVerificationSection[] = [];

  // 1. Typology findings - transaction citations (structured + inline).
  const typology = { section: "typology_citations", label: "Typology transaction citations", citationsChecked: 0, citationsValid: 0, issues: [] as string[] };
  const findings = asArray(run.typologyFindings) as Array<Record<string, unknown>>;
  for (const f of findings) {
    const name = typeof f.typologyName === "string" ? f.typologyName : "typology finding";
    checkIds(asArray(f.supportingTxnIds).filter((x): x is number => typeof x === "number"), txnIds, `"${name}"`, typology);
    if (typeof f.reasoning === "string") checkIds(extractInlineTxnIds(f.reasoning), txnIds, `"${name}" reasoning`, typology);
    // Citations the AI invented and ingestion rejected: preserved by
    // coercion precisely so they count as failed checks here.
    for (const rid of asArray(f.rejectedTxnIds).filter((x): x is number => typeof x === "number")) {
      typology.citationsChecked++;
      if (typology.issues.length < MAX_ISSUES)
        typology.issues.push(`"${name}": cited transaction ${rid}, which does not exist in this case`);
    }
  }
  sections.push(typology);

  // 2. Typology findings - cited feature values vs engineered features.
  const featSection = { section: "typology_features", label: "Typology feature citations", citationsChecked: 0, citationsValid: 0, issues: [] as string[] };
  const realFeatures = new Map<string, number>();
  for (const fv of asArray(run.features) as Array<Record<string, unknown>>) {
    if (typeof fv.value !== "number") continue;
    if (typeof fv.key === "string") realFeatures.set(norm(fv.key), fv.value);
    if (typeof fv.label === "string") realFeatures.set(norm(fv.label), fv.value);
  }
  for (const f of findings) {
    const name = typeof f.typologyName === "string" ? f.typologyName : "typology finding";
    for (const sf of asArray(f.supportingFeatures) as Array<Record<string, unknown>>) {
      if (typeof sf.feature !== "string" || typeof sf.value !== "number") continue;
      featSection.citationsChecked++;
      const actual = realFeatures.get(norm(sf.feature));
      if (actual == null) {
        if (featSection.issues.length < MAX_ISSUES)
          featSection.issues.push(`"${name}": references feature "${sf.feature}" which the engine did not compute`);
        continue;
      }
      const tolerance = Math.max(0.01, Math.abs(actual) * 0.01);
      if (Math.abs(sf.value - actual) <= tolerance) featSection.citationsValid++;
      else if (featSection.issues.length < MAX_ISSUES)
        featSection.issues.push(
          `"${name}": quotes feature "${sf.feature}" as ${sf.value} but the engine computed ${actual}`,
        );
    }
  }
  sections.push(featSection);

  // 3. Critic scenarios - referenced findings must be real findings/rules/tests.
  const critic = { section: "critic_references", label: "Critic finding references", citationsChecked: 0, citationsValid: 0, issues: [] as string[] };
  const referencePool: string[] = [];
  for (const f of findings) {
    if (typeof f.typologyId === "string") referencePool.push(norm(f.typologyId));
    if (typeof f.typologyName === "string") referencePool.push(norm(f.typologyName));
  }
  for (const rh of asArray(run.ruleHits) as Array<Record<string, unknown>>) {
    if (typeof rh.ruleId === "string") referencePool.push(norm(rh.ruleId));
    if (typeof rh.name === "string") referencePool.push(norm(rh.name));
    if (typeof rh.label === "string") referencePool.push(norm(rh.label));
  }
  const tech = (run.technicalAnalysis ?? {}) as Record<string, unknown>;
  for (const tf of asArray(tech.findings) as Array<Record<string, unknown>>) {
    if (typeof tf.findingId === "string") referencePool.push(norm(tf.findingId));
    if (typeof tf.testId === "string") referencePool.push(norm(tf.testId));
    if (typeof tf.title === "string") referencePool.push(norm(tf.title));
  }
  const matchesPool = (ref: string) => {
    const n = norm(ref);
    if (n.length < 4) return true; // too short to judge fairly
    return referencePool.some((p) => p.length >= 4 && (p.includes(n) || n.includes(p)));
  };
  for (const sc of asArray(run.criticScenarios) as Array<Record<string, unknown>>) {
    for (const ref of asArray(sc.explainsFindings)) {
      if (typeof ref !== "string") continue;
      critic.citationsChecked++;
      if (matchesPool(ref)) critic.citationsValid++;
      else if (critic.issues.length < MAX_ISSUES)
        critic.issues.push(`critic scenario references unrecognized finding: "${ref}"`);
    }
  }
  sections.push(critic);

  // 4. Investigation hypotheses - transaction citations.
  const invest = { section: "investigation_citations", label: "Investigation transaction citations", citationsChecked: 0, citationsValid: 0, issues: [] as string[] };
  const investigation = (run.aiInvestigation ?? {}) as Record<string, unknown>;
  for (const h of asArray(investigation.hypotheses) as Array<Record<string, unknown>>) {
    const title = typeof h.title === "string" ? h.title : "hypothesis";
    checkIds(asArray(h.supportingTxnIds).filter((x): x is number => typeof x === "number"), txnIds, `"${title}"`, invest);
    checkIds(asArray(h.contradictoryTxnIds).filter((x): x is number => typeof x === "number"), txnIds, `"${title}" (contradictory)`, invest);
  }
  sections.push(invest);

  // 5. Case memo - inline citations.
  const memo = { section: "memo_citations", label: "Case memo transaction citations", citationsChecked: 0, citationsValid: 0, issues: [] as string[] };
  if (typeof run.caseMemo === "string" && run.caseMemo.length > 0) {
    checkIds(extractInlineTxnIds(run.caseMemo), txnIds, "case memo", memo);
  }
  sections.push(memo);

  const totalChecked = sections.reduce((s, x) => s + x.citationsChecked, 0);
  const totalValid = sections.reduce((s, x) => s + x.citationsValid, 0);
  const hasIssues = sections.some((s) => s.issues.length > 0 || s.citationsValid < s.citationsChecked);
  return {
    verifiedAt: new Date().toISOString(),
    overall: hasIssues ? "issues" : "verified",
    totalChecked,
    totalValid,
    sections,
  };
}

/** Fetch, verify, persist. Never throws into the AI pipeline. */
export async function runAiVerification(runId: number): Promise<void> {
  const [run] = await db.select().from(analysisRunsTable).where(eq(analysisRunsTable.id, runId));
  if (!run) return;
  const txnRows = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(eq(transactionsTable.caseId, run.caseId));
  const report = buildAiVerification(run, new Set(txnRows.map((r) => r.id)));
  await db
    .update(analysisRunsTable)
    .set({ aiVerification: report as unknown })
    .where(eq(analysisRunsTable.id, runId));
}
