import {
  getGetCaseDeclarationQueryKey,
  useGetCaseDeclaration,
  type DeclarationItem,
  type Disclosure,
} from '@workspace/api-client-react';
import { Database, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DECLARATION_TYPES, SECTIONS, formatKwd, type SectionKey } from '@/pages/intake/declarationForm';

/**
 * The structured declaration record stored for the case (declarant + one row
 * per declared item), as opposed to the raw AI reading shown in the workbench.
 * Values are Arabic as written on the form.
 */
export default function DeclarationRecordCard({
  caseId,
  disclosure,
}: {
  caseId: number;
  disclosure: Disclosure | undefined;
}) {
  const ready = disclosure?.status === 'ready';
  const { data, isLoading } = useGetCaseDeclaration(caseId, {
    query: {
      // The record is rewritten whenever the reading or its corrections
      // change; keying on those stamps refetches it in step.
      queryKey: [...getGetCaseDeclarationQueryKey(caseId), disclosure?.extractedAt ?? '', disclosure?.correctedAt ?? ''],
      enabled: ready,
      retry: false,
    },
  });
  if (!ready) return null;
  if (isLoading) {
    return (
      <div className="border border-border rounded-sm p-4 font-mono text-xs text-muted-foreground animate-pulse">
        Loading the declaration record…
      </div>
    );
  }
  if (!data || !data.declarant) return null;
  const d = data.declarant;
  const verified = d.source === 'investigator' && !!d.verifiedAt;
  const typeLabel = DECLARATION_TYPES.find(t => t.value === d.declarationType);
  const bySection = new Map<SectionKey, DeclarationItem[]>();
  for (const item of data.items) {
    const list = bySection.get(item.section) ?? [];
    list.push(item);
    bySection.set(item.section, list);
  }

  const facts: { ar: string; en: string; value: string | null | undefined; ltr?: boolean }[] = [
    { ar: 'إسم مقدم الإقرار', en: 'Declarant', value: d.fullName },
    { ar: 'رقم البطاقة المدنية', en: 'Civil ID', value: d.civilId, ltr: true },
    { ar: 'الجنسية', en: 'Nationality', value: d.nationality },
    { ar: 'بلد الإقامة', en: 'Residence', value: d.residenceCountry },
    { ar: 'الوظيفة / الجهة', en: 'Position / employer', value: [d.jobTitle, d.employer].filter(Boolean).join(' - ') || null },
    { ar: 'الراتب الشهري', en: 'Monthly salary', value: d.monthlySalaryKwd != null ? formatKwd(d.monthlySalaryKwd) : null, ltr: true },
    { ar: 'نقال', en: 'Mobile', value: d.mobile, ltr: true },
    { ar: 'البريد الالكتروني', en: 'Email', value: d.email, ltr: true },
    { ar: 'عنوان السكن', en: 'Address', value: d.homeAddress },
    { ar: 'نوع الإقرار', en: 'Declaration', value: typeLabel ? `${typeLabel.ar}${d.declarationDate ? ` · ${d.declarationDate}` : ''}` : d.declarationDate },
  ];

  return (
    <div className="border border-border rounded-sm bg-card/60 overflow-hidden" data-testid="card-declaration-record">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card/80">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs uppercase tracking-widest text-foreground">Declaration record</span>
          <span className="font-arabic text-sm text-muted-foreground" dir="rtl">
            سجل الإقرار
          </span>
        </div>
        {verified ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
            <ShieldCheck className="h-3 w-3 mr-1" /> Verified by investigator
          </Badge>
        ) : (
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-400 border-amber-500/30">
            <ShieldQuestion className="h-3 w-3 mr-1" /> AI reading - not yet verified
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-3 px-4 py-3" dir="rtl">
        {facts.map(f => (
          <div key={f.en} className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground text-right" dir="ltr">
              {f.en}
            </div>
            <div className={`${f.ltr ? 'font-mono text-xs' : 'font-arabic text-sm'} truncate`} dir={f.ltr ? 'ltr' : 'rtl'} title={f.value ?? undefined}>
              {f.value || <span className="text-muted-foreground">—</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border divide-y divide-border">
        {SECTIONS.map(section => {
          const items = bySection.get(section.key) ?? [];
          const markedNone = d.sectionsMarkedNone.includes(section.key);
          const total = items.reduce((sum, i) => sum + (i.valueKwd ?? 0), 0);
          const hasValues = items.some(i => i.valueKwd != null);
          return (
            <div key={section.key} className="px-4 py-2.5" data-testid={`record-section-${section.key}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] text-primary w-4 text-center">{section.ordinal}</span>
                  <span className="font-arabic text-sm truncate" dir="rtl">
                    {section.ar}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground hidden md:inline">{section.en}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {items.length > 0 ? (
                    <span>
                      {items.length} row{items.length === 1 ? '' : 's'}
                    </span>
                  ) : markedNone ? (
                    <span className="font-arabic text-xs" dir="rtl">
                      لا يوجد
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                  {hasValues && <span className="text-foreground">{formatKwd(total)}</span>}
                </div>
              </div>
              {items.length > 0 && (
                <ul className="mt-1.5 space-y-1" dir="rtl">
                  {items.map(item => (
                    <li key={item.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate">
                        <span className="font-arabic text-[13px]">{item.label}</span>
                        {item.ownerName && item.ownerName !== item.label ? (
                          <span className="font-arabic text-muted-foreground"> · {item.ownerName}</span>
                        ) : null}
                        {item.kind ? <span className="font-arabic text-muted-foreground"> · {item.kind}</span> : null}
                        {item.quantityOrPct ? <span className="font-mono text-muted-foreground" dir="ltr"> · {item.quantityOrPct}</span> : null}
                        {item.itemCount != null ? <span className="font-mono text-muted-foreground" dir="ltr"> · ×{item.itemCount}</span> : null}
                        {item.areaSqm != null ? <span className="font-mono text-muted-foreground" dir="ltr"> · {item.areaSqm} م²</span> : null}
                        {item.dateText ? <span className="font-mono text-muted-foreground" dir="ltr"> · {item.dateText}</span> : null}
                        {item.idNumber ? <span className="font-mono text-muted-foreground" dir="ltr"> · {item.idNumber}</span> : null}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums" dir="ltr">
                        {item.valueKwd != null ? formatKwd(item.valueKwd) : ''}
                        {item.uncertain ? <span className="text-amber-400 ml-1">?</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
