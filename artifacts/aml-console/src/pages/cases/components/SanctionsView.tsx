import {
  AnalysisRun,
  SanctionsScreening,
  SanctionsMatch,
  SanctionsScreenedName,
  SanctionsListMeta,
  useGetSanctionsStatus,
  useTriggerSanctionsRescreen,
  getGetSanctionsStatusQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShieldAlert, ShieldCheck, ShieldX, Globe, RefreshCw, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

const TIER_BADGE: Record<string, string> = {
  exact: 'bg-red-500/15 text-red-400 border-red-500/40',
  strong: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
  possible: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
};

const LIST_LABEL: Record<string, string> = {
  ofac_sdn: 'OFAC SDN',
  un_consolidated: 'UN CONSOLIDATED',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : format(d, 'dd MMM yyyy HH:mm');
}

function agoLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'unknown';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function SanctionsFreshnessCard({ onRescreened }: { onRescreened?: () => void }) {
  // Waiting-for-sweep marker. Sweeps can finish faster than one poll cycle,
  // so completion is detected by lastCheckAt moving past the kick time with
  // sweeping off - never by waiting to observe the transient sweeping=true.
  const [kickedAt, setKickedAt] = useState<number | null>(null);
  const joinedRunningSweep = useRef(false);
  const { data: status, dataUpdatedAt } = useGetSanctionsStatus({
    query: {
      queryKey: getGetSanctionsStatusQueryKey(),
      refetchInterval: kickedAt != null ? 1500 : 60_000,
    },
  });
  const rescreen = useTriggerSanctionsRescreen({
    mutation: {
      onSuccess: (ack) => {
        // A sweep that was already in flight started before our click, so
        // its lastCheckAt predates the watermark - complete on any fresh
        // poll that shows it finished instead.
        joinedRunningSweep.current = ack.alreadyRunning;
        setKickedAt(Date.now());
      },
      onError: () => toast.error('Could not start the re-screen sweep.'),
    },
  });

  const sweeping = status?.scheduler.sweeping ?? false;
  const scheduler = status?.scheduler;
  useEffect(() => {
    if (kickedAt == null || !scheduler) return;
    if (dataUpdatedAt < kickedAt) return; // cached emission from before the click
    if (scheduler.sweeping) return;
    const last = scheduler.lastCheckAt ? new Date(scheduler.lastCheckAt).getTime() : 0;
    // 30s slack absorbs client/server clock drift.
    if (!joinedRunningSweep.current && last < kickedAt - 30_000) return;
    setKickedAt(null);
    joinedRunningSweep.current = false;
    if (scheduler.lastResult === 'rescreened') {
      const n = scheduler.casesRescreened;
      toast.success(`Re-screened ${n} case${n === 1 ? '' : 's'} against current lists`, { duration: 8000 });
    } else if (scheduler.lastResult === 'up_to_date') {
      toast.success('All screenings already match the current lists', { duration: 8000 });
    } else {
      toast.error(scheduler.lastError ?? 'Freshness check could not complete', { duration: 8000 });
    }
    onRescreened?.();
  }, [scheduler, dataUpdatedAt, kickedAt, onRescreened]);

  const busy = rescreen.isPending || sweeping || kickedAt != null;

  const lists = status?.lists;
  const sch = status?.scheduler;
  const resultLabel = !sch
    ? ''
    : sch.lastResult === 'idle'
      ? 'first check pending'
      : sch.lastResult === 'up_to_date'
        ? 'all screenings current'
        : sch.lastResult === 'rescreened'
          ? `re-screened ${sch.casesRescreened} case${sch.casesRescreened === 1 ? '' : 's'}`
          : sch.lastResult === 'lists_unavailable'
            ? 'lists unavailable at last check'
            : 'check failed';

  return (
    <Card className="rounded-sm border-primary/25 bg-primary/[0.03]" data-testid="panel-sanctions-freshness">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            List freshness and auto re-screen
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-sm font-mono text-[10px] uppercase tracking-wider"
            disabled={busy}
            onClick={() => rescreen.mutate()}
            data-testid="button-rescreen-now"
          >
            {busy ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Re-screening...
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3 mr-1.5" /> Check and re-screen now
              </>
            )}
          </Button>
        </div>
        {!status ? (
          <p className="text-xs font-mono text-muted-foreground">Loading list status...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {lists && lists.state === 'ready' ? (
                lists.lists.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-2 border border-border rounded-sm px-3 py-2 bg-background/40"
                    data-testid={'row-freshness-' + l.id}
                  >
                    <span className="font-mono text-[11px] uppercase truncate">{LIST_LABEL[l.id] ?? l.id}</span>
                    <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                      {l.entryCount.toLocaleString()} entries - {agoLabel(l.fetchedAt)}
                      {l.stale && <span className="text-amber-400 ml-1.5">STALE COPY</span>}
                    </span>
                  </div>
                ))
              ) : lists?.state === 'loading' ? (
                <p className="text-xs font-mono text-muted-foreground md:col-span-2">
                  Downloading list updates in the background...
                </p>
              ) : (
                <p className="text-xs font-mono text-red-400 md:col-span-2">
                  List refresh failing: {lists?.error ?? 'unknown error'}
                </p>
              )}
            </div>
            {sch && (
              <p className="text-[11px] font-mono text-muted-foreground" data-testid="text-scheduler-status">
                Auto check every {sch.intervalHours} h - last check {agoLabel(sch.lastCheckAt)} - {resultLabel}
                {sch.lastResult === 'error' && sch.lastError ? ` (${sch.lastError.slice(0, 120)})` : ''}
              </p>
            )}
            {sch && sch.lastChanges.length > 0 && (
              <div className="border border-amber-500/40 bg-amber-500/5 rounded-sm px-3 py-2">
                <p className="text-[11px] font-mono text-amber-400 uppercase tracking-wider mb-1">
                  Match totals changed on last sweep
                </p>
                {sch.lastChanges.map((c, i) => (
                  <p key={i} className="text-[11px] font-mono text-muted-foreground">
                    CASE-{c.caseId} RUN-{c.runId}:{' '}
                    {c.before ? `${c.before.exact}/${c.before.strong}/${c.before.possible}` : 'unscreened'} to{' '}
                    {c.after.exact}/{c.after.strong}/{c.after.possible} (exact/strong/possible)
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SanctionsView({ run, onRescreened }: { run: AnalysisRun; onRescreened?: () => void }) {
  const screening = (run.sanctionsScreening ?? null) as SanctionsScreening | null;

  if (!screening) {
    return (
      <div className="space-y-4">
        <SanctionsFreshnessCard onRescreened={onRescreened} />
        <Card className="rounded-sm border-border bg-muted/20">
        <CardContent className="p-10 text-center">
          <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground opacity-60 mb-4" />
          <div className="font-mono text-sm uppercase tracking-widest mb-2">Not Screened</div>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto" data-testid="text-sanctions-legacy">
            This analysis predates the sanctions screening layer. Re-run the analysis to screen the
            subject and all named counterparties against the OFAC SDN and UN Security Council
            Consolidated lists.
          </p>
        </CardContent>
        </Card>
      </div>
    );
  }

  if (screening.status === 'unavailable') {
    return (
      <div className="space-y-4">
        <SanctionsFreshnessCard onRescreened={onRescreened} />
        <Card className="rounded-sm border-red-500/40 bg-red-500/5">
        <CardContent className="p-8">
          <div className="flex items-start gap-4">
            <ShieldX className="h-8 w-8 text-red-400 shrink-0 mt-1" />
            <div>
              <div className="font-mono text-sm uppercase tracking-widest text-red-400 mb-2" data-testid="text-sanctions-unavailable">
                Screening Unavailable - Not Performed
              </div>
              <p className="text-sm text-muted-foreground mb-3">{screening.reason}</p>
              <p className="text-xs font-mono uppercase tracking-wider text-red-400/80">
                Do not interpret this as a clean result. Re-run the analysis once list sources are
                reachable.
              </p>
            </div>
          </div>
        </CardContent>
        </Card>
      </div>
    );
  }

  const totalMatches = screening.totals.exact + screening.totals.strong + screening.totals.possible;
  const clean = totalMatches === 0;

  return (
    <div className="space-y-4">
      <SanctionsFreshnessCard onRescreened={onRescreened} />
      {/* Verdict banner */}
      {clean ? (
        <Card className="rounded-sm border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="p-6 flex items-start gap-4">
            <ShieldCheck className="h-8 w-8 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <div className="font-mono text-sm uppercase tracking-widest text-emerald-400 mb-1" data-testid="text-sanctions-clean">
                No Sanctions Matches
              </div>
              <p className="text-sm text-muted-foreground">
                {screening.namesScreened} names (subject and named counterparties) screened - no
                exact, strong, or possible matches on either list. Screening covers named parties
                visible in the statements; masked account references cannot be screened.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-sm border-red-500/40 bg-red-500/5">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <ShieldAlert className="h-8 w-8 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-mono text-sm uppercase tracking-widest text-red-400 mb-2" data-testid="text-sanctions-matches">
                  Potential Sanctions Exposure - Analyst Review Required
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {screening.totals.exact > 0 && (
                    <Badge variant="outline" className={TIER_BADGE['exact'] + ' font-mono text-[10px] uppercase'}>
                      {screening.totals.exact} exact
                    </Badge>
                  )}
                  {screening.totals.strong > 0 && (
                    <Badge variant="outline" className={TIER_BADGE['strong'] + ' font-mono text-[10px] uppercase'}>
                      {screening.totals.strong} strong
                    </Badge>
                  )}
                  {screening.totals.possible > 0 && (
                    <Badge variant="outline" className={TIER_BADGE['possible'] + ' font-mono text-[10px] uppercase'}>
                      {screening.totals.possible} possible
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Name similarity is evidence, not identification. Verify identifiers (DOB,
                  nationality, documents) before acting. Matching never alters the suspicion score.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List provenance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {screening.lists.map((list: SanctionsListMeta) => (
          <Card key={list.id} className="rounded-sm border-border" data-testid={'card-list-' + list.id}>
            <CardContent className="p-4 flex items-center gap-3">
              <Globe className="h-5 w-5 text-primary/70 shrink-0" />
              <div className="min-w-0">
                <div className="font-mono text-xs uppercase tracking-wider truncate">{list.label}</div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  {list.entryCount.toLocaleString()} entries - retrieved {fmtDate(list.fetchedAt)}
                  {list.stale && (
                    <Badge variant="outline" className="ml-2 bg-amber-500/15 text-amber-400 border-amber-500/40 text-[9px] font-mono uppercase">
                      stale copy
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Subject result */}
      <Card className="rounded-sm border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-mono uppercase tracking-wider">
            Subject: {screening.subject.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {screening.subject.matches.length === 0 ? (
            <p className="text-sm text-muted-foreground font-mono" data-testid="text-subject-clean">
              No matches on either list.
            </p>
          ) : (
            screening.subject.matches.map((m, i) => <MatchCard key={i} match={m} />)
          )}
        </CardContent>
      </Card>

      {/* Counterparty results */}
      {screening.counterpartyMatches.length > 0 && (
        <Card className="rounded-sm border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-mono uppercase tracking-wider">
              Counterparty Matches ({screening.counterpartyMatches.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {screening.counterpartyMatches.map((c: SanctionsScreenedName, i: number) => (
              <div key={i} className="border border-border rounded-sm p-4" data-testid={'row-counterparty-' + i}>
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <span className="font-mono text-sm">{c.name}</span>
                  {c.txnCount != null && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {c.txnCount} txns
                    </Badge>
                  )}
                </div>
                <div className="space-y-2">
                  {c.matches.map((m, j) => <MatchCard key={j} match={m} />)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground font-mono">
        Screened {fmtDate(screening.screenedAt)} - engine {screening.engineVersion}. Tiers: EXACT =
        identical canonical name; STRONG = mutual token coverage (same person test); POSSIBLE = two
        or more shared substantive name parts.
      </p>
    </div>
  );
}

function MatchCard({ match }: { match: SanctionsMatch }) {
  return (
    <div className="bg-muted/30 border border-border rounded-sm p-3">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
        <span className="text-sm font-medium">{match.listedName}</span>
        <div className="flex gap-1.5 shrink-0">
          <Badge variant="outline" className={(TIER_BADGE[match.tier] ?? '') + ' font-mono text-[10px] uppercase'}>
            {match.tier}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px] uppercase text-muted-foreground">
            {LIST_LABEL[match.listId] ?? match.listId}
          </Badge>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground font-mono space-x-2">
        <span>{match.entryId}</span>
        <span>type: {match.entryType}</span>
        {match.programs.length > 0 && <span>programs: {match.programs.join(', ')}</span>}
        {match.listedOn && <span>listed: {match.listedOn}</span>}
      </div>
      {match.matchedAlias && (
        <div className="text-[11px] text-amber-400/90 font-mono mt-1">
          matched via listed alias: {match.matchedAlias}
        </div>
      )}
      {match.remarks && (
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{match.remarks}</p>
      )}
    </div>
  );
}
