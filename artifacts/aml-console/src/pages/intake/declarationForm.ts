import type { DisclosureExtraction } from '@workspace/api-client-react';

/**
 * Field captions for the Nazaha financial disclosure form (إقرار الذمة
 * المالية). Arabic captions are copied from the printed form so the
 * investigator can compare the AI reading against the ink box by box;
 * English is the console's working language. Values stay in Arabic exactly
 * as written - nothing here translates data.
 */

export type SectionKey =
  | 'minorChildren'
  | 'realEstate'
  | 'usufructRights'
  | 'securities'
  | 'bankAccountsAndDeposits'
  | 'debtsOwed'
  | 'valuableMovables';

export type FieldType = 'text' | 'number' | 'tristate';

export interface FieldDef {
  key: string;
  ar: string;
  en: string;
  type: FieldType;
  /** Text direction for the input: Arabic prose is rtl; ids, phones, dates, amounts are ltr. */
  dir: 'rtl' | 'ltr';
  /** Tick-box values printed on the form, offered as suggestions (free text still allowed). */
  options?: string[];
  /** Span the full row of the editor grid. */
  wide?: boolean;
  /** Unit hint shown inside the input. */
  unit?: string;
}

export interface SectionDef {
  key: SectionKey;
  /** Arabic-Indic ordinal as printed on the form tabs. */
  ordinal: string;
  ar: string;
  en: string;
  /** The form column that identifies a row; a row without it is dropped. */
  labelKey: string;
  fields: FieldDef[];
}

export const DECLARATION_TYPES: { value: DisclosureExtraction['declarationType']; ar: string; en: string }[] = [
  { value: 'first', ar: 'إقرار أول', en: 'First declaration' },
  { value: 'update', ar: 'تحديث', en: 'Update' },
  { value: 'final', ar: 'إقرار نهائي', en: 'Final declaration' },
  { value: 'unknown', ar: 'غير محدد', en: 'Not marked' },
];

export const GENDER_OPTIONS = ['ذكر', 'أنثى'];

/** بيانات عن المقر (في بلد الإقامة) - page 2 of the form. */
export const DECLARANT_FIELDS: FieldDef[] = [
  { key: 'name', ar: 'إسم مقدم الإقرار', en: 'Declarant name', type: 'text', dir: 'rtl', wide: true },
  { key: 'gender', ar: 'الجنس', en: 'Gender', type: 'text', dir: 'rtl', options: GENDER_OPTIONS },
  { key: 'nationality', ar: 'الجنسية', en: 'Nationality', type: 'text', dir: 'rtl' },
  { key: 'civilId', ar: 'رقم البطاقة المدنية', en: 'Civil ID', type: 'text', dir: 'ltr' },
  { key: 'passportNo', ar: 'رقم جواز السفر', en: 'Passport no.', type: 'text', dir: 'ltr' },
  { key: 'residenceCountry', ar: 'بلد الإقامة', en: 'Country of residence', type: 'text', dir: 'rtl' },
  { key: 'jobTitle', ar: 'الوظيفة / الصفة', en: 'Position / capacity', type: 'text', dir: 'rtl' },
  { key: 'employer', ar: 'الجهة', en: 'Employer', type: 'text', dir: 'rtl' },
  { key: 'jobStartDate', ar: 'تاريخ شغلها', en: 'Held since', type: 'text', dir: 'ltr' },
  { key: 'jobEndDate', ar: 'تاريخ تركها', en: 'Left on', type: 'text', dir: 'ltr' },
  { key: 'workPhone', ar: 'تلفون العمل', en: 'Work phone', type: 'text', dir: 'ltr' },
  { key: 'mobile', ar: 'نقال', en: 'Mobile', type: 'text', dir: 'ltr' },
  { key: 'homeAddress', ar: 'عنوان السكن', en: 'Home address', type: 'text', dir: 'rtl', wide: true },
  { key: 'homePhone', ar: 'تلفون السكن', en: 'Home phone', type: 'text', dir: 'ltr' },
  { key: 'email', ar: 'البريد الالكتروني', en: 'Email', type: 'text', dir: 'ltr' },
  {
    key: 'monthlySalaryKwd',
    ar: 'إجمالي الراتب الثابت شهرياً',
    en: 'Fixed monthly salary',
    type: 'number',
    dir: 'ltr',
    unit: 'د.ك',
  },
];

const NOTES: FieldDef = { key: 'notes', ar: 'ملاحظات', en: 'Notes', type: 'text', dir: 'rtl', wide: true };

export const SECTIONS: SectionDef[] = [
  {
    key: 'minorChildren',
    ordinal: '١',
    ar: 'أولاد المقر القصر ومن في ولايته أو وصايته أو قوامته',
    en: 'Minor children and wards',
    labelKey: 'name',
    fields: [
      { key: 'name', ar: 'الإسم', en: 'Name', type: 'text', dir: 'rtl', wide: true },
      { key: 'dateOfBirth', ar: 'تاريخ الميلاد', en: 'Date of birth', type: 'text', dir: 'ltr' },
      { key: 'relation', ar: 'الصلة', en: 'Relation', type: 'text', dir: 'rtl', options: ['ولي', 'وصي', 'قيم'] },
      { key: 'idType', ar: 'نوع الإثبات', en: 'ID type', type: 'text', dir: 'rtl', options: ['بطاقة مدنية', 'جواز سفر'] },
      { key: 'idNumber', ar: 'رقم الإثبات', en: 'ID number', type: 'text', dir: 'ltr' },
      NOTES,
    ],
  },
  {
    key: 'realEstate',
    ordinal: '٢',
    ar: 'العقارات المملوكة كلياً أو جزئياً',
    en: 'Real estate owned',
    labelKey: 'location',
    fields: [
      { key: 'ownerName', ar: 'إسم المالك', en: 'Owner', type: 'text', dir: 'rtl' },
      { key: 'location', ar: 'موقع العقار', en: 'Location', type: 'text', dir: 'rtl' },
      { key: 'areaSqm', ar: 'مساحة العقار', en: 'Area', type: 'number', dir: 'ltr', unit: 'م²' },
      { key: 'ownershipPct', ar: 'نسبة الملكية', en: 'Ownership', type: 'number', dir: 'ltr', unit: '%' },
      {
        key: 'propertyType',
        ar: 'نوع العقار',
        en: 'Property type',
        type: 'text',
        dir: 'rtl',
        options: ['سكني', 'استثماري', 'تجاري', 'أخرى'],
      },
      NOTES,
    ],
  },
  {
    key: 'usufructRights',
    ordinal: '٣',
    ar: 'حقوق الانتفاع',
    en: 'Usufruct rights',
    labelKey: 'location',
    fields: [
      { key: 'beneficiaryName', ar: 'إسم المنتفع', en: 'Beneficiary', type: 'text', dir: 'rtl' },
      { key: 'location', ar: 'موقع حق الانتفاع', en: 'Location', type: 'text', dir: 'rtl' },
      { key: 'areaSqm', ar: 'المساحة', en: 'Area', type: 'number', dir: 'ltr', unit: 'م²' },
      {
        key: 'usageType',
        ar: 'النوع',
        en: 'Usage type',
        type: 'text',
        dir: 'rtl',
        options: ['شاليه', 'صناعي', 'زراعي', 'ثروة حيوانية', 'أخرى'],
      },
      NOTES,
    ],
  },
  {
    key: 'securities',
    ordinal: '٤',
    ar: 'الأوراق المالية والحصص في الشركات',
    en: 'Securities and company shares',
    labelKey: 'company',
    fields: [
      { key: 'ownerName', ar: 'إسم المالك', en: 'Owner', type: 'text', dir: 'rtl' },
      { key: 'instrumentType', ar: 'النوع', en: 'Instrument', type: 'text', dir: 'rtl', options: ['أسهم', 'سندات', 'صكوك', 'حصة في شركة', 'وحدات صندوق'] },
      { key: 'quantityOrPct', ar: 'العدد والنسبة', en: 'Quantity / %', type: 'text', dir: 'ltr' },
      { key: 'company', ar: 'إسم الشركة أو جهة الإصدار', en: 'Company / issuer', type: 'text', dir: 'rtl' },
      { key: 'companyCountry', ar: 'جنسية الشركة أو جهة الإصدار', en: 'Issuer country', type: 'text', dir: 'rtl' },
      { key: 'listed', ar: 'مدرجة / غير مدرجة', en: 'Listed', type: 'tristate', dir: 'rtl' },
      NOTES,
    ],
  },
  {
    key: 'bankAccountsAndDeposits',
    ordinal: '٥',
    ar: 'الودائع والحسابات البنكية والديون التي لصالح المقر',
    en: 'Deposits, bank accounts and receivables',
    labelKey: 'institution',
    fields: [
      { key: 'ownerName', ar: 'الإسم', en: 'Owner', type: 'text', dir: 'rtl' },
      { key: 'institution', ar: 'إسم المدين أو المودع لديه أو البنك', en: 'Bank / debtor', type: 'text', dir: 'rtl' },
      { key: 'institutionCountry', ar: 'جنسية الجهة المدينة', en: 'Country', type: 'text', dir: 'rtl' },
      {
        key: 'kind',
        ar: 'نوع الدين أو الوديعة أو الحساب',
        en: 'Kind',
        type: 'text',
        dir: 'rtl',
        options: ['دين', 'وديعة', 'حساب بنكي'],
      },
      { key: 'valueKwd', ar: 'القيمة', en: 'Value', type: 'number', dir: 'ltr', unit: 'د.ك' },
      NOTES,
    ],
  },
  {
    key: 'debtsOwed',
    ordinal: '٦',
    ar: 'الديون التي على المقر',
    en: 'Debts owed by the declarant',
    labelKey: 'creditor',
    fields: [
      { key: 'debtorName', ar: 'إسم المدين', en: 'Debtor', type: 'text', dir: 'rtl' },
      { key: 'creditor', ar: 'إسم البنك أو جهة الإقراض أو الدائن', en: 'Creditor', type: 'text', dir: 'rtl' },
      { key: 'creditorCountry', ar: 'جنسية الجهة الدائنة', en: 'Creditor country', type: 'text', dir: 'rtl' },
      { key: 'amountKwd', ar: 'قيمة الدين', en: 'Amount', type: 'number', dir: 'ltr', unit: 'د.ك' },
      { key: 'finalRepaymentDate', ar: 'تاريخ السداد النهائي', en: 'Final repayment', type: 'text', dir: 'ltr' },
      NOTES,
    ],
  },
  {
    key: 'valuableMovables',
    ordinal: '٧',
    ar: 'المنقولات ذات القيمة',
    en: 'Valuable movables',
    labelKey: 'description',
    fields: [
      { key: 'ownerName', ar: 'إسم المالك', en: 'Owner', type: 'text', dir: 'rtl' },
      { key: 'count', ar: 'العدد', en: 'Count', type: 'number', dir: 'ltr' },
      { key: 'description', ar: 'الوصف', en: 'Description', type: 'text', dir: 'rtl' },
      { key: 'totalValueKwd', ar: 'إجمالي القيمة', en: 'Total value', type: 'number', dir: 'ltr', unit: 'د.ك' },
      NOTES,
    ],
  },
];

export const SECTION_BY_KEY: Record<SectionKey, SectionDef> = Object.fromEntries(
  SECTIONS.map(s => [s.key, s]),
) as Record<SectionKey, SectionDef>;

/** A generic view of any section row for the editor. */
export type SectionRow = Record<string, unknown> & {
  uncertain?: boolean;
  page?: number | null;
  asWritten?: string | null;
  alternates?: string[];
  corrected?: boolean;
};

export function emptyRow(section: SectionDef): SectionRow {
  const row: SectionRow = { uncertain: false, corrected: true, page: null, asWritten: null, alternates: [] };
  for (const f of section.fields) row[f.key] = f.type === 'tristate' ? null : f.type === 'number' ? null : f.key === section.labelKey ? '' : null;
  return row;
}

export function rowsOf(x: DisclosureExtraction, key: SectionKey): SectionRow[] {
  return (x[key] as unknown as SectionRow[]) ?? [];
}

/** Rows whose identifying column is blank are dropped before saving. */
export function rowIsBlank(section: SectionDef, row: SectionRow): boolean {
  const label = row[section.labelKey];
  return typeof label !== 'string' || label.trim().length === 0;
}

export function formatKwd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })} د.ك`;
}
