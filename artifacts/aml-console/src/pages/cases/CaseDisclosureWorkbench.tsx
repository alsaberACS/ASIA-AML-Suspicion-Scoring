import { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation, useParams } from 'wouter';
import { 
  useGetCaseDisclosure, 
  getGetCaseDisclosureQueryKey, 
  useUpdateCaseDisclosureExtraction,
  useReprocessCaseDisclosure,
  DisclosureExtraction,
  DisclosureDeclarant
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Document, Page, pdfjs } from "react-pdf";
import { toast } from 'sonner';
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Scanned form: pages render without text/annotation layers, so the
// react-pdf layer stylesheets are not needed here.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// UI Components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Save, X, RefreshCw, FileText, AlertTriangle, Plus, Trash2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function CaseDisclosureWorkbench() {
  const params = useParams();
  const caseId = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Queries
  const { data: disclosure, isLoading, isError } = useGetCaseDisclosure(caseId, {
    query: {
      queryKey: getGetCaseDisclosureQueryKey(caseId),
      refetchInterval: (query) => query.state.data?.status === 'processing' ? 2500 : false,
    }
  });

  const updateExtraction = useUpdateCaseDisclosureExtraction();
  const reprocess = useReprocessCaseDisclosure();

  // PDF Viewer State
  const [numPages, setNumPages] = useState<number>();
  const [pageNumber, setPageNumber] = useState<number>(1);

  // Draft State. Keyed on caseId + extractedAt: a fresh AI read (new
  // extractedAt) rebuilds the draft, and a running re-read clears it so a
  // stale draft can never be saved over the incoming reading.
  const [draft, setDraft] = useState<DisclosureExtraction | null>(null);
  const initializedForKey = useRef<string | null>(null);
  const draftKey = disclosure ? `${caseId}:${disclosure.extractedAt ?? ''}` : null;
  const isDirty = useMemo(() => {
    if (!draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(disclosure?.extraction || null);
  }, [draft, disclosure?.extraction]);

  useEffect(() => {
    if (!disclosure) return;
    if (disclosure.status === 'processing') {
      initializedForKey.current = null;
      setDraft(null);
      return;
    }
    if (disclosure.extraction && draftKey && initializedForKey.current !== draftKey) {
      initializedForKey.current = draftKey;
      setDraft(JSON.parse(JSON.stringify(disclosure.extraction)));
    }
  }, [disclosure, draftKey]);

  if (isLoading) {
    return <div className="h-[100dvh] flex items-center justify-center font-mono text-primary animate-pulse bg-background">Initializing Workbench...</div>;
  }

  if (isError || !disclosure) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center p-6 text-center bg-background">
        <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-mono text-destructive mb-2 uppercase tracking-widest">Workbench Unavailable</h2>
        <p className="text-muted-foreground font-mono text-sm max-w-md mb-6">Could not load disclosure data for this case.</p>
        <Button onClick={() => setLocation(`/cases/${caseId}`)}>Return to Case</Button>
      </div>
    );
  }

  if (!disclosure.extraction && disclosure.status !== 'processing' && disclosure.status !== 'failed') {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center p-6 text-center bg-background">
        <FileText className="h-10 w-10 text-muted-foreground mb-4 opacity-50" />
        <h2 className="text-xl font-mono text-foreground mb-2 uppercase tracking-widest">No Extraction Data</h2>
        <p className="text-muted-foreground font-mono text-sm max-w-md mb-6">There is no disclosure document ingested for this case, or extraction has not been performed.</p>
        <Button onClick={() => setLocation(`/cases/${caseId}`)}>Return to Case Intake</Button>
      </div>
    );
  }

  const handleSave = () => {
    if (!draft) return;
    updateExtraction.mutate({ caseId, data: draft }, {
      onSuccess: () => {
        toast.success("Corrections locked into authoritative record.");
        queryClient.invalidateQueries({ queryKey: getGetCaseDisclosureQueryKey(caseId) });
      },
      onError: (err: any) => {
        toast.error(`Save failed: ${err?.error || err?.message || 'Unknown error'}`);
      }
    });
  };

  const handleDiscard = () => {
    if (disclosure.extraction) {
      setDraft(JSON.parse(JSON.stringify(disclosure.extraction)));
    }
  };

  const handleReread = () => {
    if (confirm("WARNING: Fresh AI reading will OVERWRITE any manual corrections. Proceed?")) {
      reprocess.mutate({ caseId }, {
        onSuccess: () => {
          toast.success("AI reprocessing initiated.");
          queryClient.invalidateQueries({ queryKey: getGetCaseDisclosureQueryKey(caseId) });
        },
        onError: (err: any) => {
          toast.error(`Reprocess failed: ${err?.error || err?.message || 'Unknown error'}`);
        }
      });
    }
  };

  const handlePageJump = (p?: number | null) => {
    if (p && p >= 1 && p <= (numPages || 1)) {
      setPageNumber(p);
    }
  };

  // Updaters
  const updateDeclarant = (field: keyof DisclosureDeclarant, value: any) => {
    setDraft(prev => {
      if (!prev || !prev.declarant) return prev;
      const d = { ...prev.declarant, [field]: value };
      const corrected = new Set(d.correctedFields || []);
      corrected.add(field);
      d.correctedFields = Array.from(corrected);
      if (d.uncertainFields) {
        d.uncertainFields = d.uncertainFields.filter(f => f !== field);
      }
      return { ...prev, declarant: d };
    });
  };

  const updateRoot = (field: keyof DisclosureExtraction, value: any) => {
    setDraft(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const updateRow = <T extends keyof DisclosureExtraction>(section: T, index: number, field: string, value: any) => {
    setDraft(prev => {
      if (!prev) return prev;
      const array = [...(prev[section] as any[])];
      const row = { ...array[index], [field]: value, corrected: true, uncertain: false, alternates: undefined };
      array[index] = row;
      return { ...prev, [section]: array };
    });
  };

  const addRow = (section: keyof DisclosureExtraction, defaultRow: any) => {
    setDraft(prev => {
      if (!prev) return prev;
      const array = [...(prev[section] as any[]), { ...defaultRow, corrected: true }];
      return { ...prev, [section]: array };
    });
  };

  const deleteRow = (section: keyof DisclosureExtraction, index: number) => {
    setDraft(prev => {
      if (!prev) return prev;
      const array = [...(prev[section] as any[])];
      array.splice(index, 1);
      return { ...prev, [section]: array };
    });
  };

  // Render helpers
  const renderAlternates = (alternates?: string[]) => {
    if (!alternates || alternates.length === 0) return null;
    return (
      <div className="flex flex-col gap-1 mt-1.5">
        {alternates.map((alt, i) => (
          <div key={i} className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-sm border border-amber-500/20 leading-tight inline-block w-fit">
            <span className="font-bold mr-1">ALT:</span>{alt}
          </div>
        ))}
      </div>
    );
  };

  const renderAsWritten = (asWritten?: string | null) => {
    if (!asWritten) return null;
    return (
      <div dir="rtl" className="text-xs font-serif text-primary/80 mt-1 opacity-90 border-r-2 border-primary/30 pr-2 italic" title="As written in ink">
        {asWritten}
      </div>
    );
  };

  const renderStatusBadge = (uncertain?: boolean, corrected?: boolean) => {
    if (corrected) return <Badge variant="outline" className="text-[9px] h-4 px-1 rounded-sm border-emerald-500/50 text-emerald-500 uppercase tracking-widest bg-emerald-500/10" data-testid="badge-corrected">Corrected</Badge>;
    if (uncertain) return <Badge variant="outline" className="text-[9px] h-4 px-1 rounded-sm border-amber-500/50 text-amber-500 uppercase tracking-widest bg-amber-500/10" data-testid="badge-uncertain">Uncertain</Badge>;
    return null;
  };

  const renderPageChip = (page?: number | null) => {
    if (!page) return null;
    return (
      <button 
        onClick={() => handlePageJump(page)}
        className="text-[9px] h-4 px-1.5 rounded-sm bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors uppercase tracking-widest font-mono border border-border"
        data-testid="chip-page"
      >
        Pg {page}
      </button>
    );
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-background text-foreground overflow-hidden" data-testid="page-disclosure-workbench">
      {/* Top Header */}
      <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground font-mono text-xs" onClick={() => setLocation(`/cases/${caseId}`)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Case {caseId}
          </Button>
          <div className="h-4 w-px bg-border" />
          <h1 className="font-mono text-sm tracking-widest uppercase text-primary flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Disclosure Workbench
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          {disclosure.status === 'processing' && (
            <div className="flex items-center text-xs font-mono text-primary px-3 py-1 bg-primary/10 rounded-sm border border-primary/20 animate-pulse">
              <RefreshCw className="h-3 w-3 mr-2 animate-spin" />
              {disclosure.phase === 'reading_primary' ? 'CLAUDE SCANNING...' :
               disclosure.phase === 'reading_secondary' ? 'GEMINI SCANNING...' :
               disclosure.phase === 'adjudicating' ? 'ADJUDICATING...' : 'PROCESSING...'}
            </div>
          )}
          {disclosure.correctedAt && (
            <div className="text-[10px] font-mono text-emerald-500/80 mr-2 uppercase tracking-widest" title={`Last saved: ${disclosure.correctedAt}`}>
              <CheckCircle2 className="h-3 w-3 inline mr-1" />
              Verified
            </div>
          )}
          
          <Button
            variant="ghost"
            size="sm"
            className="h-8 font-mono text-xs text-muted-foreground hover:text-foreground"
            onClick={handleReread}
            disabled={reprocess.isPending || disclosure.status === 'processing'}
            data-testid="btn-reread-ai"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${reprocess.isPending ? 'animate-spin' : ''}`} />
            Re-Read
          </Button>

          {isDirty && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 font-mono text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={handleDiscard}
                data-testid="btn-discard-corrections"
              >
                <X className="h-3 w-3 mr-1" /> Discard
              </Button>
              <Button
                size="sm"
                className="h-8 font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleSave}
                disabled={updateExtraction.isPending}
                data-testid="btn-save-corrections"
              >
                {updateExtraction.isPending ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                Save Corrections
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Main Split */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left: PDF Viewer */}
        <div className="w-1/2 border-r border-border bg-[#0a0a0a] flex flex-col relative" data-testid="pdf-viewer-container">
          <div className="h-10 bg-card/80 border-b border-border flex items-center justify-between px-3 shrink-0">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Original Document</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber <= 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-mono text-foreground w-16 text-center">
                {pageNumber} / {numPages || '?'}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPageNumber(p => Math.min(numPages || p, p + 1))} disabled={pageNumber >= (numPages || 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4 flex justify-center w-full">
              <Document
                file={`${import.meta.env.BASE_URL}api/cases/${caseId}/disclosure/pdf`}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                loading={<div className="font-mono text-sm text-primary animate-pulse py-20">Loading Document...</div>}
                error={<div className="font-mono text-sm text-destructive py-20">Failed to load Document</div>}
              >
                <Page
                  pageNumber={pageNumber}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  scale={1.2}
                  className="shadow-2xl border border-border"
                />
              </Document>
            </div>
          </ScrollArea>
        </div>

        {/* Right: Data Extraction */}
        <div className="w-1/2 flex flex-col bg-background relative">
          {disclosure.status === 'failed' ? (
            <div className="p-8 text-center mt-20">
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-4" />
              <h2 className="text-lg font-mono text-destructive mb-2 uppercase">Extraction Failed</h2>
              <p className="text-sm font-mono text-muted-foreground">{disclosure.error}</p>
            </div>
          ) : draft ? (
            <ScrollArea className="flex-1 p-6 custom-scrollbar">
              <div className="max-w-3xl mx-auto space-y-8 pb-20">
                
                {/* Metadata & Readers */}
                <section className="bg-card border border-border p-4 rounded-sm space-y-4 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-primary/50" />
                  
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-mono uppercase tracking-widest text-primary">Metadata & Analysis</h3>
                    {draft.readers && (
                      <div className="text-[10px] font-mono flex gap-2 uppercase">
                        <span className="text-muted-foreground">Primary: <span className="text-foreground">{draft.readers.primary}</span></span>
                        {draft.readers.secondary && (
                          <>
                            <span className="text-border">|</span>
                            <span className="text-muted-foreground">Secondary: <span className="text-foreground">{draft.readers.secondary}</span></span>
                          </>
                        )}
                        {draft.readers.adjudicated && (
                          <>
                            <span className="text-border">|</span>
                            <span className="text-emerald-500">Cross-checked</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {draft.extractionWarnings && draft.extractionWarnings.length > 0 && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-sm p-3">
                      <div className="flex items-center gap-2 text-destructive mb-2 text-xs font-mono uppercase tracking-wider">
                        <ShieldAlert className="h-3 w-3" /> Extraction Warnings
                      </div>
                      <ul className="list-disc list-inside text-xs font-mono text-destructive/80 space-y-1">
                        {draft.extractionWarnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Declaration Type</label>
                      <select 
                        value={draft.declarationType} 
                        onChange={e => updateRoot('declarationType', e.target.value)}
                        className="w-full bg-input border border-border rounded-sm h-8 text-xs font-mono px-2 outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="first">First</option>
                        <option value="update">Update</option>
                        <option value="final">Final</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Date</label>
                      <Input 
                        value={draft.declarationDate || ''} 
                        onChange={e => updateRoot('declarationDate', e.target.value)}
                        className="h-8 text-xs font-mono rounded-sm"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Summary</label>
                    <Textarea 
                      value={draft.summaryEn || ''} 
                      onChange={e => updateRoot('summaryEn', e.target.value)}
                      className="min-h-[60px] text-xs font-mono rounded-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">General Notes</label>
                    <Textarea 
                      value={draft.generalNotes || ''} 
                      onChange={e => updateRoot('generalNotes', e.target.value)}
                      className="min-h-[60px] text-xs font-mono rounded-sm"
                    />
                  </div>
                </section>

                {/* Declarant */}
                {draft.declarant && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <h3 className="text-sm font-mono uppercase tracking-widest text-foreground">1. Declarant Details</h3>
                      {renderPageChip(draft.declarant.page)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4 bg-card/50 p-4 rounded-sm border border-border">
                      {['name', 'civilId', 'nationality', 'residenceCountry', 'gender', 'passportNo', 'employer', 'jobTitle', 'jobStartDate', 'jobEndDate', 'monthlySalaryKwd', 'workPhone', 'mobile', 'homePhone', 'email', 'homeAddress'].map(field => {
                        const val = (draft.declarant as any)[field] || '';
                        const isUncertain = draft.declarant?.uncertainFields?.includes(field);
                        const isCorrected = draft.declarant?.correctedFields?.includes(field);
                        const alternates = draft.declarant?.alternates?.filter(a => a.startsWith(field + ':')).map(a => a.replace(field + ':', '').trim());
                        
                        return (
                          <div key={field} className={`space-y-1.5 ${field === 'homeAddress' ? 'col-span-2' : ''}`}>
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{field}</label>
                              {renderStatusBadge(isUncertain, isCorrected)}
                            </div>
                            <Input 
                              value={val} 
                              onChange={e => updateDeclarant(field as keyof DisclosureDeclarant, e.target.value)}
                              className={`h-8 text-xs font-mono rounded-sm ${isUncertain ? 'border-amber-500/50 bg-amber-500/5' : isCorrected ? 'border-emerald-500/50' : ''}`}
                            />
                            {renderAlternates(alternates)}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Array Sections */}
                <SectionEditor 
                  title="2. Minor Children" 
                  sectionKey="minorChildren" 
                  draft={draft} 
                  fields={[{key:'name', label:'Name'}, {key:'dateOfBirth', label:'DOB'}, {key:'relation', label:'Relation'}, {key:'idType', label:'ID Type'}, {key:'idNumber', label:'ID Num'}, {key:'notes', label:'Notes'}]}
                  onUpdate={updateRow} onAdd={addRow} onDelete={deleteRow}
                  renderAlternates={renderAlternates} renderAsWritten={renderAsWritten} renderPageChip={renderPageChip} renderStatusBadge={renderStatusBadge}
                  defaultRow={{ name: '', dateOfBirth: '', relation: '', idType: '', idNumber: '', notes: '' }}
                />

                <SectionEditor 
                  title="3. Real Estate" 
                  sectionKey="realEstate" 
                  draft={draft} 
                  fields={[{key:'location', label:'Location'}, {key:'ownerName', label:'Owner'}, {key:'propertyType', label:'Type'}, {key:'areaSqm', label:'Area (sqm)'}, {key:'ownershipPct', label:'Ownership %'}, {key:'notes', label:'Notes'}]}
                  onUpdate={updateRow} onAdd={addRow} onDelete={deleteRow}
                  renderAlternates={renderAlternates} renderAsWritten={renderAsWritten} renderPageChip={renderPageChip} renderStatusBadge={renderStatusBadge}
                  defaultRow={{ location: '', ownerName: '', propertyType: '', areaSqm: null, ownershipPct: null, notes: '' }}
                />

                <SectionEditor 
                  title="4. Usufruct Rights" 
                  sectionKey="usufructRights" 
                  draft={draft} 
                  fields={[{key:'location', label:'Location'}, {key:'beneficiaryName', label:'Beneficiary'}, {key:'usageType', label:'Type'}, {key:'areaSqm', label:'Area (sqm)'}, {key:'notes', label:'Notes'}]}
                  onUpdate={updateRow} onAdd={addRow} onDelete={deleteRow}
                  renderAlternates={renderAlternates} renderAsWritten={renderAsWritten} renderPageChip={renderPageChip} renderStatusBadge={renderStatusBadge}
                  defaultRow={{ location: '', beneficiaryName: '', usageType: '', areaSqm: null, notes: '' }}
                />

                <SectionEditor 
                  title="5. Securities" 
                  sectionKey="securities" 
                  draft={draft} 
                  fields={[{key:'company', label:'Company'}, {key:'companyCountry', label:'Country'}, {key:'ownerName', label:'Owner'}, {key:'instrumentType', label:'Type'}, {key:'quantityOrPct', label:'Quantity/%'}, {key:'listed', label:'Listed'}, {key:'notes', label:'Notes'}]}
                  onUpdate={updateRow} onAdd={addRow} onDelete={deleteRow}
                  renderAlternates={renderAlternates} renderAsWritten={renderAsWritten} renderPageChip={renderPageChip} renderStatusBadge={renderStatusBadge}
                  defaultRow={{ company: '', companyCountry: '', ownerName: '', instrumentType: '', quantityOrPct: '', listed: false, notes: '' }}
                />

                <SectionEditor 
                  title="6. Bank Accounts & Deposits" 
                  sectionKey="bankAccountsAndDeposits" 
                  draft={draft} 
                  fields={[{key:'institution', label:'Institution'}, {key:'institutionCountry', label:'Country'}, {key:'ownerName', label:'Owner'}, {key:'kind', label:'Kind'}, {key:'valueKwd', label:'Value (KWD)'}, {key:'notes', label:'Notes'}]}
                  onUpdate={updateRow} onAdd={addRow} onDelete={deleteRow}
                  renderAlternates={renderAlternates} renderAsWritten={renderAsWritten} renderPageChip={renderPageChip} renderStatusBadge={renderStatusBadge}
                  defaultRow={{ institution: '', institutionCountry: '', ownerName: '', kind: '', valueKwd: null, notes: '' }}
                />

                <SectionEditor 
                  title="7. Debts Owed" 
                  sectionKey="debtsOwed" 
                  draft={draft} 
                  fields={[{key:'creditor', label:'Creditor'}, {key:'creditorCountry', label:'Country'}, {key:'debtorName', label:'Debtor'}, {key:'amountKwd', label:'Amount (KWD)'}, {key:'finalRepaymentDate', label:'Repayment Date'}, {key:'notes', label:'Notes'}]}
                  onUpdate={updateRow} onAdd={addRow} onDelete={deleteRow}
                  renderAlternates={renderAlternates} renderAsWritten={renderAsWritten} renderPageChip={renderPageChip} renderStatusBadge={renderStatusBadge}
                  defaultRow={{ creditor: '', creditorCountry: '', debtorName: '', amountKwd: null, finalRepaymentDate: '', notes: '' }}
                />

                <SectionEditor 
                  title="8. Valuable Movables" 
                  sectionKey="valuableMovables" 
                  draft={draft} 
                  fields={[{key:'description', label:'Description'}, {key:'ownerName', label:'Owner'}, {key:'count', label:'Count'}, {key:'totalValueKwd', label:'Total Value (KWD)'}, {key:'notes', label:'Notes'}]}
                  onUpdate={updateRow} onAdd={addRow} onDelete={deleteRow}
                  renderAlternates={renderAlternates} renderAsWritten={renderAsWritten} renderPageChip={renderPageChip} renderStatusBadge={renderStatusBadge}
                  defaultRow={{ description: '', ownerName: '', count: null, totalValueKwd: null, notes: '' }}
                />

              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8" data-testid="panel-pipeline-live">
              {disclosure.status === 'processing' ? (
                <div className="w-full max-w-sm space-y-6">
                  <div className="text-center space-y-2">
                    <RefreshCw className="h-8 w-8 text-primary mx-auto animate-spin [animation-duration:2.5s]" />
                    <h2 className="text-sm font-mono text-primary uppercase tracking-widest">Dual-Reader Pipeline Active</h2>
                    <p className="text-xs font-mono text-muted-foreground">Editing unlocks when the new reading is adjudicated.</p>
                  </div>
                  <div className="space-y-2">
                    {([
                      { key: 'reading_primary', label: 'Reader 1 - Claude Sonnet 4.6' },
                      { key: 'reading_secondary', label: 'Reader 2 - Gemini 3.1 Pro' },
                      { key: 'adjudicating', label: 'Adjudication - cross-checking ink' },
                    ] as const).map((s, i) => {
                      const order = ['reading_primary', 'reading_secondary', 'adjudicating'];
                      const cur = order.indexOf(disclosure.phase || 'reading_primary');
                      const state = i < cur ? 'done' : i === cur ? 'active' : 'pending';
                      return (
                        <div key={s.key} data-testid={`pipeline-stage-${s.key}`} className={`flex items-center gap-3 border rounded-sm px-3 py-2 font-mono text-xs ${state === 'active' ? 'border-primary/60 bg-primary/5 text-primary' : state === 'done' ? 'border-emerald-500/40 text-emerald-400' : 'border-border text-muted-foreground'}`}>
                          {state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : state === 'active' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <span className="h-3.5 w-3.5 rounded-full border border-current inline-block opacity-40" />}
                          <span className="uppercase tracking-wider">{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center font-mono text-sm text-muted-foreground">No extraction data available.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionEditor({ 
  title, 
  sectionKey, 
  draft, 
  fields, 
  onUpdate, 
  onAdd, 
  onDelete,
  renderAlternates,
  renderAsWritten,
  renderPageChip,
  renderStatusBadge,
  defaultRow
}: any) {
  const rows = draft[sectionKey] || [];
  
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-sm font-mono uppercase tracking-widest text-foreground flex items-center gap-2">
          {title}
          {draft.sectionsMarkedNone?.includes(sectionKey) && (
             <Badge variant="outline" className="text-[9px] h-4 px-1 rounded-sm border-muted-foreground/50 text-muted-foreground uppercase tracking-widest">Declared None</Badge>
          )}
        </h3>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] font-mono uppercase tracking-widest px-2 text-primary hover:bg-primary/10" onClick={() => onAdd(sectionKey, defaultRow)}>
          <Plus className="h-3 w-3 mr-1" /> Add Row
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-xs font-mono text-muted-foreground italic py-4 text-center bg-card/20 rounded-sm border border-border border-dashed">No rows extracted</div>
      ) : (
        <div className="space-y-3">
          {rows.map((row: any, i: number) => (
            <div key={i} className={`bg-card/50 p-4 rounded-sm border ${row.uncertain ? 'border-amber-500/30' : 'border-border'} relative group`}>
              <div className="absolute right-2 top-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                {renderPageChip(row.page)}
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(sectionKey, i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3 relative z-0">
                {fields.map((f: any) => (
                  <div key={f.key} className={`space-y-1.5 ${f.key === 'notes' || f.key === 'description' ? 'col-span-2' : ''}`}>
                    <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{f.label}</label>
                    {typeof row[f.key] === 'boolean' || f.key === 'listed' ? (
                      <select 
                        value={row[f.key] ? 'true' : 'false'} 
                        onChange={e => onUpdate(sectionKey, i, f.key, e.target.value === 'true')}
                        className={`w-full bg-input border rounded-sm h-8 text-xs font-mono px-2 outline-none focus:ring-1 focus:ring-primary ${row.uncertain ? 'border-amber-500/50 bg-amber-500/5' : row.corrected ? 'border-emerald-500/50' : 'border-border'}`}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    ) : (
                      <Input 
                        value={row[f.key] === null || row[f.key] === undefined ? '' : row[f.key]} 
                        onChange={e => {
                          const val = e.target.value;
                          const isNumeric = ['areaSqm', 'ownershipPct', 'valueKwd', 'amountKwd', 'count', 'totalValueKwd'].includes(f.key);
                          onUpdate(sectionKey, i, f.key, isNumeric ? (val === '' ? null : Number(val)) : val);
                        }}
                        className={`h-8 text-xs font-mono rounded-sm ${row.uncertain ? 'border-amber-500/50 bg-amber-500/5' : row.corrected ? 'border-emerald-500/50' : ''}`}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-start justify-between border-t border-border/50 pt-3 mt-3 relative z-0">
                <div className="flex-1">
                  {renderAsWritten(row.asWritten)}
                  {renderAlternates(row.alternates)}
                </div>
                <div className="shrink-0 flex items-center gap-2 mt-1">
                  {renderStatusBadge(row.uncertain, row.corrected)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}