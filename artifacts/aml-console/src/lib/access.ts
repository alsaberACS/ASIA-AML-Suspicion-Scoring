/**
 * Lightweight client-side access gate for the console landing page.
 *
 * NOTE: this is a presentation gate for demos — the code lives in the
 * browser bundle, so it keeps casual visitors out but is NOT real
 * authentication. Wire up server-side auth if this ever guards live data.
 */

const STORAGE_KEY = 'aml-console-access';
const ACCESS_CODE = 'A123';

export function isUnlocked(): boolean {
  try {
    // Dev-only convenience: ?access=<code> unlocks directly so preview
    // screenshots and local tooling can reach the console. Stripped from
    // production builds by the DEV guard.
    if (import.meta.env.DEV) {
      const qp = new URLSearchParams(window.location.search).get('access');
      if (qp && qp.trim() === ACCESS_CODE) {
        grantAccess();
        return true;
      }
    }
    return localStorage.getItem(STORAGE_KEY) === 'granted';
  } catch {
    return false;
  }
}

export function verifyAccessCode(code: string): boolean {
  return code.trim() === ACCESS_CODE;
}

export function grantAccess() {
  try {
    localStorage.setItem(STORAGE_KEY, 'granted');
  } catch {
    /* best-effort persistence */
  }
}

/** Relock the console (used from the settings menu) and return to the gate. */
export function lockConsole() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}
