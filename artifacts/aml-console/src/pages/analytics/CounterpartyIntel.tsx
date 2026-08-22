import { useGetCounterpartyIntel, SharedCounterparty } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Share2, Loader2, UserSearch, Flag } from 'lucide-react';
import { Link } from 'wouter';

const KIND_LABEL: Record<string, string> = {
  name: 'NAME',
  account_ref: 'ACCOUNT REF',
  instapay_ref: 'INSTAPAY REF',
};

function fmtKwd(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

function ClusterRow({ cluster, index }: { cluster: SharedCounterparty; index: number }) {
  const isSubject = cluster.subjectOfCaseIds.length > 0;
  const flagged = cluster.cases.reduce((s, c) => s + c.flaggedCount, 0);
  return (
    <div
      className={`border rounded-sm p-4 ${isSubject ? 'border-red-500/40 bg-red-500/[0.04]' : 'border-border bg-card'}`}
      data-testid={`row-intel-${index}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium">{cluster.display}</span>
            <Badge variant="outline" className="font-mono text-[9px] uppercase text-muted-foreground">
              {KIND_LABEL[cluster.kind] ?? cluster.kind}
            </Badge>
            {isSubject && (
              <Badge variant="outline" className="font-mono text-[9px] uppercase bg-red-500/15 text-red-400 border-red-500/40">
                <UserSearch className="h-3 w-3 mr-1" />
                subject of {cluster.subjectOfCaseIds.map((id) => `CASE-${id}`).join(', ')}
              </Badge>
            )}
          </div>
          {isSubject && (
            <p className="text-[11px] text-red-400/90 font-mono mt-1">
              This party is itself under investigation and also moves funds in other subjects' statements.
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground shrink-0">
          <span>{cluster.caseCount} cases</span>
          <span>{cluster.totalTxns} txns</span>
          <span className="text-foreground">{fmtKwd(cluster.totalKwd)} KWD</span>
          {flagged > 0 && (
            <span className="text-amber-400 inline-flex items-center gap-1">
              <Flag className="h-3 w-3" /> {flagged}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {cluster.cases.map((c) => (
          <Link key={c.caseId} href={`/cases/${c.caseId}`}>
            <div
              className="border border-border rounded-sm px-3 py-1.5 bg-background/50 hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
              data-testid={`chip-intel-case-${c.caseId}`}
            >
              <span className="font-mono text-[11px] text-primary">CASE-{c.caseId}</span>
              <span className="text-[11px] text-muted-foreground ml-2">{c.subjectName}</span>
              <span className="font-mono text-[10px] text-muted-foreground ml-2">
                {c.txnCount} txns - in {fmtKwd(c.inflowKwd)} / out {fmtKwd(c.outflowKwd)} KWD
                {c.flaggedCount > 0 && <span className="text-amber-400"> - {c.flaggedCount} flagged</span>}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function CounterpartyIntelPage() {
  const { data, isLoading } = useGetCounterpartyIntel();
  const subjectHits = data?.clusters.filter((c) => c.subjectOfCaseIds.length > 0).length ?? 0;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Share2 className="h-6 w-6 text-primary" /> Counterparty Intel
        </h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          The same real-world party appearing across multiple cases. Clustering uses the engine's
          conservative identity resolution - masked references only merge on literal equality.
        </p>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs p-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Correlating counterparties across cases...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Cases covered', value: String(data.casesCovered) },
              { label: 'External txns scanned', value: data.txnsScanned.toLocaleString() },
              { label: 'Shared counterparties', value: String(data.sharedCount) },
              { label: 'Subjects seen elsewhere', value: String(subjectHits) },
            ].map((s) => (
              <div key={s.label} className="border border-border rounded-sm p-4 bg-card">
                <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{s.label}</div>
                <div className="text-2xl font-bold font-mono">{s.value}</div>
              </div>
            ))}
          </div>

          <Card className="bg-card border-border rounded-sm" data-testid="panel-counterparty-intel">
            <CardHeader>
              <CardTitle className="text-base font-mono uppercase tracking-wider">Shared across cases</CardTitle>
              <CardDescription className="text-xs font-mono">
                Sorted by subject-overlap first, then case reach and volume. Click a case chip to open it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.clusters.length === 0 ? (
                <p className="text-xs font-mono text-muted-foreground py-6 text-center">
                  No counterparties shared across cases yet. This view populates as more cases are ingested.
                </p>
              ) : (
                data.clusters.map((c, i) => <ClusterRow key={c.key} cluster={c} index={i} />)
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
