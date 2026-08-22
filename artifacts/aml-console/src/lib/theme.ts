export type ThemeId =
  | 'cyan'
  | 'emerald'
  | 'amber'
  | 'violet'
  | 'ice'
  | 'paper'
  | 'light'
  | 'mist';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  tagline: string;
  /** Preview swatches: [base, primary accent, secondary accent] */
  swatches: [string, string, string];
}

export const THEMES: ThemeOption[] = [
  {
    id: 'cyan',
    label: 'Cyan Command',
    tagline: 'Electric cyan on deep navy — default',
    swatches: ['hsl(222 47% 10%)', 'hsl(190 90% 50%)', 'hsl(210 80% 60%)'],
  },
  {
    id: 'emerald',
    label: 'Emerald Terminal',
    tagline: 'Phosphor green on dark teal',
    swatches: ['hsl(170 35% 10%)', 'hsl(152 76% 46%)', 'hsl(175 70% 45%)'],
  },
  {
    id: 'amber',
    label: 'Amber Watch',
    tagline: 'Warm amber on smoked charcoal',
    swatches: ['hsl(28 16% 10%)', 'hsl(38 95% 54%)', 'hsl(20 85% 55%)'],
  },
  {
    id: 'violet',
    label: 'Violet Recon',
    tagline: 'Neon violet on midnight purple',
    swatches: ['hsl(252 32% 11%)', 'hsl(262 85% 66%)', 'hsl(290 70% 60%)'],
  },
  {
    id: 'ice',
    label: 'Arctic Ice',
    tagline: 'Glacier blue on cold steel',
    swatches: ['hsl(215 40% 10%)', 'hsl(205 90% 62%)', 'hsl(190 80% 55%)'],
  },
  {
    id: 'paper',
    label: 'Paper White',
    tagline: 'Brightest - dark ink on pure white',
    swatches: ['hsl(0 0% 100%)', 'hsl(190 95% 29%)', 'hsl(215 75% 46%)'],
  },
  {
    id: 'light',
    label: 'Daylight',
    tagline: 'Soft off-white with white panels',
    swatches: ['hsl(210 30% 96%)', 'hsl(190 95% 29%)', 'hsl(215 75% 46%)'],
  },
  {
    id: 'mist',
    label: 'Slate Mist',
    tagline: 'Muted light gray-blue - lowest glare',
    swatches: ['hsl(215 22% 90%)', 'hsl(191 90% 28%)', 'hsl(170 75% 27%)'],
  },
];

/** Theme ids that render dark ink on light surfaces. */
export const LIGHT_THEME_IDS: ReadonlySet<ThemeId> = new Set(['paper', 'light', 'mist']);

const STORAGE_KEY = 'aml-console-theme';

export function getSavedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    /* storage unavailable — fall through to default */
  }
  return 'cyan';
}

function setRootTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === 'cyan') delete root.dataset.theme;
  else root.dataset.theme = id;
}

export function applyTheme(id: ThemeId) {
  setRootTheme(id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* persistence is best-effort */
  }
}

/** Apply the saved theme before first render to avoid a color flash. */
export function initTheme() {
  let id = getSavedTheme();
  try {
    // ?theme=... previews a theme via URL without persisting it.
    const q = new URLSearchParams(window.location.search).get('theme');
    if (q && THEMES.some((t) => t.id === q)) id = q as ThemeId;
  } catch {
    /* URL unavailable - keep saved theme */
  }
  setRootTheme(id);
}
