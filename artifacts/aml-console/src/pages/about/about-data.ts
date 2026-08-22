/**
 * Static methodology facts for the About page. Every number here mirrors the
 * real engine (api-server/src/aml): rule weights are the actual log-LR
 * weights in rules.ts, bands mirror bandFor() in types.ts, and the model
 * constants match scoring.ts. Update this file when the engine changes.
 */

export interface RuleFact {
  id: string;
  title: string;
  family: FamilyId;
  weight: number; // log-likelihood ratio when fired
}

export type FamilyId =
  | 'structuring'
  | 'layering'
  | 'network'
  | 'cash'
  | 'geo'
  | 'temporal'
  | 'narrative'
  | 'statistical'
  | 'virtual-asset';

export const FAMILY_LABEL: Record<FamilyId, string> = {
  structuring: 'Structuring',
  layering: 'Layering',
  network: 'Network',
  cash: 'Cash Intensity',
  geo: 'Geography',
  temporal: 'Temporal',
  narrative: 'Narrative',
  statistical: 'Statistical',
  'virtual-asset': 'Virtual Assets',
};

/** Chart color per family, keyed to the theme chart tokens. */
export const FAMILY_COLOR: Record<FamilyId, string> = {
  structuring: 'hsl(var(--chart-1))',
  layering: 'hsl(var(--chart-2))',
  network: 'hsl(var(--chart-4))',
  cash: 'hsl(var(--chart-3))',
  geo: 'hsl(var(--chart-5))',
  temporal: 'hsl(var(--chart-2))',
  narrative: 'hsl(var(--chart-5))',
  statistical: 'hsl(var(--chart-4))',
  'virtual-asset': 'hsl(var(--chart-1))',
};

/** The 17 deterministic typology rules, verbatim from the engine. */
export const RULES: RuleFact[] = [
  { id: 'R-STRUCT-01', title: 'Cash deposits clustered under the KD 3,000 trigger', family: 'structuring', weight: 1.1 },
  { id: 'R-STRUCT-02', title: 'Same-day cash placement across multiple banks', family: 'structuring', weight: 1.4 },
  { id: 'R-STRUCT-03', title: 'Split same-day deposits under the threshold at one bank', family: 'structuring', weight: 0.8 },
  { id: 'R-SMURF-01', title: 'Cash entry deliberately fragmented across banks', family: 'structuring', weight: 0.9 },
  { id: 'R-LAYER-01', title: 'Account operates as a pass-through conduit', family: 'layering', weight: 1.0 },
  { id: 'R-LAYER-02', title: 'Funds dispatched within 72 hours of arrival', family: 'layering', weight: 0.9 },
  { id: 'R-LAYER-03', title: 'Relay chains through own accounts at different banks', family: 'layering', weight: 1.2 },
  { id: 'R-CIRC-01', title: "Heavy circulation between the subject's own banks", family: 'layering', weight: 0.7 },
  { id: 'R-CASH-01', title: 'Cash volume inconsistent with declared income', family: 'cash', weight: 1.1 },
  { id: 'R-CASH-02', title: 'Systematically round cash amounts', family: 'cash', weight: 0.5 },
  { id: 'R-GEO-01', title: 'Flows touching FATF-listed jurisdictions', family: 'geo', weight: 0.9 },
  { id: 'R-VEL-01', title: "Turnover burst against the subject's own history", family: 'temporal', weight: 0.6 },
  { id: 'R-DORM-01', title: 'Dormant account reactivated with heavy flows', family: 'temporal', weight: 0.8 },
  { id: 'R-NARR-01', title: 'High-value flows with no economic story', family: 'narrative', weight: 0.5 },
  { id: 'R-FUNNEL-01', title: 'Dispersed inflows consolidated to few outflow channels', family: 'network', weight: 1.0 },
  { id: 'R-VA-01', title: 'Virtual-asset activity alongside unexplained flows', family: 'virtual-asset', weight: 0.6 },
  { id: 'R-BENF-01', title: 'First-digit distribution deviates from Benford expectation', family: 'statistical', weight: 0.4 },
];

export interface BandFact {
  name: string;
  range: string;
  meaning: string;
  colorClass: string; // text color class used across the console
}

/** Mirrors bandFor() exactly: <5, <20, <50, <80, rest. */
export const BANDS: BandFact[] = [
  { name: 'Low', range: '0 - 5%', meaning: 'Ordinary activity. No pattern worth an analyst minute.', colorClass: 'text-emerald-400' },
  { name: 'Moderate', range: '5 - 20%', meaning: 'Weak signals present. Review if capacity allows.', colorClass: 'text-chart-2' },
  { name: 'Elevated', range: '20 - 50%', meaning: 'Multiple independent signals. Queue for review.', colorClass: 'text-amber-400' },
  { name: 'High', range: '50 - 80%', meaning: 'Strong converging evidence. Prioritize this case.', colorClass: 'text-orange-400' },
  { name: 'Critical', range: '80 - 97%', meaning: 'Textbook typology fit. Escalate immediately.', colorClass: 'text-red-400' },
];

/** Model constants, verbatim from scoring.ts. */
export const MODEL = {
  priorP: 0.02,
  priorLogOdds: Math.log(0.02 / 0.98), // about -3.89
  familyDiscount: 0.5,
  residualCritical: 0.3,
  residualElevated: 0.15,
  residualCap: 0.9,
  shrinkFloor: 0.55,
  qualityFullTrust: 0.9,
  qualityDesignThreshold: 0.7,
  probabilityCap: 0.97,
};

/** Sigmoid curve samples for the log-odds chart. */
export const SIGMOID_POINTS = Array.from({ length: 49 }, (_, i) => {
  const x = -6 + i * 0.25;
  return { x: Math.round(x * 100) / 100, p: 1 / (1 + Math.exp(-x)) };
});

/** Data-quality shrinkage curve, verbatim formula from scoring.ts. */
export const SHRINK_POINTS = Array.from({ length: 31 }, (_, i) => {
  const q = 0.4 + i * 0.02;
  const shrink = q >= 0.9 ? 1 : Math.max(0.55, q / 0.9);
  return { q: Math.round(q * 100) / 100, shrink: Math.round(shrink * 1000) / 1000 };
});

export interface PipelineStage {
  num: string;
  name: string;
  detail: string;
}

export const PIPELINE: PipelineStage[] = [
  { num: '01', name: 'Parse', detail: 'Five bank export dialects (compliance exports, core dumps, query extracts, classic and signed-amount statements) read into one ledger, Arabic labels included.' },
  { num: '02', name: 'Consolidate', detail: 'All accounts merge into one ledger; cross-file duplicates and balance breaks are detected and reported, and transfers between the subject\u2019s own accounts are recognised as internal movement.' },
  { num: '03', name: 'Profile', detail: 'Declared income, occupation and expected geography form the economic baseline every flow is judged against.' },
  { num: '04', name: 'Quantify', detail: 'More than twenty forensic signals measured: near-threshold density, pass-through ratio, dwell time, Benford deviation, velocity bursts and more.' },
  { num: '05', name: 'Test', detail: 'Seventeen deterministic typology rules test the ledger - most hits list the exact statement rows that triggered them.' },
  { num: '06', name: 'Score', detail: 'Bayesian evidence aggregation turns fired rules into one suspicion probability with a full driver breakdown.' },
  { num: '07', name: 'Screen', detail: 'Names and counterparties checked against OFAC and UN consolidated lists, auto-refreshed every six hours.' },
  { num: '08', name: 'Narrate + Verify', detail: 'An AI assistant drafts the case narrative; a verification layer then cross-checks every citation it made against the real ledger.' },
];

export interface AiBoundary {
  can: string;
  cannot: string;
}

export const AI_BOUNDARIES: AiBoundary[] = [
  { can: 'Draft the case narrative and typology findings in plain language', cannot: 'Change the suspicion score - the score is computed before the AI runs' },
  { can: 'Cite specific transactions as supporting evidence', cannot: 'Invent citations silently - fabricated references are detected, kept and reported' },
  { can: 'Suggest benign explanations an analyst should rule out', cannot: 'Close or escalate a case - dispositions are analyst-only actions' },
  { can: 'Summarize the self-declared disclosure against observed flows', cannot: 'See data outside the case file - no internet, no other subjects' },
];
