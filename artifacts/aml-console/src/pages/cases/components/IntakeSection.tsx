import { useState, useRef, useEffect } from 'react';
import {
  useListCaseFiles,
  useUploadCaseFile,
  useDeleteCaseFile,
  useAnalyzeCase,
  useGetCaseDisclosure,
  useUploadCaseDisclosure,
  useDeleteCaseDisclosure,
  getGetCaseDisclosureQueryKey,
  Case,
  Disclosure,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  FileSpreadsheet,
  FileText,
  Upload,
  Trash2,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  DatabaseZap,
  Activity,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function IntakeSection({
  caseId,
  caseData,
  refetchCase,
}: {
  caseId: number;
  caseData: Case;
  refetchCase: () => void;
}) {
  const {
    data: files,
    isLoading,
    refetch: refetchFiles,
  } = useListCaseFiles(caseId);
  const uploadFile = useUploadCaseFile();
  const deleteFile = useDeleteCaseFile();
  const analyzeCase = useAnalyzeCase();
  const queryClient = useQueryClient();
  // Self report (financial disclosure): one PDF per case. While the AI is
  // reading it (status "processing") the query polls so the card flips to
  // "ready" on its own.
  const { data: disclosure, refetch: refetchDisclosure } = useGetCaseDisclosure(
    caseId,
    {
      query: {
        queryKey: getGetCaseDisclosureQueryKey(caseId),
        retry: false,
        refetchInterval: (query) =>
          query.state.data?.status === 'processing' ? 4000 : false,
      },
    },
  );
  const uploadDisclosure = useUploadCaseDisclosure();
  const deleteDisclosure = useDeleteCaseDisclosure();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disclosureInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  const resetDragState = () => {
    dragDepth.current = 0;
    setIsDragging(false);
  };

  // While the intake panel is mounted:
  // - stop the browser from navigating away when a file is dropped outside
  //   the dropzone (default behavior opens the file and loses the SPA state);
  // - reset drag state on terminal events that may never reach the zone's own
  //   handlers (drop elsewhere, dragend, Escape-cancel / leaving the window),
  //   so the overlay can never get stuck visible.
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    const endDrag = (e: DragEvent) => {
      e.preventDefault();
      resetDragState();
    };
    const onWindowDragLeave = (e: DragEvent) => {
      // relatedTarget is null when the drag left the window or was cancelled.
      if (e.relatedTarget === null) resetDragState();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', endDrag);
    window.addEventListener('dragend', endDrag);
    window.addEventListener('dragleave', onWindowDragLeave);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', endDrag);
      window.removeEventListener('dragend', endDrag);
      window.removeEventListener('dragleave', onWindowDragLeave);
      resetDragState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingestDisclosure = (file: File) => {
    if (uploadDisclosure.isPending) {
      toast.info('Still uploading the previous self report — try again in a moment');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      const contentBase64 = base64.split(',')[1];
      toast.info(`Uploading ${file.name}...`);
      uploadDisclosure.mutate(
        { caseId, data: { filename: file.name, contentBase64 } },
        {
          onSuccess: () => {
            toast.success(
              'Self report uploaded — AI is now reading the handwritten form',
            );
            refetchDisclosure();
          },
          onError: (err: any) => {
            toast.error(
              `Failed to upload ${file.name}: ${err.message || 'Unknown error'}`,
            );
          },
        },
      );
    };
    reader.readAsDataURL(file);
  };

  const handleDisclosureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) ingestDisclosure(file);
    if (disclosureInputRef.current) {
      disclosureInputRef.current.value = '';
    }
  };

  const handleDeleteDisclosure = () => {
    if (!disclosure) return;
    if (
      confirm(
        `Remove the self report ${disclosure.filename}? Its extracted declaration will be deleted too.`,
      )
    ) {
      deleteDisclosure.mutate(
        { caseId },
        {
          onSuccess: () => {
            toast.success('Self report removed');
            queryClient.removeQueries({
              queryKey: getGetCaseDisclosureQueryKey(caseId),
            });
          },
          onError: (err: any) => {
            toast.error(
              `Failed to remove the self report: ${err.message || 'Unknown error'}`,
            );
          },
        },
      );
    }
  };

  const ingestFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    // PDFs are self reports (financial disclosure), everything else goes to
    // the statement parser.
    const pdfs = incoming.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    const statements = incoming.filter(
      (f) => !f.name.toLowerCase().endsWith('.pdf'),
    );
    if (pdfs.length > 0) {
      ingestDisclosure(pdfs[0]);
      if (pdfs.length > 1) {
        toast.warning('Only one self report per case — using the first PDF');
      }
    }
    if (statements.length === 0) return;
    if (uploadFile.isPending) {
      toast.info(
        'Still parsing the previous upload — drop the files again in a moment',
      );
      return;
    }
    const supported = ['csv', 'xlsx', 'xls'];
    const accepted = statements.filter((f) =>
      supported.includes(f.name.split('.').pop()?.toLowerCase() ?? ''),
    );
    const skipped = statements.length - accepted.length;
    if (skipped > 0) {
      toast.warning(
        `${skipped} file${skipped > 1 ? 's' : ''} skipped — statements must be CSV, XLSX or XLS; the self report must be a PDF`,
      );
    }

    accepted.forEach((file) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        // strip data prefix
        const contentBase64 = base64.split(',')[1];

        toast.info(`Parsing ${file.name}...`);

        uploadFile.mutate(
          { caseId, data: { filename: file.name, contentBase64 } },
          {
            onSuccess: () => {
              toast.success(`${file.name} uploaded and parsed successfully`);
              refetchFiles();
              refetchCase();
            },
            onError: (err: any) => {
              toast.error(
                `Failed to upload ${file.name}: ${err.message || 'Unknown error'}`,
              );
            },
          },
        );
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    ingestFiles(Array.from(e.target.files ?? []));
    // reset input so the same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Drag & drop: depth counter avoids overlay flicker when dragging across children.
  const dragHasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files');

  const handleDragEnter = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    resetDragState();
    ingestFiles(Array.from(e.dataTransfer.files));
  };

  const handleDelete = (fileId: number, filename: string) => {
    if (
      confirm(
        `Are you sure you want to delete ${filename} and all its parsed transactions?`,
      )
    ) {
      deleteFile.mutate(
        { caseId, fileId },
        {
          onSuccess: () => {
            toast.success('File deleted');
            refetchFiles();
            refetchCase();
          },
        },
      );
    }
  };

  const handleAnalyze = () => {
    toast.info('Starting analysis pipeline...');
    analyzeCase.mutate(
      { caseId },
      {
        onSuccess: () => {
          toast.success('Analysis pipeline initiated successfully');
          refetchCase();
        },
        onError: (err: any) => {
          toast.error(`Analysis failed: ${err.message}`);
        },
      },
    );
  };

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="dropzone-intake"
    >
      {isDragging && (
        <div
          aria-hidden
          data-testid="overlay-drop"
          className="pointer-events-none absolute -inset-3 z-20 flex flex-col items-center justify-center gap-3 rounded-sm border-2 border-dashed border-primary/70 bg-background/85 backdrop-blur-sm"
        >
          <Upload className="h-10 w-10 text-primary" />
          <div className="font-mono text-sm uppercase tracking-widest text-primary">
            Drop files to ingest
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            Statements: CSV, XLSX, XLS — Self report: PDF
          </div>
        </div>
      )}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <DatabaseZap className="h-5 w-5 text-primary" />
              Data Intake & Consolidation
            </h2>
            <p className="text-sm text-muted-foreground font-mono mt-1">
              Upload or drag in bank statement exports (Excel/CSV) and the
              subject's self report PDF (financial disclosure)
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              accept=".csv, .xlsx, .xls"
              multiple
            />
            <input
              type="file"
              ref={disclosureInputRef}
              onChange={handleDisclosureUpload}
              className="hidden"
              accept=".pdf,application/pdf"
            />
            <Button
              variant="outline"
              className="rounded-sm font-mono text-xs border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => disclosureInputRef.current?.click()}
              disabled={uploadDisclosure.isPending}
              data-testid="btn-upload-disclosure"
            >
              {uploadDisclosure.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                  Uploading...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Self Report
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              className="rounded-sm font-mono text-xs border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadFile.isPending}
            >
              {uploadFile.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                  Parsing...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Upload className="h-4 w-4" /> Upload Files
                </span>
              )}
            </Button>

            <Button
              className="rounded-sm font-mono text-xs shadow-[0_0_15px_rgba(0,195,255,0.3)] hover:shadow-[0_0_20px_rgba(0,195,255,0.5)] transition-shadow"
              onClick={handleAnalyze}
              disabled={analyzeCase.isPending || (files && files.length === 0)}
            >
              {analyzeCase.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 border-2 border-background/20 border-t-background rounded-full animate-spin" />
                  Running Pipeline
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Activity className="h-4 w-4" /> Run Analysis
                </span>
              )}
            </Button>
          </div>
        </div>

        {disclosure && (
          <DisclosureCard
            disclosure={disclosure}
            onDelete={handleDeleteDisclosure}
            deleting={deleteDisclosure.isPending}
          />
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2].map((i) => (
              <Card
                key={i}
                className="bg-card border-border rounded-sm h-48 animate-pulse"
              />
            ))}
          </div>
        ) : files && files.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {files.map((file) => (
              <Card
                key={file.id}
                className="bg-card border-border rounded-sm shadow-sm flex flex-col relative overflow-hidden group"
              >
                {file.status === 'error' && (
                  <div className="absolute top-0 left-0 w-full h-1 bg-destructive" />
                )}
                {file.status === 'parsed' && (
                  <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
                )}

                <CardHeader className="pb-3 flex flex-row items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded mt-1 ${file.status === 'error' ? 'bg-destructive/10' : 'bg-primary/10'}`}
                    >
                      <FileSpreadsheet
                        className={`h-5 w-5 ${file.status === 'error' ? 'text-destructive' : 'text-primary'}`}
                      />
                    </div>
                    <div>
                      <CardTitle
                        className="text-base truncate max-w-[250px]"
                        title={file.filename}
                      >
                        {file.filename}
                      </CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="text-sm font-medium text-foreground bg-muted px-2 py-0.5 rounded-sm inline-block"
                          dir="auto"
                        >
                          {file.bankLabel}
                        </span>
                        {file.status === 'parsed' ? (
                          <span className="flex items-center text-xs font-mono text-emerald-500">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Parsed
                          </span>
                        ) : (
                          <span className="flex items-center text-xs font-mono text-destructive">
                            <AlertTriangle className="h-3 w-3 mr-1" /> Error
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleDelete(file.id, file.filename)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardHeader>

                <CardContent className="flex-1 text-sm space-y-4">
                  <div className="grid grid-cols-2 gap-4 bg-background/50 p-3 rounded-sm border border-border/50">
                    <div>
                      <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
                        Coverage
                      </div>
                      <div className="font-mono text-xs">
                        {file.periodStart
                          ? format(new Date(file.periodStart), 'dd MMM yy')
                          : '?'}
                        {' → '}
                        {file.periodEnd
                          ? format(new Date(file.periodEnd), 'dd MMM yy')
                          : '?'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
                        Accounts
                      </div>
                      <div
                        className="font-mono text-xs text-primary truncate"
                        title={file.accountIds?.join(', ')}
                      >
                        {file.accountIds && file.accountIds.length > 0
                          ? file.accountIds.join(', ')
                          : 'None extracted'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
                        Rows Parsed
                      </div>
                      <div className="font-mono font-medium">
                        {file.rowsParsed.toLocaleString()}{' '}
                        <span className="text-muted-foreground font-normal">
                          ({file.rowsSkipped} skipped)
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
                        Value (KWD)
                      </div>
                      <div className="font-mono text-xs">
                        <span className="text-emerald-500">
                          +{formatKwd(file.totalCreditsKwd)}
                        </span>
                        <span className="mx-1">/</span>
                        <span className="text-orange-500">
                          -{formatKwd(file.totalDebitsKwd)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono uppercase tracking-wider">
                      <span className="text-muted-foreground">
                        Extraction Quality
                      </span>
                      <span
                        className={
                          file.dataQuality > 0.8
                            ? 'text-emerald-500'
                            : file.dataQuality > 0.5
                              ? 'text-amber-500'
                              : 'text-destructive'
                        }
                      >
                        {(file.dataQuality * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Progress
                      value={file.dataQuality * 100}
                      className="h-1.5 bg-muted"
                      indicatorClassName={
                        file.dataQuality > 0.8
                          ? 'bg-emerald-500'
                          : file.dataQuality > 0.5
                            ? 'bg-amber-500'
                            : 'bg-destructive'
                      }
                    />
                  </div>

                  {(file.mappingNotes.length > 0 ||
                    file.qualityIssues.length > 0) && (
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center text-xs font-mono text-primary hover:underline">
                        <ChevronDown className="h-3 w-3 mr-1" /> View Parser
                        Logs
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-3 pt-2 border-t border-border/50">
                        {file.qualityIssues.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-mono text-destructive uppercase tracking-wider">
                              Issues
                            </div>
                            <ul className="text-xs space-y-1 list-disc list-inside pl-4 text-muted-foreground">
                              {file.qualityIssues.map((issue, idx) => (
                                <li key={idx}>{issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {file.mappingNotes.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                              Mapping Log
                            </div>
                            <ul className="text-xs space-y-1 list-disc list-inside pl-4 text-muted-foreground">
                              {file.mappingNotes.map((note, idx) => (
                                <li key={idx}>{note}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border border-dashed rounded-sm p-12 text-center flex flex-col items-center justify-center text-muted-foreground">
            <Upload className="h-10 w-10 mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-foreground mb-1 font-mono uppercase tracking-widest">
              No Data Ingested
            </h3>
            <p className="text-sm max-w-md mb-6">
              Drag and drop statements anywhere on this panel, or click Select
              Files. The adaptive parser handles diverse formats from various
              local and international banks.
            </p>
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="font-mono text-xs rounded-sm"
            >
              Select Files
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatKwd(val: number) {
  if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return val.toFixed(0);
}

function DisclosureCard({
  disclosure,
  onDelete,
  deleting,
}: {
  disclosure: Disclosure;
  onDelete: () => void;
  deleting: boolean;
}) {
  const x = disclosure.extraction;
  const declarationTypeLabel =
    x?.declarationType === 'first'
      ? 'First declaration'
      : x?.declarationType === 'update'
        ? 'Update declaration'
        : x?.declarationType === 'final'
          ? 'Final declaration'
          : 'Declaration';
  const counts = x
    ? [
        { label: 'Real Estate', count: x.realEstate.length },
        { label: 'Usufruct', count: x.usufructRights.length },
        { label: 'Securities', count: x.securities.length },
        {
          label: 'Accounts & Deposits',
          count: x.bankAccountsAndDeposits.length,
        },
        { label: 'Debts Owed', count: x.debtsOwed.length },
        { label: 'Movables', count: x.valuableMovables.length },
        { label: 'Minor Children', count: x.minorChildren.length },
      ]
    : [];
  return (
    <Card
      className="bg-card border-border rounded-sm relative overflow-hidden"
      data-testid="card-disclosure"
    >
      {disclosure.status === 'ready' && (
        <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
      )}
      {disclosure.status === 'failed' && (
        <div className="absolute top-0 left-0 w-full h-1 bg-destructive" />
      )}
      {disclosure.status === 'processing' && (
        <div className="absolute top-0 left-0 w-full h-1 bg-primary animate-pulse" />
      )}
      <CardHeader className="pb-3 flex flex-row items-start justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded mt-1 ${disclosure.status === 'failed' ? 'bg-destructive/10' : 'bg-primary/10'}`}
          >
            <FileText
              className={`h-5 w-5 ${disclosure.status === 'failed' ? 'text-destructive' : 'text-primary'}`}
            />
          </div>
          <div>
            <CardTitle
              className="text-base truncate max-w-[420px]"
              title={disclosure.filename}
              dir="auto"
            >
              {disclosure.filename}
            </CardTitle>
            <div className="text-xs text-muted-foreground font-mono mt-1">
              Self report — official financial disclosure
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              {disclosure.status === 'processing' ? (
                <span
                  className="flex items-center text-xs font-mono text-primary"
                  data-testid="status-disclosure-processing"
                >
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" /> AI reading
                  the handwritten form...
                </span>
              ) : disclosure.status === 'ready' ? (
                <span
                  className="flex items-center text-xs font-mono text-emerald-500"
                  data-testid="status-disclosure-ready"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {declarationTypeLabel}
                  {x?.declarationDate ? ` — dated ${x.declarationDate}` : ''}
                </span>
              ) : (
                <span
                  className="flex items-center text-xs font-mono text-destructive"
                  data-testid="status-disclosure-failed"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" /> Extraction failed
                </span>
              )}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          disabled={deleting}
          data-testid="btn-delete-disclosure"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="text-sm space-y-4">
        {disclosure.status === 'processing' && (
          <p className="text-xs text-muted-foreground font-mono">
            Reading the declaration page by page and extracting the handwritten
            entries — usually one to two minutes. The card updates
            automatically; you can keep working meanwhile.
          </p>
        )}
        {disclosure.status === 'failed' && (
          <div className="bg-destructive/5 border border-destructive/20 p-3 rounded-sm text-xs font-mono text-destructive/90">
            {disclosure.error || 'The AI could not read this document.'}
            <span className="text-muted-foreground">
              {' '}
              — remove it and upload the PDF again to retry.
            </span>
          </div>
        )}
        {disclosure.status === 'ready' && x && (
          <>
            {(x.declarant || x.summaryEn) && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-background/50 p-3 rounded-sm border border-border/50">
                <div>
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
                    Declarant
                  </div>
                  <div className="font-mono text-xs" dir="auto">
                    {x.declarant?.name || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
                    Employer / Role
                  </div>
                  <div className="font-mono text-xs" dir="auto">
                    {[x.declarant?.employer, x.declarant?.jobTitle]
                      .filter(Boolean)
                      .join(' — ') || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
                    Declared Salary
                  </div>
                  <div className="font-mono text-xs text-primary">
                    {x.declarant?.monthlySalaryKwd != null
                      ? `${x.declarant.monthlySalaryKwd.toLocaleString()} KWD / month`
                      : '—'}
                  </div>
                </div>
              </div>
            )}
            <div
              className="flex flex-wrap gap-1.5"
              data-testid="chips-disclosure-counts"
            >
              {counts.map((c) => (
                <span
                  key={c.label}
                  className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border ${
                    c.count > 0
                      ? 'border-primary/30 text-foreground bg-primary/5'
                      : 'border-border/50 text-muted-foreground bg-background/40'
                  }`}
                >
                  {c.label}: {c.count > 0 ? c.count : 'none'}
                </span>
              ))}
            </div>
            {x.extractionWarnings.length > 0 && (
              <div className="bg-amber-500/5 border border-amber-500/20 p-2.5 rounded-sm space-y-1">
                <div className="text-[10px] font-mono text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" /> Reading warnings
                </div>
                <ul className="list-disc list-inside pl-1 space-y-0.5">
                  {x.extractionWarnings.map((w, i) => (
                    <li
                      key={i}
                      className="text-[11px] text-amber-500/80 leading-snug"
                      dir="auto"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Collapsible>
              <CollapsibleTrigger
                className="flex items-center text-xs font-mono text-primary hover:underline"
                data-testid="btn-disclosure-details"
              >
                <ChevronDown className="h-3 w-3 mr-1" /> View Extracted
                Declaration
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-4 pt-3 border-t border-border/50">
                {x.summaryEn && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {x.summaryEn}
                  </p>
                )}
                {x.minorChildren.length > 0 && (
                  <DisclosureSection title="Minor Children / Dependents">
                    {x.minorChildren.map((c, i) => (
                      <DisclosureRow
                        key={i}
                        uncertain={c.uncertain}
                        text={[
                          c.name,
                          c.dateOfBirth ? `DOB ${c.dateOfBirth}` : null,
                          c.relation,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      />
                    ))}
                  </DisclosureSection>
                )}
                {x.realEstate.length > 0 && (
                  <DisclosureSection title="Real Estate">
                    {x.realEstate.map((r, i) => (
                      <DisclosureRow
                        key={i}
                        uncertain={r.uncertain}
                        text={[
                          r.location,
                          r.propertyType,
                          r.areaSqm != null
                            ? `${r.areaSqm.toLocaleString()} m²`
                            : null,
                          r.ownershipPct != null
                            ? `${r.ownershipPct}% owned`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      />
                    ))}
                  </DisclosureSection>
                )}
                {x.usufructRights.length > 0 && (
                  <DisclosureSection title="Usufruct Rights">
                    {x.usufructRights.map((r, i) => (
                      <DisclosureRow
                        key={i}
                        uncertain={r.uncertain}
                        text={[
                          r.location,
                          r.usageType,
                          r.areaSqm != null
                            ? `${r.areaSqm.toLocaleString()} m²`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      />
                    ))}
                  </DisclosureSection>
                )}
                {x.securities.length > 0 && (
                  <DisclosureSection title="Securities / Company Interests">
                    {x.securities.map((s, i) => (
                      <DisclosureRow
                        key={i}
                        uncertain={s.uncertain}
                        text={[
                          s.instrumentType,
                          s.company,
                          s.quantityOrPct,
                          s.listed != null
                            ? s.listed
                              ? 'listed'
                              : 'unlisted'
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      />
                    ))}
                  </DisclosureSection>
                )}
                {x.bankAccountsAndDeposits.length > 0 && (
                  <DisclosureSection title="Bank Accounts, Deposits & Debts in Favor">
                    {x.bankAccountsAndDeposits.map((a, i) => (
                      <DisclosureRow
                        key={i}
                        uncertain={a.uncertain}
                        text={[
                          a.institution,
                          a.kind,
                          a.valueKwd != null
                            ? `${a.valueKwd.toLocaleString()} KWD`
                            : null,
                          a.institutionCountry,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      />
                    ))}
                  </DisclosureSection>
                )}
                {x.debtsOwed.length > 0 && (
                  <DisclosureSection title="Debts Owed by Declarant">
                    {x.debtsOwed.map((d, i) => (
                      <DisclosureRow
                        key={i}
                        uncertain={d.uncertain}
                        text={[
                          d.creditor,
                          d.amountKwd != null
                            ? `${d.amountKwd.toLocaleString()} KWD`
                            : null,
                          d.finalRepaymentDate
                            ? `due ${d.finalRepaymentDate}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      />
                    ))}
                  </DisclosureSection>
                )}
                {x.valuableMovables.length > 0 && (
                  <DisclosureSection title="High-Value Movables">
                    {x.valuableMovables.map((m, i) => (
                      <DisclosureRow
                        key={i}
                        uncertain={m.uncertain}
                        text={[
                          m.description,
                          m.count != null ? `x${m.count}` : null,
                          m.totalValueKwd != null
                            ? `${m.totalValueKwd.toLocaleString()} KWD total`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      />
                    ))}
                  </DisclosureSection>
                )}
                {x.generalNotes && (
                  <DisclosureSection title="Declarant Notes">
                    <DisclosureRow text={x.generalNotes} />
                  </DisclosureSection>
                )}
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DisclosureSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
        {title}
      </div>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function DisclosureRow({
  text,
  uncertain,
}: {
  text: string;
  uncertain?: boolean;
}) {
  return (
    <li className="text-xs text-foreground/85 flex items-start gap-2" dir="auto">
      <span className="text-primary/50 mt-0.5">›</span>
      <span>
        {text}
        {uncertain && (
          <span className="ml-1.5 text-[9px] font-mono uppercase text-amber-500 border border-amber-500/30 bg-amber-500/5 px-1 py-px rounded-sm">
            uncertain
          </span>
        )}
      </span>
    </li>
  );
}
