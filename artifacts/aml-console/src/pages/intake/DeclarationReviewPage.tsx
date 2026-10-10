import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  getGetCaseDisclosureQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDeclarationIntakeQueryKey,
  getListCasesQueryKey,
  getListDeclarationIntakesQueryKey,
  useConfirmDeclarationIntake,
  useDiscardDeclarationIntake,
  useGetCaseDisclosure,
  useGetDeclarationIntake,
  useReprocessCaseDisclosure,
  useUpdateCaseDisclosureExtraction,
  type DisclosureExtraction,
} from '@workspace/api-client-react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Crosshair,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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
import DeclarationPdfPane, { type InkReveal } from './DeclarationPdfPane';
import { NumberField, TextField, TristateField, type FieldState } from './ReviewFields';
import {
  DECLARANT_FIELDS,
  DECLARATION_TYPES,
  SECTIONS,
  emptyRow,
  rowIsBlank,
  rowsOf,
  type SectionDef,
  type SectionKey,
  type SectionRow,
} from './declarationForm';
import { apiErrorText } from './DeclarationIntakePage';

const PIPELINE = [
  { key: 'reading_primary', label: 'Reader 1 transcribes the handwriting' },
  { key: 'reading_secondary', label: 'Reader 2 transcribes independently' },
  { key: 'adjudicating', label: 'Disagreements are reconciled against the ink' },
  { key: 'locating', label: 'Each value is pinned to its place on the page' },
] as const;

type Declarant = NonNullable<DisclosureExtraction['declarant']>;

function emptyDeclarant(): Declarant {
  return {
    name: null,
    gender: null,
    nationality: null,
    residenceCountry: null,
    civilId: null,
    passportNo: null,
    jobTitle: null,
    employer: null,
    jobStartDate: null,
    jobEndDate: null,
    workPhone: null,
    mobile: null,
    homePhone: null,
    email: null,
    homeAddress: null,
    monthlySalaryKwd: null,
    page: null,
    uncertainFields: [],
    correctedFields: [],
    alternates: [],
  };
}

/** Rows whose identifying column is blank are dropped before saving. */
function pruneBlankRows(x: DisclosureExtraction): DisclosureExtraction {
  const next: DisclosureExtraction = { ...x };
  let structureChanged = false;
  for (const s of SECTIONS) {
    const rows = rowsOf(x, s.key);
    const kept = rows.filter(r => !rowIsBlank(s, r));
    if (kept.length !== rows.length) structureChanged = true;
    (next as unknown as Record<string, unknown>)[s.key] = kept;
  }
  // Dropping rows misaligns "<section>.<index>" location keys; let the
  // server re-map rather than point at the wrong row.
  if (structureChanged) delete next.locations;
  return next;
}

export default function DeclarationReviewPage() {
  const params = useParams<{ id: string }>();
  const caseId = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const intakeQ = useGetDeclarationIntake(caseId, {
    query: { queryKey: getGetDeclarationIntakeQueryKey(caseId), enabled: Number.isFinite(caseId), retry: false },
  });
  const disclosureQ = useGetCaseDisclosure(caseId, {
    query: {
      queryKey: getGetCaseDisclosureQueryKey(caseId),
      enabled: Number.isFinite(caseId) && !!intakeQ.data,
      retry: false,
      refetchInterval: query => (query.state.data?.status === 'processing' ? 2500 : false),
    },
  });
  const intake = intakeQ.data;
  const disclosure = disclosureQ.data;

  const confirm = useConfirmDeclarationIntake();
  const saveDraft = useUpdateCaseDisclosureExtraction();
  const reprocess = useReprocessCaseDisclosure();
  const discard = useDiscardDeclarationIntake();

  // ---- Draft -------------------------------------------------------------
  const draftKey =
    disclosure?.status === 'ready' && disclosure.extraction
      ? `${caseId}:${disclosure.extractedAt ?? ''}:${disclosure.correctedAt ?? ''}`
      : null;
  const [draft, setDraft] = useState<DisclosureExtraction | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  useEffect(() => {
    if (!draftKey || !disclosure?.extraction) {
      if (!draftKey && draft) {
        setDraft(null);
        setDraftFor(null);
      }
      return;
    }
    if (draftKey === draftFor) return;
    const copy = structuredClone(disclosure.extraction) as DisclosureExtraction;
    if (!copy.declarant) copy.declarant = emptyDeclarant();
    setDraft(copy);
    setDraftFor(draftKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, disclosure?.extraction]);

  const dirty = useMemo(() => {
    if (!draft || !disclosure?.extraction) return false;
    return JSON.stringify(draft) !== JSON.stringify(disclosure.extraction);
  }, [draft, disclosure?.extraction]);

  const locationMap = useMemo(() => {
    const list = draft?.locations ?? disclosure?.extraction?.locations ?? [];
    return new Map(list.map(l => [l.key, l] as const));
  }, [draft?.locations, disclosure?.extraction?.locations]);

  // ---- Ink reveal --------------------------------------------------------
  const [reveal, setReveal] = useState<InkReveal | null>(null);
  const [revealSeq, setRevealSeq] = useState(0);
  const revealKey = useCallback(
    (key: string, fallbackPage: number | null | undefined) => {
      const loc = locationMap.get(key) ?? (key.startsWith('declarant.') ? locationMap.get('declarant') : undefined);
      const page = loc?.page ?? fallbackPage ?? null;
      if (!page) {
        toast.info('The reader did not record where on the page this was read');
        return;
      }
      const seq = revealSeq + 1;
      setRevealSeq(seq);
      setReveal({ seq, page, box: loc ? { x0: loc.x0, y0: loc.y0, x1: loc.x1, y1: loc.y1 } : null });
    },
    [locationMap, revealSeq],
  );

  // ---- Edit helpers ------------------------------------------------------
  const setDeclarantField = (key: string, value: unknown) => {
    setDraft(prev => {
      if (!prev) return prev;
      const d = { ...(prev.declarant ?? emptyDeclarant()) } as Declarant & Record<string, unknown>;
      d[key] = value;
      d.uncertainFields = (d.uncertainFields ?? []).filter(f => f !== key);
      d.correctedFields = Array.from(new Set([...(d.correctedFields ?? []), key]));
      return { ...prev, declarant: d };
    });
  };
  const setTop = <K extends keyof DisclosureExtraction>(key: K, value: DisclosureExtraction[K]) =>
    setDraft(prev => (prev ? { ...prev, [key]: value } : prev));
  const setRowField = (section: SectionKey, index: number, key: string, value: unknown) => {
    setDraft(prev => {
      if (!prev) return prev;
      const rows = [...rowsOf(prev, section)];
      rows[index] = { ...rows[index], [key]: value, corrected: true, uncertain: false };
      return { ...prev, [section]: rows };
    });
  };
  const addRow = (section: SectionDef) => {
    setDraft(prev => {
      if (!prev) return prev;
      const rows = [...rowsOf(prev, section.key), emptyRow(section)];
      const marked = prev.sectionsMarkedNone.filter(s => s !== section.key);
      return { ...prev, [section.key]: rows, sectionsMarkedNone: marked };
    });
  };
  const deleteRow = (section: SectionKey, index: number) => {
    setDraft(prev => {
      if (!prev) return prev;
      const rows = [...rowsOf(prev, section)];
      rows.splice(index, 1);
      // Keep ink provenance aligned: drop the deleted row's box and shift
      // later rows of the same section down one index.
      const locations = prev.locations
        ?.filter(l => l.key !== `${section}.${index}`)
        .map(l => {
          const m = l.key.match(/^([a-zA-Z]+)\.(\d+)$/);
          if (!m || m[1] !== section) return l;
          const i = Number(m[2]);
          return i > index ? { ...l, key: `${section}.${i - 1}` } : l;
        });
      return { ...prev, [section]: rows, ...(locations ? { locations } : {}) };
    });
  };
  const toggleMarkedNone = (section: SectionKey, on: boolean) => {
    setDraft(prev => {
      if (!prev) return prev;
      const set = new Set(prev.sectionsMarkedNone);
      if (on) set.add(section);
      else set.delete(section);
      return { ...prev, sectionsMarkedNone: [...set] };
    });
  };

  // ---- Actions -----------------------------------------------------------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: getListDeclarationIntakesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };

  const handleSaveDraft = () => {
    if (!draft) return;
    saveDraft.mutate(
      { caseId, data: pruneBlankRows(draft) },
      {
        onSuccess: () => {
          toast.success('Review saved - you can continue later');
          queryClient.invalidateQueries({ queryKey: getGetCaseDisclosureQueryKey(caseId) });
          queryClient.invalidateQueries({ queryKey: getGetDeclarationIntakeQueryKey(caseId) });
          invalidateLists();
        },
        onError: err => toast.error(`Could not save: ${apiErrorText(err)}`),
      },
    );
  };

  const declarantName = draft?.declarant?.name?.trim() ?? '';

  const handleConfirm = () => {
    if (!draft) return;
    if (!declarantName) {
      toast.error('The declarant name (إسم مقدم الإقرار) is required to register the case');
      return;
    }
    setConfirmOpen(false);
    confirm.mutate(
      { caseId, data: pruneBlankRows(draft) },
      {
        onSuccess: created => {
          toast.success(`Case #${created.id} registered for ${created.subjectName}`);
          invalidateLists();
          queryClient.invalidateQueries({ queryKey: getGetDeclarationIntakeQueryKey(caseId) });
          setLocation(`/cases/${created.id}`);
        },
        onError: err => toast.error(`Could not register the case: ${apiErrorText(err)}`),
      },
    );
  };

  const handleDiscard = () => {
    setDiscardOpen(false);
    discard.mutate(
      { caseId },
      {
        onSuccess: () => {
          toast.success('Pending declaration discarded');
          invalidateLists();
          setLocation('/register');
        },
        onError: err => toast.error(`Could not discard: ${apiErrorText(err)}`),
      },
    );
  };

  const handleReprocess = () => {
    reprocess.mutate(
      { caseId },
      {
        onSuccess: () => {
          toast.info('Reading the declaration again');
          queryClient.invalidateQueries({ queryKey: getGetCaseDisclosureQueryKey(caseId) });
        },
        onError: err => toast.error(`Could not restart the reading: ${apiErrorText(err)}`),
      },
    );
  };

  // ---- Review statistics -------------------------------------------------
  const stats = useMemo(() => {
    if (!draft) return { rows: 0, uncertain: 0 };
    let rows = 0;
    let uncertain = draft.declarant?.uncertainFields?.length ?? 0;
    for (const s of SECTIONS) {
      for (const r of rowsOf(draft, s.key)) {
        rows += 1;
        if (r.uncertain) uncertain += 1;
      }
    }
    return { rows, uncertain };
  }, [draft]);

  // ---- Guards ------------------------------------------------------------
  if (!Number.isFinite(caseId)) {
    return <Unavailable title="Unknown intake" body="This link does not point at a pending declaration." onBack={() => setLocation('/register')} />;
  }
  if (intakeQ.isLoading) {
    return <div className="h-[100dvh] flex items-center justify-center font-mono text-primary animate-pulse">Opening the declaration…</div>;
  }
  if (intakeQ.isError || !intake) {
    return (
      <Unavailable
        title="Intake not found"
        body="This pending declaration no longer exists - it may have been discarded or already registered."
        onBack={() => setLocation('/register')}
      />
    );
  }
  if (intake.caseStatus !== 'intake') {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-4" />
        <h2 className="text-xl font-mono uppercase tracking-widest mb-2">Already registered</h2>
        <p className="text-muted-foreground text-sm max-w-md mb-6">
          This declaration has been confirmed and is now case #{intake.caseId}
          {intake.declarantName ? (
            <>
              {' '}
              for <span className="font-arabic text-foreground" dir="rtl">{intake.declarantName}</span>
            </>
          ) : null}
          .
        </p>
        <Button onClick={() => setLocation(`/cases/${intake.caseId}`)} data-testid="btn-open-registered-case">
          Open the case <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
  }

  const busy = confirm.isPending || saveDraft.isPending || discard.isPending;

  return (
    <div className="h-[100dvh] flex flex-col bg-background" data-testid="page-declaration-review">
      {/* Header */}
      <header className="h-14 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between px-4 shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation('/register')} data-testid="btn-back-intake">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary">Declaration review</span>
              <span className="font-mono text-[10px] text-muted-foreground">intake #{caseId}</span>
            </div>
            <div className="text-sm truncate" dir="auto">
              {intake.filename}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {draft && (
            <>
              <span className="hidden lg:inline font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                {stats.rows} rows · {stats.uncertain} unsure{dirty ? ' · unsaved edits' : ''}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 font-mono text-xs"
                onClick={handleSaveDraft}
                disabled={busy || !dirty}
                data-testid="btn-save-review"
              >
                {saveDraft.isPending ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                Save review
              </Button>
              <Button
                size="sm"
                className="h-8 font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setConfirmOpen(true)}
                disabled={busy || !declarantName}
                data-testid="btn-confirm-register"
              >
                {confirm.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                Confirm & register case
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 font-mono text-xs text-muted-foreground hover:text-destructive"
            onClick={() => setDiscardOpen(true)}
            disabled={busy}
            data-testid="btn-discard-review"
          >
            <Trash2 className="h-3 w-3 mr-1" /> Discard
          </Button>
        </div>
      </header>

      {/* Split */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 border-r border-border">
          <DeclarationPdfPane
            caseId={caseId}
            reveal={reveal}
            detectedRotation={disclosure?.extraction?.pageRotation ?? null}
          />
        </div>

        <div className="w-1/2 flex flex-col overflow-hidden">
          {disclosureQ.isLoading || !disclosure ? (
            <div className="flex-1 flex items-center justify-center font-mono text-sm text-muted-foreground animate-pulse">
              Loading the reading…
            </div>
          ) : disclosure.status === 'processing' ? (
            <ProcessingPanel phase={disclosure.phase} />
          ) : disclosure.status === 'failed' ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
              <h2 className="text-lg font-mono text-destructive uppercase tracking-widest mb-2">Reading failed</h2>
              <p className="text-sm text-muted-foreground max-w-md mb-6">{disclosure.error ?? 'The AI readers could not process this PDF.'}</p>
              <Button onClick={handleReprocess} disabled={reprocess.isPending} data-testid="btn-reprocess">
                <RefreshCw className={`h-4 w-4 mr-2 ${reprocess.isPending ? 'animate-spin' : ''}`} /> Read again
              </Button>
            </div>
          ) : draft ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="max-w-3xl mx-auto p-6 space-y-6 pb-24">
                <ReadingSummary draft={draft} />

                {/* Declaration meta */}
                <section className="bg-card border border-border rounded-sm p-4 space-y-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-1 h-full bg-primary/60" />
                  <SectionTitle ar="نوع الإقرار وتاريخه" en="Declaration type and date" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="mb-1 text-right">
                        <span className="block font-arabic text-[13px]" dir="rtl">نوع الإقرار</span>
                        <span className="block font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Declaration type</span>
                      </div>
                      <select
                        dir="rtl"
                        value={draft.declarationType}
                        onChange={e => setTop('declarationType', e.target.value as DisclosureExtraction['declarationType'])}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 font-arabic text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="select-declaration-type"
                      >
                        {DECLARATION_TYPES.map(t => (
                          <option key={t.value} value={t.value}>
                            {t.ar} — {t.en}
                          </option>
                        ))}
                      </select>
                    </div>
                    <TextField
                      def={{ key: 'declarationDate', ar: 'تاريخ الإقرار', en: 'Declaration date', type: 'text', dir: 'ltr' }}
                      value={draft.declarationDate}
                      onChange={v => setTop('declarationDate', v)}
                      state="plain"
                      testId="input-declaration-date"
                    />
                  </div>
                </section>

                {/* Declarant */}
                <section className="bg-card border border-border rounded-sm p-4 space-y-4 relative overflow-hidden" data-testid="section-declarant">
                  <div className="absolute top-0 right-0 w-1 h-full bg-primary/60" />
                  <SectionTitle
                    ar="بيانات عن المقر (في بلد الإقامة)"
                    en="Declarant details"
                    page={draft.declarant?.page}
                    onReveal={() => revealKey('declarant', draft.declarant?.page)}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4" dir="rtl">
                    {DECLARANT_FIELDS.map(def => {
                      const d = (draft.declarant ?? emptyDeclarant()) as Declarant & Record<string, unknown>;
                      const state: FieldState = d.correctedFields?.includes(def.key)
                        ? 'corrected'
                        : d.uncertainFields?.includes(def.key)
                          ? 'uncertain'
                          : 'plain';
                      const onReveal = () => revealKey(`declarant.${def.key}`, d.page);
                      if (def.type === 'number') {
                        return (
                          <NumberField
                            key={def.key}
                            def={def}
                            value={d[def.key] as number | null}
                            onChange={v => setDeclarantField(def.key, v)}
                            state={state}
                            onReveal={onReveal}
                            testId={`input-declarant-${def.key}`}
                          />
                        );
                      }
                      return (
                        <TextField
                          key={def.key}
                          def={def}
                          value={d[def.key] as string | null}
                          onChange={v => setDeclarantField(def.key, v)}
                          state={state}
                          onReveal={onReveal}
                          testId={`input-declarant-${def.key}`}
                        />
                      );
                    })}
                  </div>
                  {draft.declarant?.alternates && draft.declarant.alternates.length > 0 && (
                    <Alternates items={draft.declarant.alternates} />
                  )}
                </section>

                {/* Sections 1-7 */}
                {SECTIONS.map(section => {
                  const rows = rowsOf(draft, section.key);
                  const markedNone = draft.sectionsMarkedNone.includes(section.key);
                  return (
                    <section
                      key={section.key}
                      className="bg-card border border-border rounded-sm p-4 space-y-4 relative overflow-hidden"
                      data-testid={`section-${section.key}`}
                    >
                      <div className={`absolute top-0 right-0 w-1 h-full ${rows.length > 0 ? 'bg-primary/60' : 'bg-border'}`} />
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <SectionTitle ar={`${section.ordinal} · ${section.ar}`} en={section.en} />
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={markedNone}
                            onChange={e => toggleMarkedNone(section.key, e.target.checked)}
                            className="accent-[hsl(var(--primary))]"
                            data-testid={`check-none-${section.key}`}
                          />
                          <span className="font-arabic text-sm" dir="rtl">لا يوجد</span>
                          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">marked none</span>
                        </label>
                      </div>

                      {rows.length === 0 ? (
                        <div className="text-xs text-muted-foreground font-mono border border-dashed border-border rounded-sm px-3 py-3">
                          {markedNone ? 'The declarant ticked "none" for this table.' : 'No rows were read in this table.'}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {rows.map((row, index) => (
                            <RowEditor
                              key={index}
                              section={section}
                              row={row}
                              index={index}
                              onChange={(key, value) => setRowField(section.key, index, key, value)}
                              onDelete={() => deleteRow(section.key, index)}
                              onReveal={() => revealKey(`${section.key}.${index}`, row.page)}
                            />
                          ))}
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 font-mono text-xs"
                        onClick={() => addRow(section)}
                        data-testid={`btn-add-${section.key}`}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add row
                      </Button>
                    </section>
                  );
                })}

                {/* General notes */}
                <section className="bg-card border border-border rounded-sm p-4 space-y-3">
                  <SectionTitle ar="ملاحظات عامة" en="General notes" />
                  <Textarea
                    dir="rtl"
                    value={draft.generalNotes ?? ''}
                    onChange={e => setTop('generalNotes', e.target.value === '' ? null : e.target.value)}
                    className="font-arabic text-[15px] min-h-[80px]"
                    data-testid="input-general-notes"
                  />
                </section>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center font-mono text-sm text-muted-foreground">
              No reading is available for this declaration.
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Register this case?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  A new case is opened for{' '}
                  <span className="font-arabic text-foreground" dir="rtl">
                    {declarantName}
                  </span>
                  {draft?.declarant?.civilId ? <span className="font-mono"> ({draft.declarant.civilId})</span> : null}. The reviewed
                  reading is stored as the verified declaration record and the case profile is filled from it.
                </p>
                {stats.uncertain > 0 && (
                  <p className="text-amber-400">
                    {stats.uncertain} value{stats.uncertain === 1 ? ' is' : 's are'} still flagged as unsure. You can register
                    anyway and correct them later in the case workbench.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} data-testid="btn-confirm-register-final">
              Register case
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this declaration?</AlertDialogTitle>
            <AlertDialogDescription>
              The uploaded PDF, the AI reading and your edits are deleted. No case is created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Pieces --------------------------------------------------------------

function Unavailable({ title, body, onBack }: { title: string; body: string; onBack: () => void }) {
  return (
    <div className="h-[100dvh] flex flex-col items-center justify-center p-6 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
      <h2 className="text-xl font-mono text-destructive uppercase tracking-widest mb-2">{title}</h2>
      <p className="text-muted-foreground text-sm max-w-md mb-6">{body}</p>
      <Button onClick={onBack}>Back to registration</Button>
    </div>
  );
}

function ProcessingPanel({ phase }: { phase: string | null | undefined }) {
  const cur = PIPELINE.findIndex(p => p.key === (phase ?? 'reading_primary'));
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-card border border-border rounded-sm p-6 space-y-5" data-testid="panel-processing">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-primary">AI is reading the handwriting</div>
            <div className="font-arabic text-sm text-muted-foreground" dir="rtl">جارٍ قراءة الإقرار المكتوب بخط اليد</div>
          </div>
        </div>
        <ol className="space-y-2">
          {PIPELINE.map((p, i) => {
            const state = i < cur ? 'done' : i === cur ? 'active' : 'pending';
            return (
              <li key={p.key} className="flex items-center gap-3 text-sm">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    state === 'done' ? 'bg-emerald-500' : state === 'active' ? 'bg-primary animate-pulse' : 'bg-border'
                  }`}
                />
                <span className={state === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>{p.label}</span>
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-muted-foreground">
          A 13-page declaration usually takes two to four minutes. You can leave this page; the reading continues and the
          declaration stays in the pending list.
        </p>
      </div>
    </div>
  );
}

function ReadingSummary({ draft }: { draft: DisclosureExtraction }) {
  const readers = draft.readers;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="reading-summary">
      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
        {readers ? `${readers.secondary ? 'Two readers' : 'One reader'}${readers.adjudicated ? ' · reconciled' : ''}` : 'AI reading'}
      </Badge>
      {draft.pageCount ? (
        <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
          {draft.pageCount} pages
        </Badge>
      ) : null}
      {draft.extractionWarnings.length > 0 && (
        <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-400 border-amber-500/30">
          <AlertTriangle className="h-3 w-3 mr-1" /> {draft.extractionWarnings.length} reader note
          {draft.extractionWarnings.length === 1 ? '' : 's'}
        </Badge>
      )}
      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        Amber boxes = the readers were unsure. Click the crosshair on any caption to see the ink.
      </span>
      {draft.extractionWarnings.length > 0 && (
        <ul className="w-full mt-1 space-y-1">
          {draft.extractionWarnings.map((w, i) => (
            <li key={i} className="text-xs text-amber-400/90 border-l-2 border-amber-500/40 pl-2">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionTitle({
  ar,
  en,
  page,
  onReveal,
}: {
  ar: string;
  en: string;
  page?: number | null;
  onReveal?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-right flex-1 min-w-0">
        <h3 className="font-arabic text-base font-medium leading-tight" dir="rtl">
          {ar}
        </h3>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{en}</div>
      </div>
      {onReveal && (
        <Button variant="ghost" size="sm" className="h-7 px-2 font-mono text-[10px]" onClick={onReveal}>
          <Crosshair className="h-3 w-3 mr-1" /> {page ? `page ${page}` : 'show'}
        </Button>
      )}
    </div>
  );
}

function Alternates({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" dir="rtl">
      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground" dir="ltr">
        other readings
      </span>
      {items.map((a, i) => (
        <span key={i} className="font-arabic text-xs px-1.5 py-0.5 rounded-sm border border-amber-500/30 bg-amber-500/10 text-amber-300">
          {a}
        </span>
      ))}
    </div>
  );
}

function RowEditor({
  section,
  row,
  index,
  onChange,
  onDelete,
  onReveal,
}: {
  section: SectionDef;
  row: SectionRow;
  index: number;
  onChange: (key: string, value: unknown) => void;
  onDelete: () => void;
  onReveal: () => void;
}) {
  const state: FieldState = row.corrected ? 'corrected' : row.uncertain ? 'uncertain' : 'plain';
  return (
    <div
      className={`rounded-sm border p-3 space-y-3 ${
        state === 'uncertain' ? 'border-amber-500/40 bg-amber-500/[0.03]' : 'border-border bg-background/40'
      }`}
      data-testid={`row-${section.key}-${index}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Row {index + 1}</span>
          {row.page ? <span className="font-mono text-[10px] text-muted-foreground">p.{row.page}</span> : null}
          {state === 'uncertain' && (
            <Badge variant="outline" className="font-mono text-[9px] uppercase bg-amber-500/15 text-amber-400 border-amber-500/30">
              unsure
            </Badge>
          )}
          {state === 'corrected' && (
            <Badge variant="outline" className="font-mono text-[9px] uppercase bg-primary/15 text-primary border-primary/30">
              edited
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 font-mono text-[10px]" onClick={onReveal} data-testid={`btn-reveal-${section.key}-${index}`}>
            <Crosshair className="h-3 w-3 mr-1" /> ink
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Remove this row"
            data-testid={`btn-delete-${section.key}-${index}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" dir="rtl">
        {section.fields.map(def => {
          const testId = `input-${section.key}-${index}-${def.key}`;
          if (def.type === 'number') {
            return (
              <NumberField
                key={def.key}
                def={def}
                value={row[def.key] as number | null}
                onChange={v => onChange(def.key, v)}
                state={state}
                testId={testId}
              />
            );
          }
          if (def.type === 'tristate') {
            return (
              <TristateField
                key={def.key}
                def={def}
                value={row[def.key] as boolean | null}
                onChange={v => onChange(def.key, v)}
                state={state}
                testId={testId}
                labels={{ yes: 'مدرجة', no: 'غير مدرجة' }}
              />
            );
          }
          return (
            <TextField
              key={def.key}
              def={def}
              value={row[def.key] as string | null}
              onChange={v => onChange(def.key, v)}
              state={state}
              testId={testId}
            />
          );
        })}
      </div>
      {row.asWritten ? (
        <div className="font-arabic text-xs text-muted-foreground text-right" dir="rtl">
          <span className="font-mono text-[9px] uppercase tracking-widest" dir="ltr">
            as written
          </span>{' '}
          {row.asWritten}
        </div>
      ) : null}
      {row.alternates && row.alternates.length > 0 ? <Alternates items={row.alternates} /> : null}
    </div>
  );
}
