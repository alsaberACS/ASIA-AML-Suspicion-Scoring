import type { FeatureValue, RuleHit, SubjectProfile, Txn } from "./types";
import type { FeatureBundle } from "./features";

/**
 * M1 deterministic rule engine.
 *
 * Each rule encodes a recognized laundering typology with an explicit
 * citation, a calibrated log-likelihood-ratio weight for the Bayesian
 * aggregator, and the transaction IDs that constitute its evidence.
 * Rules that did not fire are still returned (fired=false) so the UI can
 * show what was checked, not just what tripped.
 */

interface RuleDef {
  ruleId: string;
  typologyId: string;
  typologyName: string;
  title: string;
  severity: RuleHit["severity"];
  weight: number; // log-LR when fired
  floor: number; // minimum posterior probability this rule alone justifies
  citation: string;
  description: string;
  evaluate: (ctx: RuleCtx) => { fired: boolean; detail: string | null; txnIds: number[]; weightOverride?: number } | null;
}

interface RuleCtx {
  f: Map<string, FeatureValue>;
  aux: FeatureBundle["aux"];
  txns: Txn[];
  profile: SubjectProfile;
  totalCreditsExternal: number;
}

const val = (ctx: RuleCtx, key: string): number => ctx.f.get(key)?.value ?? 0;
const zone = (ctx: RuleCtx, key: string): string => ctx.f.get(key)?.zone ?? "gated";

export const RULE_FLOORS: Record<string, number> = {};

const RULES: RuleDef[] = [
  {
    ruleId: "R-STRUCT-01",
    typologyId: "FATF.STR.1",
    typologyName: "Structuring / threshold avoidance",
    title: "Cash deposits clustered under the KD 3,000 trigger",
    severity: "high",
    weight: 1.1,
    floor: 0.25,
    citation:
      "FATF (2023) Money Laundering typologies - structuring below cash reporting thresholds; Kuwait FIU cash transaction reporting trigger of KD 3,000 (Law No. 106/2013, MOCI Res. 37/2013).",
    description:
      "A disproportionate share of sizeable cash deposits lands in the 2,400-2,999 KWD band immediately below the reporting threshold.",
    evaluate: (ctx) => {
      const density = val(ctx, "near_threshold_density");
      const ids = ctx.aux.nearThresholdTxns;
      const fired = zone(ctx, "near_threshold_density") !== "gated" && ids.length >= 4 && density >= 0.2;
      return {
        fired,
        detail: fired
          ? `${ids.length} cash deposits sit in the 2,400-2,999 KWD band (${(density * 100).toFixed(0)}% of sizeable cash deposits). Under a uniform spend pattern this band would attract about 5%.`
          : null,
        txnIds: fired ? ids.slice(0, 50) : [],
        weightOverride: density >= 0.35 ? 1.4 : undefined,
      };
    },
  },
  {
    ruleId: "R-STRUCT-02",
    typologyId: "FATF.STR.2",
    typologyName: "Structuring / multi-institution placement",
    title: "Same-day cash placement across multiple banks",
    severity: "critical",
    weight: 1.4,
    floor: 0.35,
    citation:
      "Egmont Group (2014) case compilation - smurfing via multiple institutions to defeat single-institution monitoring; FATF R.20 suspicious transaction indicators.",
    description:
      "Cash deposited at two or more banks on the same day, each below KD 3,000, while the combined daily total crossed the threshold. Invisible to any single bank.",
    evaluate: (ctx) => {
      const days = ctx.aux.multibankCashDays;
      const fired = days.length >= 2;
      return {
        fired,
        detail: fired
          ? `${days.length} days show coordinated sub-threshold cash placement across banks (e.g. ${days
              .slice(0, 3)
              .map((d) => d.date)
              .join(", ")}). This pattern only appears after cross-bank consolidation.`
          : null,
        txnIds: days.flatMap((d) => d.txnIds).slice(0, 50),
      };
    },
  },
  {
    ruleId: "R-STRUCT-03",
    typologyId: "FATF.STR.3",
    typologyName: "Structuring / split deposits",
    title: "Split same-day deposits under the threshold at one bank",
    severity: "high",
    weight: 0.8,
    floor: 0.15,
    citation: "FATF (2023) structuring indicators - splitting a single sum into several sub-threshold deposits.",
    description: "Multiple sub-threshold cash deposits at one bank on the same day, summing above KD 3,000.",
    evaluate: (ctx) => {
      const days = ctx.aux.splitDepositDays;
      const ratio = val(ctx, "aggregate_threshold_evasion");
      const fired = days.length >= 1 && ratio >= 1;
      return {
        fired,
        detail: fired
          ? `${days.length} day${days.length === 1 ? "" : "s"} with multiple sub-threshold cash deposits at one bank (${days
              .slice(0, 3)
              .map((d) => d.date)
              .join(", ")}); the largest same-day aggregate reaches ${(ratio * 100).toFixed(0)}% of the KD 3,000 trigger while every individual deposit stayed under it.`
          : null,
        txnIds: days.flatMap((d) => d.txnIds).slice(0, 50),
        weightOverride: days.length >= 3 ? undefined : 0.45,
      };
    },
  },
  {
    ruleId: "R-SMURF-01",
    typologyId: "FATF.PLC.1",
    typologyName: "Placement / cash fragmentation",
    title: "Cash entry deliberately fragmented across banks",
    severity: "high",
    weight: 0.9,
    floor: 0.2,
    citation: "FATF (2013) 'Money Laundering through the Physical Transportation of Cash'; Egmont smurfing typology.",
    description: "Cash placement spread evenly across several institutions rather than a natural home bank.",
    evaluate: (ctx) => {
      const frag = val(ctx, "bank_fragmentation_index");
      const cashTotal = ctx.aux.cashDepositTxns.length;
      const fired = zone(ctx, "bank_fragmentation_index") !== "gated" && frag >= 0.45 && cashTotal >= 8;
      return {
        fired,
        detail: fired
          ? `Fragmentation index ${frag.toFixed(2)} across banks (0 = single bank, 1 = perfectly even spread).`
          : null,
        txnIds: ctx.aux.cashDepositTxns.slice(0, 50),
      };
    },
  },
  {
    ruleId: "R-LAYER-01",
    typologyId: "FATF.LAY.1",
    typologyName: "Layering / pass-through",
    title: "Account operates as a pass-through conduit",
    severity: "high",
    weight: 1.0,
    floor: 0.3,
    citation:
      "FATF (2018) 'Professional Money Laundering' - flow-through accounts with balanced in/out volumes and minimal retention.",
    description: "External outflows track external inflows within ±5% at material volume - the account retains nothing.",
    evaluate: (ctx) => {
      const r = val(ctx, "pass_through_ratio");
      const fired =
        zone(ctx, "pass_through_ratio") === "elevated" ||
        (r >= 0.95 && r <= 1.05 && ctx.totalCreditsExternal >= 10000);
      return {
        fired,
        detail: fired
          ? `Outflow/inflow ratio ${r.toFixed(3)} on ${Math.round(ctx.totalCreditsExternal).toLocaleString()} KWD of external inflows.`
          : null,
        txnIds: [],
      };
    },
  },
  {
    ruleId: "R-LAYER-02",
    typologyId: "FATF.LAY.2",
    typologyName: "Layering / rapid movement",
    title: "Funds dispatched within 72 hours of arrival",
    severity: "high",
    weight: 0.9,
    floor: 0.2,
    citation: "FATF (2023) indicators - minimal dwell time between credits and matching debits.",
    description: "A large share of inflow value exits in a matching-magnitude outflow within three days.",
    evaluate: (ctx) => {
      const share = val(ctx, "quick_out_share");
      const fired = share >= 0.35 && ctx.aux.quickOutMatches.length >= 3;
      return {
        fired,
        detail: fired
          ? `${(share * 100).toFixed(0)}% of sizeable inflow value re-dispatched within 72h (${ctx.aux.quickOutMatches.length} matched pairs).`
          : null,
        txnIds: ctx.aux.quickOutMatches.flatMap((m) => [m.creditId, m.debitId]).slice(0, 50),
        weightOverride: share >= 0.6 ? 1.2 : undefined,
      };
    },
  },
  {
    ruleId: "R-LAYER-03",
    typologyId: "FATF.LAY.3",
    typologyName: "Layering / inter-bank relay",
    title: "Relay chains through own accounts at different banks",
    severity: "critical",
    weight: 1.2,
    floor: 0.35,
    citation:
      "Egmont Group case studies - layering through the subject's own accounts at multiple institutions to break the audit trail.",
    description: "External inflow at bank A, hop to own account at bank B, external outflow from B - all within days.",
    evaluate: (ctx) => {
      const chains = ctx.aux.relayChains;
      const fired = chains.length >= 2;
      return {
        fired,
        detail: fired ? `${chains.length} complete in-hop-out chains identified across banks.` : null,
        txnIds: chains.flatMap((c) => c.txnIds).slice(0, 50),
      };
    },
  },
  {
    ruleId: "R-CIRC-01",
    typologyId: "BCBS.CIR.1",
    typologyName: "Layering / self-circulation",
    title: "Heavy circulation between the subject's own banks",
    severity: "medium",
    weight: 0.7,
    floor: 0.12,
    citation:
      "Basel Committee (2014) 'Sound management of risks related to money laundering' - wash-through between own accounts obscuring origin of funds.",
    description: "A material share of turnover is the same money moving between the subject's own accounts.",
    evaluate: (ctx) => {
      const share = val(ctx, "internal_circulation_share");
      const fired = share >= 0.25;
      return {
        fired,
        detail: fired ? `${(share * 100).toFixed(0)}% of consolidated turnover circulates between own accounts.` : null,
        txnIds: [],
      };
    },
  },
  {
    ruleId: "R-CASH-01",
    typologyId: "FATF.PLC.2",
    typologyName: "Placement / unexplained cash intensity",
    title: "Cash volume inconsistent with declared income",
    severity: "high",
    weight: 1.1,
    floor: 0.3,
    citation:
      "FATF R.10/INR.10 customer due diligence - activity inconsistent with the customer's known profile; Kuwait CBK AML/CFT instructions (2/RB/2013 as amended).",
    description: "Cash deposits materially exceed what the declared income could generate.",
    evaluate: (ctx) => {
      const peak = val(ctx, "cash_to_income_peak");
      const mult = val(ctx, "income_multiple");
      const cashShare = val(ctx, "cash_share");
      if (zone(ctx, "income_multiple") === "gated") return { fired: false, detail: null, txnIds: [] };
      const fired = peak >= 2 || (mult >= 3 && cashShare >= 0.4);
      return {
        fired,
        detail: fired
          ? `Peak 30-day cash equals ${peak.toFixed(1)}x declared monthly income; overall inflows run ${mult.toFixed(1)}x income with ${(cashShare * 100).toFixed(0)}% arriving as cash.`
          : null,
        txnIds: ctx.aux.cashDepositTxns.slice(0, 50),
        weightOverride: peak >= 4 ? 1.5 : undefined,
      };
    },
  },
  {
    ruleId: "R-CASH-02",
    typologyId: "FATF.PLC.3",
    typologyName: "Placement / synthetic amounts",
    title: "Systematically round cash amounts",
    severity: "medium",
    weight: 0.5,
    floor: 0.08,
    citation: "FATF (2023) indicators - repeated round-sum cash transactions lacking retail character.",
    description: "Cash activity dominated by exact multiples of 100 KWD.",
    evaluate: (ctx) => {
      const share = val(ctx, "round_number_share");
      const fired = zone(ctx, "round_number_share") !== "gated" && share >= 0.6 && ctx.aux.roundCashTxns.length >= 10;
      return {
        fired,
        detail: fired ? `${(share * 100).toFixed(0)}% of cash transactions are exact multiples of 100 KWD.` : null,
        txnIds: ctx.aux.roundCashTxns.slice(0, 50),
      };
    },
  },
  {
    ruleId: "R-GEO-01",
    typologyId: "FATF.GEO.1",
    typologyName: "Geographic risk exposure",
    title: "Flows touching FATF-listed jurisdictions",
    severity: "high",
    weight: 0.9,
    floor: 0.2,
    citation:
      "FATF 'High-Risk Jurisdictions subject to a Call for Action' and 'Jurisdictions under Increased Monitoring' (2025 lists); FATF R.19 enhanced due diligence.",
    description:
      "Counterparty countries appear on FATF call-for-action or increased-monitoring lists. Ordinary remittance corridors are not penalized.",
    evaluate: (ctx) => {
      const share = val(ctx, "high_risk_geo_share");
      const black = ctx.aux.geoBlackTxns.length > 0;
      const fired = black || share >= 0.02;
      return {
        fired,
        detail: fired
          ? black
            ? `${ctx.aux.geoBlackTxns.length} transactions touch call-for-action jurisdictions; total listed-country share ${(share * 100).toFixed(1)}%.`
            : `${(share * 100).toFixed(1)}% of value flows to/from increased-monitoring jurisdictions.`
          : null,
        txnIds: ctx.aux.geoTxns.slice(0, 50),
        weightOverride: black ? 1.3 : undefined,
      };
    },
  },
  {
    ruleId: "R-VEL-01",
    typologyId: "FATF.TMP.1",
    typologyName: "Temporal anomaly / velocity burst",
    title: "Turnover burst against the subject's own history",
    severity: "medium",
    weight: 0.6,
    floor: 0.1,
    citation: "FATF (2023) indicators - sudden, unexplained increase in account velocity.",
    description: "A 30-day window whose turnover is a statistical outlier against the subject's own baseline.",
    evaluate: (ctx) => {
      const z = val(ctx, "velocity_burst_z");
      if (zone(ctx, "velocity_burst_z") === "gated") return { fired: false, detail: null, txnIds: [] };
      const fired = z >= 2.5;
      return {
        fired,
        detail: fired ? `Peak 30-day window sits ${z.toFixed(1)} standard deviations above the self-baseline.` : null,
        txnIds: ctx.aux.burstWindow?.txnIds.slice(0, 50) ?? [],
        weightOverride: z >= 3.5 ? 0.9 : undefined,
      };
    },
  },
  {
    ruleId: "R-DORM-01",
    typologyId: "FATF.TMP.2",
    typologyName: "Temporal anomaly / dormancy reactivation",
    title: "Dormant account reactivated with heavy flows",
    severity: "high",
    weight: 0.8,
    floor: 0.18,
    citation: "Egmont Group / FATF indicators - long-dormant accounts suddenly used to move significant value.",
    description: "An account silent for 180+ days abruptly moves multiples of its historical monthly volume.",
    evaluate: (ctx) => {
      const fired = val(ctx, "dormancy_reactivation") >= 1;
      return {
        fired,
        detail: fired ? ctx.f.get("dormancy_reactivation")?.description ?? null : null,
        txnIds: ctx.aux.dormancyTxns.slice(0, 50),
      };
    },
  },
  {
    ruleId: "R-NARR-01",
    typologyId: "FATF.NAR.1",
    typologyName: "Opacity / vague narratives",
    title: "High-value flows with no economic story",
    severity: "medium",
    weight: 0.5,
    floor: 0.08,
    citation: "FATF R.16 wire-transfer information standards; vague or missing payment purposes as an ML indicator.",
    description: "A dominant share of value moves under descriptions that explain nothing.",
    evaluate: (ctx) => {
      const share = val(ctx, "narrative_vagueness_share");
      const fired = share >= 0.5 && ctx.aux.vagueHighValueTxns.length >= 5;
      return {
        fired,
        detail: fired
          ? `${(share * 100).toFixed(0)}% of moved value carries vague/empty narratives, including ${ctx.aux.vagueHighValueTxns.length} movements of 1,000+ KWD.`
          : null,
        txnIds: ctx.aux.vagueHighValueTxns.slice(0, 50),
      };
    },
  },
  {
    ruleId: "R-FUNNEL-01",
    typologyId: "FATF.NET.1",
    typologyName: "Network / funnel account",
    title: "Dispersed inflows consolidated to few outflow channels",
    severity: "high",
    weight: 1.0,
    floor: 0.25,
    citation: "FinCEN advisory FIN-2014-A005 / FATF - funnel account typology: many unrelated payers, consolidated dispatch.",
    description: "Numerous unrelated counterparties feed the subject; value exits concentrated to a single channel.",
    evaluate: (ctx) => {
      const fanIn = ctx.aux.fanInCount;
      const top = ctx.aux.topOutflowCounterparty;
      const pass = val(ctx, "pass_through_ratio");
      const fired = fanIn >= 12 && pass >= 0.8 && (top == null || top.share >= 0.5);
      return {
        fired,
        detail: fired
          ? `${fanIn} distinct inflow counterparties feed the subject${
              top
                ? `; ${(top.share * 100).toFixed(0)}% of named outflow value exits to "${top.name}".`
                : "; the value exits through large transfers with no named beneficiary."
            }`
          : null,
        txnIds: ctx.aux.fanInTxns.slice(0, 50),
      };
    },
  },
  {
    ruleId: "R-VA-01",
    typologyId: "FATF.VA.1",
    typologyName: "Virtual assets / VASP exposure",
    title: "Virtual-asset activity alongside unexplained flows",
    severity: "medium",
    weight: 0.6,
    floor: 0.12,
    citation:
      "FATF (2021) Updated Guidance on Virtual Assets and VASPs; R.15 - VA transfers as a layering route outside conventional banking visibility.",
    description:
      "Statement narratives reference crypto exchanges or virtual-asset purchases, opening an off-ramp whose ultimate destination the banking record cannot follow.",
    evaluate: (ctx) => {
      const ids = ctx.aux.cryptoTxns;
      const fired = ids.length >= 2;
      return {
        fired,
        detail: fired
          ? `${ids.length} movements reference virtual-asset platforms (e.g. Binance, USDT purchases). Value leaving through VASP rails is unobservable to the banking system once converted.`
          : null,
        txnIds: ids.slice(0, 50),
      };
    },
  },
  {
    ruleId: "R-BENF-01",
    typologyId: "STAT.BEN.1",
    typologyName: "Statistical anomaly / Benford deviation",
    title: "First-digit distribution deviates from Benford expectation",
    severity: "low",
    weight: 0.4,
    floor: 0.05,
    citation: "Nigrini (2012) 'Benford's Law: Applications for Forensic Accounting'; supporting indicator only, gated at n>=300.",
    description: "Amount first-digit distribution departs from the naturally occurring pattern.",
    evaluate: (ctx) => {
      if (zone(ctx, "benford_mad") === "gated") return { fired: false, detail: null, txnIds: [] };
      const mad = val(ctx, "benford_mad");
      const fired = mad >= 0.015;
      return {
        fired,
        detail: fired ? `MAD ${mad.toFixed(4)} over ${ctx.aux.benfordN} amounts (nonconformity begins at 0.015).` : null,
        txnIds: [],
      };
    },
  },
];

for (const r of RULES) RULE_FLOORS[r.ruleId] = r.floor;

export function evaluateRules(
  bundle: FeatureBundle,
  txns: Txn[],
  profile: SubjectProfile,
): RuleHit[] {
  const fmap = new Map(bundle.features.map((f) => [f.key, f]));
  const totalCreditsExternal = (() => {
    const internalExcluded = txns.filter((t) => !t.isInternalTransfer && t.direction === "credit");
    return internalExcluded.reduce((s, t) => s + t.amountKwd, 0);
  })();
  const ctx: RuleCtx = { f: fmap, aux: bundle.aux, txns, profile, totalCreditsExternal };
  const hits: RuleHit[] = [];
  for (const def of RULES) {
    const res = def.evaluate(ctx) ?? { fired: false, detail: null, txnIds: [] };
    hits.push({
      ruleId: def.ruleId,
      typologyId: def.typologyId,
      typologyName: def.typologyName,
      title: def.title,
      severity: def.severity,
      weightLogLr: res.fired ? res.weightOverride ?? def.weight : def.weight,
      fired: res.fired,
      description: def.description,
      citation: def.citation,
      detail: res.detail,
      txnIds: res.txnIds,
    });
  }
  return hits;
}
