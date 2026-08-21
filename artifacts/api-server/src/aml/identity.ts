/**
 * Counterparty identity resolution.
 *
 * Statements surface the same real-world counterparty in three shapes:
 *   1. proper names, with truncation and initials ("ANWAR H A" / "ANWAR HAMAD ALI"),
 *   2. masked account references ("Account 100600XXXX"),
 *   3. masked payment-rail references ("InstaPay 6999XXXX").
 *
 * This module assigns every raw counterparty string a stable identity key and
 * clusters keys that very likely denote the same party, so fan-in, HHI,
 * funnel and cross-bank bridging count PARTIES instead of SPELLINGS.
 *
 * Matching is deliberately conservative and auditable:
 *   - reference identities merge only on literally identical visible fragments;
 *   - name identities merge only under mutual token coverage (every token of
 *     each side is matched by the other side, exactly or by initial) with at
 *     least one shared substantive token. "MOHAMMED A" and "MOHAMMED K"
 *     conflict on initials and stay apart; a lone shared first name is never
 *     enough to merge.
 */

export type IdentityKind = "name" | "account_ref" | "instapay_ref";

export interface CounterpartyIdentity {
  kind: IdentityKind;
  /** Canonical pre-clustering key, e.g. "acct:100600XXXX" or "name:ANWAR H A". */
  key: string;
  /** Original (trimmed) string for display. */
  display: string;
  /** Canonical name tokens (empty for reference identities). */
  tokens: string[];
}

const HONORIFICS = new Set([
  "MR", "MRS", "MS", "DR", "ENG", "SHEIKH", "SHAIKH", "SAYED", "SAYYID", "SYED",
]);

const LEGAL_SUFFIXES = new Set([
  "CO", "COMPANY", "EST", "ESTABLISHMENT", "LLC", "WLL", "KSC", "KSCC", "KSCP",
  "SAL", "FZE", "FZC", "LTD", "LIMITED", "INC", "CORP", "SPC", "SARL",
]);

/**
 * Identity-specific normalization. Unlike display-name normalization this
 * PRESERVES digits: "01673XXXXX" and "00077XXXXX" are different masked
 * fragments and must never collapse into one phantom party, and a trailing
 * number can be the only thing distinguishing two entity names.
 */
function normalizeIdentityText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\bAL[\s-]+(?=[A-Z0-9])/g, "AL")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalNameTokens(raw: string): string[] {
  let tokens = normalizeIdentityText(raw)
    .split(" ")
    .filter((t) => t.length > 0);
  while (tokens.length > 1 && HONORIFICS.has(tokens[0]!)) tokens = tokens.slice(1);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens = tokens.slice(0, -1);
  }
  return tokens;
}

export function parseIdentity(raw: string | null | undefined): CounterpartyIdentity | null {
  if (!raw) return null;
  const display = raw.replace(/\s+/g, " ").trim();
  if (display.length === 0) return null;

  let m = display.match(/^account\s+([0-9X]{3,})$/i);
  if (m) {
    return { kind: "account_ref", key: `acct:${m[1]!.toUpperCase()}`, display, tokens: [] };
  }
  m = display.match(/^instapay\s+([0-9X][0-9X-]{2,})$/i);
  if (m) {
    return { kind: "instapay_ref", key: `ip:${m[1]!.toUpperCase()}`, display, tokens: [] };
  }
  const tokens = canonicalNameTokens(display);
  if (tokens.length === 0) return null;
  return { kind: "name", key: `name:${tokens.join(" ")}`, display, tokens };
}

const isSubstantive = (t: string): boolean => t.length >= 3;
const isInitial = (t: string): boolean => t.length <= 2;

/** True when `initial` plausibly abbreviates `token` ("H" ~ "HAMAD", "AB" ~ "ABDULLA"). */
function initialCovers(initial: string, token: string): boolean {
  return token.startsWith(initial);
}

/** Every token of `a` is matched in `b`: exact, or by initial<->token coverage. */
function coveredBy(a: string[], b: string[]): boolean {
  return a.every((ta) => {
    if (b.includes(ta)) return true;
    if (isInitial(ta)) return b.some((tb) => initialCovers(ta, tb));
    return b.some((tb) => isInitial(tb) && initialCovers(tb, ta));
  });
}

/**
 * Conservative same-person test for canonical token arrays: mutual coverage
 * plus at least one shared substantive token. Identical token sets share a
 * key already, so this only decides variant merges.
 */
export function namesLikelySame(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const shared = a.filter((t) => isSubstantive(t) && b.includes(t));
  if (shared.length === 0) return false;
  return coveredBy(a, b) && coveredBy(b, a);
}

/**
 * True when an extracted name carries no information beyond the subject
 * themself (e.g. an inward SWIFT line that repeats the beneficiary's own
 * name). Such strings must not be presented as counterparties.
 */
export function nameRefersToSubject(raw: string, subjectName: string): boolean {
  const tokens = canonicalNameTokens(raw);
  const subject = canonicalNameTokens(subjectName);
  if (tokens.length === 0 || subject.length === 0) return false;
  return coveredBy(tokens, subject);
}

export interface IdentityIndex {
  /** Cluster key for a raw counterparty string (null when unusable). */
  keyOf(raw: string | null | undefined): string | null;
  /** Best display string for a cluster key. */
  displayOf(clusterKey: string): string;
  /** Identity kind for a cluster key. */
  kindOf(clusterKey: string): IdentityKind;
  /** Number of distinct clusters seen at build time. */
  size: number;
}

/**
 * Build an identity index over every counterparty string observed in a case.
 * Reference identities cluster by literal fragment equality; name identities
 * additionally merge under `namesLikelySame` via union-find.
 */
export function buildIdentityIndex(raws: Iterable<string | null | undefined>): IdentityIndex {
  interface Node {
    key: string;
    kind: IdentityKind;
    tokens: string[];
    displays: Map<string, number>;
  }
  const nodes = new Map<string, Node>();
  const rawToKey = new Map<string, string>();

  for (const raw of raws) {
    const id = parseIdentity(raw);
    if (!id) continue;
    const rawNorm = id.display.toUpperCase();
    rawToKey.set(rawNorm, id.key);
    let node = nodes.get(id.key);
    if (!node) {
      node = { key: id.key, kind: id.kind, tokens: id.tokens, displays: new Map() };
      nodes.set(id.key, node);
    }
    node.displays.set(id.display, (node.displays.get(id.display) ?? 0) + 1);
  }

  // Union-find over name nodes.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(k, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const k of nodes.keys()) parent.set(k, k);

  const nameNodes = [...nodes.values()].filter((n) => n.kind === "name");
  for (let i = 0; i < nameNodes.length; i++) {
    for (let j = i + 1; j < nameNodes.length; j++) {
      if (namesLikelySame(nameNodes[i]!.tokens, nameNodes[j]!.tokens)) {
        union(nameNodes[i]!.key, nameNodes[j]!.key);
      }
    }
  }

  // Choose cluster representatives: the member with the most name tokens,
  // breaking ties by observation count (favors the fullest spelling).
  const clusterMembers = new Map<string, Node[]>();
  for (const node of nodes.values()) {
    const root = find(node.key);
    const arr = clusterMembers.get(root);
    if (arr) arr.push(node);
    else clusterMembers.set(root, [node]);
  }
  const clusterDisplay = new Map<string, string>();
  const clusterKind = new Map<string, IdentityKind>();
  for (const [root, members] of clusterMembers) {
    let best: { display: string; substantive: number; length: number; count: number } | null = null;
    for (const member of members) {
      const substantive = member.tokens.filter(isSubstantive).length;
      for (const [display, count] of member.displays) {
        const cand = { display, substantive, length: display.length, count };
        const better =
          !best ||
          cand.substantive > best.substantive ||
          (cand.substantive === best.substantive &&
            (cand.length > best.length ||
              (cand.length === best.length && cand.count > best.count)));
        if (better) best = cand;
      }
    }
    clusterDisplay.set(root, best?.display ?? root);
    clusterKind.set(root, members[0]!.kind);
  }

  return {
    keyOf(raw) {
      if (!raw) return null;
      const rawNorm = raw.replace(/\s+/g, " ").trim().toUpperCase();
      const key = rawToKey.get(rawNorm);
      if (key) return find(key);
      const id = parseIdentity(raw);
      return id ? find(id.key) : null;
    },
    displayOf(clusterKey) {
      return clusterDisplay.get(clusterKey) ?? clusterKey.replace(/^(name|acct|ip):/, "");
    },
    kindOf(clusterKey) {
      return clusterKind.get(clusterKey) ?? "name";
    },
    size: clusterMembers.size,
  };
}
