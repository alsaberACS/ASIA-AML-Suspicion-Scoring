import { useState } from 'react';
import {
  useListAnalysisRuns,
  useGetAnalysisRun,
  getGetAnalysisRunQueryKey,
  AnalysisRun,
  AnalysisRunSummary,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { History, GitCompare, TrendingUp, TrendingDown, ArrowRight, Loader2, Plus, Minus, Scale } from 'lucide-react';

const BAND_HEX: Record<string, string> = {
  Critical: '#ef4444',
  High: '#f97316',
  Elevated: '#f59e0b',
  Moderate: '#22d3ee',
  Low: '#10b981',
};

function bandTone(band: string): string {
  switch (band) {
    case 'Critical': return 'text-destructive border-destructive/40';
    case 'High': return 'text-orange-500 border-orange-500/40';
    case 'Elevated': return 'text-amber-500 border-amber-500/40';
    case 'Moderate': return 'text-primary border-primary/40';
    case 'Low': return 'text-emerald-500 border-emerald-500/40';
    default: return 'text-muted-foreground border-border';
  }
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

const fmtNum = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });

function ScoreTrend({ runs }: { runs: AnalysisRunSummary[] }) {
  // chronological, oldest first
  const seq = [...runs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
  if (seq.length < 2) return null;
  const W = 600, H = 90, PX = 12, PY = 12;
  const x = (i: number) => PX + (i / (seq.length - 1)) * (W - 2 * PX);
  const y = (p: number) => H - PY - p * (H - 2 * PY);
  const points = seq.map((r, i) => `${x(i)},${y(r.probability)}`).join(' ');
  return (
    <div data-testid="chart-score-trend">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={PX} x2={W - PX} y1={y(g)} y2={y(g)} stroke="currentColor" className="text-border" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <polyline points={points} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeOpacity="0.7" />
        {seq.map((r, i) => (
          <circle key={r.id} cx={x(i)} cy={y(r.probability)} r="3.5" fill={BAND_HEX[r.band] ?? '#94a3b8'}>
            <title>{`RUN-${r.id}: ${(r.probability * 100).toFixed(1)}% (${r.band})`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground uppercase tracking-wider px-1">
        <span>{fmtDate(seq[0].createdAt)}</span>
        <span>Suspicion probability across {seq.length} runs</span>
        <span>{fmtDate(seq[seq.length - 1].createdAt)}</span>
      </div>
    </div>
  );
}

function DeltaChip({ value, suffix, invert }: { value: number; suffix?: string; invert?: boolean }) {
  if (Math.abs(value) < 1e-9) {
    return <span className="font-mono text-xs text-muted-foreground">no change</span>;
  }
  const up = value > 0;
  const bad = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs ${bad ? 'text-destructive' : 'text-emerald-500'}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? '+' : ''}{fmtNum(value)}{suffix ?? ''}
    </span>
  );
}

function RunSelect({ label, runs, value, onChange, testId }: {
  label: string;
  runs: AnalysisRunSummary[];
  value: number | null;
  onChange: (id: number) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-background border border-border rounded-sm px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:border-primary/50"
        data-testid={testId}
      >
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            RUN-{r.id} - {fmtDate(r.createdAt)} - {(r.probability * 100).toFixed(1)}%
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffPanel({ base, comp }: { base: AnalysisRun; comp: AnalysisRun }) {
  const firedBase = new Map(base.ruleHits.filter((r) => r.fired).map((r) => [r.ruleId, r]));
  const firedComp = new Map(comp.ruleHits.filter((r) => r.fired).map((r) => [r.ruleId, r]));
  const added = [...firedComp.values()].filter((r) => !firedBase.has(r.ruleId));
  const removed = [...firedBase.values()].filter((r) => !firedComp.has(r.ruleId));
  const changed = [...firedComp.values()]
    .filter((r) => firedBase.has(r.ruleId) && Math.abs(firedBase.get(r.ruleId)!.weightLogLr - r.weightLogLr) > 0.001)
    .map((r) => ({ rule: r, from: firedBase.get(r.ruleId)!.weightLogLr, to: r.weightLogLr }));

  const featBase = new Map(base.features.map((f) => [f.key, f]));
  const movers = comp.features
    .map((f) => ({ now: f, prev: featBase.get(f.key) }))
    .filter((x): x is { now: typeof x.now; prev: NonNullable<typeof x.prev> } => !!x.prev && Math.abs(x.now.value - x.prev.value) > 1e-9)
    .map((x) => ({
      label: x.now.label,
      unit: x.now.unit ?? null,
      from: x.prev.value,
      to: x.now.value,
      zoneFrom: x.prev.zone,
      zoneTo: x.now.zone,
      rel: Math.abs(x.now.value - x.prev.value) / Math.max(Math.abs(x.prev.value), 1e-9),
    }))
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 6);

  const ppDelta = (comp.probability - base.probability) * 100;
  const baseLo = base.posteriorLogOdds ?? 0;
  const compLo = comp.posteriorLogOdds ?? 0;
  const metrics = [
    { label: 'Suspicion', from: `${(base.probability * 100).toFixed(1)}%`, to: `${(comp.probability * 100).toFixed(1)}%`, delta: <DeltaChip value={ppDelta} suffix=" pp" /> },
    { label: 'Log-odds', from: baseLo.toFixed(2), to: compLo.toFixed(2), delta: <DeltaChip value={compLo - baseLo} /> },
    { label: 'Data quality', from: `${(base.dataQualityScore * 100).toFixed(0)}%`, to: `${(comp.dataQualityScore * 100).toFixed(0)}%`, delta: <DeltaChip value={(comp.dataQualityScore - base.dataQualityScore) * 100} suffix=" pp" invert /> },
    { label: 'Transactions', from: String(base.txnCount), to: String(comp.txnCount), delta: <DeltaChip value={comp.txnCount - base.txnCount} invert /> },
  ];

  return (
    <div className="space-y-4" data-testid="panel-run-diff">
      {/* Band + headline metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="border border-border/60 rounded-sm p-3 bg-background/40">
            <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">{m.label}</div>
            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="text-muted-foreground">{m.from}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-foreground">{m.to}</span>
            </div>
            <div className="mt-1">{m.delta}</div>
          </div>
        ))}
      </div>

      {base.band !== comp.band && (
        <div className="flex items-center gap-3 border border-border/60 rounded-sm p-3 bg-background/40">
          <Scale className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Band change</span>
          <Badge variant="outline" className={`font-mono text-[10px] uppercase ${bandTone(base.band)}`}>{base.band}</Badge>
          <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
          <Badge variant="outline" className={`font-mono text-[10px] uppercase ${bandTone(comp.band)}`}>{comp.band}</Badge>
        </div>
      )}

      {/* Rule changes */}
      <div className="border border-border/60 rounded-sm">
        <div className="px-4 py-2.5 border-b border-border/40 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Rule changes
        </div>
        {added.length === 0 && removed.length === 0 && changed.length === 0 ? (
          <p className="px-4 py-3 text-xs font-mono text-muted-foreground">Identical rule firings in both runs.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {added.map((r) => (
              <div key={`a-${r.ruleId}`} className="px-4 py-2.5 flex items-center gap-3" data-testid={`diff-rule-added-${r.ruleId}`}>
                <Plus className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="text-xs flex-1">{r.title}</span>
                <span className="font-mono text-[10px] text-muted-foreground uppercase">{r.ruleId}</span>
                <span className="font-mono text-xs text-destructive">+{r.weightLogLr.toFixed(2)} logLR</span>
              </div>
            ))}
            {removed.map((r) => (
              <div key={`r-${r.ruleId}`} className="px-4 py-2.5 flex items-center gap-3" data-testid={`diff-rule-removed-${r.ruleId}`}>
                <Minus className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span className="text-xs flex-1">{r.title}</span>
                <span className="font-mono text-[10px] text-muted-foreground uppercase">{r.ruleId}</span>
                <span className="font-mono text-xs text-emerald-500">no longer fires</span>
              </div>
            ))}
            {changed.map((c) => (
              <div key={`c-${c.rule.ruleId}`} className="px-4 py-2.5 flex items-center gap-3">
                <Scale className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="text-xs flex-1">{c.rule.title}</span>
                <span className="font-mono text-[10px] text-muted-foreground uppercase">{c.rule.ruleId}</span>
                <span className="font-mono text-xs text-amber-500">{c.from.toFixed(2)} {'\u2192'} {c.to.toFixed(2)} logLR</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feature drift */}
      <div className="border border-border/60 rounded-sm">
        <div className="px-4 py-2.5 border-b border-border/40 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Largest feature movements
        </div>
        {movers.length === 0 ? (
          <p className="px-4 py-3 text-xs font-mono text-muted-foreground">No feature moved between these runs.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {movers.map((m) => (
              <div key={m.label} className="px-4 py-2.5 flex items-center gap-3">
                <span className="text-xs flex-1">{m.label}</span>
                {m.zoneFrom !== m.zoneTo && (
                  <Badge variant="outline" className="font-mono text-[9px] uppercase text-amber-500 border-amber-500/40">
                    {m.zoneFrom} {'\u2192'} {m.zoneTo}
                  </Badge>
                )}
                <span className="font-mono text-xs text-muted-foreground">
                  {fmtNum(m.from)}{m.unit ? ` ${m.unit}` : ''}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
                <span className="font-mono text-xs text-foreground">
                  {fmtNum(m.to)}{m.unit ? ` ${m.unit}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function RunHistoryView({ caseId, currentRunId }: { caseId: number; currentRunId: number }) {
  const { data: runs, isLoading } = useListAnalysisRuns(caseId);
  const [baseSel, setBaseSel] = useState<number | null>(null);
  const [compSel, setCompSel] = useState<number | null>(null);

  const baselineId = baseSel ?? runs?.[1]?.id ?? null;
  const compareId = compSel ?? runs?.[0]?.id ?? null;

  const baseQuery = useGetAnalysisRun(baselineId ?? 0, {
    query: { enabled: baselineId != null, queryKey: getGetAnalysisRunQueryKey(baselineId ?? 0) },
  });
  const compQuery = useGetAnalysisRun(compareId ?? 0, {
    query: { enabled: compareId != null, queryKey: getGetAnalysisRunQueryKey(compareId ?? 0) },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs p-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading run history...
      </div>
    );
  }
  if (!runs || runs.length === 0) {
    return <p className="text-xs font-mono text-muted-foreground p-8 text-center">No analysis runs recorded for this case.</p>;
  }

  return (
    <div className="space-y-6" data-testid="panel-run-history">
      <Card className="bg-card border-border rounded-sm">
        <CardHeader>
          <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Run History
          </CardTitle>
          <CardDescription className="text-xs font-mono">
            Every scoring run for this case. Newer data or engine updates should move the score for explainable reasons -
            unexplained drift is itself a finding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ScoreTrend runs={runs} />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase">Run</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">When</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Score</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Band</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Quality</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Rules</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Txns</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">AI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30" data-testid={`row-run-${r.id}`}>
                    <TableCell className="font-mono text-xs">
                      RUN-{r.id}
                      {r.id === currentRunId && (
                        <Badge variant="outline" className="ml-2 font-mono text-[8px] uppercase text-primary border-primary/40">current</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs text-right">{(r.probability * 100).toFixed(1)}%</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-mono text-[9px] uppercase ${bandTone(r.band)}`}>{r.band}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-right text-muted-foreground">{(r.dataQualityScore * 100).toFixed(0)}%</TableCell>
                    <TableCell className="font-mono text-xs text-right">{r.rulesFired}</TableCell>
                    <TableCell className="font-mono text-xs text-right text-muted-foreground">{r.txnCount}</TableCell>
                    <TableCell className="font-mono text-[10px] uppercase text-muted-foreground">{r.aiStatus}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border rounded-sm">
        <CardHeader>
          <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary" /> Compare Runs
          </CardTitle>
          <CardDescription className="text-xs font-mono">
            What changed between two runs: score, fired rules, and the features that drove the movement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {runs.length < 2 ? (
            <p className="text-xs font-mono text-muted-foreground">
              Only one run recorded so far. Re-run the analysis after new statements arrive to unlock comparison.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                <RunSelect label="Baseline" runs={runs} value={baselineId} onChange={setBaseSel} testId="select-baseline-run" />
                <RunSelect label="Compare" runs={runs} value={compareId} onChange={setCompSel} testId="select-compare-run" />
              </div>
              {baselineId === compareId ? (
                <p className="text-xs font-mono text-muted-foreground">Select two different runs to compare.</p>
              ) : baseQuery.data && compQuery.data ? (
                <DiffPanel base={baseQuery.data} comp={compQuery.data} />
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading runs for comparison...
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
