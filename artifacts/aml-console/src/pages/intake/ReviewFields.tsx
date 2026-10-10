import { useEffect, useId, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { FieldDef } from './declarationForm';

/**
 * Inputs for the declaration review form. Captions come from the printed
 * form (Arabic first, English underneath); values are edited as written.
 */

export type FieldState = 'plain' | 'uncertain' | 'corrected';

const STATE_RING: Record<FieldState, string> = {
  plain: '',
  uncertain: 'border-amber-500/70 bg-amber-500/5 focus-visible:ring-amber-500/40',
  corrected: 'border-primary/70 bg-primary/5',
};

/** Arabic-Indic and Persian digits -> ASCII, thousands separators dropped. */
export function parseLooseNumber(text: string): number | null {
  const ascii = text
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,\u066c\s]/g, '')
    .replace(/\u066b/g, '.')
    .trim();
  if (ascii === '') return null;
  const n = Number(ascii);
  return Number.isFinite(n) ? n : null;
}

export function Caption({
  def,
  state,
  onReveal,
  htmlFor,
}: {
  def: Pick<FieldDef, 'ar' | 'en' | 'unit'>;
  state: FieldState;
  onReveal?: () => void;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 mb-1">
      <label htmlFor={htmlFor} className="min-w-0 flex-1 cursor-text">
        <span className="block font-arabic text-[13px] leading-tight text-foreground text-right" dir="rtl">
          {def.ar}
          {def.unit ? <span className="text-muted-foreground"> ({def.unit})</span> : null}
        </span>
        <span className="block font-mono text-[9px] uppercase tracking-widest text-muted-foreground text-right">
          {def.en}
          {state === 'uncertain' && <span className="text-amber-400"> · unsure</span>}
          {state === 'corrected' && <span className="text-primary"> · edited</span>}
        </span>
      </label>
      {onReveal && (
        <button
          type="button"
          onClick={onReveal}
          className="shrink-0 text-muted-foreground hover:text-primary transition-colors mt-0.5"
          title="Show where this was read on the page"
          aria-label={`Show ${def.en} on the original page`}
        >
          <Crosshair className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function TextField({
  def,
  value,
  onChange,
  state,
  onReveal,
  testId,
}: {
  def: FieldDef;
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  state: FieldState;
  onReveal?: () => void;
  testId: string;
}) {
  const id = useId();
  const listId = def.options ? `${id}-options` : undefined;
  return (
    <div className={def.wide ? 'md:col-span-2' : ''}>
      <Caption def={def} state={state} onReveal={onReveal} htmlFor={id} />
      <Input
        id={id}
        dir={def.dir}
        list={listId}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
        className={`h-9 ${def.dir === 'rtl' ? 'font-arabic text-[15px]' : 'font-mono text-sm'} ${STATE_RING[state]}`}
        autoComplete="off"
        data-testid={testId}
      />
      {listId && (
        <datalist id={listId}>
          {def.options!.map(o => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </div>
  );
}

export function NumberField({
  def,
  value,
  onChange,
  state,
  onReveal,
  testId,
}: {
  def: FieldDef;
  value: number | null | undefined;
  onChange: (next: number | null) => void;
  state: FieldState;
  onReveal?: () => void;
  testId: string;
}) {
  const id = useId();
  const [text, setText] = useState(value == null ? '' : String(value));
  // Keep the box in step with outside changes (fresh reading, row reorder).
  useEffect(() => {
    setText(prev => (parseLooseNumber(prev) === (value ?? null) ? prev : value == null ? '' : String(value)));
  }, [value]);
  return (
    <div className={def.wide ? 'md:col-span-2' : ''}>
      <Caption def={def} state={state} onReveal={onReveal} htmlFor={id} />
      <Input
        id={id}
        dir="ltr"
        inputMode="decimal"
        value={text}
        onChange={e => {
          setText(e.target.value);
          onChange(parseLooseNumber(e.target.value));
        }}
        onBlur={() => {
          const n = parseLooseNumber(text);
          setText(n == null ? '' : String(n));
        }}
        className={`h-9 font-mono text-sm tabular-nums ${STATE_RING[state]}`}
        autoComplete="off"
        data-testid={testId}
      />
    </div>
  );
}

export function TristateField({
  def,
  value,
  onChange,
  state,
  onReveal,
  testId,
  labels,
}: {
  def: FieldDef;
  value: boolean | null | undefined;
  onChange: (next: boolean | null) => void;
  state: FieldState;
  onReveal?: () => void;
  testId: string;
  labels: { yes: string; no: string };
}) {
  const id = useId();
  return (
    <div className={def.wide ? 'md:col-span-2' : ''}>
      <Caption def={def} state={state} onReveal={onReveal} htmlFor={id} />
      <select
        id={id}
        dir="rtl"
        value={value === true ? 'yes' : value === false ? 'no' : ''}
        onChange={e => onChange(e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null)}
        className={`h-9 w-full rounded-md border border-input bg-background px-3 font-arabic text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${STATE_RING[state]}`}
        data-testid={testId}
      >
        <option value="">—</option>
        <option value="yes">{labels.yes}</option>
        <option value="no">{labels.no}</option>
      </select>
    </div>
  );
}
