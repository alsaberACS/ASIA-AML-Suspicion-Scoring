import { Link } from 'wouter';
import {
  ArrowRight,
  CheckCircle2,
  FileSearch,
  Fingerprint,
  Gauge,
  RefreshCcw,
  Scale,
  ShieldCheck,
  Sigma,
  Target,
  XCircle,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AI_BOUNDARIES,
  BANDS,
  FAMILY_COLOR,
  FAMILY_LABEL,
  MODEL,
  PIPELINE,
  RULES,
  SHRINK_POINTS,
  SIGMOID_POINTS,
} from './about-data';

const img = (name: string) => import.meta.env.BASE_URL + 'about/' + name;

/** Mono uppercase kicker used as the dossier "stamp" of each section. */
function Stamp({ num, title, onDark = false }: { num: string; title: string; onDark?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className={`font-mono text-sm tracking-widest ${onDark ? 'text-cyan-300' : 'text-primary'}`}>
        {num}
      </span>
      <span className={`h-px flex-1 max-w-24 ${onDark ? 'bg-cyan-300/40' : 'bg-primary/40'}`} />
      <span
        className={`font-mono text-xs uppercase tracking-[0.25em] ${onDark ? 'text-white/60' : 'text-muted-foreground'}`}
      >
        {title}
      </span>
    </div>
  );
}

function HeroStat({ value, label, testid }: { value: string; label: string; testid: string }) {
  return (
    <div
      className="border border-white/15 bg-black/40 backdrop-blur-sm rounded-sm px-4 py-3"
      data-testid={testid}
    >
      <div className="font-mono text-2xl text-cyan-300">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-white/60 mt-1">
        {label}
      </div>
    </div>
  );
}

const axisTick = {
  fill: 'hsl(var(--muted-foreground))',
  fontSize: 10,
  fontFamily: 'JetBrains Mono, monospace',
};

const chartTooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--popover-border))',
  borderRadius: 2,
  fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace',
  color: 'hsl(var(--popover-foreground))',
};

export default function AboutPage() {
  return (
    <div className="min-h-full" data-testid="panel-about">
      {/* ------------------------------------------------ Hero (always dark) */}
      <section className="relative overflow-hidden border-b border-border">
        <img
          src={img('holo-dashboard.jpg')}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#060b16]/95 via-[#060b16]/80 to-[#060b16]/55" />
        <div
          aria-hidden
          className="landing-scan absolute left-0 right-0 h-px bg-cyan-300/70 shadow-[0_0_12px_rgba(103,232,249,0.9)]"
        />
        <div className="relative px-8 py-16 max-w-5xl">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300/90 mb-4">
            ASIA Data-Science // Methodology Dossier
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight max-w-2xl">
            Inside the Suspicion Engine
          </h1>
          <p className="mt-4 max-w-2xl text-white/75 leading-relaxed">
            This console reads raw bank statements the way a forensic analyst does - then shows
            its work. Every score is assembled from named, citable evidence: no black box, no
            hidden judgment. This page explains the idea, the methods, and exactly how far the
            numbers can be trusted.
          </p>
          <div className="mt-8 grid grid-cols-2 md:grid-cols-5 gap-3 max-w-3xl">
            <HeroStat value="17" label="Typology rules" testid="stat-about-rules" />
            <HeroStat value="20+" label="Forensic signals" testid="stat-about-signals" />
            <HeroStat value="5" label="Statement dialects" testid="stat-about-dialects" />
            <HeroStat value="2" label="Sanctions sources" testid="stat-about-sanctions" />
            <HeroStat value="97%" label="Score ceiling" testid="stat-about-ceiling" />
          </div>
        </div>
      </section>

      <div className="px-8 py-12 space-y-16 max-w-6xl">
        {/* ------------------------------------------------ 01 The idea */}
        <section data-testid="section-about-idea">
          <Stamp num="01" title="The Idea" />
          <div className="grid lg:grid-cols-5 gap-8">
            <div className="lg:col-span-3 space-y-4">
              <h2 className="text-2xl font-semibold">
                Triage by evidence, not by gut feeling
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                An AML analyst facing a stack of statements from five banks has two bad options:
                skim and hope, or spend days rebuilding one subject&apos;s financial life by hand.
                This engine does the rebuilding automatically - it consolidates every account
                into a single ledger, measures the patterns money launderers actually use, and
                converts them into one suspicion probability whose assumptions are printed on
                this page.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The output is not a verdict. It is a prioritized queue with the case already
                assembled: which transactions triggered which typology, what the subject&apos;s
                declared profile can and cannot explain, and what a reviewer should check before
                deciding. The decision stays human.
              </p>
            </div>
            <Card className="lg:col-span-2">
              <CardContent className="pt-6 space-y-4">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Design principles
                </div>
                {[
                  { icon: Fingerprint, text: 'Evidence first - drivers link to the exact transactions wherever row-level evidence exists' },
                  { icon: Sigma, text: 'Deterministic core - same data in, same score out, every time' },
                  { icon: ShieldCheck, text: 'AI narrates, never scores - the number exists before the AI runs' },
                  { icon: Gauge, text: 'Honest under bad data - unreliable ledgers are forced toward the base rate' },
                ].map((p) => (
                  <div key={p.text} className="flex gap-3 items-start">
                    <p.icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm leading-snug">{p.text}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ------------------------------------------------ 02 Pipeline */}
        <section data-testid="section-about-pipeline">
          <Stamp num="02" title="The Pipeline" />
          <h2 className="text-2xl font-semibold mb-2">Eight stages from raw export to case file</h2>
          <p className="text-muted-foreground mb-6 max-w-3xl">
            Each stage is inspectable on the case page - parser logs, netting decisions, fired
            rules and AI verification all keep their receipts.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PIPELINE.map((s) => (
              <div
                key={s.num}
                className="cyber-panel rounded-sm p-4 flex flex-col gap-2"
                data-testid={`card-pipeline-${s.num}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-primary text-lg">{s.num}</span>
                  <span className="font-semibold">{s.name}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ------------------------------------------------ Interlude (always dark) */}
      <section className="relative overflow-hidden border-y border-border">
        <img
          src={img('signal-lines.jpg')}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#04121a]/70" />
        <div className="relative px-8 py-10 max-w-4xl">
          <p className="font-mono text-sm md:text-base text-cyan-100/90 leading-relaxed">
            &gt; A score you cannot decompose is an opinion.
            <br />
            &gt; Here, every score unfolds into named drivers - with row-level citations wherever
            the evidence lives in specific transactions.
          </p>
        </div>
      </section>

      <div className="px-8 py-12 space-y-16 max-w-6xl">
        {/* ------------------------------------------------ 03 Signal catalog */}
        <section data-testid="section-about-signals">
          <Stamp num="03" title="The Signal Catalog" />
          <h2 className="text-2xl font-semibold mb-2">Seventeen typology rules, openly weighted</h2>
          <p className="text-muted-foreground mb-6 max-w-3xl">
            Each rule encodes one laundering pattern from FATF and CBK typology literature. Its
            default weight is a log-likelihood ratio: how much more likely this pattern is in illicit
            activity than in legitimate activity. Weights are printed here because analysts
            should be able to argue with them.
          </p>
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div className="border border-border rounded-sm overflow-hidden">
              <Table data-testid="table-rules">
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase">Rule</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Pattern</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase text-right">
                      Weight
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {RULES.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="align-top">
                        <div className="font-mono text-xs text-primary whitespace-nowrap">{r.id}</div>
                        <Badge
                          variant="outline"
                          className="mt-1 font-mono text-[9px] uppercase tracking-wider"
                        >
                          {FAMILY_LABEL[r.family]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs leading-snug align-top">{r.title}</TableCell>
                      <TableCell className="text-right align-top">
                        <span className="font-mono text-sm">{r.weight.toFixed(1)}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
                    Evidence weight by rule (log-likelihood ratio)
                  </div>
                  <div className="h-[420px]" data-testid="chart-weights">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={RULES} layout="vertical" margin={{ left: 8, right: 24 }}>
                        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" domain={[0, 1.5]} tick={axisTick} tickCount={4} />
                        <YAxis
                          type="category"
                          dataKey="id"
                          width={104}
                          tick={{ ...axisTick, fontSize: 9 }}
                          interval={0}
                        />
                        <Tooltip
                          contentStyle={chartTooltipStyle}
                          formatter={(v: number) => [v.toFixed(1) + ' log-LR', 'weight']}
                          labelFormatter={(id: string) => RULES.find((r) => r.id === id)?.title ?? id}
                          cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                        />
                        <Bar dataKey="weight" radius={[0, 2, 2, 0]} barSize={12}>
                          {RULES.map((r) => (
                            <Cell key={r.id} fill={FAMILY_COLOR[r.family]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Correlated rules inside one family never double-count: the strongest hit enters
                at full weight, the rest at half. Severe typologies also carry a score floor - a
                hard structuring hit cannot be averaged away by an otherwise quiet ledger. A few
                rules escalate beyond their default weight when a pattern is extreme.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ 04 Scoring model */}
        <section data-testid="section-about-scoring">
          <Stamp num="04" title="The Scoring Model" />
          <h2 className="text-2xl font-semibold mb-2">Bayesian aggregation, visible end to end</h2>
          <p className="text-muted-foreground mb-6 max-w-3xl">
            The engine starts from a configured {(MODEL.priorP * 100).toFixed(0)}% prior - an
            expert assumption about how common genuine suspicion is in a review queue, not a
            measured base rate - and lets evidence move the log-odds from there. The sigmoid curve
            translates accumulated log-odds into the probability you see on every case.
          </p>
          <div className="grid lg:grid-cols-2 gap-8">
            <Card>
              <CardContent className="pt-6">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
                  Log-odds to probability - band zones shaded
                </div>
                <div className="h-72" data-testid="chart-sigmoid">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={SIGMOID_POINTS} margin={{ left: 0, right: 12, top: 4 }}>
                      <defs>
                        <linearGradient id="sigFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="x"
                        tick={axisTick}
                        ticks={[-6, -4, -2, 0, 2, 4, 6]}
                        label={{
                          value: 'posterior log-odds',
                          position: 'insideBottom',
                          offset: -2,
                          style: { ...axisTick, textAnchor: 'middle' },
                        }}
                      />
                      <YAxis
                        tick={axisTick}
                        domain={[0, 1]}
                        tickFormatter={(v: number) => (v * 100).toFixed(0) + '%'}
                      />
                      {/* Band zones (probability space) */}
                      <ReferenceArea y1={0} y2={0.05} fill="hsl(var(--chart-3))" fillOpacity={0.07} />
                      <ReferenceArea y1={0.2} y2={0.5} fill="hsl(38 95% 54%)" fillOpacity={0.06} />
                      <ReferenceArea y1={0.5} y2={0.8} fill="hsl(25 90% 50%)" fillOpacity={0.07} />
                      <ReferenceArea y1={0.8} y2={1} fill="hsl(var(--destructive))" fillOpacity={0.08} />
                      <ReferenceLine
                        x={-3.89}
                        stroke="hsl(var(--primary))"
                        strokeDasharray="4 3"
                        label={{ value: 'prior (2%)', position: 'insideTopLeft', style: { ...axisTick, fill: 'hsl(var(--primary))' } }}
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(v: number) => [(v * 100).toFixed(1) + '%', 'probability']}
                        labelFormatter={(x: number) => 'log-odds ' + x}
                      />
                      <Area
                        type="monotone"
                        dataKey="p"
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2}
                        fill="url(#sigFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-4">
              <div className="border border-border rounded-sm overflow-hidden">
                <Table data-testid="table-bands">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-mono text-[10px] uppercase">Band</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase">Probability</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase">Reading</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {BANDS.map((b) => (
                      <TableRow key={b.name}>
                        <TableCell className={`font-mono text-xs font-semibold ${b.colorClass}`}>
                          {b.name.toUpperCase()}
                        </TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{b.range}</TableCell>
                        <TableCell className="text-xs leading-snug">{b.meaning}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="cyber-panel rounded-sm p-4 space-y-2">
                {[
                  ['Family de-duplication', 'strongest rule full weight, siblings at 50% - correlated evidence is not counted twice'],
                  ['Residual signals', 'critical features add +0.3, elevated +0.15, bundle capped at 0.9 with the strongest admitted first'],
                  ['Data-quality gate', 'below 0.9 extraction quality, all evidence shrinks toward the prior (floor 0.55x)'],
                  ['Severity floors', 'a hard typology hit guarantees a minimum score - softened 25% when data quality is poor'],
                  ['Humility cap', 'probability never exceeds 97% - the engine never claims certainty'],
                ].map(([t, d]) => (
                  <div key={t} className="flex gap-2 text-xs leading-relaxed">
                    <span className="font-mono text-primary whitespace-nowrap">{t}:</span>
                    <span className="text-muted-foreground">{d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Card className="mt-6">
            <CardContent className="pt-6 grid lg:grid-cols-2 gap-6 items-center">
              <div className="h-52" data-testid="chart-shrink">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={SHRINK_POINTS} margin={{ left: 0, right: 12, top: 8 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="q"
                      tick={axisTick}
                      ticks={[0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]}
                      label={{
                        value: 'extraction quality score',
                        position: 'insideBottom',
                        offset: -2,
                        style: { ...axisTick, textAnchor: 'middle' },
                      }}
                    />
                    <YAxis
                      tick={axisTick}
                      domain={[0.5, 1.05]}
                      tickFormatter={(v: number) => (v * 100).toFixed(0) + '%'}
                    />
                    <ReferenceLine x={0.9} stroke="hsl(var(--chart-3))" strokeDasharray="4 3" />
                    <ReferenceLine x={0.7} stroke="hsl(38 95% 54%)" strokeDasharray="4 3" />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(v: number) => [(v * 100).toFixed(0) + '%', 'evidence kept']}
                      labelFormatter={(q: number) => 'quality ' + q}
                    />
                    <Line type="monotone" dataKey="shrink" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Why bad scans cannot raise loud alarms
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Every file receives an extraction-quality score at parse time; the case-level
                  score is the transaction-weighted blend across files. Below 0.9, the engine
                  keeps only part of the evidence - down to a floor of 55% - and prints the
                  suppression as its own negative driver. The separate six-check data-quality
                  report explains where reliability is lost, but it does not itself move the
                  number. A garbled ledger produces a cautious score and says so, instead of a
                  confident hallucination.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* ------------------------------------------------ 05 AI (always dark) */}
      <section className="relative overflow-hidden border-y border-border" data-testid="section-about-ai">
        <img
          src={img('magnifier-data.jpg')}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#050d18]/85" />
        <div className="relative px-8 py-12 max-w-6xl">
          <Stamp num="05" title="AI With Guardrails" onDark />
          <h2 className="text-2xl font-semibold text-white mb-2">
            The AI explains the case. It is never allowed to score it.
          </h2>
          <p className="text-white/70 mb-6 max-w-3xl leading-relaxed">
            After the deterministic engine finishes, a large language model drafts the narrative:
            what pattern, which transactions, what innocent explanations to rule out. Then a
            verification layer replays every claim against the actual ledger - every cited
            transaction id, feature value and finding is checked, and anything the model invented
            is kept, counted and displayed as a defect on the case.
          </p>
          <div className="border border-white/15 rounded-sm overflow-hidden bg-black/45 backdrop-blur-sm max-w-4xl">
            <Table data-testid="table-ai-boundaries">
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase text-cyan-300/90">
                    The AI can
                  </TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-red-300/90">
                    The AI cannot
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {AI_BOUNDARIES.map((row) => (
                  <TableRow key={row.can} className="border-white/10 hover:bg-white/5">
                    <TableCell className="text-xs text-white/85 leading-snug align-top">
                      <div className="flex gap-2 items-start">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300 mt-0.5 shrink-0" />
                        {row.can}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-white/85 leading-snug align-top">
                      <div className="flex gap-2 items-start">
                        <XCircle className="h-3.5 w-3.5 text-red-300 mt-0.5 shrink-0" />
                        {row.cannot}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      <div className="px-8 py-12 max-w-6xl">
        {/* ------------------------------------------------ 06 Accuracy */}
        <section data-testid="section-about-accuracy">
          <Stamp num="06" title="Accuracy, Honestly" />
          <h2 className="text-2xl font-semibold mb-2">What the numbers mean - and what they do not</h2>
          <p className="text-muted-foreground mb-6 max-w-3xl">
            Suspicion scoring is not a court verdict, so this system is engineered for a
            different kind of accuracy: reproducibility, traceability, and measurable precision
            over time.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {[
              { icon: Sigma, title: 'Reproducible', text: 'The scoring core is fully deterministic. Re-running a case on the same data yields the identical score and drivers - auditors can replay any result.' },
              { icon: Scale, title: 'Expert-elicited', text: 'Weights are expert-set log-likelihood ratios grounded in FATF and CBK typologies - stated openly, with no claim of being fitted or validated on labeled outcomes.' },
              { icon: Target, title: 'Measured in use', text: 'The Rule Performance page tracks each rule against your own escalate / close decisions, so precision is observed on your data, not promised.' },
              { icon: FileSearch, title: 'Verified narration', text: 'Every AI citation is cross-checked against the ledger. Invented references are counted and shown - the verification strip on each case reports the result.' },
              { icon: RefreshCcw, title: 'Current lists', text: 'OFAC and UN sanctions lists are re-checked every six hours, and existing screenings are automatically refreshed when a list changes.' },
              { icon: Gauge, title: 'Bounded confidence', text: 'Scores cap at 97%, degrade under poor data quality, and always ship with the full driver breakdown needed to disagree with them.' },
            ].map((c) => (
              <div key={c.title} className="cyber-panel rounded-sm p-4" data-testid={`card-accuracy-${c.title.toLowerCase().replace(/\s/g, '-')}`}>
                <c.icon className="h-4 w-4 text-primary mb-2" />
                <div className="font-semibold text-sm mb-1">{c.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{c.text}</p>
              </div>
            ))}
          </div>
          <Card>
            <CardContent className="pt-6">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Honest limits
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The probability follows from a configured prior and expert-set weights; it has
                never been validated against prosecution outcomes - treat bands as triage
                priorities, not guilt. Rules target known
                typologies; a genuinely novel scheme can score low, which is why analysts see
                raw features alongside fired rules. And the engine only knows what is in the
                uploaded statements: activity at banks that were never uploaded is invisible to
                it. The final judgment - escalate or close - belongs to a human, by design.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* ------------------------------------------------ Closing (always dark) */}
      <section className="relative overflow-hidden border-t border-border">
        <img
          src={img('analyst-tablet.jpg')}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-[#060b16]/85" />
        <div className="relative px-8 py-14 max-w-4xl">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300/90 mb-3">
            Built to be challenged
          </div>
          <h2 className="text-3xl font-bold text-white mb-3">
            Open the evidence and argue with it
          </h2>
          <p className="text-white/70 max-w-2xl leading-relaxed mb-6">
            The fastest way to understand the engine is to open a scored case, unfold its
            drivers, and follow a citation down to the exact bank statement row.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/cases">
              <Button className="rounded-sm" data-testid="link-about-cases">
                Open the Case Registry
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link href="/rules">
              <Button
                variant="outline"
                className="rounded-sm border-white/30 bg-transparent text-white hover:text-white"
                data-testid="link-about-rules"
              >
                Inspect Rule Performance
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
