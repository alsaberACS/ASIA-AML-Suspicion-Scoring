import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import {
  getListDeclarationIntakesQueryKey,
  useDiscardDeclarationIntake,
  useListDeclarationIntakes,
  useStartDeclarationIntake,
  type DeclarationIntake,
} from '@workspace/api-client-react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  ScanText,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function apiErrorText(err: unknown): string {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  if (data && typeof data.error === 'string') return data.error;
  return err instanceof Error ? err.message : 'Unknown error';
}

const PHASE_LABEL: Record<string, string> = {
  reading_primary: 'Reading the handwriting',
  reading_secondary: 'Second reader checking',
  adjudicating: 'Reconciling the two readings',
  locating: 'Pinning values to the ink',
};

function statusBadge(item: DeclarationIntake) {
  if (item.status === 'processing') {
    return (
      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-400 border-amber-500/30">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        {PHASE_LABEL[item.phase ?? ''] ?? 'AI reading'}
      </Badge>
    );
  }
  if (item.status === 'failed') {
    return (
      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider bg-destructive/15 text-destructive border-destructive/30">
        <AlertTriangle className="h-3 w-3 mr-1" /> Reading failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider bg-primary/15 text-primary border-primary/30">
      <CheckCircle2 className="h-3 w-3 mr-1" /> Ready for review
    </Badge>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function DeclarationIntakePage() {
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<DeclarationIntake | null>(null);

  const { data: intakes = [], isLoading, refetch } = useListDeclarationIntakes({
    query: {
      queryKey: getListDeclarationIntakesQueryKey(),
      refetchInterval: query => (query.state.data?.some(i => i.status === 'processing') ? 3000 : false),
    },
  });
  const start = useStartDeclarationIntake();
  const discard = useDiscardDeclarationIntake();

  const upload = (file: File) => {
    if (start.isPending) {
      toast.info('Still uploading the previous declaration - one moment');
      return;
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast.error('Upload the scanned declaration as a PDF file');
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      const dataUrl = event.target?.result as string;
      const contentBase64 = dataUrl.split(',')[1];
      start.mutate(
        { data: { filename: file.name, contentBase64 } },
        {
          onSuccess: created => {
            toast.success('Declaration uploaded - the AI is reading the handwriting');
            refetch();
            setLocation(`/register/${created.caseId}`);
          },
          onError: err => toast.error(`Could not upload ${file.name}: ${apiErrorText(err)}`),
        },
      );
    };
    reader.readAsDataURL(file);
  };

  const confirmDiscard = () => {
    const target = discardTarget;
    if (!target) return;
    setDiscardTarget(null);
    discard.mutate(
      { caseId: target.caseId },
      {
        onSuccess: () => {
          toast.success('Pending declaration discarded');
          refetch();
        },
        onError: err => toast.error(`Could not discard: ${apiErrorText(err)}`),
      },
    );
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-8" data-testid="page-declaration-intake">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-primary mb-2">
            <ScanText className="h-3.5 w-3.5" /> Case registration
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Register from Declaration</h1>
          <p className="font-arabic text-base text-muted-foreground mt-1" dir="rtl">
            تسجيل حالة جديدة من إقرار الذمة المالية المكتوب بخط اليد
          </p>
        </div>
        <p className="text-sm text-muted-foreground max-w-md">
          Upload the scanned Nazaha declaration. Two AI readers transcribe the handwritten Arabic, you check it
          against the ink, and the confirmed data becomes a new case and a searchable declaration record.
        </p>
      </header>

      <section
        className={`relative border-2 border-dashed rounded-sm p-10 text-center transition-colors cursor-pointer ${
          dragging ? 'border-primary bg-primary/10' : 'border-border bg-card/40 hover:border-primary/60 hover:bg-card'
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        data-testid="dropzone-declaration"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = '';
          }}
          data-testid="input-declaration-pdf"
        />
        <div className="absolute top-0 left-0 w-1 h-full bg-primary/60" />
        {start.isPending ? (
          <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin mb-4" />
        ) : (
          <UploadCloud className="h-10 w-10 mx-auto text-primary mb-4" />
        )}
        <div className="font-mono text-sm uppercase tracking-widest text-foreground">
          {start.isPending ? 'Uploading…' : 'Drop the declaration PDF here or click to choose'}
        </div>
        <div className="font-arabic text-sm text-muted-foreground mt-2" dir="rtl">
          أسقط ملف الإقرار (PDF) هنا أو اضغط للاختيار
        </div>
        <div className="font-mono text-[10px] text-muted-foreground mt-4 uppercase tracking-wider">
          Scanned PDF · up to 20 MB · handwriting is read by AI, nothing is typed by hand
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { n: '01', t: 'Upload', d: 'The 13-page declaration is stored with the case and sent to the readers.' },
          { n: '02', t: 'AI reads the handwriting', d: 'Two independent readers transcribe every box; disagreements are flagged for you.' },
          { n: '03', t: 'Verify and register', d: 'Correct anything wrong against the original page, then confirm to open the case.' },
        ].map(step => (
          <div key={step.n} className="bg-card border border-border rounded-sm p-4">
            <div className="font-mono text-[10px] text-primary tracking-widest mb-1">{step.n}</div>
            <div className="text-sm font-medium">{step.t}</div>
            <div className="text-xs text-muted-foreground mt-1">{step.d}</div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Pending declarations <span className="text-foreground">({intakes.length})</span>
          </h2>
        </div>
        {isLoading ? (
          <div className="font-mono text-xs text-muted-foreground animate-pulse">Loading…</div>
        ) : intakes.length === 0 ? (
          <div className="border border-border rounded-sm p-8 text-center text-sm text-muted-foreground bg-card/30" data-testid="empty-intakes">
            No declarations waiting for review. Upload one above to start.
          </div>
        ) : (
          <div className="border border-border rounded-sm divide-y divide-border bg-card/40">
            {intakes.map(item => (
              <div
                key={item.caseId}
                className="flex flex-wrap items-center gap-4 px-4 py-3"
                data-testid={`row-intake-${item.caseId}`}
              >
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">#{item.caseId}</span>
                    <span className="text-sm font-medium truncate" dir="auto">
                      {item.filename}
                    </span>
                    {statusBadge(item)}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span className="font-mono">{formatWhen(item.uploadedAt)}</span>
                    <span className="font-mono">{(item.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                    {item.declarantName && (
                      <span className="font-arabic text-sm text-foreground" dir="rtl">
                        {item.declarantName}
                      </span>
                    )}
                    {item.civilId && <span className="font-mono">{item.civilId}</span>}
                  </div>
                  {item.status === 'failed' && item.error && (
                    <div className="text-xs text-destructive mt-1">{item.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="h-8 font-mono text-xs"
                    onClick={() => setLocation(`/register/${item.caseId}`)}
                    data-testid={`btn-review-${item.caseId}`}
                  >
                    {item.status === 'ready' ? 'Review' : 'Open'} <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setDiscardTarget(item)}
                    title="Discard this pending declaration"
                    data-testid={`btn-discard-${item.caseId}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <AlertDialog open={discardTarget !== null} onOpenChange={open => !open && setDiscardTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this declaration?</AlertDialogTitle>
            <AlertDialogDescription>
              The uploaded PDF and its AI reading for {discardTarget?.filename} will be deleted. No case is created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
