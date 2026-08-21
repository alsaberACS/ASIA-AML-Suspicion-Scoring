/**
 * ASIA Consulting - AML Suspicion Analysis Report (PDF).
 *
 * Server-side rendered with @react-pdf/renderer. Light print styling with the
 * ASIA brand accent. The report is honest by construction: AI sections render
 * only when the AI layer completed, gated tests and data-quality caveats are
 * listed explicitly, and the deterministic score is presented as independent
 * of the AI narrative layers.
 */
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type * as z from "zod/v4";
import type { GetAnalysisRunResponse } from "@workspace/api-zod";
import type { SanctionsScreening } from "./sanctions";

/**
 * The report consumes the same shape the API serves (zod-inferred from the
 * OpenAPI contract), so every field rendered here is a field the console and
 * tests can verify.
 */
type RunApi = z.infer<typeof GetAnalysisRunResponse>;

export interface ReportCaseInfo {
  id: number;
  subjectName: string;
  subjectReference?: string | null;
  declaredOccupation?: string | null;
  declaredMonthlyIncomeKwd?: number | null;
  declaredBusinessActivity?: string | null;
  expectedCountries?: string[] | null;
}

const INK = "#0F172A";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const LINE = "#E2E8F0";
const ACCENT = "#0F766E";
const ACCENT_SOFT = "#F0FDFA";
const PAPER_SOFT = "#F8FAFC";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#B91C1C",
  high: "#C2410C",
  medium: "#B45309",
  low: "#64748B",
};

const VERDICT_COLOR: Record<string, string> = {
  accepted: ACCENT,
  dismissed: "#64748B",
  undetermined: "#B45309",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
    paddingTop: 84,
    paddingBottom: 56,
    paddingHorizontal: 48,
  },
  // NOTE: deliberately no lineHeight on the page style. Page-level lineHeight
  // reaches the fixed render-prop page-number Text via inheritance and silently
  // breaks it in @react-pdf 4.6.x; a wrapper View inflates spacing instead.
  // Line spacing is therefore applied per body style (para, bulletText, memo).
  masthead: {
    position: "absolute",
    top: 24,
    left: 48,
    right: 48,
    height: 46,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
    paddingBottom: 10,
  },
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 2, color: INK },
  brandSub: { fontSize: 7.5, color: MUTED, letterSpacing: 1.2, marginTop: 2 },
  confidential: { fontSize: 7.5, color: "#B91C1C", fontFamily: "Helvetica-Bold", letterSpacing: 1.5, textAlign: "right" },
  reportRef: { fontSize: 7.5, color: MUTED, marginTop: 3, textAlign: "right" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9.5, color: MUTED, marginBottom: 14 },
  sectionTitle: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  kvGrid: { flexDirection: "row", flexWrap: "wrap" },
  kvCell: { width: "33.33%", marginBottom: 7, paddingRight: 10 },
  kvLabel: { fontSize: 6.5, color: FAINT, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 1.5 },
  kvValue: { fontSize: 9.5 },
  scoreBox: {
    flexDirection: "row",
    backgroundColor: ACCENT_SOFT,
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 3,
    padding: 12,
    marginBottom: 10,
    alignItems: "center",
  },
  scoreBig: { fontSize: 26, fontFamily: "Helvetica-Bold", color: ACCENT },
  para: { marginBottom: 6, textAlign: "justify", lineHeight: 1.45 },
  bullet: { flexDirection: "row", marginBottom: 3, paddingRight: 8 },
  bulletDot: { width: 10, color: ACCENT },
  bulletText: { flex: 1, lineHeight: 1.45 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingVertical: 4,
    alignItems: "flex-start",
  },
  rowHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: MUTED,
    paddingVertical: 3,
    marginTop: 2,
  },
  headCell: { fontSize: 6.5, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase" },
  chip: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
    borderWidth: 0.75,
  },
  card: {
    borderWidth: 0.75,
    borderColor: LINE,
    borderRadius: 3,
    padding: 8,
    marginBottom: 7,
    backgroundColor: PAPER_SOFT,
  },
  cardTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginBottom: 3, flex: 1, paddingRight: 8 },
  small: { fontSize: 8, color: MUTED },
  memo: {
    fontFamily: "Courier",
    fontSize: 7.5,
    lineHeight: 1.5,
    backgroundColor: PAPER_SOFT,
    borderWidth: 0.75,
    borderColor: LINE,
    padding: 10,
  },
  pageNumber: {
    position: "absolute",
    bottom: 34,
    right: 48,
    height: 10,
    fontSize: 6.5,
    color: FAINT,
    textAlign: "right",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    height: 26,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 6,
  },
  footerText: { fontSize: 6.5, color: FAINT, letterSpacing: 0.5 },
});

function fmtKwd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return `${Math.round(v).toLocaleString("en-US")} KWD`;
}

function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined) return "-";
  return `${(p * 100).toFixed(1)}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function nowKuwait(): string {
  return `${new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Kuwait",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} (Kuwait)`;
}

function signed(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

function sevColor(sev: string): string {
  return SEVERITY_COLOR[sev.toLowerCase()] ?? MUTED;
}

function Chip({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.chip, { color, borderColor: color }]}>{label}</Text>;
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>-</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvCell}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

const PRESENT_LABEL: Record<string, string> = {
  yes: "Present",
  partial: "Partially present",
  no: "Not indicated",
};

export async function renderAnalysisReport(
  run: RunApi,
  caseInfo: ReportCaseInfo | null,
): Promise<Buffer> {
  const firedRules = [...run.ruleHits.filter((r) => r.fired)].sort(
    (a, b) => Math.abs(b.weightLogLr) - Math.abs(a.weightLogLr),
  );
  const testedNotFired = run.ruleHits.length - firedRules.length;
  const tech = run.technicalAnalysis;
  const aiComplete = run.aiStatus === "complete";
  // The run serializer intentionally types AI payload columns loosely; re-type
  // them here against the shapes the AI pipeline persists (verified against the
  // live API responses).
  type HypDoc = {
    hypothesisId: string;
    title: string;
    status: string;
    priority: string;
    rationale: string;
    benignExplanations: string[];
    unresolvedQuestions: string[];
  };
  type ActionDoc = { action: string; priority: string; rationale: string; evidenceNeeded: string };
  type AiInvestigationDoc = {
    executiveAssessment: string;
    hypotheses: HypDoc[];
    recommendedActions: ActionDoc[];
    limitations: string[];
  };
  type TypologyDoc = {
    typologyId: string;
    typologyName: string;
    present: string;
    strength: string;
    reasoning: string;
    benignExplanationsPossible?: string | null;
  };
  type CriticDoc = {
    scenario: string;
    plausibility: string;
    consistencyCheck?: string | null;
    confirmingDocument?: string | null;
  };
  const inv = aiComplete
    ? ((run.aiInvestigation ?? null) as unknown as AiInvestigationDoc | null)
    : null;
  const sanctions = (run.sanctionsScreening ?? null) as SanctionsScreening | null;
  const typology = aiComplete
    ? ((run.typologyFindings ?? []) as unknown as TypologyDoc[])
    : [];
  const critic = aiComplete
    ? ((run.criticScenarios ?? []) as unknown as CriticDoc[])
    : [];
  const reviews = run.disposition?.hypothesisReviews ?? [];
  const reviewByHyp = new Map(reviews.map((r) => [r.hypothesisId, r]));
  const currentBand = run.bandScale.find((b) => b.band === run.band);
  const reportRef = `RPT-C${run.caseId.toString().padStart(3, "0")}-R${run.id.toString().padStart(3, "0")}`;
  const gatedFeatures = run.features.filter((f) => f.gatedReason);

  const doc = (
    <Document
      title={`ASIA AML Suspicion Analysis Report - ${caseInfo?.subjectName ?? `Case ${run.caseId}`}`}
      author="ASIA Consulting - AML Suspicion Scoring Console"
    >
      <Page size="A4" style={styles.page}>
        {/* Masthead */}
        <View style={styles.masthead} fixed>
          <View>
            <Text style={styles.brand}>ASIA CONSULTING</Text>
            <Text style={styles.brandSub}>FINANCIAL CRIME ADVISORY - KUWAIT</Text>
          </View>
          <View>
            <Text style={styles.confidential}>CONFIDENTIAL</Text>
            <Text style={styles.reportRef}>{reportRef}</Text>
          </View>
        </View>

        <Text style={styles.title}>AML Suspicion Analysis Report</Text>
        <Text style={styles.subtitle}>
          Subject: {caseInfo?.subjectName ?? "-"}
          {caseInfo?.subjectReference ? `  |  Ref: ${caseInfo.subjectReference}` : ""}
          {"  |  "}Generated: {nowKuwait()}
        </Text>

        {/* 1. Executive summary */}
        <SectionTitle>1. Executive Summary</SectionTitle>
        <View style={styles.scoreBox} wrap={false}>
          <View style={{ marginRight: 24 }}>
            <Text style={styles.kvLabel}>Suspicion Probability</Text>
            <Text style={styles.scoreBig}>{fmtPct(run.probability)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: ACCENT }}>
              Band: {run.band}
            </Text>
            <Text style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>
              {currentBand ? `Recommended posture: ${currentBand.action}` : ""}
            </Text>
            <Text style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>
              Prior {fmtPct(run.priorProbability)} adjusted by evidence to posterior log-odds{" "}
              {signed(run.posteriorLogOdds)}. Score produced by the deterministic forensic engine{" "}
              {tech ? `(${tech.engineVersion})` : ""} and unaffected by AI narrative layers.
            </Text>
          </View>
        </View>
        <View style={styles.kvGrid}>
          <KV label="Analysis Run" value={`#${run.id} on ${fmtDate(run.createdAt)}`} />
          <KV label="Transactions Analyzed" value={`${run.txnCount} across ${run.banks.length} banks`} />
          <KV label="Statement Period" value={`${fmtDate(run.periodStart)} - ${fmtDate(run.periodEnd)}`} />
          <KV label="Total Credits" value={fmtKwd(run.totalCreditsKwd)} />
          <KV label="Total Debits" value={fmtKwd(run.totalDebitsKwd)} />
          <KV
            label="Inter-Account Transfers"
            value={`${run.internalTransferCount} (${fmtKwd(run.internalValueKwd)})`}
          />
          <KV label="Data Quality Index" value={`${(run.dataQualityScore * 100).toFixed(1)} / 100`} />
          <KV label="Profile Consistency" value={run.profileConsistency?.verdict ?? "-"} />
          <KV label="AI Layer Status" value={run.aiStatus} />
        </View>
        {caseInfo ? (
          <View style={styles.kvGrid}>
            <KV label="Declared Occupation" value={caseInfo.declaredOccupation || "-"} />
            <KV label="Declared Monthly Income" value={fmtKwd(caseInfo.declaredMonthlyIncomeKwd)} />
            <KV label="Declared Activity" value={caseInfo.declaredBusinessActivity || "-"} />
          </View>
        ) : null}
        {inv?.executiveAssessment ? (
          <Text style={styles.para}>{inv.executiveAssessment}</Text>
        ) : (
          <Text style={[styles.para, { color: MUTED }]}>
            The AI investigation layer has not completed for this run (status: {run.aiStatus}). The
            deterministic findings in sections 2-5 stand on their own.
          </Text>
        )}

        {/* 2. Score composition */}
        <SectionTitle>2. Suspicion Score Composition</SectionTitle>
        <Text style={[styles.small, { marginBottom: 4 }]}>
          Top evidence drivers by absolute contribution (log-likelihood ratio). Positive values push
          toward suspicion; negative values are exculpatory.
        </Text>
        <View style={styles.rowHead}>
          <Text style={[styles.headCell, { flex: 5 }]}>Driver</Text>
          <Text style={[styles.headCell, { flex: 1.4 }]}>Source</Text>
          <Text style={[styles.headCell, { flex: 1, textAlign: "right" }]}>Contribution</Text>
        </View>
        {run.drivers.map((d, i) => (
          <View key={i} style={styles.row}>
            <Text style={{ flex: 5, paddingRight: 8 }}>{d.label}</Text>
            <Text style={{ flex: 1.4, color: MUTED, fontSize: 8 }}>{d.source}</Text>
            <Text
              style={{
                flex: 1,
                textAlign: "right",
                fontFamily: "Helvetica-Bold",
                color: d.contribution >= 0 ? "#B91C1C" : ACCENT,
              }}
            >
              {signed(d.contribution)}
            </Text>
          </View>
        ))}
        <Text style={[styles.small, { marginTop: 5 }]}>
          Scoring bands:{" "}
          {run.bandScale
            .map((b) => `${b.band} ${fmtPct(b.minP)}-${fmtPct(b.maxP)}`)
            .join("  |  ")}
        </Text>

        {/* 3. Fired rules */}
        <SectionTitle>3. Rule-Based Red Flags</SectionTitle>
        <Text style={[styles.small, { marginBottom: 4 }]}>
          {firedRules.length} of {run.ruleHits.length} rules fired ({testedNotFired} tested without
          triggering). Weights are expert-elicited log-likelihood ratios with regulatory citations.
        </Text>
        {firedRules.map((r) => (
          <View key={r.ruleId} style={styles.row} wrap={false}>
            <View style={{ flex: 5, paddingRight: 8 }}>
              <Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{r.ruleId}</Text>  {r.title}
              </Text>
              <Text style={{ fontSize: 7, color: FAINT, marginTop: 1 }}>
                {r.typologyName} - {r.citation}
              </Text>
            </View>
            <View style={{ flex: 1.2, alignItems: "flex-start" }}>
              <Chip label={r.severity} color={sevColor(r.severity)} />
            </View>
            <Text style={{ flex: 0.9, textAlign: "right", fontFamily: "Helvetica-Bold" }}>
              {signed(r.weightLogLr)}
            </Text>
          </View>
        ))}

        {/* 4. Technical findings */}
        <SectionTitle>4. Technical Forensic Findings</SectionTitle>
        {tech ? (
          <View>
            <Text style={[styles.small, { marginBottom: 5 }]}>
              Engine {tech.engineVersion} executed {tech.testsExecuted.length} test families over{" "}
              {tech.testedTransactionCount} transactions.
            </Text>
            {tech.findings.map((f) => (
              <View key={f.findingId} style={styles.card} wrap={false}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <Text style={styles.cardTitle}>
                    {f.findingId}  {f.title}
                  </Text>
                  <Chip label={f.severity} color={sevColor(f.severity)} />
                </View>
                <Text style={{ fontSize: 8.5 }}>{f.summary}</Text>
                <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 3 }}>
                  Metric: {f.metricValue}  |  Benchmark: {f.benchmark}
                </Text>
                <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 1 }}>
                  Method: {f.methodology}
                </Text>
                {f.caveat ? (
                  <Text style={{ fontSize: 7.5, color: "#B45309", marginTop: 2 }}>
                    Caveat: {f.caveat}
                  </Text>
                ) : null}
              </View>
            ))}
            {tech.gatedTests.length > 0 ? (
              <View>
                <Text style={[styles.small, { marginBottom: 3 }]}>
                  Tests withheld due to insufficient data quality:
                </Text>
                {tech.gatedTests.map((g, i) => (
                  <Bullet key={i}>{typeof g === "string" ? g : JSON.stringify(g)}</Bullet>
                ))}
              </View>
            ) : (
              <Text style={styles.small}>No tests were gated on this run.</Text>
            )}
          </View>
        ) : (
          <Text style={styles.small}>Technical analysis unavailable for this run.</Text>
        )}

        {/* 5. Data quality */}
        <SectionTitle>5. Data Quality &amp; Coverage Caveats</SectionTitle>
        <Text style={[styles.small, { marginBottom: 4 }]}>
          Data quality index {(run.dataQualityScore * 100).toFixed(1)}/100.{" "}
          {gatedFeatures.length > 0
            ? `${gatedFeatures.length} feature(s) were excluded from scoring because their inputs could not be verified.`
            : "No features were gated."}
        </Text>
        {run.dataQualityIssues.map((issue, i) => (
          <Bullet key={i}>{issue}</Bullet>
        ))}

        {/* 6. Sanctions screening (evidence only - never feeds the score) */}
        <SectionTitle>6. Sanctions Screening</SectionTitle>
        {sanctions == null ? (
          <Text style={styles.small}>
            This analysis predates the sanctions screening layer. Re-run the analysis to screen
            the subject and named counterparties against the OFAC SDN and UN Security Council
            Consolidated lists.
          </Text>
        ) : sanctions.status === "unavailable" ? (
          <View style={styles.card} wrap={false}>
            <Text style={[styles.cardTitle, { color: "#B91C1C" }]}>
              SCREENING UNAVAILABLE - NOT PERFORMED
            </Text>
            <Text style={{ fontSize: 8.5 }}>
              {sanctions.reason ?? "Sanctions lists could not be retrieved."} This must not be
              interpreted as a clean result.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={[styles.small, { marginBottom: 4 }]}>
              {sanctions.namesScreened} names (subject and named counterparties) screened against{" "}
              {sanctions.lists
                .map(
                  (l) =>
                    l.label +
                    " (" +
                    l.entryCount +
                    " entries, retrieved " +
                    l.fetchedAt.slice(0, 10) +
                    (l.stale ? ", stale copy" : "") +
                    ")",
                )
                .join(" and ")}
              . Name matching is evidence-only and never alters the suspicion score.
            </Text>
            {sanctions.totals.exact + sanctions.totals.strong + sanctions.totals.possible === 0 ? (
              <Text style={styles.small}>
                No exact, strong, or possible matches were found for the subject or any named
                counterparty. Masked account references cannot be name-screened.
              </Text>
            ) : (
              <View>
                {sanctions.subject.matches.map((m, i) => (
                  <View key={i} style={styles.card} wrap={false}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <Text style={styles.cardTitle}>SUBJECT vs {m.listedName}</Text>
                      <Chip
                        label={m.tier.toUpperCase()}
                        color={m.tier === "exact" ? "#B91C1C" : m.tier === "strong" ? "#C2410C" : "#B45309"}
                      />
                    </View>
                    <Text style={{ fontSize: 8.5 }}>
                      {(m.listId === "ofac_sdn" ? "OFAC SDN " : "UN Consolidated ") + m.entryId}
                      {m.programs.length > 0 ? " - programs: " + m.programs.join(", ") : ""}
                      {m.matchedAlias ? " - matched listed alias: " + m.matchedAlias : ""}
                      {m.listedOn ? " - listed on " + m.listedOn : ""}
                    </Text>
                    {m.remarks ? (
                      <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 2 }}>{m.remarks}</Text>
                    ) : null}
                  </View>
                ))}
                {sanctions.counterpartyMatches.map((c, i) => (
                  <View key={i} style={styles.card} wrap={false}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <Text style={styles.cardTitle}>
                        {c.name + (c.txnCount != null ? " (" + c.txnCount + " txns)" : "")}
                      </Text>
                      {c.matches[0] ? (
                        <Chip
                          label={c.matches[0].tier.toUpperCase()}
                          color={
                            c.matches[0].tier === "exact"
                              ? "#B91C1C"
                              : c.matches[0].tier === "strong"
                                ? "#C2410C"
                                : "#B45309"
                          }
                        />
                      ) : null}
                    </View>
                    {c.matches.map((m, j) => (
                      <Text key={j} style={{ fontSize: 8 }}>
                        {m.tier.toUpperCase() +
                          ": " +
                          m.listedName +
                          " (" +
                          (m.listId === "ofac_sdn" ? "OFAC SDN " : "UN ") +
                          m.entryId +
                          (m.programs.length > 0 ? ", " + m.programs.join(", ") : "") +
                          ")" +
                          (m.matchedAlias ? " via alias " + m.matchedAlias : "")}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* 7+ AI sections, only when complete */}
        {aiComplete && typology.length > 0 ? (
          <View>
            <SectionTitle>7. AI Typology Screen</SectionTitle>
            <Text style={[styles.small, { marginBottom: 4 }]}>
              Generative screen across {typology.length} laundering typologies. Evidence-only: informs
              the narrative, never the score. Every claim cites transaction IDs verifiable in the
              console.
            </Text>
            {typology.map((t) => (
              <View key={t.typologyId} style={styles.card} wrap={false}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <Text style={styles.cardTitle}>{t.typologyName}</Text>
                  <Chip
                    label={`${PRESENT_LABEL[t.present] ?? t.present}${
                      t.present !== "no" ? ` / ${t.strength}` : ""
                    }`}
                    color={t.present === "no" ? MUTED : t.present === "yes" ? "#B91C1C" : "#B45309"}
                  />
                </View>
                <Text style={{ fontSize: 8.5 }}>{t.reasoning}</Text>
                {t.benignExplanationsPossible ? (
                  <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 2 }}>
                    Benign explanations possible: {t.benignExplanationsPossible}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {aiComplete && critic.length > 0 ? (
          <View>
            <SectionTitle>8. Adversarial Critic - Innocent Scenarios</SectionTitle>
            <Text style={[styles.small, { marginBottom: 4 }]}>
              A second AI pass argues the innocent side: plausible lawful explanations for the observed
              patterns and the single document that would confirm each.
            </Text>
            {critic.map((c, i) => (
              <View key={i} style={styles.card} wrap={false}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <Text style={[styles.cardTitle, { fontFamily: "Helvetica" }]}>{c.scenario}</Text>
                  <Chip label={`plausibility: ${c.plausibility}`} color={ACCENT} />
                </View>
                {c.consistencyCheck ? (
                  <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 2 }}>
                    Consistency: {c.consistencyCheck}
                  </Text>
                ) : null}
                {c.confirmingDocument ? (
                  <Text style={{ fontSize: 7.5, color: ACCENT, marginTop: 2 }}>
                    Confirming document: {c.confirmingDocument}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {inv ? (
          <View>
            <SectionTitle>9. Investigation Hypotheses &amp; Analyst Review</SectionTitle>
            {inv.hypotheses.map((h) => {
              const review = reviewByHyp.get(h.hypothesisId);
              const verdict = review?.verdict ?? "not reviewed";
              return (
                <View key={h.hypothesisId} style={styles.card} wrap={false}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                    <Text style={styles.cardTitle}>
                      {h.hypothesisId}  {h.title}
                    </Text>
                    <Chip label={h.priority} color={sevColor(h.priority)} />
                  </View>
                  <Text style={{ fontSize: 8.5 }}>{h.rationale}</Text>
                  {h.benignExplanations.length > 0 ? (
                    <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 2 }}>
                      Benign alternatives: {h.benignExplanations.join("; ")}
                    </Text>
                  ) : null}
                  {h.unresolvedQuestions.length > 0 ? (
                    <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 2 }}>
                      Open questions: {h.unresolvedQuestions.join(" ")}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: "row", marginTop: 4, alignItems: "center" }}>
                    <Text style={{ fontSize: 7, color: FAINT, marginRight: 5 }}>ANALYST VERDICT:</Text>
                    <Chip
                      label={verdict}
                      color={review ? (VERDICT_COLOR[review.verdict] ?? MUTED) : FAINT}
                    />
                    {review?.note ? (
                      <Text style={{ fontSize: 7.5, color: MUTED, marginLeft: 6, flex: 1 }}>
                        {review.note}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}

            <SectionTitle>10. Recommended Actions</SectionTitle>
            {inv.recommendedActions.map((a, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <View style={{ flex: 5, paddingRight: 8 }}>
                  <Text>{a.action}</Text>
                  <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 1 }}>
                    Evidence needed: {a.evidenceNeeded}
                  </Text>
                </View>
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Chip label={a.priority} color={sevColor(a.priority)} />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {aiComplete && run.caseMemo ? (
          <View>
            <SectionTitle>11. Draft Case Memo</SectionTitle>
            <Text style={styles.memo}>{run.caseMemo}</Text>
          </View>
        ) : null}

        {/* Disposition */}
        <SectionTitle>{aiComplete ? "12. Analyst Disposition" : "7. Analyst Disposition"}</SectionTitle>
        {run.disposition ? (
          <View>
            <View style={styles.kvGrid}>
              <KV label="Decision" value={run.disposition.decision.toUpperCase()} />
              <KV label="Analyst" value={run.disposition.analystName || "-"} />
              <KV label="Recorded" value={fmtDate(run.disposition.createdAt)} />
            </View>
            <Text style={styles.para}>{run.disposition.notes || "No notes recorded."}</Text>
            {reviews.length > 0 ? (
              <Text style={styles.small}>
                Hypothesis review: {reviews.filter((r) => r.verdict === "accepted").length} accepted,{" "}
                {reviews.filter((r) => r.verdict === "dismissed").length} dismissed,{" "}
                {reviews.filter((r) => r.verdict === "undetermined").length} undetermined.
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={[styles.para, { color: MUTED }]}>
            No disposition has been recorded for this run. This report reflects the analytical state
            only; it does not constitute a decision.
          </Text>
        )}

        {/* Method & limitations */}
        <SectionTitle>{aiComplete ? "13. Method & Limitations" : "8. Method & Limitations"}</SectionTitle>
        <Bullet>
          The suspicion probability is computed exclusively by the deterministic forensic engine
          from rule hits and technical features with expert-elicited log-likelihood weights. AI
          layers contribute narrative and investigative direction only and cannot alter the score.
        </Bullet>
        <Bullet>
          Findings are indicators, not proof. This report supports - and does not replace - human
          judgment and the institution's SAR/STR obligations under Kuwait Law No. 106 of 2013 and
          CBK instructions.
        </Bullet>
        <Bullet>
          Results are conditioned on the completeness of the statements provided. Data-quality
          caveats in section 5 list what could not be verified.
        </Bullet>
        {inv && inv.limitations.length > 0
          ? inv.limitations.map((l, i) => <Bullet key={i}>{l}</Bullet>)
          : null}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            ASIA Consulting - AML Suspicion Scoring Console  |  {reportRef}  |  CONFIDENTIAL
          </Text>
        </View>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
