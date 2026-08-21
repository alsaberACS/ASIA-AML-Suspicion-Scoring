import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, analysisRunsTable, casesTable, transactionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { ForcedMapping } from "./parse";
import type {
  FeatureValue,
  InternalPair,
  RuleHit,
  TechnicalAnalysis,
} from "./types";
import { coerceAiInvestigation } from "./investigation-output";

/**
 * LLM analyst layers (P3 typology analysis, P5 adversarial critic, P4 memo).
 *
 * Hard boundary per the system design: the LLM NEVER produces or adjusts the
 * suspicion probability. The deterministic engine computes the score; the
 * LLM reads evidence, reasons about typologies, argues the benign case, and
 * writes the memo - always citing transaction IDs from the provided data.
 */

const MODEL = "claude-sonnet-4-6";

export function aiAvailable(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  );
}

async function callClaude(system: string, user: string, maxTokens = 8192): Promise<string> {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");
}

function extractJson(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

async function callJson(system: string, user: string): Promise<unknown> {
  const first = await callClaude(system, user);
  try {
    return extractJson(first);
  } catch {
    const retry = await callClaude(
      system,
      `${user}\n\nYour previous reply was not valid JSON. Respond again with ONLY the JSON object - no prose, no code fences.`,
    );
    return extractJson(retry);
  }
}

// ---------------------------------------------------------------------------
// Column-mapping assistant (used when the heuristic parser cannot map a file).

export async function llmMapColumns(
  headers: string[],
  sampleRows: unknown[][],
): Promise<ForcedMapping | null> {
  if (!aiAvailable()) return null;
  const system =
    "You map messy bank-statement spreadsheet columns to a canonical schema. Reply with ONLY a JSON object.";
  const user = `Spreadsheet headers (in order):
${JSON.stringify(headers)}

First data rows:
${JSON.stringify(sampleRows.slice(0, 5))}

Identify the columns. Reply with ONLY JSON with any of these keys (omit keys that do not apply):
{
  "dateHeader": "<header of the transaction/posting date column>",
  "amountHeader": "<single amount column, if any>",
  "debitHeader": "<separate debit-amount column, if any>",
  "creditHeader": "<separate credit-amount column, if any>",
  "dcIndicatorHeader": "<debit/credit indicator column, if any>",
  "creditIndicatorValues": ["values in that column meaning CREDIT"],
  "typeTextHeader": "<column with textual type like Debit/Credit or Cash Deposit>",
  "balanceHeader": "<running balance column, if any>",
  "narrativeHeaders": ["description/remarks columns"],
  "accountHeader": "<account number column, if any>",
  "currencyHeader": "<currency column, if any>"
}`;
  try {
    const raw = (await callJson(system, user)) as Record<string, unknown>;
    const s = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
    const mapping: ForcedMapping = {
      dateHeader: s("dateHeader"),
      amountHeader: s("amountHeader"),
      debitHeader: s("debitHeader"),
      creditHeader: s("creditHeader"),
      dcIndicatorHeader: s("dcIndicatorHeader"),
      creditIndicatorValues: Array.isArray(raw.creditIndicatorValues)
        ? (raw.creditIndicatorValues as unknown[]).map(String)
        : undefined,
      typeTextHeader: s("typeTextHeader"),
      balanceHeader: s("balanceHeader"),
      narrativeHeaders: Array.isArray(raw.narrativeHeaders)
        ? (raw.narrativeHeaders as unknown[]).map(String)
        : undefined,
      accountHeader: s("accountHeader"),
      currencyHeader: s("currencyHeader"),
    };
    if (!mapping.dateHeader) return null;
    return mapping;
  } catch (err) {
    logger.error({ err }, "llmMapColumns failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Evidence pack construction for prompts.

interface TxnLite {
  id: number;
  postingDate: string;
  bank: string;
  direction: string;
  amountKwd: number;
  channel: string;
  counterpartyName: string | null;
  counterpartyCountry: string | null;
  narrative: string | null;
  isInternalTransfer: boolean;
}

function txnLine(t: TxnLite): string {
  const parts = [
    `[txn ${t.id}]`,
    t.postingDate,
    t.bank,
    t.direction === "credit" ? "IN" : "OUT",
    `${t.amountKwd.toFixed(3)} KWD`,
    t.channel,
  ];
  if (t.counterpartyName) parts.push(`cp:${t.counterpartyName}`);
  if (t.counterpartyCountry) parts.push(`country:${t.counterpartyCountry}`);
  if (t.narrative) parts.push(`"${t.narrative.slice(0, 90)}"`);
  if (t.isInternalTransfer) parts.push("(internal own-account move)");
  return parts.join(" | ");
}

function buildEvidence(args: {
  caseRow: typeof casesTable.$inferSelect;
  run: typeof analysisRunsTable.$inferSelect;
  txns: TxnLite[];
}): string {
  const { caseRow, run, txns } = args;
  const byId = new Map(txns.map((t) => [t.id, t]));
  const features = (run.features ?? []) as unknown as FeatureValue[];
  const ruleHits = (run.ruleHits ?? []) as unknown as RuleHit[];
  const pairs = (run.internalTransfers ?? []) as unknown as InternalPair[];
  const technical = (run.technicalAnalysis ?? {
    findings: [],
    gatedTests: [],
  }) as unknown as TechnicalAnalysis;
  const fired = ruleHits.filter((r) => r.fired);

  const monthly = new Map<string, { cin: number; cout: number }>();
  for (const t of txns) {
    const m = t.postingDate.slice(0, 7);
    const e = monthly.get(m) ?? { cin: 0, cout: 0 };
    if (t.direction === "credit") e.cin += t.amountKwd;
    else e.cout += t.amountKwd;
    monthly.set(m, e);
  }
  const monthLines = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, v]) => `${m}: in ${v.cin.toFixed(0)} / out ${v.cout.toFixed(0)}`)
    .join("; ");

  // Channel mix - lets the model see, for example, that a declared salaried
  // employee has zero salary-channel credits.
  const chanAgg = new Map<string, { n: number; v: number }>();
  for (const t of txns) {
    const key = `${t.channel} ${t.direction === "credit" ? "in" : "out"}`;
    const e = chanAgg.get(key) ?? { n: 0, v: 0 };
    e.n++;
    e.v += t.amountKwd;
    chanAgg.set(key, e);
  }
  const chanLines = [...chanAgg.entries()]
    .sort((a, b) => b[1].v - a[1].v)
    .map(([k, e]) => `${k}: ${e.n} txns / ${e.v.toFixed(0)} KWD`)
    .join("; ");

  const featLines = features
    .map((f) => {
      if (f.zone === "gated") return `- ${f.key} = GATED (${f.gatedReason ?? "insufficient data"})`;
      const base = f.baseline != null ? ` (baseline ${f.baseline}${f.unit ? ` ${f.unit}` : ""})` : "";
      return `- ${f.key} = ${f.value}${f.unit ? ` ${f.unit}` : ""}${base} [${f.zone.toUpperCase()}]`;
    })
    .join("\n");

  const ruleLines = fired
    .map((r) => {
      const sample = r.txnIds
        .slice(0, 8)
        .map((id) => byId.get(id))
        .filter((t): t is TxnLite => Boolean(t))
        .map((t) => `    ${txnLine(t)}`)
        .join("\n");
      return `- ${r.ruleId} ${r.title} [severity ${r.severity}]\n  ${r.detail ?? r.description}\n  Basis: ${r.citation}${sample ? `\n  Evidence sample:\n${sample}` : ""}`;
    })
    .join("\n");

  const pairLines = pairs
    .slice(0, 12)
    .map(
      (p) =>
        `- ${p.amountKwd.toFixed(3)} KWD ${p.fromBank} -> ${p.toBank}, gap ${p.dateGapDays}d (txn ${p.debitTxnId} -> txn ${p.creditTxnId}); basis: ${p.matchBasis}`,
    )
    .join("\n");

  const technicalLines = (technical.findings ?? [])
    .map((finding) => {
      const sample = finding.txnIds
        .slice(0, 8)
        .map((id) => byId.get(id))
        .filter((t): t is TxnLite => Boolean(t))
        .map((t) => `    ${txnLine(t)}`)
        .join("\n");
      return `- ${finding.findingId} ${finding.title} [${finding.severity}]
  ${finding.summary}
  Test: ${finding.methodology}
  Benchmark: ${finding.benchmark}
  Caveat: ${finding.caveat ?? "none"}
${sample ? `  Evidence sample:\n${sample}` : "  Evidence sample: none available"}`;
    })
    .join("\n");
  const gatedTechnicalLines = (technical.gatedTests ?? [])
    .map((test) => `- ${test.testId}: ${test.reason}`)
    .join("\n");

  return `SUBJECT PROFILE
Name: ${caseRow.subjectName}
Declared occupation: ${caseRow.declaredOccupation ?? "not declared"}
Declared monthly income: ${caseRow.declaredMonthlyIncomeKwd != null ? `${caseRow.declaredMonthlyIncomeKwd} KWD` : "not declared"}
Declared business activity: ${caseRow.declaredBusinessActivity ?? "none"}
Expected countries: ${(caseRow.expectedCountries ?? []).join(", ") || "not specified"}
Analyst notes: ${caseRow.notes ?? "-"}

CONSOLIDATED DATA (${run.txnCount} transactions across ${((run.banks ?? []) as unknown[]).length} banks, ${run.periodStart ?? "?"} to ${run.periodEnd ?? "?"})
External credits total: ${run.totalCreditsKwd.toFixed(0)} KWD gross; debits ${run.totalDebitsKwd.toFixed(0)} KWD
Internal own-account transfers netted: ${run.internalTransferCount} pairs, ${run.internalValueKwd.toFixed(0)} KWD
Data quality score: ${run.dataQualityScore.toFixed(2)}${run.dataQualityIssues.length ? `\nData quality issues:\n${run.dataQualityIssues.map((i) => `- ${i}`).join("\n")}` : ""}

MONTHLY FLOW (KWD): ${monthLines}

CHANNEL MIX (consolidated): ${chanLines}

ENGINEERED FEATURES
${featLines}

FIRED DETERMINISTIC RULES
${ruleLines || "- none fired"}

INTERNAL TRANSFER PAIRS (own money moving between own banks)
${pairLines || "- none detected"}

TECHNICAL FORENSICS (separate from and with no effect on the suspicion score)
${technicalLines || "- no technical anomaly crossed its evidence threshold"}

GATED TECHNICAL TESTS
${gatedTechnicalLines || "- none"}`;
}

// ---------------------------------------------------------------------------
// Output coercion - the LLM reply is untrusted; clamp to API schema shapes.

const ENUM = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  allowed.includes(v as T) ? (v as T) : dflt;

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 12) : [];

function coerceFindings(raw: unknown, validIds: Set<number>): unknown[] {
  const arr = Array.isArray((raw as Record<string, unknown>)?.typologyFindings)
    ? ((raw as Record<string, unknown>).typologyFindings as unknown[])
    : Array.isArray(raw)
      ? raw
      : [];
  return arr.slice(0, 10).map((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    return {
      typologyId: String(o.typologyId ?? "UNSPECIFIED"),
      typologyName: String(o.typologyName ?? "Unspecified typology"),
      present: ENUM(o.present, ["yes", "partial", "no"] as const, "no"),
      strength: ENUM(o.strength, ["weak", "moderate", "strong"] as const, "weak"),
      reasoning: String(o.reasoning ?? ""),
      supportingTxnIds: (Array.isArray(o.supportingTxnIds) ? o.supportingTxnIds : [])
        .map((n) => Number(n))
        .filter((n) => validIds.has(n))
        .slice(0, 25),
      supportingFeatures: (Array.isArray(o.supportingFeatures) ? o.supportingFeatures : [])
        .slice(0, 8)
        .map((s) => {
          const so = (s ?? {}) as Record<string, unknown>;
          return {
            feature: String(so.feature ?? ""),
            value: Number(so.value ?? 0) || 0,
            baseline: so.baseline == null ? null : Number(so.baseline) || 0,
          };
        }),
      benignExplanationsPossible: strArr(o.benignExplanationsPossible),
    };
  });
}

function coerceProfileConsistency(raw: unknown): unknown {
  const o = ((raw as Record<string, unknown>)?.profileConsistency ?? raw ?? {}) as Record<
    string,
    unknown
  >;
  if (!o || typeof o !== "object") return null;
  return {
    verdict: ENUM(
      o.verdict,
      ["consistent", "partially_inconsistent", "inconsistent"] as const,
      "partially_inconsistent",
    ),
    explanation: String(o.explanation ?? ""),
  };
}

function coerceScenarios(raw: unknown): unknown[] {
  const arr = Array.isArray((raw as Record<string, unknown>)?.criticScenarios)
    ? ((raw as Record<string, unknown>).criticScenarios as unknown[])
    : [];
  return arr.slice(0, 8).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      scenario: String(o.scenario ?? ""),
      explainsFindings: strArr(o.explainsFindings),
      consistencyCheck: String(o.consistencyCheck ?? ""),
      confirmingDocument: String(o.confirmingDocument ?? ""),
      plausibility: ENUM(o.plausibility, ["high", "medium", "low"] as const, "medium"),
    };
  });
}

function coerceObjections(raw: unknown): unknown[] {
  const arr = Array.isArray((raw as Record<string, unknown>)?.methodologicalObjections)
    ? ((raw as Record<string, unknown>).methodologicalObjections as unknown[])
    : [];
  return arr.slice(0, 8).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      targetFinding: String(o.targetFinding ?? ""),
      objection: String(o.objection ?? ""),
      severity: ENUM(o.severity, ["high", "medium", "low"] as const, "medium"),
    };
  });
}

// ---------------------------------------------------------------------------

export const AI_STAGES = [
  { stageId: "typology", label: "Typology analysis" },
  { stageId: "critic", label: "Adversarial critic" },
  { stageId: "investigation", label: "Investigation hypotheses" },
  { stageId: "memo", label: "Case memo" },
] as const;
export type AiStageId = (typeof AI_STAGES)[number]["stageId"];

interface AiStageProgress {
  stageId: AiStageId;
  label: string;
  status: "pending" | "running" | "complete" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AiProgress {
  stages: AiStageProgress[];
  attempts: number;
  heartbeatAt: string;
}

const STAGE_TIMEOUT_MS = 6 * 60 * 1000;
const HEARTBEAT_MS = 25_000;
const activeAiRuns = new Set<number>();

export function aiRunActive(runId: number): boolean {
  return activeAiRuns.has(runId);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function withStageTimeout<T>(label: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${label} stage exceeded the ${Math.round(STAGE_TIMEOUT_MS / 60000)}-minute watchdog limit`,
          ),
        ),
      STAGE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * On startup, resume AI runs that a restart interrupted (aiStatus still
 * pending/running with no live worker). Persisted stage outputs are kept;
 * only missing stages are recomputed.
 */
export async function reconcileInterruptedAiRuns(): Promise<void> {
  const stuck = await db
    .select({ id: analysisRunsTable.id })
    .from(analysisRunsTable)
    .where(inArray(analysisRunsTable.aiStatus, ["pending", "running"]));
  if (stuck.length === 0) return;
  logger.info(
    { runIds: stuck.map((r) => r.id) },
    "reconciling AI runs interrupted by a restart",
  );
  void (async () => {
    for (const row of stuck) {
      await runAiLayers(row.id).catch((err) =>
        logger.error({ err, runId: row.id }, "reconciled AI run failed"),
      );
    }
  })();
}

const SHARED_GUARDRAILS = `Hard rules you must never break:
1. NEVER state, estimate, or imply a suspicion probability, score, percentage, or risk rating. The deterministic engine owns the score. If asked, you would refuse.
2. Cite evidence by transaction id using the integer ids provided (e.g. supportingTxnIds: [123]). Never invent ids.
3. Nationality, ethnicity, and religion are NOT risk factors. Regular remittances to family are normal behavior in Kuwait and are not suspicious by themselves.
4. Ground every statement in the provided data. If data is missing, say so instead of guessing.`;

export async function runAiLayers(runId: number): Promise<void> {
  const log = logger.child({ runId, layer: "ai" });
  if (activeAiRuns.has(runId)) {
    log.warn("AI layers already in progress for this run; ignoring duplicate launch");
    return;
  }
  activeAiRuns.add(runId);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let progress: AiProgress | undefined;
  const writeProgress = async () => {
    if (!progress) return;
    progress.heartbeatAt = nowIso();
    await db
      .update(analysisRunsTable)
      .set({ aiProgress: progress as unknown })
      .where(eq(analysisRunsTable.id, runId));
  };
  const setStage = async (stageId: AiStageId, status: AiStageProgress["status"]) => {
    const st = progress?.stages.find((s) => s.stageId === stageId);
    if (!st) return;
    st.status = status;
    if (status === "running") st.startedAt = nowIso();
    if (status === "complete" || status === "failed") st.finishedAt = nowIso();
    await writeProgress();
  };
  try {
    const [run] = await db
      .select()
      .from(analysisRunsTable)
      .where(eq(analysisRunsTable.id, runId));
    if (!run) return;
    if (!aiAvailable()) {
      await db
        .update(analysisRunsTable)
        .set({ aiStatus: "skipped", aiError: "AI integration not configured" })
        .where(eq(analysisRunsTable.id, runId));
      return;
    }
    const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, run.caseId));
    if (!caseRow) return;
    const txnRows = await db
      .select({
        id: transactionsTable.id,
        postingDate: transactionsTable.postingDate,
        bank: transactionsTable.bank,
        direction: transactionsTable.direction,
        amountKwd: transactionsTable.amountKwd,
        channel: transactionsTable.channel,
        counterpartyName: transactionsTable.counterpartyName,
        counterpartyCountry: transactionsTable.counterpartyCountry,
        narrative: transactionsTable.narrative,
        isInternalTransfer: transactionsTable.isInternalTransfer,
      })
      .from(transactionsTable)
      .where(eq(transactionsTable.caseId, run.caseId));

    // Resume support: stage outputs persisted on the run survive restarts and
    // are never recomputed. Only missing stages run.
    let typologyFindings = (run.typologyFindings ?? null) as
      | ReturnType<typeof coerceFindings>
      | null;
    let profileConsistency = (run.profileConsistency ?? null) as
      | ReturnType<typeof coerceProfileConsistency>
      | null;
    let informationGaps = (run.informationGaps ?? null) as string[] | null;
    let criticScenarios = (run.criticScenarios ?? null) as
      | ReturnType<typeof coerceScenarios>
      | null;
    let methodologicalObjections = (run.methodologicalObjections ?? null) as
      | ReturnType<typeof coerceObjections>
      | null;
    let residualUnexplained = (run.residualUnexplained ?? null) as string[] | null;
    let aiInvestigation = (run.aiInvestigation ?? null) as
      | ReturnType<typeof coerceAiInvestigation>
      | null;
    const doneByStage: Record<AiStageId, boolean> = {
      typology: typologyFindings != null,
      critic: criticScenarios != null,
      investigation: aiInvestigation != null,
      memo: run.caseMemo != null,
    };
    if (doneByStage.typology || doneByStage.critic || doneByStage.investigation || doneByStage.memo) {
      log.info({ doneByStage }, "resuming AI layers from last completed stage");
    }
    const prevAttempts = ((run.aiProgress ?? null) as AiProgress | null)?.attempts ?? 0;
    progress = {
      attempts: prevAttempts + 1,
      heartbeatAt: nowIso(),
      stages: AI_STAGES.map((s) => ({
        stageId: s.stageId,
        label: s.label,
        status: doneByStage[s.stageId] ? "complete" : "pending",
        startedAt: null,
        finishedAt: null,
      })),
    };

    await db
      .update(analysisRunsTable)
      .set({ aiStatus: "running", aiError: null })
      .where(eq(analysisRunsTable.id, runId));
    await writeProgress();
    heartbeat = setInterval(() => {
      void writeProgress().catch(() => undefined);
    }, HEARTBEAT_MS);

    const evidence = buildEvidence({ caseRow, run, txns: txnRows });
    const validIds = new Set(txnRows.map((t) => t.id));

    // ---- P3: typology analysis -----------------------------------------
    if (!doneByStage.typology) {
    await setStage("typology", "running");
    log.info("P3 typology analysis starting");
    const p3System = `You are a senior AML typology analyst at ASIA Consulting (Kuwait), reviewing consolidated multi-bank statement evidence. ${SHARED_GUARDRAILS}`;
    const p3User = `${evidence}

TASK - Assess each candidate typology against the evidence:
1. FATF.STR - Structuring / threshold avoidance (KD 3,000 cash trigger)
2. FATF.PLC - Cash placement inconsistent with profile
3. FATF.LAY - Layering: pass-through, rapid movement, relay chains
4. BCBS.CIR - Self-circulation between own accounts
5. FATF.NET - Funnel / third-party collection patterns
6. FATF.GEO - High-risk jurisdiction exposure
7. FATF.TMP - Temporal anomalies (bursts, dormancy reactivation)
8. FATF.NAR - Narrative opacity / unexplained flows

Also assess whether observed activity is consistent with the declared profile, and list concrete information gaps an investigator should close.

Reply with ONLY this JSON:
{
  "typologyFindings": [{
    "typologyId": "FATF.STR",
    "typologyName": "...",
    "present": "yes|partial|no",
    "strength": "weak|moderate|strong",
    "reasoning": "2-5 sentences grounded in the data, citing [txn id] inline",
    "supportingTxnIds": [1,2],
    "supportingFeatures": [{"feature": "near_threshold_density", "value": 0.4, "baseline": 0.05}],
    "benignExplanationsPossible": ["..."]
  }],
  "profileConsistency": {"verdict": "consistent|partially_inconsistent|inconsistent", "explanation": "..."},
  "informationGaps": ["..."]
}`;
    const p3 = await withStageTimeout("Typology analysis", callJson(p3System, p3User));
    typologyFindings = coerceFindings(p3, validIds);
    profileConsistency = coerceProfileConsistency(p3);
    informationGaps = strArr((p3 as Record<string, unknown>)?.informationGaps);
    await db
      .update(analysisRunsTable)
      .set({ typologyFindings, profileConsistency, informationGaps })
      .where(eq(analysisRunsTable.id, runId));
    await setStage("typology", "complete");
    }
    if (!typologyFindings || !profileConsistency || !informationGaps) {
      throw new Error("typology stage outputs missing after execution");
    }

    // ---- P5: adversarial critic ----------------------------------------
    if (!doneByStage.critic) {
    await setStage("critic", "running");
    log.info("P5 adversarial critic starting");
    const p5System = `You are the adversarial reviewer in an AML quality-control process at ASIA Consulting (Kuwait). Your job is to argue the SUBJECT'S side: construct innocent explanations for the flagged patterns and attack weaknesses in the methodology. Be specific and testable, not generic. ${SHARED_GUARDRAILS}`;
    const p5User = `${evidence}

PRIMARY ANALYST FINDINGS (P3):
${JSON.stringify({ typologyFindings, profileConsistency, informationGaps }, null, 1).slice(0, 6000)}

TASK:
1. criticScenarios - benign scenarios that could explain the flagged patterns. For each: which findings it explains, a concrete consistency check against THIS data (does the data contradict it?), the single document that would confirm it, and plausibility.
2. methodologicalObjections - attacks on the analysis itself (baseline validity, gated features, data-quality caveats, netting assumptions).
3. residualUnexplained - what remains suspicious even under the most charitable benign reading.

Reply with ONLY this JSON:
{
  "criticScenarios": [{"scenario": "...", "explainsFindings": ["FATF.STR"], "consistencyCheck": "...", "confirmingDocument": "...", "plausibility": "high|medium|low"}],
  "methodologicalObjections": [{"targetFinding": "...", "objection": "...", "severity": "high|medium|low"}],
  "residualUnexplained": ["..."]
}`;
    const p5 = await withStageTimeout("Adversarial critic", callJson(p5System, p5User));
    criticScenarios = coerceScenarios(p5);
    methodologicalObjections = coerceObjections(p5);
    residualUnexplained = strArr((p5 as Record<string, unknown>)?.residualUnexplained);
    await db
      .update(analysisRunsTable)
      .set({ criticScenarios, methodologicalObjections, residualUnexplained })
      .where(eq(analysisRunsTable.id, runId));
    await setStage("critic", "complete");
    }
    if (!criticScenarios || !methodologicalObjections || !residualUnexplained) {
      throw new Error("critic stage outputs missing after execution");
    }

    // ---- P6: deep investigation hypotheses ------------------------------
    if (!doneByStage.investigation) {
    await setStage("investigation", "running");
    log.info("P6 investigation intelligence starting");
    const technical = (run.technicalAnalysis ?? {
      findings: [],
    }) as unknown as TechnicalAnalysis;
    const validFindingIds = new Set((technical.findings ?? []).map((finding) => finding.findingId));
    const p6System = `You are a forensic AML investigator at ASIA Consulting (Kuwait). You formulate falsifiable investigative hypotheses from technical transaction evidence, then actively search for contradictory and benign interpretations. Your output is decision support, not a verdict. ${SHARED_GUARDRAILS}`;
    const p6User = `${evidence}

PRIMARY TYPOLOGY REVIEW:
${JSON.stringify({ typologyFindings, profileConsistency, informationGaps }, null, 1).slice(0, 7000)}

ADVERSARIAL REVIEW:
${JSON.stringify({ criticScenarios, methodologicalObjections, residualUnexplained }, null, 1).slice(0, 6000)}

TASK:
1. Prioritize no more than 6 falsifiable hypotheses. A supported or plausible hypothesis MUST cite real supportingTxnIds. Include contradictoryTxnIds when the provided evidence weakens the hypothesis.
2. Connect hypotheses to technicalFindingIds only when those IDs appear in TECHNICAL FORENSICS.
3. State benign explanations and unresolved questions for each hypothesis.
4. Recommend targeted checks or documents that could confirm or reject the hypotheses. Do not recommend escalation as an automatic outcome.
5. Do not mention, infer, restate, or adjust any probability, percentage, score, or risk band.
6. Every factual sentence in executiveAssessment and each rationale must cite one or more provided transaction IDs inline as [txn 123] or explicitly state the transaction-level evidence gap.

Reply with ONLY this JSON:
{
  "aiInvestigation": {
    "executiveAssessment": "Evidence-grounded summary without any probability or score language",
    "hypotheses": [{
      "hypothesisId": "AI-HYP-01",
      "title": "...",
      "priority": "high|medium|low",
      "status": "supported|plausible|inconclusive|not_supported",
      "rationale": "Grounded explanation citing [txn 123] inline",
      "supportingTxnIds": [123],
      "contradictoryTxnIds": [456],
      "technicalFindingIds": ["TECH-SEQ-01"],
      "benignExplanations": ["..."],
      "unresolvedQuestions": ["..."]
    }],
    "recommendedActions": [{
      "priority": "high|medium|low",
      "action": "...",
      "rationale": "...",
      "evidenceNeeded": "Specific document, record, or check"
    }],
    "limitations": ["..."]
  }
}`;
    const p6 = await withStageTimeout("Investigation hypotheses", callJson(p6System, p6User));
    aiInvestigation = coerceAiInvestigation(p6, validIds, validFindingIds);
    await db
      .update(analysisRunsTable)
      .set({ aiInvestigation })
      .where(eq(analysisRunsTable.id, runId));
    await setStage("investigation", "complete");
    }
    if (!aiInvestigation) {
      throw new Error("investigation stage output missing after execution");
    }

    // ---- P4: case memo ---------------------------------------------------
    if (!doneByStage.memo) {
    await setStage("memo", "running");
    log.info("P4 case memo starting");
    const p4System = `You write disposition-ready AML case memos for ASIA Consulting (Kuwait). Professional, precise, no hedging filler, no emojis, no markdown syntax (plain text with UPPERCASE section headings). ${SHARED_GUARDRAILS}
Exception to rule 1: the deterministic engine's already-computed score is provided to you as a fixed fact; quote it verbatim where indicated but never recompute, adjust, or second-guess it.`;
    const p4User = `${evidence}

COMPUTED SCORE (fixed fact from the deterministic engine - quote as given):
Suspicion probability: ${(run.probability * 100).toFixed(1)}% - Band: ${run.band}

PRIMARY FINDINGS: ${JSON.stringify(typologyFindings).slice(0, 5000)}
PROFILE CONSISTENCY: ${JSON.stringify(profileConsistency)}
CRITIC SCENARIOS: ${JSON.stringify(criticScenarios).slice(0, 4000)}
RESIDUAL CONCERNS: ${JSON.stringify(residualUnexplained)}
INVESTIGATION HYPOTHESES: ${JSON.stringify(aiInvestigation.hypotheses).slice(0, 5000)}
RECOMMENDED INVESTIGATION ACTIONS: ${JSON.stringify(aiInvestigation.recommendedActions).slice(0, 3500)}

Write the case memo (450-700 words) with these sections:
SUBJECT AND SCOPE
DATA COVERAGE AND QUALITY
KEY FINDINGS (cite transactions inline as [txn 123])
ALTERNATIVE EXPLANATIONS CONSIDERED
RESIDUAL CONCERNS
RECOMMENDED NEXT STEPS (concrete, in priority order)`;
    const memo = await withStageTimeout("Case memo", callClaude(p4System, p4User));
    await db
      .update(analysisRunsTable)
      .set({ caseMemo: memo.trim(), aiStatus: "complete", aiError: null })
      .where(eq(analysisRunsTable.id, runId));
    await setStage("memo", "complete");
    } else {
      await db
        .update(analysisRunsTable)
        .set({ aiStatus: "complete", aiError: null })
        .where(eq(analysisRunsTable.id, runId));
    }
    log.info("AI layers complete");
  } catch (err) {
    log.error({ err }, "AI layers failed");
    const runningStage = progress?.stages.find((s) => s.status === "running");
    if (runningStage) {
      runningStage.status = "failed";
      runningStage.finishedAt = nowIso();
      await writeProgress().catch(() => undefined);
    }
    await db
      .update(analysisRunsTable)
      .set({
        aiStatus: "failed",
        aiError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      })
      .where(eq(analysisRunsTable.id, runId))
      .catch(() => undefined);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    activeAiRuns.delete(runId);
  }
}
