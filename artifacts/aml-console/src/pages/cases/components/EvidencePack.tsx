import { useState, useRef, useEffect } from 'react';
import { 
  useGetLatestAnalysis, 
  useGetAnalysisRun,
  getGetAnalysisRunQueryKey,
  useGetCaseTimeline,
  useGetCaseNetwork,
  useCreateDisposition,
  useListCaseTransactions,
  AnalysisRun,
  RuleHit,
  FeatureValue,
  Driver,
  BankBreakdown,
  InternalTransferPair
} from '@workspace/api-client-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  AlertTriangle, CheckCircle2, AlertCircle, Info, ShieldAlert, Activity,
  ArrowRightLeft, Layers, BrainCircuit, Shield, Network, Scale, FileText, FileSearch, ArrowRight, Search, ListFilter
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Legend, ComposedChart, Line
} from 'recharts';
import { InvestigationIntelligenceView } from './InvestigationIntelligenceView';

export default function EvidencePack({ caseId }: { caseId: number }) {
  const { data: latestAnalysis, isLoading: analysisLoading, error: analysisError, refetch: refetchLatest } = useGetLatestAnalysis(caseId);
  const [activeTab, setActiveTab] = useState('summary');
  const [transactionIdsFilter, setTransactionIdsFilter] = useState<string | undefined>();
  
  // AI Polling logic
  const shouldPoll = latestAnalysis?.aiStatus === 'pending' || latestAnalysis?.aiStatus === 'running';
  const { data: polledAnalysis } = useGetAnalysisRun(
    latestAnalysis?.id as number, 
    {
      query: {
        queryKey: getGetAnalysisRunQueryKey(latestAnalysis?.id as number),
        enabled: shouldPoll,
        refetchInterval: 2500,
      },
    }
  );

  const run = polledAnalysis || latestAnalysis;

  if (analysisLoading) {
    return <div className="p-12 text-center text-primary font-mono animate-pulse">Loading evidence pack...</div>;
  }

  // 404 from api client usually comes through as an error if no run exists
  if (!run) {
    return (
      <div className="bg-muted/30 border border-border rounded-sm p-12 text-center">
        <ShieldAlert className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-4" />
        <h3 className="text-lg font-mono uppercase tracking-widest mb-2">Not Analyzed</h3>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          This case has not been processed by the scoring pipeline. Ingest bank statements and run the analysis to view the evidence pack.
        </p>
      </div>
    );
  }

  const navigateToTransactions = (txnIds: number[]) => {
    if (txnIds.length === 0) return;
    setTransactionIdsFilter(txnIds.join(','));
    setActiveTab('transactions');
  };

  return (
    <div className="space-y-6">
      <ScoreHeader run={run} />
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="overflow-x-auto pb-2 mb-4 scrollbar-hide">
          <TabsList className="bg-card border border-border rounded-sm h-12 inline-flex min-w-full justify-start px-1">
            <TabsTrigger value="summary" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Summary Drivers</TabsTrigger>
            <TabsTrigger value="rules" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Rule Engine</TabsTrigger>
            <TabsTrigger value="features" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Feature Matrix</TabsTrigger>
            <TabsTrigger value="consolidation" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Consolidation</TabsTrigger>
            <TabsTrigger value="timeline" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Timeline</TabsTrigger>
            {/* <TabsTrigger value="network" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Network</TabsTrigger> */}
            <TabsTrigger value="intelligence" data-testid="tab-intelligence" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              Investigation Intel
              {shouldPoll && <span className="ml-2 h-2 w-2 rounded-full bg-primary animate-pulse" />}
            </TabsTrigger>
            <TabsTrigger value="ai" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              AI Analyst
            </TabsTrigger>
            <TabsTrigger value="transactions" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Transactions</TabsTrigger>
            <TabsTrigger value="disposition" className="font-mono text-xs uppercase tracking-wider data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Disposition</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary" className="m-0 focus-visible:outline-none">
          <DriverWaterfall run={run} onNavigateTxns={navigateToTransactions} />
        </TabsContent>

        <TabsContent value="rules" className="m-0 focus-visible:outline-none">
          <RuleEngine run={run} onNavigateTxns={navigateToTransactions} />
        </TabsContent>
        
        <TabsContent value="features" className="m-0 focus-visible:outline-none">
          <FeatureMatrix run={run} />
        </TabsContent>
        
        <TabsContent value="consolidation" className="m-0 focus-visible:outline-none">
          <ConsolidationView run={run} />
        </TabsContent>
        
        <TabsContent value="timeline" className="m-0 focus-visible:outline-none">
          <TimelineView caseId={caseId} />
        </TabsContent>

        <TabsContent value="intelligence" className="m-0 focus-visible:outline-none">
          <InvestigationIntelligenceView run={run} onNavigateTxns={navigateToTransactions} />
        </TabsContent>

        <TabsContent value="ai" className="m-0 focus-visible:outline-none">
          <AiAnalystView run={run} onNavigateTxns={navigateToTransactions} />
        </TabsContent>

        <TabsContent value="transactions" className="m-0 focus-visible:outline-none">
          <TransactionsView 
            caseId={caseId} 
            run={run} 
            initialTxnIds={transactionIdsFilter} 
            onClearFilter={() => setTransactionIdsFilter(undefined)}
          />
        </TabsContent>
        
        <TabsContent value="disposition" className="m-0 focus-visible:outline-none">
          <DispositionView run={run} onUpdate={refetchLatest} />
        </TabsContent>

      </Tabs>
    </div>
  );
}

// --- SUB-COMPONENTS ---

function ScoreHeader({ run }: { run: AnalysisRun }) {
  const getBandColor = (band: string) => {
    switch (band) {
      case 'Critical': return 'text-destructive border-destructive/30 bg-destructive/10';
      case 'High': return 'text-orange-500 border-orange-500/30 bg-orange-500/10';
      case 'Elevated': return 'text-amber-500 border-amber-500/30 bg-amber-500/10';
      case 'Moderate': return 'text-primary border-primary/30 bg-primary/10';
      case 'Low': return 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10';
      default: return 'text-muted-foreground border-border bg-muted';
    }
  };

  const pct = (run.probability * 100).toFixed(1);

  return (
    <Card className="bg-card border-border rounded-sm shadow-xl relative overflow-hidden cyber-panel">
      {/* Decorative background grid */}
      <div className="absolute inset-0 cyber-grid opacity-30 pointer-events-none" />
      
      <CardContent className="p-0 flex flex-col lg:flex-row relative z-10">
        {/* Left: Score Box */}
        <div className="p-8 border-b lg:border-b-0 lg:border-r border-border flex flex-col items-center justify-center bg-background/50 lg:w-[350px]">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4">Suspicion Probability</div>
          <div className={`text-6xl font-black tracking-tighter mb-2 ${getBandColor(run.band).split(' ')[0]}`}>
            {pct}<span className="text-3xl text-muted-foreground font-light">%</span>
          </div>
          <Badge className={`font-mono uppercase tracking-widest px-4 py-1.5 text-sm ${getBandColor(run.band)} hover:${getBandColor(run.band)}`}>
            {run.band} Risk
          </Badge>
          
          <div className="w-full mt-8">
            <div className="flex justify-between text-[10px] font-mono text-muted-foreground mb-1">
              <span>0%</span>
              <span>100%</span>
            </div>
            {/* Custom Multi-segment Gauge */}
            <div className="h-2 w-full flex rounded-full overflow-hidden bg-muted">
              {run.bandScale.map((b, i) => {
                const width = (b.maxP - b.minP) * 100;
                let color = 'bg-emerald-500';
                if (b.band === 'Moderate') color = 'bg-primary';
                if (b.band === 'Elevated') color = 'bg-amber-500';
                if (b.band === 'High') color = 'bg-orange-500';
                if (b.band === 'Critical') color = 'bg-destructive';
                
                return (
                  <div key={b.band} className={`h-full opacity-30 ${color}`} style={{ width: `${width}%` }} />
                );
              })}
              {/* The Marker */}
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-foreground z-10 drop-shadow-[0_0_5px_rgba(255,255,255,0.8)]" 
                style={{ left: `${run.probability * 100}%` }} 
              />
            </div>
            <div className="text-center text-[10px] font-mono text-muted-foreground mt-2">
              Prior: {(run.priorProbability * 100).toFixed(1)}% → Posterior: {pct}%
            </div>
          </div>
        </div>

        {/* Right: Vital Stats */}
        <div className="p-8 flex-1 flex flex-col justify-center">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Analysis Date</div>
              <div className="font-mono text-sm">{format(new Date(run.createdAt), 'dd MMM yy HH:mm')}</div>
            </div>
            
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                Data Quality 
                {run.dataQualityScore < 0.8 && (
                  <Tooltip>
                    <TooltipTrigger><AlertTriangle className="h-3 w-3 text-amber-500" /></TooltipTrigger>
                    <TooltipContent className="max-w-xs p-3">
                      <div className="font-mono text-xs text-amber-500 mb-1">Quality Caveats:</div>
                      <ul className="list-disc pl-4 text-xs space-y-1">
                        {run.dataQualityIssues.map((i, idx) => <li key={idx}>{i}</li>)}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className={`font-mono text-sm ${run.dataQualityScore < 0.8 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {(run.dataQualityScore * 100).toFixed(0)}% Score
              </div>
            </div>
            
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Gross Flow</div>
              <div className="font-mono text-sm">
                <span className="text-emerald-500">+{formatKwd(run.totalCreditsKwd)}</span>
                <br />
                <span className="text-orange-500">-{formatKwd(run.totalDebitsKwd)}</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Internal Netted</div>
              <div className="font-mono text-sm text-primary">
                {formatKwd(run.internalValueKwd)} KWD
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">{run.internalTransferCount} txns excluded</div>
            </div>
          </div>
          
          <div className="mt-8 pt-6 border-t border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs border-primary/30 text-primary bg-primary/5 rounded-sm">
                {run.txnCount.toLocaleString()} Transactions Analyzed
              </Badge>
              {run.periodStart && (
                <span className="text-xs text-muted-foreground font-mono">
                  Covering {format(new Date(run.periodStart), 'MMM yyyy')} to {format(new Date(run.periodEnd!), 'MMM yyyy')}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground uppercase">AI Analyst</span>
              {run.aiStatus === 'pending' || run.aiStatus === 'running' ? (
                <Badge variant="outline" className="font-mono text-[10px] border-primary/50 text-primary rounded-sm animate-pulse">
                  <BrainCircuit className="h-3 w-3 mr-1" /> Thinking...
                </Badge>
              ) : run.aiStatus === 'complete' ? (
                <Badge variant="outline" className="font-mono text-[10px] border-emerald-500/50 text-emerald-500 rounded-sm">
                  <BrainCircuit className="h-3 w-3 mr-1" /> Synthesized
                </Badge>
              ) : (
                <Badge variant="outline" className="font-mono text-[10px] border-destructive/50 text-destructive rounded-sm">
                  <AlertTriangle className="h-3 w-3 mr-1" /> {run.aiStatus}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DriverWaterfall({ run, onNavigateTxns }: { run: AnalysisRun, onNavigateTxns: (ids: number[]) => void }) {
  // Sort drivers by absolute impact (highest magnitude first)
  const sortedDrivers = [...run.drivers].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  
  const getSourceIcon = (source: string) => {
    switch(source) {
      case 'rule': return <ShieldAlert className="h-3 w-3 text-destructive" />;
      case 'feature': return <Activity className="h-3 w-3 text-primary" />;
      case 'data_quality': return <AlertTriangle className="h-3 w-3 text-amber-500" />;
      case 'prior': return <Scale className="h-3 w-3 text-muted-foreground" />;
      default: return <Info className="h-3 w-3" />;
    }
  };

  const maxAbs = Math.max(...sortedDrivers.map(d => Math.abs(d.contribution)), 0.1);

  return (
    <Card className="bg-card border-border rounded-sm">
      <CardHeader>
        <CardTitle className="text-base font-mono uppercase tracking-wider">Bayesian Evidence Drivers</CardTitle>
        <CardDescription>Log-odds contributions ordered by impact magnitude</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sortedDrivers.map((driver, i) => {
            const isPositive = driver.contribution > 0;
            const pctWidth = (Math.abs(driver.contribution) / maxAbs) * 100;
            const hasTxns = driver.txnIds && driver.txnIds.length > 0;
            
            return (
              <div key={i} className="flex items-center gap-4 text-sm relative group">
                <div className="w-1/3 flex justify-end">
                  <div className="text-right flex items-center justify-end gap-2 truncate">
                    <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">{driver.source}</span>
                    <span className="font-medium truncate">{driver.label}</span>
                    {getSourceIcon(driver.source)}
                  </div>
                </div>
                
                <div className="w-24 text-center font-mono text-xs relative z-10">
                  <span className={isPositive ? 'text-destructive' : 'text-emerald-500'}>
                    {isPositive ? '+' : ''}{driver.contribution.toFixed(2)}
                  </span>
                </div>
                
                <div className="w-1/3 relative h-6 flex items-center">
                  <div className="absolute left-0 top-0 bottom-0 w-px bg-border z-0" />
                  {isPositive ? (
                    <div className="h-4 bg-destructive/30 border border-destructive/50 rounded-r-sm z-10" style={{ width: `${pctWidth}%` }} />
                  ) : (
                    // Negative contribution actually means pulling probability down (less suspicious)
                    // visually we just plot it to the right with green for simplicity, or we could plot to the left.
                    // Let's plot everything expanding rightward but colored by direction.
                    <div className="h-4 bg-emerald-500/30 border border-emerald-500/50 rounded-r-sm z-10" style={{ width: `${pctWidth}%` }} />
                  )}
                  
                  {hasTxns && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 ml-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm"
                      onClick={() => onNavigateTxns(driver.txnIds!)}
                    >
                      <ArrowRight className="h-3 w-3 text-primary" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RuleEngine({ run, onNavigateTxns }: { run: AnalysisRun, onNavigateTxns: (ids: number[]) => void }) {
  const firedHits = run.ruleHits.filter(r => r.fired).sort((a, b) => b.weightLogLr - a.weightLogLr);
  const passedHits = run.ruleHits.filter(r => !r.fired);

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'critical': return 'text-destructive border-destructive/30 bg-destructive/10';
      case 'high': return 'text-orange-500 border-orange-500/30 bg-orange-500/10';
      case 'medium': return 'text-amber-500 border-amber-500/30 bg-amber-500/10';
      case 'low': return 'text-primary border-primary/30 bg-primary/10';
      default: return 'text-muted-foreground border-border bg-muted';
    }
  };

  return (
    <div className="space-y-4">
      {firedHits.length === 0 ? (
        <Card className="bg-card border-border border-dashed">
          <CardContent className="p-8 text-center text-emerald-500 font-mono">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Zero Typology Rules Fired
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {firedHits.map(hit => (
            <Card key={hit.ruleId} className="bg-card border-border rounded-sm shadow-sm hover:border-primary/30 transition-colors flex flex-col">
              <CardHeader className="pb-3 border-b border-border/50">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-sm ${getSeverityColor(hit.severity)}`}>
                        {hit.severity}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{hit.ruleId}</span>
                    </div>
                    <CardTitle className="text-base text-foreground leading-tight">{hit.title}</CardTitle>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xl text-destructive font-bold">+{hit.weightLogLr.toFixed(1)}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">LOG-LR</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 flex-1 flex flex-col">
                <p className="text-sm text-muted-foreground mb-4">{hit.description}</p>
                {hit.detail && (
                  <div className="bg-muted/30 border border-border/50 p-3 rounded-sm text-xs font-mono mb-4 text-foreground/80">
                    {hit.detail}
                  </div>
                )}
                
                <div className="mt-auto space-y-3">
                  <div className="text-xs flex items-start gap-2 text-muted-foreground bg-background/50 p-2 border border-border/30 rounded-sm">
                    <Info className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                    <span><strong className="text-foreground">FATF/Egmont:</strong> {hit.citation}</span>
                  </div>
                  
                  <div className="flex items-center justify-between pt-2">
                    <div className="text-xs font-mono text-muted-foreground">
                      Typology: {hit.typologyName}
                    </div>
                    {hit.txnIds.length > 0 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 text-xs font-mono rounded-sm border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => onNavigateTxns(hit.txnIds)}
                      >
                        View {hit.txnIds.length} Txns <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {passedHits.length > 0 && (
        <Card className="bg-card border-border rounded-sm">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Checks Passed ({passedHits.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-xs text-muted-foreground font-mono flex flex-wrap gap-2">
              {passedHits.map(h => (
                <span key={h.ruleId} title={h.title} className="bg-muted px-1.5 py-0.5 rounded border border-border/50">
                  {h.ruleId}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FeatureMatrix({ run }: { run: AnalysisRun }) {
  const groups = ['placement', 'layering', 'geography', 'temporal', 'narrative', 'network', 'cross_bank'] as const;
  
  const getZoneColor = (zone: string) => {
    switch (zone) {
      case 'critical': return 'text-destructive border-destructive/30 bg-destructive/10';
      case 'elevated': return 'text-amber-500 border-amber-500/30 bg-amber-500/10';
      case 'normal': return 'text-muted-foreground border-border bg-muted/50';
      case 'gated': return 'text-muted-foreground border-border/50 bg-background opacity-50';
      default: return 'text-muted-foreground border-border bg-muted';
    }
  };

  return (
    <Card className="bg-card border-border rounded-sm">
      <CardHeader>
        <CardTitle className="text-base font-mono uppercase tracking-wider">Engineered Feature Matrix</CardTitle>
        <CardDescription>Multi-dimensional behavioral vectors vs baselines</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {groups.map(group => {
            const groupFeatures = run.features.filter(f => f.group === group);
            if (groupFeatures.length === 0) return null;
            
            return (
              <div key={group}>
                <h3 className="text-sm font-mono text-primary uppercase tracking-widest mb-3 border-b border-primary/20 pb-1">
                  {group.replace('_', ' ')} Vector
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {groupFeatures.map(f => (
                    <div key={f.key} className="border border-border/50 bg-background/50 rounded-sm p-3 relative group hover:border-primary/30 transition-colors">
                      {f.zone === 'gated' && (
                        <div className="absolute top-1 right-2 text-[9px] font-mono uppercase text-muted-foreground opacity-70">
                          {f.gatedReason}
                        </div>
                      )}
                      <div className="text-xs font-mono text-muted-foreground mb-1 truncate pr-16" title={f.label}>{f.label}</div>
                      <div className="flex items-end justify-between">
                        <div className="font-mono">
                          <span className={`text-lg font-medium ${f.zone === 'critical' ? 'text-destructive' : f.zone === 'elevated' ? 'text-amber-500' : 'text-foreground'}`}>
                            {f.value % 1 !== 0 ? f.value.toFixed(2) : f.value}
                          </span>
                          {f.unit && <span className="text-xs text-muted-foreground ml-1">{f.unit}</span>}
                        </div>
                        <Badge variant="outline" className={`font-mono text-[9px] uppercase px-1.5 py-0 rounded-sm h-4 ${getZoneColor(f.zone)}`}>
                          {f.zone}
                        </Badge>
                      </div>
                      
                      {f.baseline !== null && f.baseline !== undefined && (
                        <div className="mt-2 text-[10px] font-mono text-muted-foreground border-t border-border/30 pt-1.5 flex justify-between">
                          <span>Baseline: {f.baseline % 1 !== 0 ? f.baseline.toFixed(2) : f.baseline}{f.unit}</span>
                          <span className="truncate ml-2 text-right opacity-50" title={f.baselineLabel || ''}>{f.baselineLabel}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ConsolidationView({ run }: { run: AnalysisRun }) {
  return (
    <div className="space-y-4">
      <Card className="bg-card border-border rounded-sm">
        <CardHeader>
          <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Cross-Bank Synthesis
          </CardTitle>
          <CardDescription>Aggregate view across all ingested financial institutions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {run.banks.map(bank => (
              <div key={bank.bank} className="border border-border/50 bg-background/50 rounded-sm p-4 hover:border-primary/30 transition-colors">
                <div className="font-medium text-base mb-3 truncate" dir="auto">{bank.bank}</div>
                <div className="space-y-2 text-sm font-mono">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transactions</span>
                    <span>{bank.txnCount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Inflow</span>
                    <span className="text-emerald-500">{formatKwd(bank.creditsKwd)} KWD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Outflow</span>
                    <span className="text-orange-500">{formatKwd(bank.debitsKwd)} KWD</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border rounded-sm">
        <CardHeader>
          <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" /> Internal Transfer Netting
          </CardTitle>
          <CardDescription>Flows between subject's own accounts excluded from risk volume</CardDescription>
        </CardHeader>
        <CardContent>
          {run.internalTransfers.length === 0 ? (
            <div className="text-center p-6 text-muted-foreground text-sm font-mono border border-border/30 rounded-sm bg-background/30">
              No internal cross-bank transfers detected.
            </div>
          ) : (
            <div className="border border-border rounded-sm overflow-hidden">
              <Table>
                <TableHeader className="bg-background/50">
                  <TableRow>
                    <TableHead className="font-mono text-xs">Direction</TableHead>
                    <TableHead className="font-mono text-xs text-right">Value (KWD)</TableHead>
                    <TableHead className="font-mono text-xs text-right">Gap</TableHead>
                    <TableHead className="font-mono text-xs">Match Basis</TableHead>
                    <TableHead className="font-mono text-xs">Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.internalTransfers.map((pair) => (
                    <TableRow key={pair.id}>
                      <TableCell className="font-mono text-xs">
                        <span className="text-muted-foreground">{pair.fromBank}</span>
                        <ArrowRight className="h-3 w-3 inline mx-2 text-primary" />
                        <span>{pair.toBank}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right font-medium">
                        {pair.amountKwd.toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right text-muted-foreground">
                        {pair.dateGapDays === 0 ? 'Same day' : `${pair.dateGapDays} day(s)`}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {pair.matchBasis.replace('_', ' ')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-mono text-[9px] rounded-sm px-1.5 ${
                          pair.confidence > 0.9 ? 'text-emerald-500 border-emerald-500/30' : 
                          'text-amber-500 border-amber-500/30'
                        }`}>
                          {(pair.confidence * 100).toFixed(0)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TimelineView({ caseId }: { caseId: number }) {
  const { data, isLoading } = useGetCaseTimeline(caseId);

  if (isLoading) return <div className="h-96 flex items-center justify-center font-mono text-primary animate-pulse">Loading timeline data...</div>;
  if (!data || data.length === 0) return <div className="p-8 text-center text-muted-foreground font-mono">No timeline data available.</div>;

  // Transform data for stacked chart - aggregate by month
  const monthlyData = data.reduce((acc, curr) => {
    if (!acc[curr.month]) {
      acc[curr.month] = { 
        month: curr.month, 
        creditsKwd: 0, 
        debitsKwd: 0,
        cashInKwd: 0,
        cashOutKwd: 0,
        txnCount: 0
      };
    }
    acc[curr.month].creditsKwd += curr.creditsKwd;
    acc[curr.month].debitsKwd += curr.debitsKwd;
    acc[curr.month].cashInKwd += curr.cashInKwd;
    acc[curr.month].cashOutKwd += curr.cashOutKwd;
    acc[curr.month].txnCount += curr.txnCount;
    return acc;
  }, {} as Record<string, any>);

  const chartData = Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));

  return (
    <Card className="bg-card border-border rounded-sm">
      <CardHeader>
        <CardTitle className="text-base font-mono uppercase tracking-wider">Temporal Behavior</CardTitle>
        <CardDescription>Monthly aggregated flow velocity and cash intensity</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis 
                dataKey="month" 
                stroke="hsl(var(--muted-foreground))" 
                fontSize={10} 
                tickMargin={10}
                tickFormatter={(val) => {
                  const [y, m] = val.split('-');
                  return `${m}/${y.substring(2)}`;
                }}
              />
              <YAxis 
                yAxisId="left"
                stroke="hsl(var(--muted-foreground))" 
                fontSize={10}
                tickFormatter={(val) => formatKwd(val)}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                stroke="hsl(var(--primary))" 
                fontSize={10}
                tickFormatter={(val) => formatKwd(val)}
              />
              <RechartsTooltip 
                contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: '4px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                itemStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: number, name: string) => [formatKwd(value) + ' KWD', name]}
                labelFormatter={(label) => `Month: ${label}`}
              />
              <Legend wrapperStyle={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }} />
              
              <Bar yAxisId="left" dataKey="creditsKwd" name="Inflow" fill="hsl(var(--chart-2))" radius={[2, 2, 0, 0]} opacity={0.8} />
              <Bar yAxisId="left" dataKey="debitsKwd" name="Outflow" fill="hsl(var(--chart-4))" radius={[2, 2, 0, 0]} opacity={0.8} />
              
              <Line yAxisId="right" type="monotone" dataKey="cashInKwd" name="Cash Dep" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="cashOutKwd" name="Cash W/D" stroke="hsl(var(--chart-5))" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function AiAnalystView({ run, onNavigateTxns }: { run: AnalysisRun, onNavigateTxns: (ids: number[]) => void }) {
  if (run.aiStatus === 'pending' || run.aiStatus === 'running') {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="relative w-24 h-24 mb-8">
          <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <div className="absolute inset-2 border-2 border-primary/40 rounded-full animate-[spin_3s_linear_infinite]" />
          <div className="absolute inset-4 border-2 border-primary/60 rounded-full animate-[spin_4s_linear_infinite_reverse]" />
          <div className="absolute inset-0 flex items-center justify-center bg-background rounded-full z-10">
            <BrainCircuit className="h-8 w-8 text-primary animate-pulse" />
          </div>
        </div>
        <h3 className="text-xl font-mono uppercase tracking-widest text-primary mb-2">Synthesizing Narrative</h3>
        <p className="text-muted-foreground text-sm font-mono max-w-md">
          The LLM agent is reviewing rule hits, analyzing context, and generating adversarial benign explanations.
        </p>
      </div>
    );
  }

  if (run.aiStatus === 'failed' || run.aiStatus === 'skipped') {
    return (
      <Card className="bg-destructive/5 border-destructive/20 rounded-sm">
        <CardContent className="p-8 text-center">
          <AlertTriangle className="h-10 w-10 mx-auto text-destructive mb-4" />
          <h3 className="text-lg font-mono uppercase tracking-widest text-destructive mb-2">AI Analysis {run.aiStatus}</h3>
          <p className="text-sm text-foreground/70 mb-4">{run.aiError || 'The generative synthesis layer failed to run.'}</p>
          <p className="text-xs font-mono text-muted-foreground bg-background/50 inline-block px-3 py-1.5 rounded border border-border/50">
            Deterministic risk scores, drivers, and rules remain fully valid.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Consistency */}
      {run.profileConsistency && (
        <Card className={`border rounded-sm shadow-sm ${
          run.profileConsistency.verdict === 'inconsistent' ? 'bg-destructive/5 border-destructive/30' :
          run.profileConsistency.verdict === 'partially_inconsistent' ? 'bg-amber-500/5 border-amber-500/30' :
          'bg-emerald-500/5 border-emerald-500/30'
        }`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono uppercase tracking-wider">KYC Profile Consistency</CardTitle>
              <Badge variant="outline" className={`font-mono text-[10px] uppercase ${
                run.profileConsistency.verdict === 'inconsistent' ? 'text-destructive border-destructive' :
                run.profileConsistency.verdict === 'partially_inconsistent' ? 'text-amber-500 border-amber-500' :
                'text-emerald-500 border-emerald-500'
              }`}>
                {run.profileConsistency.verdict.replace('_', ' ')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{run.profileConsistency.explanation}</p>
          </CardContent>
        </Card>
      )}

      {/* Typology Narrative */}
      <Card className="bg-card border-border rounded-sm">
        <CardHeader>
          <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Typology Synthesis
          </CardTitle>
          <CardDescription>Qualitative assessment of detected behavioral patterns</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {run.typologyFindings?.map((finding, idx) => (
            <div key={idx} className="border border-border/50 bg-background/50 rounded-sm p-4">
              <div className="flex justify-between items-start mb-3">
                <h4 className="font-semibold text-base text-primary">{finding.typologyName}</h4>
                <div className="flex gap-2">
                  <Badge variant="outline" className={`font-mono text-[9px] uppercase ${
                    finding.present === 'yes' ? 'border-destructive text-destructive' :
                    finding.present === 'partial' ? 'border-amber-500 text-amber-500' :
                    'border-emerald-500 text-emerald-500'
                  }`}>
                    Present: {finding.present}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[9px] uppercase border-border text-muted-foreground">
                    Strength: {finding.strength}
                  </Badge>
                </div>
              </div>
              <p className="text-sm text-foreground/90 mb-4 leading-relaxed">{finding.reasoning}</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border/50 mt-4">
                {finding.benignExplanationsPossible && finding.benignExplanationsPossible.length > 0 && (
                  <div>
                    <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Possible Benign Explanations</div>
                    <ul className="list-disc pl-4 text-xs space-y-1 text-muted-foreground">
                      {finding.benignExplanationsPossible.map((exp, i) => (
                        <li key={i}>{exp}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {finding.supportingTxnIds && finding.supportingTxnIds.length > 0 && (
                  <div className="md:text-right">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="font-mono text-xs rounded-sm border-primary/30 text-primary hover:bg-primary/10 mt-2"
                      onClick={() => onNavigateTxns(finding.supportingTxnIds)}
                    >
                      View {finding.supportingTxnIds.length} Core Transactions <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Adversarial Critic */}
      {run.criticScenarios && run.criticScenarios.length > 0 && (
        <Card className="bg-card border-border rounded-sm">
          <CardHeader>
            <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2 text-primary">
              <Shield className="h-4 w-4" /> Adversarial Critic (Devil's Advocate)
            </CardTitle>
            <CardDescription>Hypothetical legitimate narratives that explain the observed data</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {run.criticScenarios.map((scenario, idx) => (
                <div key={idx} className="border border-border/50 bg-background/50 rounded-sm p-4 flex flex-col">
                  <div className="flex justify-between items-start mb-2">
                    <Badge variant="outline" className={`font-mono text-[9px] uppercase ${
                      scenario.plausibility === 'high' ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10' :
                      scenario.plausibility === 'medium' ? 'border-amber-500 text-amber-500 bg-amber-500/10' :
                      'border-muted-foreground text-muted-foreground bg-muted/50'
                    }`}>
                      Plausibility: {scenario.plausibility}
                    </Badge>
                  </div>
                  <h4 className="font-semibold text-sm mb-2">{scenario.scenario}</h4>
                  <div className="text-xs text-muted-foreground space-y-2 flex-1 mb-4">
                    <p><strong className="text-foreground/70">Consistency Check:</strong> {scenario.consistencyCheck}</p>
                    <p><strong className="text-foreground/70">Required Documents:</strong> {scenario.confirmingDocument}</p>
                  </div>
                </div>
              ))}
            </div>
            
            {run.residualUnexplained && run.residualUnexplained.length > 0 && (
              <div className="mt-6 p-4 border border-destructive/30 bg-destructive/5 rounded-sm">
                <div className="text-xs font-mono text-destructive uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" /> Residual Unexplained Behaviors
                </div>
                <ul className="list-disc pl-4 text-sm space-y-1 text-foreground/90">
                  {run.residualUnexplained.map((ru, i) => (
                    <li key={i}>{ru}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TransactionsView({ caseId, run, initialTxnIds, onClearFilter }: { caseId: number, run: AnalysisRun, initialTxnIds?: string, onClearFilter: () => void }) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [bank, setBank] = useState('');
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  
  // Update internal state if initialTxnIds prop changes
  const [txnIds, setTxnIds] = useState(initialTxnIds || '');
  
  useEffect(() => {
    if (initialTxnIds !== undefined && initialTxnIds !== txnIds) {
      setTxnIds(initialTxnIds);
      setPage(1); // reset to page 1 on new filter
    }
  }, [initialTxnIds]);

  const { data: pageData, isLoading } = useListCaseTransactions({
    caseId,
    page,
    pageSize,
    bank: bank || undefined,
    search: search || undefined,
    flaggedOnly: flaggedOnly || undefined,
    txnIds: txnIds || undefined
  });

  const clearAllFilters = () => {
    setBank('');
    setSearch('');
    setFlaggedOnly(false);
    setTxnIds('');
    setPage(1);
    onClearFilter();
  };

  const hasFilters = bank || search || flaggedOnly || txnIds;

  return (
    <Card className="bg-card border-border rounded-sm flex flex-col h-[700px]">
      <div className="p-4 border-b border-border/50 bg-background/50 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search narrative, counterparty..." 
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 h-9 text-xs font-mono bg-background border-border rounded-sm"
            />
          </div>
          
          <select 
            value={bank}
            onChange={e => { setBank(e.target.value); setPage(1); }}
            className="h-9 text-xs font-mono bg-background border border-border rounded-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
          >
            <option value="">All Banks</option>
            {run.banks.map(b => (
              <option key={b.bank} value={b.bank}>{b.bank}</option>
            ))}
          </select>
          
          <label className="flex items-center gap-2 text-xs font-mono cursor-pointer bg-background border border-border px-3 h-9 rounded-sm hover:bg-muted/50 transition-colors">
            <input 
              type="checkbox" 
              checked={flaggedOnly} 
              onChange={e => { setFlaggedOnly(e.target.checked); setPage(1); }}
              className="accent-primary"
            />
            Flagged Only
          </label>

          {txnIds && (
            <Badge variant="outline" className="h-9 font-mono text-xs border-primary/50 text-primary bg-primary/10 rounded-sm flex items-center gap-2">
              <ListFilter className="h-3 w-3" />
              Evidence Filter Active
              <button onClick={() => { setTxnIds(''); setPage(1); onClearFilter(); }} className="ml-1 hover:text-foreground hover:bg-primary/20 rounded-full p-0.5">
                ×
              </button>
            </Badge>
          )}
        </div>
        
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-9 text-xs font-mono text-muted-foreground hover:text-foreground">
            Clear Filters
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="bg-background/80 backdrop-blur sticky top-0 z-10 border-b border-border">
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs uppercase w-[100px]">Date</TableHead>
              <TableHead className="font-mono text-xs uppercase">Bank / Acct</TableHead>
              <TableHead className="font-mono text-xs uppercase w-[100px]">Dir</TableHead>
              <TableHead className="font-mono text-xs uppercase text-right">Amount</TableHead>
              <TableHead className="font-mono text-xs uppercase text-right">Balance</TableHead>
              <TableHead className="font-mono text-xs uppercase">Narrative / Counterparty</TableHead>
              <TableHead className="font-mono text-xs uppercase text-right w-[150px]">Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-primary animate-pulse font-mono">
                  Loading transactions...
                </TableCell>
              </TableRow>
            ) : pageData?.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground font-mono">
                  No transactions found matching criteria.
                </TableCell>
              </TableRow>
            ) : (
              pageData?.items.map(txn => (
                <TableRow key={txn.id} className="hover:bg-muted/30 border-b border-border/50 group">
                  <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(txn.postingDate), 'dd-MM-yyyy')}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs truncate max-w-[150px]" dir="auto" title={txn.bank}>{txn.bank}</div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{txn.accountId}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`font-mono text-[9px] uppercase px-1.5 py-0 rounded-sm ${txn.direction === 'credit' ? 'border-emerald-500/50 text-emerald-500' : 'border-orange-500/50 text-orange-500'}`}>
                      {txn.direction === 'credit' ? 'IN' : 'OUT'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right font-medium">
                    {txn.amountKwd.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right text-muted-foreground">
                    {txn.runningBalance != null ? txn.runningBalance.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs truncate max-w-[300px]" dir="auto" title={txn.narrative || ''}>
                      {txn.narrative || '—'}
                    </div>
                    {txn.counterpartyName && (
                      <div className="font-mono text-[10px] text-primary truncate mt-0.5 max-w-[300px]">
                        CP: {txn.counterpartyName} {txn.counterpartyCountry ? `(${txn.counterpartyCountry})` : ''}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {txn.isInternalTransfer ? (
                      <Badge variant="outline" className="font-mono text-[9px] uppercase px-1.5 py-0 rounded-sm border-primary/50 text-primary">
                        Internal
                      </Badge>
                    ) : txn.flags.length > 0 ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        {txn.flags.map(f => (
                          <span key={f} className="text-[9px] font-mono bg-destructive/10 text-destructive border border-destructive/20 px-1 rounded-sm" title={f}>
                            {f.split('-')[0]}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      {pageData && pageData.total > 0 && (
        <div className="p-3 border-t border-border bg-background/50 flex items-center justify-between text-xs font-mono text-muted-foreground">
          <div>
            Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, pageData.total)} of {pageData.total}
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 text-xs font-mono rounded-sm"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Prev
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 text-xs font-mono rounded-sm"
              disabled={page * pageSize >= pageData.total}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DispositionView({ run, onUpdate }: { run: AnalysisRun, onUpdate: () => void }) {
  const createDisposition = useCreateDisposition();
  const [decision, setDecision] = useState<'escalate'|'watchlist'|'close' | ''>('');
  const [notes, setNotes] = useState('');
  const [analystName, setAnalystName] = useState('O. Analyst'); // Mock logged in user

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!decision) {
      toast.error('Please select a decision');
      return;
    }
    
    createDisposition.mutate({
      runId: run.id,
      data: {
        decision,
        notes,
        analystName
      }
    }, {
      onSuccess: () => {
        toast.success('Disposition saved');
        onUpdate();
      }
    });
  };

  if (run.disposition) {
    return (
      <Card className="bg-card border-border rounded-sm">
        <CardHeader className="border-b border-border/50 bg-background/30">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-mono uppercase tracking-wider">Final Disposition</CardTitle>
              <CardDescription>Official verdict recorded for this run</CardDescription>
            </div>
            <Badge className={`font-mono uppercase tracking-widest px-4 py-1.5 text-sm ${
              run.disposition.decision === 'escalate' ? 'bg-destructive/20 text-destructive border-destructive/50 hover:bg-destructive/20' :
              run.disposition.decision === 'watchlist' ? 'bg-amber-500/20 text-amber-500 border-amber-500/50 hover:bg-amber-500/20' :
              'bg-emerald-500/20 text-emerald-500 border-emerald-500/50 hover:bg-emerald-500/20'
            }`}>
              {run.disposition.decision}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4 text-sm font-mono mb-6">
            <div>
              <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Analyst</span>
              {run.disposition.analystName}
            </div>
            <div>
              <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Date Recorded</span>
              {format(new Date(run.disposition.createdAt), 'dd MMM yyyy HH:mm')}
            </div>
          </div>
          
          <div className="space-y-1">
            <span className="text-muted-foreground block text-xs font-mono uppercase tracking-wider mb-1">Rationale / Notes</span>
            <div className="bg-background/50 border border-border/50 rounded-sm p-4 text-sm text-foreground/90 whitespace-pre-wrap">
              {run.disposition.notes || 'No notes provided.'}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-primary/30 rounded-sm relative overflow-hidden cyber-panel">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />
      <CardHeader>
        <CardTitle className="text-base font-mono uppercase tracking-wider text-primary">Record Disposition</CardTitle>
        <CardDescription>Register your final decision for this scoring pipeline run.</CardDescription>
      </CardHeader>
      <CardContent>
        {run.caseMemo && (
          <div className="mb-6 space-y-2">
            <div className="flex items-center text-xs font-mono text-muted-foreground uppercase tracking-wider gap-1.5">
              <FileSearch className="h-3 w-3" /> Auto-Generated Case Memo Draft
            </div>
            <div className="bg-muted/30 p-4 rounded-sm border border-border text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {run.caseMemo}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 pt-4 border-t border-border/50">
          <div className="space-y-3">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Decision <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { val: 'close', label: 'Close - False Positive', color: 'emerald-500' },
                { val: 'watchlist', label: 'Add to Watchlist', color: 'amber-500' },
                { val: 'escalate', label: 'Escalate to SAR', color: 'destructive' }
              ].map(opt => (
                <label 
                  key={opt.val} 
                  className={`flex items-center justify-center p-4 border rounded-sm cursor-pointer transition-all ${
                    decision === opt.val 
                      ? `border-${opt.color} bg-${opt.color}/10 ring-1 ring-${opt.color}/50` 
                      : 'border-border bg-background hover:bg-muted/50'
                  }`}
                >
                  <input 
                    type="radio" 
                    name="decision" 
                    value={opt.val}
                    checked={decision === opt.val}
                    onChange={(e) => setDecision(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className={`font-mono text-sm uppercase tracking-wider ${decision === opt.val ? `text-${opt.color}` : 'text-foreground'}`}>
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Rationale & Notes</Label>
            <Textarea 
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Detail the reasoning for your decision..."
              className="min-h-[120px] font-mono text-sm bg-background/50 border-border focus-visible:ring-primary"
            />
          </div>
          
          <div className="flex justify-end">
            <Button 
              type="submit" 
              disabled={!decision || createDisposition.isPending}
              className="font-mono uppercase tracking-wider rounded-sm"
            >
              {createDisposition.isPending ? 'Submitting...' : 'Sign & Record Verdict'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function formatKwd(val: number) {
  if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return val.toFixed(0);
}