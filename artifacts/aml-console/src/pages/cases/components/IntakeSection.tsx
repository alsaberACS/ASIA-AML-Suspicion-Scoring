import { useState, useRef, useEffect } from 'react';
import {
  useListCaseFiles,
  useUploadCaseFile,
  useDeleteCaseFile,
  useAnalyzeCase,
  Case,
} from '@workspace/api-client-react';
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
  Upload,
  Trash2,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  DatabaseZap,
  Activity,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const ingestFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    if (uploadFile.isPending) {
      toast.info(
        'Still parsing the previous upload — drop the files again in a moment',
      );
      return;
    }
    const supported = ['csv', 'xlsx', 'xls'];
    const accepted = incoming.filter((f) =>
      supported.includes(f.name.split('.').pop()?.toLowerCase() ?? ''),
    );
    const skipped = incoming.length - accepted.length;
    if (skipped > 0) {
      toast.warning(
        `${skipped} file${skipped > 1 ? 's' : ''} skipped — only CSV, XLSX or XLS statements are supported`,
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
            Drop statements to ingest
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            CSV, XLSX or XLS — parsing starts on release
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
              Upload or drag in raw bank statement exports (Excel/CSV) for
              adaptive parsing
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
