import { useLocation, useParams } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import CaseNetworkGraph from './components/CaseNetworkGraph';

/**
 * Full-screen transaction network map for a case: every subject bank
 * account, every resolved counterparty, and the money moving between
 * them as a live force-directed constellation.
 */
export default function CaseNetwork() {
  const params = useParams();
  const caseId = Number(params.id);
  const [, setLocation] = useLocation();

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLocation(`/cases/${caseId}`)}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            data-testid="button-back-to-case"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Case {Number.isFinite(caseId) ? caseId : ''}
          </button>
          <div>
            <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-primary">
              Transaction Network
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              All banks {'\u00B7'} flow relationship map {'\u00B7'} particles travel in the direction money moved
            </p>
          </div>
        </div>
      </div>

      <CaseNetworkGraph caseId={caseId} height="calc(100vh - 190px)" />
    </div>
  );
}
