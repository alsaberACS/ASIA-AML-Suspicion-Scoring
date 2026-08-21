/**
 * ASIA Consulting - AML Suspicion Analysis Report (PDF).
 *
 * Executive-publication styling modeled on World Economic Forum insight
 * reports: cream cover with artwork and case information, contents page,
 * numbered sections with plain-language standfirsts, FIGURE blocks on warm
 * grey bands (risk gauge, evidence drivers, behavioural timeline, bank
 * exposure), BOX explainer panels for non-specialist readers, and running
 * chrome with confidentiality markings.
 *
 * The report stays honest by construction: AI sections render only when the
 * AI layer completed, gated tests and data-quality caveats are explicit, the
 * deterministic score is presented as independent of AI narrative layers, and
 * sanctions screening is evidence-only. Section numbers are computed from one
 * section array (single source of truth - no manual renumbering).
 */
import {
  Document,
  Image,
  Line,
  Page,
  Polyline,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { existsSync } from "node:fs";
import path from "node:path";
import { Fragment } from "react";
import type { ReactNode } from "react";
import type * as z from "zod/v4";
import type { GetAnalysisRunResponse } from "@workspace/api-zod";
import type { SanctionsScreening } from "./sanctions";

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

export interface MonthlyFlow {
  month: string; // YYYY-MM
  creditsKwd: number;
  debitsKwd: number;
  cashInKwd: number;
  cashOutKwd: number;
  txnCount: number;
}

/* ------------------------------------------------------------------ */
/* Palette - WEF-inspired print styling with the ASIA brand accent     */
/* ------------------------------------------------------------------ */

const INK = "#1A2433";
const MUTED = "#5B6B7C";
const FAINT = "#93A1B0";
const LINE = "#DFE4EA";
const CREAM = "#EFEAE2";
const BAND_BG = "#F5F3EE";
const PAPER_SOFT = "#F8FAFC";
const STAND = "#4A7FA5";
const ACCENT = "#0F766E";
const RED = "#B91C1C";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#B91C1C",
  high: "#C2410C",
  medium: "#B45309",
  low: "#64748B",
};

const BAND_COLOR: Record<string, string> = {
  Low: "#0F9D6B",
  Moderate: "#2563EB",
  Elevated: "#B45309",
  High: "#C2410C",
  Critical: "#B91C1C",
};

const GAUGE_COLOR: Record<string, string> = {
  Low: "#10B981",
  Moderate: "#3B82F6",
  Elevated: "#F59E0B",
  High: "#F97316",
  Critical: "#DC2626",
};

const VERDICT_COLOR: Record<string, string> = {
  accepted: ACCENT,
  dismissed: "#64748B",
  undetermined: "#B45309",
};

const PRESENT_LABEL: Record<string, string> = {
  yes: "Present",
  partial: "Partially present",
  no: "Not indicated",
};

/* Content width inside 48pt page margins on A4 */
const CW = 499;
/* Figure band inner width (band padding 12) */
const FW = CW - 24;

const coverImagePath = (() => {
  const candidates = [
    path.join(process.cwd(), "assets", "report-cover.jpg"),
    path.join(process.cwd(), "assets", "report-cover.png"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "report-cover.jpg"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
})();

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  // NOTE: deliberately no lineHeight on page styles. Page-level lineHeight
  // reaches the fixed render-prop page-number Text via inheritance and
  // silently breaks it in @react-pdf 4.6.x. Line spacing is per body style.
  cover: {
    fontFamily: "Helvetica",
    backgroundColor: CREAM,
    color: INK,
    padding: 0,
  },
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
    paddingTop: 70,
    paddingBottom: 62,
    paddingHorizontal: 48,
  },
  masthead: {
    position: "absolute",
    top: 22,
    left: 48,
    right: 48,
    height: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 0.75,
    borderBottomColor: LINE,
    paddingBottom: 7,
  },
  mastLeftBold: { fontSize: 7.5, fontFamily: "Helvetica-Bold", letterSpacing: 1, color: INK },
  mastLeftDim: { fontSize: 7.5, color: FAINT },
  mastRight: { fontSize: 7, textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 48,
    right: 48,
    height: 22,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 6,
  },
  footerBold: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: INK },
  footerDim: { fontSize: 6.5, color: FAINT },
  pageNumber: {
    position: "absolute",
    bottom: 28,
    right: 48,
    height: 10,
    fontSize: 6.5,
    color: FAINT,
    textAlign: "right",
  },
  /* Section headings */
  secWrap: { marginTop: 18, marginBottom: 8 },
  secRow: { flexDirection: "row", alignItems: "flex-start" },
  secNum: {
    width: 20,
    height: 20,
    backgroundColor: INK,
    color: "#FFFFFF",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    paddingTop: 4.5,
    marginRight: 9,
    borderRadius: 1,
  },
  secTitle: { fontSize: 14.5, fontFamily: "Helvetica-Bold", color: INK, flex: 1, paddingTop: 2 },
  standfirst: {
    fontSize: 10.5,
    color: STAND,
    lineHeight: 1.45,
    marginTop: 6,
    paddingLeft: 29,
    paddingRight: 20,
  },
  subHead: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  // NOTE: unitless lineHeight in react-pdf must sit next to an explicit
  // fontSize in the SAME style object - otherwise it resolves against the
  // default font size (18) instead of the inherited one and double-spaces.
  para: { fontSize: 9, marginBottom: 6, textAlign: "justify", lineHeight: 1.5 },
  small: { fontSize: 8, color: MUTED, lineHeight: 1.45 },
  bullet: { flexDirection: "row", marginBottom: 3, paddingRight: 8 },
  bulletDot: { width: 10, color: ACCENT },
  bulletText: { flex: 1, fontSize: 9, lineHeight: 1.45 },
  /* Figure + box blocks */
  figHeader: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  figLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: ACCENT, letterSpacing: 1.5 },
  figRule: { width: 0.75, backgroundColor: FAINT, alignSelf: "stretch", marginHorizontal: 7 },
  figTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: INK, flex: 1 },
  figBand: { backgroundColor: BAND_BG, padding: 12 },
  figNote: { fontSize: 6.5, color: FAINT, marginTop: 4, lineHeight: 1.4 },
  box: {
    backgroundColor: BAND_BG,
    borderLeftWidth: 2,
    borderLeftColor: ACCENT,
    padding: 12,
    marginVertical: 9,
  },
  boxText: { fontSize: 8.5, lineHeight: 1.55, marginBottom: 4 },
  /* Key stats band */
  statsBand: {
    flexDirection: "row",
    backgroundColor: BAND_BG,
    padding: 12,
    marginBottom: 10,
  },
  statCell: { flex: 1, paddingRight: 6 },
  statValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  statLabel: { fontSize: 5.75, color: FAINT, letterSpacing: 0.7, textTransform: "uppercase", marginTop: 2.5 },
  /* KV grid */
  kvGrid: { flexDirection: "row", flexWrap: "wrap" },
  kvCell: { width: "33.33%", marginBottom: 7, paddingRight: 10 },
  kvLabel: { fontSize: 6.5, color: FAINT, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 1.5 },
  kvValue: { fontSize: 9.5 },
  /* Tables */
  rowHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingVertical: 4,
    marginTop: 2,
  },
  headCell: { fontSize: 6.5, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase" },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingVertical: 4,
    alignItems: "flex-start",
  },
  rowAlt: { backgroundColor: PAPER_SOFT },
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
    borderLeftWidth: 2.5,
    borderRadius: 2,
    padding: 9,
    marginBottom: 7,
    backgroundColor: "#FFFFFF",
  },
  cardTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginBottom: 3, flex: 1, paddingRight: 8 },
  memo: {
    fontFamily: "Courier",
    fontSize: 7.5,
    lineHeight: 1.5,
    backgroundColor: BAND_BG,
    borderLeftWidth: 2,
    borderLeftColor: FAINT,
    padding: 12,
  },
  /* Cover */
  coverInner: { paddingHorizontal: 46, paddingTop: 42, flexGrow: 1 },
  coverBrandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  coverTitle: { fontSize: 29, fontFamily: "Helvetica-Bold", color: INK },
  coverStand: { fontSize: 11.5, color: STAND, lineHeight: 1.5, marginTop: 12, paddingRight: 90 },
  coverMetaCaps: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 3, marginTop: 22 },
  coverDate: { fontSize: 7, color: MUTED, letterSpacing: 2, marginTop: 4 },
  coverInfo: { marginTop: 22, borderTopWidth: 1.25, borderTopColor: INK, paddingTop: 12, flexDirection: "row", flexWrap: "wrap" },
  coverKv: { width: "33.33%", marginBottom: 9, paddingRight: 12 },
  /* Contents */
  tocTitle: { fontSize: 24, fontFamily: "Helvetica-Bold", marginBottom: 14 },
  tocRow: { flexDirection: "row", paddingVertical: 5.5, borderBottomWidth: 0.5, borderBottomColor: LINE },
  tocNum: { width: 24, fontSize: 9.5, fontFamily: "Helvetica-Bold", color: ACCENT },
  tocText: { fontSize: 9.5, flex: 1 },
});

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function fmtKwd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return `${Math.round(v).toLocaleString("en-US")} KWD`;
}

function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
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

function fmtMonthShort(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}...`;
}

/** Compact monthly flows to quarters when the period is long. */
function compactFlows(flows: MonthlyFlow[]): { label: string; f: MonthlyFlow }[] {
  if (flows.length === 0) return [];
  if (flows.length <= 30) {
    return flows.map((f) => ({ label: `${f.month.slice(5, 7)}/${f.month.slice(2, 4)}`, f }));
  }
  const byQ = new Map<string, MonthlyFlow>();
  for (const f of flows) {
    const q = Math.floor((Number(f.month.slice(5, 7)) - 1) / 3) + 1;
    const key = `${f.month.slice(0, 4)}-Q${q}`;
    let e = byQ.get(key);
    if (!e) {
      e = { month: key, creditsKwd: 0, debitsKwd: 0, cashInKwd: 0, cashOutKwd: 0, txnCount: 0 };
      byQ.set(key, e);
    }
    e.creditsKwd += f.creditsKwd;
    e.debitsKwd += f.debitsKwd;
    e.cashInKwd += f.cashInKwd;
    e.cashOutKwd += f.cashOutKwd;
    e.txnCount += f.txnCount;
  }
  return [...byQ.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, f]) => ({ label: `Q${key.slice(6)} ${key.slice(2, 4)}`, f }));
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Chip({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.chip, { color, borderColor: color }]}>{label}</Text>;
}

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bullet} wrap={false}>
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

function SectionHeading({ n, title, standfirst }: { n: number; title: string; standfirst?: string }) {
  return (
    <View style={styles.secWrap} wrap={false}>
      <View style={styles.secRow}>
        <Text style={styles.secNum}>{n}</Text>
        <Text style={styles.secTitle}>{title}</Text>
      </View>
      {standfirst ? <Text style={styles.standfirst}>{standfirst}</Text> : null}
    </View>
  );
}

function FigureBlock({
  n,
  title,
  note,
  source,
  children,
}: {
  n: number;
  title: string;
  note?: string;
  source?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ marginVertical: 10 }} wrap={false}>
      <View style={styles.figHeader}>
        <Text style={styles.figLabel}>FIGURE {n}</Text>
        <View style={styles.figRule} />
        <Text style={styles.figTitle}>{title}</Text>
      </View>
      <View style={styles.figBand}>{children}</View>
      {note ? (
        <Text style={styles.figNote}>
          <Text style={{ fontFamily: "Helvetica-Bold", color: MUTED }}>Note: </Text>
          {note}
        </Text>
      ) : null}
      {source ? (
        <Text style={styles.figNote}>
          <Text style={{ fontFamily: "Helvetica-Bold", color: MUTED }}>Source: </Text>
          {source}
        </Text>
      ) : null}
    </View>
  );
}

function BoxPanel({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <View style={styles.box} wrap={false}>
      <View style={[styles.figHeader, { marginBottom: 6 }]}>
        <Text style={styles.figLabel}>BOX {n}</Text>
        <View style={styles.figRule} />
        <Text style={styles.figTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* SVG figures                                                         */
/* ------------------------------------------------------------------ */

function GaugeSvg({ run }: { run: RunApi }) {
  const W = FW;
  const H = 62;
  const barY = 26;
  const barH = 13;
  let x = 0;
  const segs = run.bandScale.map((b) => {
    const w = (b.maxP - b.minP) * W;
    const seg = { band: b.band, x, w, minP: b.minP };
    x += w;
    return seg;
  });
  const px = Math.min(Math.max(run.probability * W, 2), W - 2);
  const labelX = Math.min(Math.max(px, 42), W - 42);
  return (
    <Svg width={W} height={H}>
      {segs.map((s) => (
        <Rect key={s.band} x={s.x} y={barY} width={s.w} height={barH} fill={GAUGE_COLOR[s.band] ?? MUTED} opacity={0.88} />
      ))}
      {segs.map((s) =>
        s.w > 40 ? (
          <Text
            key={`l-${s.band}`}
            x={s.x + s.w / 2}
            y={barY + 9}
            textAnchor="middle"
            style={{ fontSize: 5.5, fontFamily: "Helvetica-Bold", fill: "#FFFFFF" }}
          >
            {s.band.toUpperCase()}
          </Text>
        ) : null,
      )}
      {[...segs.map((s) => ({ p: s.minP, x: s.x })), { p: 1, x: W }].map((t, i) => (
        <Text
          key={i}
          x={t.x}
          y={barY + barH + 12}
          textAnchor={t.x < 8 ? "start" : t.x > W - 8 ? "end" : "middle"}
          style={{ fontSize: 5.5, fill: FAINT }}
        >
          {`${Math.round(t.p * 100)}%`}
        </Text>
      ))}
      <Polyline points={`${px - 4.5},15 ${px + 4.5},15 ${px},${barY - 2}`} fill={INK} stroke={INK} strokeWidth={0.5} />
      <Line x1={px} y1={barY - 2} x2={px} y2={barY + barH + 2} stroke={INK} strokeWidth={1.4} />
      <Text x={labelX} y={10} textAnchor="middle" style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", fill: INK }}>
        {`THIS CASE  ${fmtPct(run.probability)}  (${run.band.toUpperCase()})`}
      </Text>
    </Svg>
  );
}

function DriversSvg({ drivers }: { drivers: RunApi["drivers"] }) {
  const top = [...drivers].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 10);
  const rowH = 16;
  const H = top.length * rowH + 20;
  const labelW = 206;
  const plotL = labelW + 6;
  const plotR = FW - 30;
  const half = (plotR - plotL) / 2;
  const xz = plotL + half;
  const maxAbs = Math.max(...top.map((d) => Math.abs(d.contribution)), 0.1);
  const scale = half / maxAbs;
  return (
    <Svg width={FW} height={H}>
      <Line x1={xz} y1={0} x2={xz} y2={H - 16} stroke={MUTED} strokeWidth={0.75} />
      {top.map((d, i) => {
        const y = i * rowH + 3;
        const w = Math.abs(d.contribution) * scale;
        const bx = d.contribution >= 0 ? xz : xz - w;
        const pos = d.contribution >= 0;
        // When a large negative bar would push its value label into the
        // driver-label column, print the value inside the bar instead.
        const inside = !pos && xz - w - 3 < labelW + 12;
        return (
          <Fragment key={i}>
            <Text x={labelW} y={y + 7.5} textAnchor="end" style={{ fontSize: 6.5, fill: INK }}>
              {truncate(d.label, 52)}
            </Text>
            <Rect x={bx} y={y} width={Math.max(w, 0.5)} height={10} fill={pos ? RED : ACCENT} opacity={0.92} />
            <Text
              x={pos ? xz + w + 3 : inside ? bx + 3 : xz - w - 3}
              y={y + 7.5}
              textAnchor={pos ? "start" : inside ? "start" : "end"}
              style={{
                fontSize: 6,
                fontFamily: "Helvetica-Bold",
                fill: inside ? "#FFFFFF" : pos ? RED : ACCENT,
              }}
            >
              {signed(d.contribution)}
            </Text>
          </Fragment>
        );
      })}
      <Text x={plotL} y={H - 4} textAnchor="start" style={{ fontSize: 5.5, fill: FAINT }}>
        pulls away from suspicion
      </Text>
      <Text x={plotR} y={H - 4} textAnchor="end" style={{ fontSize: 5.5, fill: FAINT }}>
        pushes toward suspicion
      </Text>
    </Svg>
  );
}

function FlowsSvg({ periods }: { periods: { label: string; f: MonthlyFlow }[] }) {
  const W = FW;
  const H = 186;
  const plotL = 34;
  const plotR = W - 4;
  const plotT = 10;
  const plotB = 136;
  const n = periods.length;
  const slot = (plotR - plotL) / Math.max(n, 1);
  const barW = Math.min(7, slot * 0.34);
  const maxV =
    Math.max(...periods.map((p) => Math.max(p.f.creditsKwd, p.f.debitsKwd)), 1) * 1.06;
  const yOf = (v: number) => plotB - ((plotB - plotT) * v) / maxV;
  const xc = (i: number) => plotL + slot * i + slot / 2;
  const step = Math.max(1, Math.ceil(n / 9));
  const cashInPts = periods.map((p, i) => `${xc(i)},${yOf(p.f.cashInKwd)}`).join(" ");
  const cashOutPts = periods.map((p, i) => `${xc(i)},${yOf(p.f.cashOutKwd)}`).join(" ");
  const gridVals = [0.25, 0.5, 0.75, 1].map((t) => maxV * t);
  const IN = "#0F766E";
  const OUT = "#C05621";
  const CIN = "#0E7490";
  const COUT = "#B91C1C";
  return (
    <Svg width={W} height={H}>
      {gridVals.map((v, i) => (
        <Fragment key={i}>
          <Line x1={plotL} y1={yOf(v)} x2={plotR} y2={yOf(v)} stroke={LINE} strokeWidth={0.5} strokeDasharray="2,2" />
          <Text x={plotL - 3} y={yOf(v) + 2} textAnchor="end" style={{ fontSize: 5.5, fill: FAINT }}>
            {fmtCompact(v)}
          </Text>
        </Fragment>
      ))}
      <Line x1={plotL} y1={plotB} x2={plotR} y2={plotB} stroke={MUTED} strokeWidth={0.75} />
      {periods.map((p, i) => (
        <Fragment key={i}>
          <Rect x={xc(i) - barW - 0.6} y={yOf(p.f.creditsKwd)} width={barW} height={plotB - yOf(p.f.creditsKwd)} fill={IN} opacity={0.9} />
          <Rect x={xc(i) + 0.6} y={yOf(p.f.debitsKwd)} width={barW} height={plotB - yOf(p.f.debitsKwd)} fill={OUT} opacity={0.9} />
        </Fragment>
      ))}
      {n > 1 ? <Polyline points={cashInPts} fill="none" stroke={CIN} strokeWidth={1.1} strokeDasharray="3,2" /> : null}
      {n > 1 ? <Polyline points={cashOutPts} fill="none" stroke={COUT} strokeWidth={1.1} strokeDasharray="3,2" /> : null}
      {periods.map((p, i) =>
        i % step === 0 ? (
          <Text key={`x${i}`} x={xc(i)} y={plotB + 10} textAnchor="middle" style={{ fontSize: 5.5, fill: MUTED }}>
            {p.label}
          </Text>
        ) : null,
      )}
      {/* Legend */}
      <Rect x={plotL} y={H - 26} width={7} height={7} fill={IN} />
      <Text x={plotL + 10} y={H - 20} style={{ fontSize: 6, fill: INK }}>Inflows (KWD)</Text>
      <Rect x={plotL + 90} y={H - 26} width={7} height={7} fill={OUT} />
      <Text x={plotL + 100} y={H - 20} style={{ fontSize: 6, fill: INK }}>Outflows (KWD)</Text>
      <Line x1={plotL + 185} y1={H - 22} x2={plotL + 205} y2={H - 22} stroke={CIN} strokeWidth={1.1} strokeDasharray="3,2" />
      <Text x={plotL + 209} y={H - 20} style={{ fontSize: 6, fill: INK }}>Cash deposits</Text>
      <Line x1={plotL + 290} y1={H - 22} x2={plotL + 310} y2={H - 22} stroke={COUT} strokeWidth={1.1} strokeDasharray="3,2" />
      <Text x={plotL + 314} y={H - 20} style={{ fontSize: 6, fill: INK }}>Cash withdrawals</Text>
    </Svg>
  );
}

function BanksSvg({ banks }: { banks: RunApi["banks"] }) {
  const rows = [...banks].sort((a, b) => b.creditsKwd + b.debitsKwd - (a.creditsKwd + a.debitsKwd));
  const rowH = 27;
  const H = rows.length * rowH + 12;
  const labelW = 150;
  const plotL = labelW + 8;
  const plotR = FW - 46;
  const maxV = Math.max(...rows.map((r) => Math.max(r.creditsKwd, r.debitsKwd)), 1);
  const scale = (plotR - plotL) / maxV;
  const IN = "#0F766E";
  const OUT = "#C05621";
  return (
    <Svg width={FW} height={H}>
      {rows.map((r, i) => {
        const y = i * rowH + 4;
        return (
          <Fragment key={r.bank}>
            <Text x={labelW} y={y + 7} textAnchor="end" style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", fill: INK }}>
              {truncate(r.bank, 34)}
            </Text>
            <Text x={labelW} y={y + 15} textAnchor="end" style={{ fontSize: 5.5, fill: FAINT }}>
              {`${r.txnCount} transactions`}
            </Text>
            <Rect x={plotL} y={y} width={Math.max(r.creditsKwd * scale, 0.5)} height={7} fill={IN} opacity={0.9} />
            <Text x={plotL + r.creditsKwd * scale + 3} y={y + 5.5} style={{ fontSize: 5.5, fill: IN }}>
              {`+${fmtCompact(r.creditsKwd)}`}
            </Text>
            <Rect x={plotL} y={y + 9} width={Math.max(r.debitsKwd * scale, 0.5)} height={7} fill={OUT} opacity={0.9} />
            <Text x={plotL + r.debitsKwd * scale + 3} y={y + 14.5} style={{ fontSize: 5.5, fill: OUT }}>
              {`-${fmtCompact(r.debitsKwd)}`}
            </Text>
          </Fragment>
        );
      })}
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Page chrome                                                         */
/* ------------------------------------------------------------------ */

function Chrome({ subject, reportRef }: { subject: string; reportRef: string }) {
  return (
    <>
      <View style={styles.masthead} fixed>
        <Text>
          <Text style={styles.mastLeftBold}>ASIA CONSULTING</Text>
          <Text style={styles.mastLeftDim}>   |   AML Suspicion Analysis</Text>
        </Text>
        <Text style={styles.mastRight}>
          <Text style={{ color: RED, fontFamily: "Helvetica-Bold", letterSpacing: 1 }}>CONFIDENTIAL</Text>
          <Text style={{ color: FAINT }}>   {reportRef}</Text>
        </Text>
      </View>
      <View style={styles.footer} fixed>
        <Text>
          <Text style={styles.footerBold}>AML Suspicion Analysis: </Text>
          <Text style={styles.footerDim}>{subject}</Text>
        </Text>
      </View>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        fixed
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export async function renderAnalysisReport(
  run: RunApi,
  caseInfo: ReportCaseInfo | null,
  monthlyFlows: MonthlyFlow[] = [],
): Promise<Buffer> {
  const subject = caseInfo?.subjectName ?? `Case ${run.caseId}`;
  const firedRules = [...run.ruleHits.filter((r) => r.fired)].sort(
    (a, b) => Math.abs(b.weightLogLr) - Math.abs(a.weightLogLr),
  );
  const testedNotFired = run.ruleHits.length - firedRules.length;
  const tech = run.technicalAnalysis;
  const aiComplete = run.aiStatus === "complete";

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
  const inv = aiComplete ? ((run.aiInvestigation ?? null) as unknown as AiInvestigationDoc | null) : null;
  const sanctions = (run.sanctionsScreening ?? null) as SanctionsScreening | null;
  const typology = aiComplete ? ((run.typologyFindings ?? []) as unknown as TypologyDoc[]) : [];
  const critic = aiComplete ? ((run.criticScenarios ?? []) as unknown as CriticDoc[]) : [];
  const reviews = run.disposition?.hypothesisReviews ?? [];
  const reviewByHyp = new Map(reviews.map((r) => [r.hypothesisId, r]));
  const currentBand = run.bandScale.find((b) => b.band === run.band);
  const reportRef = `RPT-C${run.caseId.toString().padStart(3, "0")}-R${run.id.toString().padStart(3, "0")}`;
  const gatedFeatures = run.features.filter((f) => f.gatedReason);
  const bandColor = BAND_COLOR[run.band] ?? INK;
  const periods = compactFlows(monthlyFlows);
  const quarterized = monthlyFlows.length > 30;
  const totalCash = monthlyFlows.reduce((s, m) => s + m.cashInKwd, 0);
  const cashShare = run.totalCreditsKwd > 0 ? totalCash / run.totalCreditsKwd : 0;
  const peakIn = monthlyFlows.reduce(
    (best, m) => (m.creditsKwd > (best?.creditsKwd ?? 0) ? m : best),
    null as MonthlyFlow | null,
  );

  let figN = 0;
  const nextFig = () => ++figN;
  let boxN = 0;
  const nextBox = () => ++boxN;

  /* ----- sections (single source of truth for numbering) ----- */
  const sections: { title: string; standfirst?: string; body: ReactNode }[] = [];

  sections.push({
    title: "Executive Summary",
    standfirst:
      "How likely is it that this account activity reflects money laundering - and on what evidence. The verdict of the deterministic engine, in figures first.",
    body: (
      <View>
        <View style={styles.statsBand} wrap={false}>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: bandColor }]}>{fmtPct(run.probability)}</Text>
            <Text style={styles.statLabel}>Suspicion Probability</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: bandColor }]}>{run.band}</Text>
            <Text style={styles.statLabel}>Risk Band</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{String(run.txnCount)}</Text>
            <Text style={styles.statLabel}>Transactions</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{String(run.banks.length)}</Text>
            <Text style={styles.statLabel}>Banking Institutions</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{`${(run.dataQualityScore * 100).toFixed(0)}%`}</Text>
            <Text style={styles.statLabel}>Data Quality Index</Text>
          </View>
        </View>

        <FigureBlock
          n={nextFig()}
          title="Where this case sits on the risk spectrum"
          note={`The marker shows the computed suspicion probability. Recommended posture for the ${run.band} band: ${currentBand?.action ?? "-"}.`}
          source={`ASIA deterministic forensic engine${tech ? ` ${tech.engineVersion}` : ""}, analysis run #${run.id} of ${fmtDate(run.createdAt)}.`}
        >
          <GaugeSvg run={run} />
        </FigureBlock>

        {inv?.executiveAssessment ? (
          <Text style={styles.para}>{inv.executiveAssessment}</Text>
        ) : (
          <Text style={[styles.para, { color: MUTED }]}>
            The AI investigation layer has not completed for this run (status: {run.aiStatus}). The
            deterministic findings in this report stand on their own; every score, rule and figure
            below comes from the deterministic engine alone.
          </Text>
        )}

        <BoxPanel n={nextBox()} title="How to read the suspicion score">
          <Text style={styles.boxText}>
            The engine starts from a conservative base rate: out of every 100 reviewed cases of this
            kind, about {fmtPct(run.priorProbability)} turn out to involve laundering. It then moves
            that starting point only when it finds weighted, citable evidence - each red flag or
            forensic finding pushes the probability up, and each exculpatory signal pulls it down.
          </Text>
          <Text style={styles.boxText}>
            For this case the evidence moved the probability from {fmtPct(run.priorProbability)} to{" "}
            {fmtPct(run.probability)}, which falls in the {run.band} band. In plain terms: the
            activity shows materially more risk signals than a typical account, but the score is a
            measure of suspicion, not a finding of guilt.
          </Text>
          <Text style={[styles.boxText, { marginBottom: 0 }]}>
            The AI sections later in this report add narrative and investigative direction only.
            They can never change the number above - by design.
          </Text>
        </BoxPanel>

        <Text style={styles.subHead}>Subject profile and declarations</Text>
        <View style={styles.kvGrid}>
          <KV label="Declared Occupation" value={caseInfo?.declaredOccupation || "-"} />
          <KV label="Declared Monthly Income" value={fmtKwd(caseInfo?.declaredMonthlyIncomeKwd)} />
          <KV label="Declared Activity" value={caseInfo?.declaredBusinessActivity || "-"} />
          <KV label="Statement Period" value={`${fmtDate(run.periodStart)} - ${fmtDate(run.periodEnd)}`} />
          <KV label="Total Credits" value={fmtKwd(run.totalCreditsKwd)} />
          <KV label="Total Debits" value={fmtKwd(run.totalDebitsKwd)} />
          <KV
            label="Inter-Account Transfers"
            value={`${run.internalTransferCount} (${fmtKwd(run.internalValueKwd)})`}
          />
          <KV label="Profile Consistency" value={run.profileConsistency?.verdict ?? "-"} />
          <KV label="AI Layer Status" value={run.aiStatus} />
        </View>
      </View>
    ),
  });

  sections.push({
    title: "Suspicion Score Composition",
    standfirst:
      "Every driver that moved the score, ranked by weight of evidence. Red bars push toward suspicion; teal bars pull away from it.",
    body: (
      <View>
        <FigureBlock
          n={nextFig()}
          title="Top evidence drivers by contribution"
          note="Contributions are in log-likelihood units - the engine's currency of evidence. A driver of +0.9 roughly doubles the odds; the base-rate prior anchors the scale on the left."
          source="Bayesian evidence aggregation over fired rules and technical features."
        >
          <DriversSvg drivers={run.drivers} />
        </FigureBlock>

        <Text style={styles.subHead}>Full driver table</Text>
        <View style={styles.rowHead}>
          <Text style={[styles.headCell, { flex: 5 }]}>Driver</Text>
          <Text style={[styles.headCell, { flex: 1.4 }]}>Source</Text>
          <Text style={[styles.headCell, { flex: 1, textAlign: "right" }]}>Contribution</Text>
        </View>
        {run.drivers.map((d, i) => (
          <View key={i} style={[styles.row, ...(i % 2 === 1 ? [styles.rowAlt] : [])]}>
            <Text style={{ flex: 5, paddingRight: 8 }}>{d.label}</Text>
            <Text style={{ flex: 1.4, color: MUTED, fontSize: 8 }}>{d.source}</Text>
            <Text
              style={{
                flex: 1,
                textAlign: "right",
                fontFamily: "Helvetica-Bold",
                color: d.contribution >= 0 ? RED : ACCENT,
              }}
            >
              {signed(d.contribution)}
            </Text>
          </View>
        ))}
        <Text style={[styles.small, { marginTop: 5 }]}>
          Scoring bands:{" "}
          {run.bandScale.map((b) => `${b.band} ${fmtPct(b.minP)}-${fmtPct(b.maxP)}`).join("  |  ")}
        </Text>
      </View>
    ),
  });

  if (periods.length > 1) {
    sections.push({
      title: "Behavioural Timeline",
      standfirst:
        "The rhythm of the money: how inflows, outflows and cash moved through the accounts over the statement period, across all institutions combined.",
      body: (
        <View>
          <FigureBlock
            n={nextFig()}
            title={`${quarterized ? "Quarterly" : "Monthly"} flow velocity and cash intensity`}
            note={`${quarterized ? "Aggregated to quarters for legibility over a long statement period. " : ""}Bars read against the left axis in KWD; dashed lines trace the cash component of those flows.`}
            source={`Consolidated statements, ${run.txnCount} transactions across ${run.banks.length} institutions.`}
          >
            <FlowsSvg periods={periods} />
          </FigureBlock>
          <Text style={styles.para}>
            {peakIn
              ? `Inflows peak at ${fmtKwd(peakIn.creditsKwd)} in ${fmtMonthShort(`${peakIn.month}-01`)}. `
              : ""}
            Cash deposits account for {fmtPct(cashShare)} of all credited value
            {cashShare > 0.3 ? " - a materially cash-intensive profile" : ""}. Concentration of
            activity in short windows, and divergence between the cash lines and the overall bars,
            are the patterns the rule engine in section {periods.length > 1 ? "4" : "3"} tests
            formally.
          </Text>
          <FigureBlock
            n={nextFig()}
            title="Exposure by banking institution"
            note="Top bar of each pair is credited value (+), bottom bar is debited value (-). Fragmenting activity across several institutions is itself a recognized layering pattern."
            source="Per-institution totals from the consolidated ledger."
          >
            <BanksSvg banks={run.banks} />
          </FigureBlock>
        </View>
      ),
    });
  }

  sections.push({
    title: "Rule-Based Red Flags",
    standfirst:
      "Deterministic rules with regulatory citations - each either fired on the evidence or it did not. No judgment calls, no black box.",
    body: (
      <View>
        <Text style={[styles.small, { marginBottom: 4 }]}>
          {firedRules.length} of {run.ruleHits.length} rules fired ({testedNotFired} tested without
          triggering). Weights are expert-elicited log-likelihood ratios; citations reference FATF
          typologies and Kuwaiti regulatory instruments.
        </Text>
        {firedRules.map((r, i) => (
          <View key={r.ruleId} style={[styles.row, ...(i % 2 === 1 ? [styles.rowAlt] : [])]} wrap={false}>
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
      </View>
    ),
  });

  sections.push({
    title: "Technical Forensic Findings",
    standfirst:
      "Statistical tests run directly on the transaction ledger - benchmarks, methods and caveats stated for every finding so each one can be independently re-checked.",
    body: (
      <View>
        {tech ? (
          <View>
            <Text style={[styles.small, { marginBottom: 5 }]}>
              Engine {tech.engineVersion} executed {tech.testsExecuted.length} test families over{" "}
              {tech.testedTransactionCount} transactions.
            </Text>
            {tech.findings.map((f) => (
              <View key={f.findingId} style={[styles.card, { borderLeftColor: sevColor(f.severity) }]} wrap={false}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <Text style={styles.cardTitle}>
                    {f.findingId}  {f.title}
                  </Text>
                  <Chip label={f.severity} color={sevColor(f.severity)} />
                </View>
                <Text style={{ fontSize: 8.5, lineHeight: 1.4 }}>{f.summary}</Text>
                <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 3 }}>
                  Metric: {f.metricValue}  |  Benchmark: {f.benchmark}
                </Text>
                <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 1 }}>Method: {f.methodology}</Text>
                {f.caveat ? (
                  <Text style={{ fontSize: 7.5, color: "#B45309", marginTop: 2 }}>Caveat: {f.caveat}</Text>
                ) : null}
              </View>
            ))}
            {tech.gatedTests.length > 0 ? (
              <View>
                <Text style={[styles.small, { marginBottom: 3 }]}>
                  Tests withheld because the underlying data could not support a reliable answer:
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
      </View>
    ),
  });

  sections.push({
    title: "Data Quality & Coverage",
    standfirst:
      "An unreliable ledger cannot be allowed to raise confident alarms. What could not be verified is listed here, and it directly discounts the score.",
    body: (
      <View>
        <Text style={[styles.small, { marginBottom: 4 }]}>
          Data quality index {(run.dataQualityScore * 100).toFixed(1)}/100.{" "}
          {gatedFeatures.length > 0
            ? `${gatedFeatures.length} feature(s) were excluded from scoring because their inputs could not be verified.`
            : "No features were gated."}
        </Text>
        {run.dataQualityIssues.map((issue, i) => (
          <Bullet key={i}>{issue}</Bullet>
        ))}
      </View>
    ),
  });

  sections.push({
    title: "Sanctions Screening",
    standfirst:
      "Every name in the case checked against the OFAC and UN Security Council lists. A name match is investigative evidence - it is never treated as identification and never moves the score.",
    body: (
      <View>
        {sanctions == null ? (
          <Text style={styles.small}>
            This analysis predates the sanctions screening layer. Re-run the analysis to screen the
            subject and named counterparties against the OFAC SDN and UN Security Council
            Consolidated lists.
          </Text>
        ) : sanctions.status === "unavailable" ? (
          <View style={[styles.card, { borderLeftColor: RED }]} wrap={false}>
            <Text style={[styles.cardTitle, { color: RED }]}>SCREENING UNAVAILABLE - NOT PERFORMED</Text>
            <Text style={{ fontSize: 8.5 }}>
              {sanctions.reason ?? "Sanctions lists could not be retrieved."} This must not be
              interpreted as a clean result.
            </Text>
          </View>
        ) : (
          <View>
            <View style={styles.rowHead}>
              <Text style={[styles.headCell, { flex: 3 }]}>List</Text>
              <Text style={[styles.headCell, { flex: 1, textAlign: "right" }]}>Entries</Text>
              <Text style={[styles.headCell, { flex: 1.4, textAlign: "right" }]}>Retrieved</Text>
              <Text style={[styles.headCell, { flex: 1.2, textAlign: "right" }]}>Copy</Text>
            </View>
            {sanctions.lists.map((l, i) => (
              <View key={l.id} style={[styles.row, ...(i % 2 === 1 ? [styles.rowAlt] : [])]}>
                <Text style={{ flex: 3, paddingRight: 8 }}>{l.label}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{l.entryCount.toLocaleString("en-US")}</Text>
                <Text style={{ flex: 1.4, textAlign: "right" }}>{l.fetchedAt.slice(0, 10)}</Text>
                <Text style={{ flex: 1.2, textAlign: "right", color: l.stale ? "#B45309" : ACCENT }}>
                  {l.stale ? "stale cache" : "current"}
                </Text>
              </View>
            ))}
            <Text style={[styles.small, { marginTop: 5, marginBottom: 5 }]}>
              {sanctions.namesScreened} names screened: the subject and every counterparty that
              could be identified by name in the statements. Masked account references cannot be
              name-screened.
            </Text>
            {sanctions.totals.exact + sanctions.totals.strong + sanctions.totals.possible === 0 ? (
              <Text style={styles.small}>
                No exact, strong, or possible matches were found for the subject or any named
                counterparty.
              </Text>
            ) : (
              <View>
                {sanctions.subject.matches.map((m, i) => (
                  <View
                    key={i}
                    style={[styles.card, { borderLeftColor: m.tier === "exact" ? RED : m.tier === "strong" ? "#C2410C" : "#B45309" }]}
                    wrap={false}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <Text style={styles.cardTitle}>SUBJECT vs {m.listedName}</Text>
                      <Chip
                        label={m.tier.toUpperCase()}
                        color={m.tier === "exact" ? RED : m.tier === "strong" ? "#C2410C" : "#B45309"}
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
                  <View
                    key={i}
                    style={[
                      styles.card,
                      {
                        borderLeftColor:
                          c.matches[0]?.tier === "exact" ? RED : c.matches[0]?.tier === "strong" ? "#C2410C" : "#B45309",
                      },
                    ]}
                    wrap={false}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <Text style={styles.cardTitle}>
                        {c.name +
                          (c.txnCount != null
                            ? " (" + c.txnCount + (c.txnCount === 1 ? " txn)" : " txns)")
                            : "")}
                      </Text>
                      {c.matches[0] ? (
                        <Chip
                          label={c.matches[0].tier.toUpperCase()}
                          color={
                            c.matches[0].tier === "exact" ? RED : c.matches[0].tier === "strong" ? "#C2410C" : "#B45309"
                          }
                        />
                      ) : null}
                    </View>
                    {c.matches.map((m, j) => (
                      <Text key={j} style={{ fontSize: 8, lineHeight: 1.4 }}>
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
            <BoxPanel n={nextBox()} title="What a match tier means">
              <Text style={styles.boxText}>
                EXACT - the name is token-for-token the same as a listed name or official alias,
                ignoring word order. STRONG - the names are highly similar under conservative
                matching. POSSIBLE - the names share at least two distinctive words; common filler
                words are never enough.
              </Text>
              <Text style={[styles.boxText, { marginBottom: 0 }]}>
                Any tier is a lead for the analyst, not an identification. Confirming identity
                requires date of birth, nationality or identity documents - none of which appear in
                bank statements.
              </Text>
            </BoxPanel>
          </View>
        )}
      </View>
    ),
  });

  if (aiComplete && typology.length > 0) {
    sections.push({
      title: "AI Typology Screen",
      standfirst:
        "A generative model reviews the case against known laundering patterns. It informs the narrative and cites transaction IDs - it has no vote on the score.",
      body: (
        <View>
          {typology.map((t) => (
            <View
              key={t.typologyId}
              style={[styles.card, { borderLeftColor: t.present === "no" ? LINE : t.present === "yes" ? RED : "#B45309" }]}
              wrap={false}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <Text style={styles.cardTitle}>{t.typologyName}</Text>
                <Chip
                  label={`${PRESENT_LABEL[t.present] ?? t.present}${t.present !== "no" ? ` / ${t.strength}` : ""}`}
                  color={t.present === "no" ? MUTED : t.present === "yes" ? RED : "#B45309"}
                />
              </View>
              <Text style={{ fontSize: 8.5, lineHeight: 1.4 }}>{t.reasoning}</Text>
              {t.benignExplanationsPossible ? (
                <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 2 }}>
                  Benign explanations possible: {t.benignExplanationsPossible}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ),
    });
  }

  if (aiComplete && critic.length > 0) {
    sections.push({
      title: "Adversarial Critic - Innocent Scenarios",
      standfirst:
        "A second AI pass argues the innocent side on purpose: the lawful explanations that could produce the same patterns, and the single document that would confirm each.",
      body: (
        <View>
          {critic.map((c, i) => (
            <View key={i} style={[styles.card, { borderLeftColor: ACCENT }]} wrap={false}>
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
      ),
    });
  }

  if (inv) {
    sections.push({
      title: "Investigation Hypotheses & Analyst Review",
      standfirst:
        "The concrete lines of investigation the case supports, each with its benign alternatives, open questions, and the analyst's recorded verdict.",
      body: (
        <View>
          {inv.hypotheses.map((h) => {
            const review = reviewByHyp.get(h.hypothesisId);
            const verdict = review?.verdict ?? "not reviewed";
            return (
              <View key={h.hypothesisId} style={[styles.card, { borderLeftColor: sevColor(h.priority) }]} wrap={false}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <Text style={styles.cardTitle}>
                    {h.hypothesisId}  {h.title}
                  </Text>
                  <Chip label={h.priority} color={sevColor(h.priority)} />
                </View>
                <Text style={{ fontSize: 8.5, lineHeight: 1.4 }}>{h.rationale}</Text>
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
                  <Chip label={verdict} color={review ? (VERDICT_COLOR[review.verdict] ?? MUTED) : FAINT} />
                  {review?.note ? (
                    <Text style={{ fontSize: 7.5, color: MUTED, marginLeft: 6, flex: 1 }}>{review.note}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ),
    });

    sections.push({
      title: "Recommended Actions",
      standfirst:
        "What to do next, in priority order - and the specific evidence each step is designed to obtain.",
      body: (
        <View>
          {inv.recommendedActions.map((a, i) => (
            <View key={i} style={[styles.row, ...(i % 2 === 1 ? [styles.rowAlt] : [])]} wrap={false}>
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
      ),
    });
  }

  if (aiComplete && run.caseMemo) {
    sections.push({
      title: "Draft Case Memo",
      standfirst:
        "An AI-drafted starting point for the institution's internal file - the analyst owns, edits and signs the final text.",
      body: <Text style={styles.memo}>{run.caseMemo}</Text>,
    });
  }

  sections.push({
    title: "Analyst Disposition",
    standfirst: run.disposition
      ? "The recorded human decision on this analysis run."
      : "No decision has been recorded yet for this run.",
    body: run.disposition ? (
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
        This report reflects the analytical state only; it does not constitute a decision. The
        disposition workflow in the console records the decision, the analyst, and the review of
        each investigation hypothesis.
      </Text>
    ),
  });

  sections.push({
    title: "Method & Limitations",
    standfirst:
      "What this report can honestly claim, and where its limits are. Read this section before acting on any finding.",
    body: (
      <View>
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
          Results are conditioned on the completeness of the statements provided. The data-quality
          section lists what could not be verified, and those gaps discount the score directly.
        </Bullet>
        <Bullet>
          Sanctions screening compares names only. It can neither confirm nor exclude identity, and
          an unavailable screening is reported as not performed - never as clean.
        </Bullet>
        {inv && inv.limitations.length > 0 ? inv.limitations.map((l, i) => <Bullet key={i}>{l}</Bullet>) : null}
        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: INK, paddingTop: 8 }}>
          <Text style={{ fontSize: 6.5, color: FAINT, lineHeight: 1.5 }}>
            Prepared by ASIA Consulting - AML Suspicion Scoring Console. Generated {nowKuwait()}.
            Report reference {reportRef}. This document is confidential and intended solely for the
            requesting institution's compliance function. Every transaction ID cited in this report
            can be opened and verified in the case console.
          </Text>
        </View>
      </View>
    ),
  });

  /* ----- document ----- */

  const doc = (
    <Document
      title={`ASIA AML Suspicion Analysis Report - ${subject}`}
      author="ASIA Consulting - AML Suspicion Scoring Console"
    >
      {/* Cover */}
      <Page size="A4" style={styles.cover}>
        <View style={styles.coverInner}>
          <View style={styles.coverBrandRow}>
            <View>
              <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 2 }}>
                ASIA CONSULTING
              </Text>
              <Text style={{ fontSize: 6.5, color: MUTED, letterSpacing: 1.2, marginTop: 3 }}>
                FINANCIAL CRIME ADVISORY - KUWAIT
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", letterSpacing: 3 }}>ASIA</Text>
              <Text style={{ fontSize: 6, color: MUTED, letterSpacing: 2, marginTop: 1 }}>DATA-SCIENCE</Text>
            </View>
          </View>

          <View style={{ marginTop: 44 }}>
            <Text style={styles.coverTitle}>AML Suspicion</Text>
            <Text style={styles.coverTitle}>Analysis Report</Text>
            <Text style={styles.coverStand}>
              An evidence-based assessment of money-laundering risk for {subject}, consolidating{" "}
              {run.banks.length} banking relationship{run.banks.length === 1 ? "" : "s"} and{" "}
              {run.txnCount} transactions into one defensible picture.
            </Text>
            <Text style={styles.coverMetaCaps}>ANALYSIS REPORT</Text>
            <Text style={styles.coverDate}>
              {`GENERATED ${nowKuwait().toUpperCase()}`}
            </Text>
            <Text style={{ fontSize: 7, color: RED, fontFamily: "Helvetica-Bold", letterSpacing: 2, marginTop: 8 }}>
              CONFIDENTIAL
            </Text>
          </View>

          <View style={styles.coverInfo}>
            <View style={styles.coverKv}>
              <Text style={styles.kvLabel}>Case Reference</Text>
              <Text style={styles.kvValue}>{reportRef}</Text>
            </View>
            <View style={styles.coverKv}>
              <Text style={styles.kvLabel}>Subject</Text>
              <Text style={styles.kvValue}>{subject}</Text>
            </View>
            <View style={styles.coverKv}>
              <Text style={styles.kvLabel}>Analysis Run</Text>
              <Text style={styles.kvValue}>{`#${run.id} of ${fmtDate(run.createdAt)}`}</Text>
            </View>
            <View style={styles.coverKv}>
              <Text style={styles.kvLabel}>Statement Period</Text>
              <Text style={styles.kvValue}>{`${fmtDate(run.periodStart)} - ${fmtDate(run.periodEnd)}`}</Text>
            </View>
            <View style={styles.coverKv}>
              <Text style={styles.kvLabel}>Institutions</Text>
              <Text style={styles.kvValue}>{`${run.banks.length} banks, ${run.txnCount} transactions`}</Text>
            </View>
            <View style={styles.coverKv}>
              <Text style={styles.kvLabel}>Prepared By</Text>
              <Text style={styles.kvValue}>ASIA Consulting</Text>
            </View>
          </View>
        </View>

        {coverImagePath ? (
          <Image src={coverImagePath} style={{ width: "100%", height: 308, objectFit: "cover" }} />
        ) : (
          <View style={{ width: "100%", height: 308, backgroundColor: INK }} />
        )}
      </Page>

      {/* Contents */}
      <Page size="A4" style={styles.page}>
        <Chrome subject={subject} reportRef={reportRef} />
        <Text style={styles.tocTitle}>Contents</Text>
        {sections.map((s, i) => (
          <View key={i} style={styles.tocRow}>
            <Text style={styles.tocNum}>{i + 1}</Text>
            <Text style={styles.tocText}>{s.title}</Text>
          </View>
        ))}
        <View style={[styles.box, { marginTop: 22 }]}>
          <View style={[styles.figHeader, { marginBottom: 6 }]}>
            <Text style={styles.figLabel}>ABOUT THIS REPORT</Text>
          </View>
          <Text style={styles.boxText}>
            This report was produced by the ASIA AML Suspicion Scoring Console. The console reads
            raw bank statements exactly as exported by each institution, reconstructs one
            consolidated ledger, and runs a deterministic forensic engine over it: red-flag rules
            with regulatory citations, statistical tests with stated benchmarks, and a Bayesian
            evidence model that turns the findings into a single suspicion probability.
          </Text>
          <Text style={styles.boxText}>
            Two AI passes then add narrative - one describes which laundering patterns the evidence
            resembles, the other deliberately argues the innocent interpretation. Their output is
            clearly marked, cites verifiable transaction IDs, and never changes the score.
          </Text>
          <Text style={[styles.boxText, { marginBottom: 0 }]}>
            Figures appear on shaded panels with their sources; explanation boxes like this one are
            written for readers who are not financial-crime specialists.
          </Text>
        </View>
      </Page>

      {/* Body */}
      <Page size="A4" style={styles.page}>
        <Chrome subject={subject} reportRef={reportRef} />
        {sections.map((s, i) => (
          <View key={i}>
            <SectionHeading n={i + 1} title={s.title} standfirst={s.standfirst} />
            {s.body}
          </View>
        ))}
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
