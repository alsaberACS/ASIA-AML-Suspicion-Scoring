import { useGetDashboardSummary, useSeedDemoCase, RunSummary } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity,
  Briefcase,
  AlertTriangle,
  FileSpreadsheet,
  ArrowRight,
  DatabaseZap,
  DollarSign
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function Dashboard() {
  const { data: summary, isLoading, error } = useGetDashboardSummary();
  const seedDemoCase = useSeedDemoCase();
  const [, setLocation] = useLocation();

  const handleSeedDemo = () => {
    toast.info('Parsing bank statements and building demo case...', {
      description: 'This usually takes 10-30 seconds.'
    });
    
    seedDemoCase.mutate(undefined, {
      onSuccess: (caseData) => {
        toast.success('Demo case loaded successfully');
        setLocation(`/cases/${caseData.id}`);
      },
      onError: (err) => {
        toast.error('Failed to load demo case: ' + (err as any)?.message);
      }
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="col-span-2 h-96" />
          <Skeleton className="col-span-1 h-96" />
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center text-muted-foreground">
          <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h2 className="text-lg font-medium text-foreground mb-2">Error loading dashboard</h2>
          <p>The analytics service is currently unavailable.</p>
        </div>
      </div>
    );
  }

  // Empty state logic
  if (summary.totalCases === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-background to-background">
        <div className="max-w-md w-full text-center space-y-6 cyber-panel p-10 rounded-lg relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />
          
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 mb-6">
            <DatabaseZap className="h-8 w-8 text-primary" />
          </div>
          
          <h1 className="text-2xl font-bold tracking-tight">System Initialized</h1>
          <p className="text-muted-foreground text-sm">
            The ASIA AML Suspicion Scoring pipeline is ready. 
            There are currently no active cases or ingested datasets in the registry.
          </p>
          
          <div className="pt-4 space-y-3">
            <Button 
              className="w-full font-mono uppercase tracking-wider" 
              onClick={handleSeedDemo}
              disabled={seedDemoCase.isPending}
            >
              {seedDemoCase.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-background/20 border-t-background rounded-full animate-spin" />
                  Processing Multi-Bank Ingestion...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Load Demonstration Case <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Injects 5 standard format variations with complex structuring patterns.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const formatKwd = (val: number) => {
    if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    return val.toFixed(0);
  };

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

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            System overview and active threat detection metrics
          </p>
        </div>
        <Button variant="outline" className="font-mono text-xs rounded-sm border-primary/30 text-primary hover:bg-primary/10" onClick={handleSeedDemo} disabled={seedDemoCase.isPending}>
          <DatabaseZap className="h-3 w-3 mr-2" />
          Inject Test Data
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border rounded-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Subjects</CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{summary.totalCases}</div>
          </CardContent>
        </Card>
        
        <Card className="bg-card border-border rounded-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ingested Volumes</CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{summary.totalFiles}</div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">FILES PARSED</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border rounded-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Transactions</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              {(summary.totalTransactions / 1000).toFixed(1)}k
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">RECORDS ANALYZED</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border rounded-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              <span className="text-lg text-muted-foreground mr-1">KWD</span>
              {formatKwd(summary.totalValueKwd)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">GROSS THROUGHPUT</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-1 bg-card border-border rounded-sm flex flex-col">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider font-mono text-muted-foreground">Risk Distribution</CardTitle>
            <CardDescription>Pipeline output banding across active cases</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="space-y-4">
              {['Critical', 'High', 'Elevated', 'Moderate', 'Low'].map(bandName => {
                const b = summary.bandCounts.find(b => b.band === bandName);
                const count = b ? b.count : 0;
                const totalScored = Math.max(1, summary.bandCounts.reduce((acc, curr) => acc + curr.count, 0));
                const pct = (count / totalScored) * 100;
                
                return (
                  <div key={bandName} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm font-mono">
                      <span className={getBandColor(bandName).split(' ')[0]}>{bandName}</span>
                      <span className="text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${getBandColor(bandName).split(' ')[2].replace('/10', '')}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2 bg-card border-border rounded-sm">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider font-mono text-muted-foreground">Recent Analysis Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.recentRuns.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center font-mono">No recent analysis runs.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left font-mono text-muted-foreground">
                      <th className="pb-3 font-medium">Subject</th>
                      <th className="pb-3 font-medium text-right">Probability</th>
                      <th className="pb-3 font-medium">Risk Band</th>
                      <th className="pb-3 font-medium">Analyzed</th>
                      <th className="pb-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {summary.recentRuns.map((run: RunSummary) => (
                      <tr key={run.runId} className="group hover:bg-muted/30 transition-colors">
                        <td className="py-3 font-medium">{run.subjectName}</td>
                        <td className="py-3 text-right font-mono text-primary">{(run.probability * 100).toFixed(1)}%</td>
                        <td className="py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-mono border ${getBandColor(run.band)}`}>
                            {run.band}
                          </span>
                        </td>
                        <td className="py-3 text-muted-foreground font-mono text-xs">
                          {format(new Date(run.createdAt), 'dd MMM yyyy HH:mm')}
                        </td>
                        <td className="py-3 text-right">
                          <Link href={`/cases/${run.caseId}`}>
                            <Button variant="ghost" size="sm" className="h-8 text-xs font-mono rounded hover:text-primary">
                              Review <ArrowRight className="ml-1 h-3 w-3" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}