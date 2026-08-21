import { 
  AnalysisRun, 
  TechnicalFinding, 
  InvestigationHypothesis, 
  InvestigationAction,
  useRetryAiAnalysis,
  getGetAnalysisRunQueryKey,
  getGetLatestAnalysisQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  BrainCircuit, Cpu, AlertTriangle, AlertCircle, Info, 
  ArrowRight, Microscope, Crosshair, Target, CheckCircle2,
  Terminal, Shield, Zap, Search, Fingerprint, Loader2, RotateCcw, Circle, Scale
} from 'lucide-react';
import { 
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function InvestigationIntelligenceView({ 
  run, 
  onNavigateTxns 
}: { 
  run: AnalysisRun, 
  onNavigateTxns: (ids: number[]) => void 
}) {
  const queryClient = useQueryClient();
  const retryAi = useRetryAiAnalysis({
    mutation: {
      onSuccess: () => {
        toast.success('AI analysis relaunched - resuming from the last completed stage');
        void queryClient.invalidateQueries({ queryKey: getGetLatestAnalysisQueryKey(run.caseId) });
        void queryClient.invalidateQueries({ queryKey: getGetAnalysisRunQueryKey(run.id) });
      },
      onError: (err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Could not relaunch the AI analysis');
      },
    },
  });
  const technical = run.technicalAnalysis;
  const ai = run.aiInvestigation;
  const aiProgress = run.aiProgress;
  const recon = run.disclosureReconciliation;

  const isAiLoading = !ai && (run.aiStatus === 'pending' || run.aiStatus === 'running');
  const isAiFailed = !ai && (run.aiStatus === 'failed' || run.aiStatus === 'skipped');
  const isLegacyTechnical = technical.engineVersion === 'legacy-unavailable';
  const memoStageFailed = Boolean(ai) && run.aiStatus === 'failed';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6" data-testid="investigation-intelligence-surface">
      {/* LEFT COLUMN: Deterministic Technical Forensics */}
      <div className="xl:col-span-5 flex flex-col gap-6">
        {/* Technical Engine Header */}
        <Card className="bg-card border-border rounded-sm cyber-panel overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <Cpu className="h-24 w-24" />
          </div>
          <CardHeader className="pb-2 border-b border-border/50 bg-background/30">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2">
                  <Microscope className="h-4 w-4 text-primary" />
                  Technical Forensics
                </CardTitle>
                <CardDescription className="font-mono text-xs mt-1">
                  Deterministic heuristics & anomaly detection
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-[9px] uppercase border-primary/30 text-primary" data-testid="badge-engine-version">
                {technical?.engineVersion || 'forensic-v1.0'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-1">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Tests Executed</div>
                <div className="font-mono text-lg" data-testid="text-tests-executed">{technical?.testsExecuted?.length || 0}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Data Quality</div>
                <div className="font-mono text-lg flex items-center gap-2" data-testid="text-data-quality">
                  <span className={(technical?.dataQualityScore || 0) < 0.8 ? 'text-amber-500' : 'text-emerald-500'}>
                    {((technical?.dataQualityScore || 0) * 100).toFixed(0)}%
                  </span>
                  {(technical?.dataQualityScore || 0) < 0.8 && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                </div>
              </div>
            </div>

            {technical?.gatedTests && technical.gatedTests.length > 0 && (
              <div className="mt-4 p-3 border border-border/50 bg-background/50 rounded-sm">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertCircle className="h-3 w-3 text-muted-foreground" />
                  Gated Tests (Skipped)
                </div>
                <ul className="space-y-2">
                  {technical.gatedTests.map((gt, i) => (
                    <li key={i} className="flex justify-between items-start gap-2" data-testid={`gated-test-${gt.testId}`}>
                      <span className="font-mono text-xs text-foreground/80">{gt.testId}</span>
                      <span className="font-mono text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm max-w-[150px] truncate" title={gt.reason}>
                        {gt.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Technical Findings List */}
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Detection Signals</h3>
            <Badge variant="outline" className="font-mono text-[9px] border-border" data-testid="badge-finding-count">
              {technical?.findings?.length || 0} Findings
            </Badge>
          </div>
          
          {!technical?.findings || technical.findings.length === 0 ? (
            <Card className="bg-background/20 border-dashed border-border/50 h-32 flex items-center justify-center">
              <span className="font-mono text-xs text-muted-foreground">
                {isLegacyTechnical
                  ? 'Technical forensics unavailable for this legacy run'
                  : 'No technical anomalies detected'}
              </span>
            </Card>
          ) : (
            <div className="space-y-3 overflow-y-auto pr-1 custom-scrollbar" style={{ maxHeight: 'calc(100vh - 350px)' }}>
              {technical.findings.map((finding) => (
                <FindingCard 
                  key={finding.findingId} 
                  finding={finding} 
                  onNavigateTxns={onNavigateTxns} 
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: AI Investigation Synthesis */}
      <div className="xl:col-span-7 flex flex-col gap-6">
        <Card className="bg-card border-border rounded-sm h-full flex flex-col cyber-panel relative">
          <CardHeader className="pb-3 border-b border-border/50 bg-background/30">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" />
                  AI Investigation Engine
                </CardTitle>
                <CardDescription className="font-mono text-xs mt-1">
                  Generative hypothesis synthesis & context reasoning
                </CardDescription>
              </div>
              
              {isAiLoading ? (
                <Badge variant="outline" className="font-mono text-[10px] border-primary/50 text-primary animate-pulse flex items-center gap-1.5" data-testid="badge-ai-status-running">
                  <BrainCircuit className="h-3 w-3" /> Processing...
                </Badge>
              ) : isAiFailed ? (
                <Badge variant="outline" className="font-mono text-[10px] border-destructive/50 text-destructive flex items-center gap-1.5" data-testid="badge-ai-status-failed">
                  <AlertTriangle className="h-3 w-3" /> Synthesis Failed
                </Badge>
              ) : ai ? (
                <Badge variant="outline" className={`font-mono text-[10px] flex items-center gap-1.5 ${
                  memoStageFailed
                    ? 'border-amber-500/50 text-amber-500'
                    : 'border-emerald-500/50 text-emerald-500'
                }`} data-testid="badge-ai-status-complete">
                  <CheckCircle2 className="h-3 w-3" /> Investigation Complete
                </Badge>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto p-0 custom-scrollbar">
            {isAiLoading ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-8">
                <div className="relative w-20 h-20 mb-6">
                  <div className="absolute inset-0 border border-primary/20 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                  <div className="absolute inset-2 border border-primary/40 rounded-full animate-[spin_3s_linear_infinite]" />
                  <div className="absolute inset-4 border border-primary/60 rounded-full animate-[spin_4s_linear_infinite_reverse]" />
                  <div className="absolute inset-0 flex items-center justify-center bg-background rounded-full z-10 shadow-[0_0_15px_rgba(var(--primary),0.2)]">
                    <BrainCircuit className="h-6 w-6 text-primary animate-pulse" />
                  </div>
                </div>
                <h3 className="text-sm font-mono uppercase tracking-widest text-primary mb-2">Generating Intelligence</h3>
                <p className="text-muted-foreground text-xs font-mono max-w-sm">
                  Agent is correlating technical findings, formulating hypotheses, and searching for adversarial counter-narratives...
                </p>
                {aiProgress ? (
                  <div className="w-full max-w-xs mt-6 space-y-1.5 text-left" data-testid="ai-stage-checklist">
                    {aiProgress.stages.map((s) => (
                      <div
                        key={s.stageId}
                        className={'flex items-center justify-between border rounded-sm px-3 py-2 bg-background/40 ' + (s.status === 'running' ? 'border-primary/40' : 'border-border/40')}
                        data-testid={'ai-stage-' + s.stageId}
                      >
                        <span className={'font-mono text-xs ' + (s.status === 'pending' ? 'text-muted-foreground' : 'text-foreground/90')}>{s.label}</span>
                        {s.status === 'complete' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : s.status === 'running' ? (
                          <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                        ) : s.status === 'failed' ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                        ) : (
                          <Circle className="h-3 w-3 text-muted-foreground/40" />
                        )}
                      </div>
                    ))}
                    {aiProgress.attempts > 1 && (
                      <p className="font-mono text-[10px] text-muted-foreground pt-1" data-testid="text-ai-attempts">
                        Attempt {aiProgress.attempts} - resumed from the last completed stage; finished stages are preserved.
                      </p>
                    )}
                  </div>
                ) : (
                  <Progress value={65} className="h-1 w-48 mt-6 bg-muted/50 [&>div]:bg-primary" />
                )}
              </div>
            ) : isAiFailed ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-8">
                <AlertTriangle className="h-12 w-12 text-destructive mb-4 opacity-80" />
                <h3 className="text-sm font-mono uppercase tracking-widest text-destructive mb-2">Generation Aborted</h3>
                <p className="text-muted-foreground text-xs font-mono max-w-sm bg-background/50 p-3 rounded-sm border border-border mt-2">
                  {run.aiError || 'The generative layer timed out or encountered an unexpected error.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 font-mono text-xs rounded-sm border-primary/40 text-primary hover:bg-primary/10"
                  onClick={() => retryAi.mutate({ runId: run.id })}
                  disabled={retryAi.isPending}
                  data-testid="btn-retry-ai"
                >
                  {retryAi.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                  Retry AI Analysis
                </Button>
                {aiProgress && aiProgress.stages.some((s) => s.status === 'complete') && (
                  <p className="font-mono text-[10px] text-muted-foreground mt-2" data-testid="text-retry-resume-note">
                    Completed stages are preserved; the retry resumes where the analysis stopped.
                  </p>
                )}
              </div>
            ) : ai ? (
              <div className="p-6 space-y-8">
                {memoStageFailed && (
                  <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-sm text-xs text-amber-500/90 font-mono flex items-center justify-between gap-3" data-testid="notice-memo-stage-failed">
                    <span>Investigation synthesis completed and is preserved. The later case-memo stage failed: {run.aiError || 'unknown error'}.</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 font-mono text-[10px] rounded-sm border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                      onClick={() => retryAi.mutate({ runId: run.id })}
                      disabled={retryAi.isPending}
                      data-testid="btn-retry-ai-memo"
                    >
                      {retryAi.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                      Retry
                    </Button>
                  </div>
                )}
                {/* Executive Assessment */}
                <div className="space-y-3">
                  <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Fingerprint className="h-3.5 w-3.5" /> Executive Assessment
                  </h3>
                  <div className="bg-background/40 border border-border/60 p-4 rounded-sm text-sm leading-relaxed text-foreground/90 font-mono shadow-inner">
                    {ai.executiveAssessment}
                  </div>
                </div>

                {/* Hypotheses Accordion */}
                {ai.hypotheses.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Target className="h-3.5 w-3.5" /> Evaluated Hypotheses
                    </h3>
                    
                    <Accordion type="multiple" defaultValue={ai.hypotheses.map(h => h.hypothesisId)} className="space-y-3">
                      {ai.hypotheses.map((hypothesis) => (
                        <AccordionItem 
                          key={hypothesis.hypothesisId} 
                          value={hypothesis.hypothesisId}
                          className="border border-border/50 bg-background/30 rounded-sm overflow-hidden data-[state=open]:border-primary/30 transition-colors"
                          data-testid={`accordion-hypothesis-${hypothesis.hypothesisId}`}
                        >
                          <AccordionTrigger className="px-4 py-3 hover:bg-muted/30 hover:no-underline [&[data-state=open]]:bg-background/50">
                            <div className="flex flex-1 items-center justify-between pr-4">
                              <div className="flex items-center gap-3">
                                <StatusBadge status={hypothesis.status} />
                                <span className="font-mono text-sm text-left">{hypothesis.title}</span>
                              </div>
                              <Badge variant="outline" className={`font-mono text-[9px] uppercase ${
                                hypothesis.priority === 'high' ? 'border-destructive text-destructive' :
                                hypothesis.priority === 'medium' ? 'border-amber-500 text-amber-500' :
                                'border-primary/50 text-primary'
                              }`}>
                                {hypothesis.priority} PRI
                              </Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-4 py-4 border-t border-border/30 bg-background/20 space-y-5">
                            {/* Rationale */}
                            <div>
                              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Rationale</div>
                              <p className="text-sm text-foreground/80 leading-relaxed">
                                {hypothesis.rationale}
                              </p>
                            </div>
                            
                            {/* Sourcing & Evidence */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Pro Evidence */}
                              {(hypothesis.supportingTxnIds.length > 0 || hypothesis.technicalFindingIds.length > 0) && (
                                <div className="bg-emerald-500/5 border border-emerald-500/20 p-3 rounded-sm">
                                  <div className="text-[10px] font-mono text-emerald-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Shield className="h-3 w-3" /> Supporting Evidence
                                  </div>
                                  <div className="space-y-2">
                                    {hypothesis.technicalFindingIds.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">
                                        {hypothesis.technicalFindingIds.map(fid => (
                                          <Badge key={fid} variant="outline" className="font-mono text-[9px] border-emerald-500/30 text-emerald-500 bg-emerald-500/10">
                                            {fid}
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                                    {hypothesis.supportingTxnIds.length > 0 && (
                                      <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="h-7 w-full text-xs font-mono rounded-sm border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500 mt-2"
                                        onClick={() => onNavigateTxns(hypothesis.supportingTxnIds)}
                                        data-testid={`btn-support-txns-${hypothesis.hypothesisId}`}
                                      >
                                        View {hypothesis.supportingTxnIds.length} Source Txns <ArrowRight className="h-3 w-3 ml-1" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Contra Evidence & Benign */}
                              {(hypothesis.contradictoryTxnIds.length > 0 || hypothesis.benignExplanations.length > 0) && (
                                <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-sm flex flex-col justify-between">
                                  <div>
                                    <div className="text-[10px] font-mono text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                      <Crosshair className="h-3 w-3" /> Contradictory Signals
                                    </div>
                                    {hypothesis.benignExplanations.length > 0 && (
                                      <ul className="list-disc pl-4 text-xs text-foreground/70 space-y-1 mb-2">
                                        {hypothesis.benignExplanations.map((exp, i) => (
                                          <li key={i}>{exp}</li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                  {hypothesis.contradictoryTxnIds.length > 0 && (
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      className="h-7 w-full text-xs font-mono rounded-sm border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500 mt-auto"
                                      onClick={() => onNavigateTxns(hypothesis.contradictoryTxnIds)}
                                      data-testid={`btn-contra-txns-${hypothesis.hypothesisId}`}
                                    >
                                      View {hypothesis.contradictoryTxnIds.length} Contra Txns <ArrowRight className="h-3 w-3 ml-1" />
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                            
                            {/* Unresolved */}
                            {hypothesis.unresolvedQuestions.length > 0 && (
                              <div className="border-t border-border/30 pt-4 mt-2">
                                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                  <Search className="h-3 w-3" /> Unresolved Questions
                                </div>
                                <ul className="space-y-1.5">
                                  {hypothesis.unresolvedQuestions.map((q, i) => (
                                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-2">
                                      <span className="text-primary mt-0.5 opacity-50">›</span>
                                      {q}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                )}

                {/* Actions & Limitations */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4">
                  {ai.recommendedActions.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Zap className="h-3.5 w-3.5" /> Recommended Actions
                      </h3>
                      <div className="space-y-3">
                        {ai.recommendedActions.map((action, i) => (
                          <div key={i} className="bg-background/30 border border-border/50 p-3 rounded-sm flex gap-3">
                            <div className="mt-0.5">
                              <Badge variant="outline" className={`font-mono text-[9px] uppercase px-1.5 py-0 min-w-[50px] justify-center ${
                                action.priority === 'high' ? 'border-destructive/50 text-destructive bg-destructive/10' :
                                action.priority === 'medium' ? 'border-amber-500/50 text-amber-500 bg-amber-500/10' :
                                'border-primary/50 text-primary bg-primary/10'
                              }`}>
                                {action.priority}
                              </Badge>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-foreground mb-1">{action.action}</div>
                              <div className="text-xs text-muted-foreground mb-2">{action.rationale}</div>
                              <div className="text-[10px] font-mono text-primary/70 bg-primary/5 px-2 py-1 rounded inline-block border border-primary/10">
                                <strong className="text-primary">Need:</strong> {action.evidenceNeeded}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {ai.limitations.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5" /> Limitations & Caveats
                      </h3>
                      <div className="bg-muted/30 border border-border/50 p-4 rounded-sm h-full">
                        <ul className="space-y-2">
                          {ai.limitations.map((limit, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                              <span className="text-muted-foreground/50 mt-0.5">—</span>
                              {limit}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="h-full min-h-[400px] flex items-center justify-center text-muted-foreground font-mono text-sm">
                No AI Investigation data available.
              </div>
            )}
          </CardContent>
        </Card>

        {recon && (
          <Card className="bg-card border-border rounded-sm cyber-panel" data-testid="card-disclosure-reconciliation">
            <CardHeader className="pb-3 border-b border-border/50 bg-background/30">
              <CardTitle className="text-base font-mono uppercase tracking-wider flex items-center gap-2">
                <Scale className="h-4 w-4 text-primary" />
                Declared Wealth Reconciliation
              </CardTitle>
              <CardDescription className="font-mono text-xs mt-1">
                Official self report cross-referenced against observed statement flows
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="bg-background/40 border border-border/60 p-4 rounded-sm text-sm leading-relaxed text-foreground/90 font-mono shadow-inner" data-testid="text-reconciliation-summary">
                {recon.summary}
              </div>
              {recon.findings.length > 0 && (
                <div className="space-y-3">
                  {recon.findings.map((f) => (
                    <div key={f.findingId} className="bg-background/40 border border-border/60 hover:border-primary/30 transition-colors p-3 rounded-sm" data-testid={'reconciliation-finding-' + f.findingId}>
                      <div className="flex justify-between items-start mb-1.5 gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={'font-mono text-[9px] uppercase px-1.5 py-0 ' + reconSeverityStyle(f.severity)}>
                            {f.severity}
                          </Badge>
                          <span className="font-mono text-[9px] text-muted-foreground uppercase">{f.findingId}</span>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase truncate max-w-[180px]" title={f.category.replace(/_/g, ' ')}>
                          {f.category.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="font-medium text-sm text-foreground/90 mb-1">{f.title}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{f.detail}</div>
                      {f.disclosureRefs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {f.disclosureRefs.map((ref) => (
                            <Badge key={ref} variant="outline" className="font-mono text-[9px] border-border/60 text-muted-foreground">
                              {ref}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {f.txnIds.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 h-7 w-full text-xs font-mono rounded-sm border-border hover:border-primary/50 hover:bg-primary/10 hover:text-primary transition-colors"
                          onClick={() => onNavigateTxns(f.txnIds)}
                          data-testid={'btn-reconciliation-txns-' + f.findingId}
                        >
                          View {f.txnIds.length} Txns <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Sub-components

function FindingCard({ finding, onNavigateTxns }: { finding: TechnicalFinding, onNavigateTxns: (ids: number[]) => void }) {
  const getSeverityStyle = (sev: string) => {
    switch (sev) {
      case 'critical': return 'border-destructive text-destructive bg-destructive/10';
      case 'high': return 'border-orange-500 text-orange-500 bg-orange-500/10';
      case 'medium': return 'border-amber-500 text-amber-500 bg-amber-500/10';
      default: return 'border-primary text-primary bg-primary/10';
    }
  };

  const getCategoryLabel = (cat: string) => {
    return cat.replace(/_/g, ' ').toUpperCase();
  };

  return (
    <div 
      className="bg-background/40 border border-border/60 hover:border-primary/30 transition-colors p-3 rounded-sm flex flex-col group relative overflow-hidden"
      data-testid={`technical-finding-${finding.findingId}`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`font-mono text-[9px] uppercase px-1.5 py-0 ${getSeverityStyle(finding.severity)}`}>
            {finding.severity}
          </Badge>
          <span className="font-mono text-[9px] text-muted-foreground uppercase">{finding.findingId}</span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[120px]" title={getCategoryLabel(finding.category)}>
          {getCategoryLabel(finding.category)}
        </div>
      </div>
      
      <div className="font-medium text-sm text-foreground/90 mb-1">{finding.title}</div>
      <div className="text-xs text-muted-foreground mb-3 leading-relaxed">{finding.summary}</div>
      
      <div className="mt-auto pt-3 border-t border-border/30 grid grid-cols-2 gap-2 text-[10px] font-mono relative">
        <div className="space-y-1">
          <div className="text-muted-foreground/70 uppercase">Value</div>
          <div className="text-foreground">{finding.metricValue !== null && finding.metricValue !== undefined ? finding.metricValue.toFixed(2) : '—'}</div>
        </div>
        <div className="space-y-1">
          <div className="text-muted-foreground/70 uppercase">Benchmark</div>
          <div className="text-foreground truncate" title={finding.benchmark}>{finding.benchmark || '—'}</div>
        </div>
        
        {/* Hover overlay for methodology */}
        {finding.methodology && (
          <div className="absolute inset-0 bg-background/95 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between px-1 pointer-events-none">
            <div className="flex-1 text-[9px] text-muted-foreground line-clamp-2 pr-2 leading-tight">
              <strong className="text-primary/70">Method:</strong> {finding.methodology}
            </div>
          </div>
        )}
      </div>

      {finding.caveat && (
        <div className="mt-2 bg-amber-500/5 border border-amber-500/20 p-1.5 rounded-sm flex gap-1.5 items-start">
          <Info className="h-3 w-3 text-amber-500/70 shrink-0 mt-0.5" />
          <span className="text-[9px] font-mono text-amber-500/80 leading-tight">{finding.caveat}</span>
        </div>
      )}

      {finding.txnIds && finding.txnIds.length > 0 && (
        <Button 
          variant="outline" 
          size="sm" 
          className="mt-3 h-7 w-full text-xs font-mono rounded-sm border-border hover:border-primary/50 hover:bg-primary/10 hover:text-primary transition-colors"
          onClick={() => onNavigateTxns(finding.txnIds)}
          data-testid={`btn-finding-txns-${finding.findingId}`}
        >
          View {finding.txnIds.length} Txns <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      )}
    </div>
  );
}

function reconSeverityStyle(sev: string) {
  switch (sev) {
    case 'significant': return 'border-destructive/50 text-destructive bg-destructive/10';
    case 'notable': return 'border-amber-500/50 text-amber-500 bg-amber-500/10';
    default: return 'border-primary/50 text-primary bg-primary/10';
  }
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'supported':
      return <Badge variant="outline" className="font-mono text-[9px] uppercase border-emerald-500/50 text-emerald-500 bg-emerald-500/10">Supported</Badge>;
    case 'plausible':
      return <Badge variant="outline" className="font-mono text-[9px] uppercase border-primary/50 text-primary bg-primary/10">Plausible</Badge>;
    case 'not_supported':
      return <Badge variant="outline" className="font-mono text-[9px] uppercase border-destructive/50 text-destructive bg-destructive/10">Refuted</Badge>;
    default:
      return <Badge variant="outline" className="font-mono text-[9px] uppercase border-muted-foreground text-muted-foreground bg-muted/30">Inconclusive</Badge>;
  }
}
