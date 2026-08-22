import { useGetRulePerformance, RulePerformanceRow } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Target, AlertTriangle, Loader2, Gavel } from 'lucide-react';

function severityTone(sev: string): string {
  switch (sev) {
    case 'critical': return 'text-destructive border-destructive/40';
    case 'high': return 'text-orange-500 border-orange-500/40';
    case 'medium': return 'text-amber-500 border-amber-500/40';
    default: return 'text-muted-foreground border-border';
  }
}

function SplitBar({ row }: { row: RulePerformanceRow }) {
  const total = row.casesFired || 1;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="h-2 w-full flex rounded-full overflow-hidden bg-muted min-w-[120px]">
      {row.escalate > 0 && <div className="bg-destructive" style={{ width: seg(row.escalate) }} title={`${row.escalate} escalated`} />}
      {row.watchlist > 0 && <div className="bg-amber-500" style={{ width: seg(row.watchlist) }} title={`${row.watchlist} watchlisted`} />}
      {row.close > 0 && <div className="bg-emerald-500" style={{ width: seg(row.close) }} title={`${row.close} closed`} />}
      {row.undecided > 0 && <div className="bg-muted-foreground/30" style={{ width: seg(row.undecided) }} title={`${row.undecided} undecided`} />}
    </div>
  );
}

export default function RulePerformancePage() {
  const { data, isLoading } = useGetRulePerformance();

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Target className="h-6 w-6 text-primary" /> Rule Performance
        </h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Which detection rules fire across the portfolio, and how analysts ultimately decided those cases.
          Latest run per case only.
        </p>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs p-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rule performance...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Cases assessed', value: String(data.casesAssessed) },
              { label: 'Cases decided', value: String(data.casesDecided) },
              { label: 'Rules firing', value: String(data.rules.length) },
              {
                label: 'Decision coverage',
                value: data.casesAssessed > 0 ? `${Math.round((data.casesDecided / data.casesAssessed) * 100)}%` : '0%',
              },
            ].map((s) => (
              <div key={s.label} className="border border-border rounded-sm p-4 bg-card">
                <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{s.label}</div>
                <div className="text-2xl font-bold font-mono">{s.value}</div>
              </div>
            ))}
          </div>

          {data.casesDecided === 0 && (
            <Card className="bg-amber-500/5 border-amber-500/30 rounded-sm" data-testid="banner-no-dispositions">
              <CardContent className="py-4 px-5 flex items-start gap-3">
                <Gavel className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">No analyst decisions recorded yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Record a decision in the Disposition tab of each case after review. Once cases are decided,
                    this view shows which rules concentrate true escalations and which fire mostly on cases that
                    get closed - the evidence base for tuning rule weights.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-card border-border rounded-sm" data-testid="panel-rule-performance">
            <CardHeader>
              <CardTitle className="text-base font-mono uppercase tracking-wider">Rules by portfolio reach</CardTitle>
              <CardDescription className="text-xs font-mono">
                Split bar: <span className="text-destructive">escalated</span> / <span className="text-amber-500">watchlisted</span> / <span className="text-emerald-500">closed</span> / <span>undecided</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.rules.length === 0 ? (
                <p className="text-xs font-mono text-muted-foreground py-6 text-center">
                  No rules have fired on any case yet. Run analyses from the case workspace first.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-mono text-[10px] uppercase">Rule</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase">Typology</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase">Severity</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase text-right">Weight</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase text-right">Cases fired</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase w-[180px]">Disposition split</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase text-right">Escalation rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rules.map((r) => {
                        const decided = r.escalate + r.watchlist + r.close;
                        const fireShare = data.casesAssessed > 0 ? r.casesFired / data.casesAssessed : 0;
                        return (
                          <TableRow key={r.ruleId} className="hover:bg-muted/30" data-testid={`row-rule-${r.ruleId}`}>
                            <TableCell>
                              <div className="text-xs font-medium">{r.title}</div>
                              <div className="font-mono text-[10px] text-muted-foreground uppercase mt-0.5">{r.ruleId}</div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={r.typologyName}>
                              {r.typologyName}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`font-mono text-[9px] uppercase ${severityTone(r.severity)}`}>
                                {r.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-right">{r.weightLogLr.toFixed(2)}</TableCell>
                            <TableCell className="text-right">
                              <span className="font-mono text-xs">{r.casesFired}</span>
                              <span className="font-mono text-[10px] text-muted-foreground ml-1.5">
                                ({Math.round(fireShare * 100)}%)
                              </span>
                            </TableCell>
                            <TableCell><SplitBar row={r} /></TableCell>
                            <TableCell className="font-mono text-xs text-right">
                              {decided > 0 ? (
                                <span className={r.escalate / decided >= 0.5 ? 'text-destructive' : 'text-foreground'}>
                                  {Math.round((r.escalate / decided) * 100)}%
                                </span>
                              ) : (
                                <span className="text-muted-foreground/60 inline-flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" /> no decisions
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
