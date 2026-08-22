import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { XMLParser } from "fast-xml-parser";
import { logger } from "../lib/logger";
import { canonicalNameTokens, namesLikelySame, nameRefersToSubject, parseIdentity } from "./identity";
import type { Txn } from "./types";

/**
 * Sanctions screening layer (sanctions-v1.0).
 *
 * Screens the case subject and all named counterparties against the two
 * primary public sanctions lists:
 *   - OFAC Specially Designated Nationals (SDN), including official aliases
 *   - UN Security Council Consolidated List (individuals + entities)
 *
 * Design rules, mirroring the rest of the engine:
 *   - EVIDENCE ONLY: results never feed the Bayesian score. A sanctions hit
 *     is presented to the analyst; it does not move the probability.
 *   - HONEST FAILURE: if neither a fresh download nor a cached copy of a
 *     list is available, the run is marked "unavailable" with the reason -
 *     never silently treated as "no matches".
 *   - Conservative matching with explicit tiers (exact / strong / possible)
 *     built on the same canonical-token machinery used for identity
 *     clustering, so behaviour is consistent across the engine.
 */

export const SANCTIONS_ENGINE_VERSION = "sanctions-v1.0";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh daily
const FETCH_TIMEOUT_MS = 45_000;
const MAX_MATCHES_PER_NAME = 5;
const MAX_COUNTERPARTY_RESULTS = 25;
// Floors guard against a truncated download or corrupted cache parsing
// "successfully" into a near-empty list and producing a false clean result.
const MIN_OFAC_ENTRIES = 1000; // real list: ~19k entries
const MIN_UN_ENTRIES = 100; // real list: ~1k entries
// An analyze request never waits longer than this for a cold list load.
const SCREEN_WAIT_MS = 25_000;

const SOURCES = {
  ofac_sdn: {
    label: "OFAC Specially Designated Nationals (SDN)",
    main: "https://sanctionslistservice.ofac.treas.gov/api/download/sdn.csv",
    alt: "https://sanctionslistservice.ofac.treas.gov/api/download/alt.csv",
  },
  un_consolidated: {
    label: "UN Security Council Consolidated List",
    main: "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
  },
} as const;

export type SanctionsListId = keyof typeof SOURCES;
export type MatchTier = "exact" | "strong" | "possible";

export interface SanctionsMatch {
  listId: SanctionsListId;
  entryId: string;
  listedName: string;
  matchedAlias: string | null;
  tier: MatchTier;
  entryType: string;
  programs: string[];
  referenceNumber: string | null;
  listedOn: string | null;
  remarks: string | null;
}

export interface ScreenedName {
  name: string;
  txnCount: number | null;
  matches: SanctionsMatch[];
}

export interface SanctionsListMeta {
  id: SanctionsListId;
  label: string;
  fetchedAt: string;
  stale: boolean;
  entryCount: number;
}

export interface SanctionsScreening {
  engineVersion: string;
  status: "complete" | "unavailable";
  screenedAt: string;
  reason: string | null;
  lists: SanctionsListMeta[];
  namesScreened: number;
  subject: ScreenedName;
  counterpartyMatches: ScreenedName[];
  totals: { exact: number; strong: number; possible: number };
}

interface ListEntry {
  listId: SanctionsListId;
  entryId: string;
  entryType: string;
  primaryName: string;
  /** primary name + aliases, each with canonical tokens */
  names: { text: string; tokens: string[]; isAlias: boolean }[];
  programs: string[];
  referenceNumber: string | null;
  listedOn: string | null;
  remarks: string | null;
}

interface LoadedList {
  meta: SanctionsListMeta;
  entries: ListEntry[];
}

/* ------------------------------------------------------------------ */
/* Fetching and caching                                               */
/* ------------------------------------------------------------------ */

const cacheDir = () => {
  const dir = join(tmpdir(), "aml-sanctions-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
};

interface FileMeta {
  fetchedAt: string;
}

const metaPath = (file: string) => join(cacheDir(), `${file}.meta.json`);

const readFileMeta = (file: string): FileMeta | null => {
  try {
    const meta = JSON.parse(readFileSync(metaPath(file), "utf8")) as FileMeta;
    return typeof meta.fetchedAt === "string" ? meta : null;
  } catch {
    return null;
  }
};

/**
 * Atomic publication: write a temp sibling then rename over the target, so a
 * crash mid-write can never leave a truncated file that later parses as a
 * "successful" near-empty list. Meta is per file and written after its data
 * file - concurrent downloads of different lists cannot clobber each other
 * (a shared meta.json previously lost updates in exactly that race).
 */
const atomicWrite = (path: string, data: string) => {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
};

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the text of `file`, downloading from `url` when the cached copy is
 * older than the TTL. Falls back to a stale cached copy when the network
 * fails; throws only when there is neither a download nor any cache.
 */
async function cachedDownload(
  file: string,
  url: string,
): Promise<{ text: string; fetchedAt: string; stale: boolean }> {
  const path = join(cacheDir(), file);
  const entry = readFileMeta(file);
  const fresh = entry && Date.now() - Date.parse(entry.fetchedAt) < CACHE_TTL_MS && existsSync(path);
  if (fresh) {
    return { text: readFileSync(path, "utf8"), fetchedAt: entry.fetchedAt, stale: false };
  }
  try {
    const text = await fetchText(url);
    const fetchedAt = new Date().toISOString();
    atomicWrite(path, text);
    atomicWrite(metaPath(file), JSON.stringify({ fetchedAt }, null, 2));
    return { text, fetchedAt, stale: false };
  } catch (err) {
    if (entry && existsSync(path)) {
      logger.warn({ err, file }, "sanctions list refresh failed - using stale cache");
      return { text: readFileSync(path, "utf8"), fetchedAt: entry.fetchedAt, stale: true };
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* OFAC SDN parsing (CSV with quoted multiline fields)                */
/* ------------------------------------------------------------------ */

/** Minimal CSV reader: handles quoted fields, "" escapes, newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0]!.trim() !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0]!.trim() !== "") rows.push(row);
  }
  return rows;
}

const sdnNull = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" || t === "-0-" ? null : t;
};

const parsePrograms = (raw: string | null): string[] =>
  raw
    ? raw
        .split(/\]\s*\[/)
        .map((p) => p.replace(/[[\]]/g, "").trim())
        .filter((p) => p.length > 0)
    : [];

export function parseOfac(sdnCsv: string, altCsv: string): ListEntry[] {
  const aliasByEnt = new Map<string, string[]>();
  for (const row of parseCsv(altCsv)) {
    const ent = sdnNull(row[0]);
    // Normalize "a.k.a." / "f.k.a." / "n.k.a." spellings before comparing:
    // the official feed has used dotted and plain forms over time.
    const type = (sdnNull(row[2]) ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const name = sdnNull(row[3]);
    if (!ent || !name) continue;
    if (type !== "aka" && type !== "fka" && type !== "nka") continue; // skip weak aliases
    const arr = aliasByEnt.get(ent);
    if (arr) arr.push(name);
    else aliasByEnt.set(ent, [name]);
  }
  const entries: ListEntry[] = [];
  for (const row of parseCsv(sdnCsv)) {
    const ent = sdnNull(row[0]);
    const name = sdnNull(row[1]);
    if (!ent || !name) continue;
    const names: ListEntry["names"] = [];
    const seen = new Set<string>();
    const push = (text: string, isAlias: boolean) => {
      const tokens = canonicalNameTokens(text);
      if (tokens.length === 0) return;
      const key = tokens.join(" ");
      if (seen.has(key)) return;
      seen.add(key);
      names.push({ text, tokens, isAlias });
    };
    push(name, false);
    for (const alias of aliasByEnt.get(ent) ?? []) push(alias, true);
    entries.push({
      listId: "ofac_sdn",
      entryId: `SDN-${ent}`,
      entryType: sdnNull(row[2])?.toLowerCase() ?? "entity",
      primaryName: name,
      names,
      programs: parsePrograms(sdnNull(row[3])),
      referenceNumber: `SDN ${ent}`,
      listedOn: null,
      remarks: sdnNull(row[11]),
    });
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* UN consolidated list parsing                                       */
/* ------------------------------------------------------------------ */

const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

const textOf = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

export function parseUn(xml: string): ListEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name) =>
      ["INDIVIDUAL", "ENTITY", "INDIVIDUAL_ALIAS", "ENTITY_ALIAS"].includes(name),
  });
  const doc = parser.parse(xml) as Record<string, any>;
  const root = doc.CONSOLIDATED_LIST ?? {};
  const entries: ListEntry[] = [];

  const build = (
    node: Record<string, any>,
    entryType: "individual" | "entity",
    aliasKey: string,
  ) => {
    const nameParts = [node.FIRST_NAME, node.SECOND_NAME, node.THIRD_NAME, node.FOURTH_NAME]
      .map(textOf)
      .filter((p): p is string => p !== null);
    const primaryName = nameParts.join(" ").trim();
    if (primaryName.length === 0) return;
    const names: ListEntry["names"] = [];
    const seen = new Set<string>();
    const push = (text: string, isAlias: boolean) => {
      const tokens = canonicalNameTokens(text);
      if (tokens.length === 0) return;
      const key = tokens.join(" ");
      if (seen.has(key)) return;
      seen.add(key);
      names.push({ text, tokens, isAlias });
    };
    push(primaryName, false);
    for (const alias of asArray<Record<string, any>>(node[aliasKey])) {
      const aliasName = textOf(alias?.ALIAS_NAME);
      if (aliasName) push(aliasName, true);
    }
    if (names.length === 0) return;
    entries.push({
      listId: "un_consolidated",
      entryId: `UN-${textOf(node.DATAID) ?? primaryName}`,
      entryType,
      primaryName,
      names,
      programs: [textOf(node.UN_LIST_TYPE)].filter((p): p is string => p !== null),
      referenceNumber: textOf(node.REFERENCE_NUMBER),
      listedOn: textOf(node.LISTED_ON),
      remarks: textOf(node.COMMENTS1),
    });
  };

  for (const ind of asArray<Record<string, any>>(root.INDIVIDUALS?.INDIVIDUAL)) {
    build(ind, "individual", "INDIVIDUAL_ALIAS");
  }
  for (const ent of asArray<Record<string, any>>(root.ENTITIES?.ENTITY)) {
    build(ent, "entity", "ENTITY_ALIAS");
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Index + matching                                                   */
/* ------------------------------------------------------------------ */

const isSubstantive = (t: string): boolean => t.length >= 3;

/**
 * Tokens too generic to establish a "possible" link on their own: function
 * words plus ubiquitous name particles and Gulf trade-name fillers. They
 * still count toward exact/strong tiers, which demand full mutual coverage.
 */
const NON_DISTINCTIVE = new Set([
  "AND", "THE", "FOR", "OF", "BIN", "IBN", "ABU", "ABD", "UMM",
  "GENERAL", "TRADING", "INTERNATIONAL", "GROUP",
]);

export class SanctionsIndex {
  readonly lists: SanctionsListMeta[];
  private readonly entries: ListEntry[];
  private readonly byToken = new Map<string, number[]>();

  constructor(lists: LoadedList[]) {
    this.lists = lists.map((l) => l.meta);
    this.entries = lists.flatMap((l) => l.entries);
    this.entries.forEach((entry, idx) => {
      const tokens = new Set<string>();
      for (const n of entry.names) for (const t of n.tokens) if (isSubstantive(t)) tokens.add(t);
      for (const t of tokens) {
        const arr = this.byToken.get(t);
        if (arr) arr.push(idx);
        else this.byToken.set(t, [idx]);
      }
    });
  }

  get entryCount(): number {
    return this.entries.length;
  }

  /** Screen one display name; returns matches sorted best-first. */
  screen(rawName: string): SanctionsMatch[] {
    const tokens = canonicalNameTokens(rawName);
    const substantive = tokens.filter(isSubstantive);
    if (substantive.length === 0) return [];
    const distinctive = substantive.filter((t) => !NON_DISTINCTIVE.has(t));
    // Order-insensitive: OFAC lists names as "LAST, FIRST" while statements
    // carry natural order - identical token multisets are still exact.
    const sortedKey = [...tokens].sort().join(" ");

    const candidateIdxs = new Set<number>();
    for (const t of substantive) for (const idx of this.byToken.get(t) ?? []) candidateIdxs.add(idx);

    const matches: SanctionsMatch[] = [];
    for (const idx of candidateIdxs) {
      const entry = this.entries[idx]!;
      let best: { tier: MatchTier; name: ListEntry["names"][number] } | null = null;
      for (const n of entry.names) {
        let tier: MatchTier | null = null;
        if ([...n.tokens].sort().join(" ") === sortedKey) tier = "exact";
        else if (namesLikelySame(tokens, n.tokens)) tier = "strong";
        else {
          const shared = distinctive.filter((t) => n.tokens.includes(t));
          if (shared.length >= 2) tier = "possible";
        }
        if (!tier) continue;
        if (!best || TIER_RANK[tier] < TIER_RANK[best.tier]) best = { tier, name: n };
        if (best.tier === "exact") break;
      }
      if (best) {
        matches.push({
          listId: entry.listId,
          entryId: entry.entryId,
          listedName: entry.primaryName,
          matchedAlias: best.name.isAlias ? best.name.text : null,
          tier: best.tier,
          entryType: entry.entryType,
          programs: entry.programs,
          referenceNumber: entry.referenceNumber,
          listedOn: entry.listedOn,
          remarks: entry.remarks ? entry.remarks.slice(0, 280) : null,
        });
      }
    }
    matches.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.listedName.localeCompare(b.listedName));
    return matches.slice(0, MAX_MATCHES_PER_NAME);
  }
}

const TIER_RANK: Record<MatchTier, number> = { exact: 0, strong: 1, possible: 2 };

/* ------------------------------------------------------------------ */
/* Loading with in-process cache                                      */
/* ------------------------------------------------------------------ */

let indexPromise: Promise<SanctionsIndex> | null = null;
let indexBuiltAt = 0;

async function loadIndex(): Promise<SanctionsIndex> {
  const log = logger.child({ layer: "sanctions" });
  const t0 = Date.now();
  const [sdn, alt, un] = await Promise.all([
    cachedDownload("sdn.csv", SOURCES.ofac_sdn.main),
    cachedDownload("alt.csv", SOURCES.ofac_sdn.alt),
    cachedDownload("un.xml", SOURCES.un_consolidated.main),
  ]);
  const ofacEntries = parseOfac(sdn.text, alt.text);
  const unEntries = parseUn(un.text);
  if (ofacEntries.length < MIN_OFAC_ENTRIES) {
    throw new Error(`OFAC SDN parse yielded implausibly few entries (${ofacEntries.length})`);
  }
  if (unEntries.length < MIN_UN_ENTRIES) {
    throw new Error(`UN consolidated parse yielded implausibly few entries (${unEntries.length})`);
  }
  const index = new SanctionsIndex([
    {
      meta: {
        id: "ofac_sdn",
        label: SOURCES.ofac_sdn.label,
        fetchedAt: sdn.fetchedAt,
        stale: sdn.stale || alt.stale,
        entryCount: ofacEntries.length,
      },
      entries: ofacEntries,
    },
    {
      meta: {
        id: "un_consolidated",
        label: SOURCES.un_consolidated.label,
        fetchedAt: un.fetchedAt,
        stale: un.stale,
        entryCount: unEntries.length,
      },
      entries: unEntries,
    },
  ]);
  log.info(
    { ofac: ofacEntries.length, un: unEntries.length, ms: Date.now() - t0 },
    "sanctions lists loaded",
  );
  return index;
}

function getIndex(): Promise<SanctionsIndex> {
  if (!indexPromise || Date.now() - indexBuiltAt > CACHE_TTL_MS) {
    indexBuiltAt = Date.now();
    indexPromise = loadIndex().catch((err) => {
      indexPromise = null; // allow retry on next run
      throw err;
    });
  }
  return indexPromise;
}

/**
 * Fire-and-forget warm-up so the first analysis after boot does not pay the
 * download cost. Failures are tolerated here; the actual screening call
 * reports honest unavailability if lists still cannot be loaded.
 */
export function warmSanctionsCache(): void {
  getIndex().catch((err) => {
    logger.warn({ err }, "sanctions cache warm-up failed (will retry at screening time)");
  });
}

/* ------------------------------------------------------------------ */
/* Screening entry point                                              */
/* ------------------------------------------------------------------ */

/** Bounded wait: the load continues in the background if the race is lost. */
const withDeadline = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => {
      const t = setTimeout(
        () =>
          reject(
            new Error(
              `${what} did not finish within ${Math.round(ms / 1000)}s; it continues in the background - re-run the analysis shortly`,
            ),
          ),
        ms,
      );
      if (typeof t.unref === "function") t.unref();
    }),
  ]);

/**
 * Screens the subject and all named counterparties of a case.
 * Never throws: on total list unavailability returns status "unavailable".
 */
export async function screenCase(subjectName: string, txns: Txn[]): Promise<SanctionsScreening> {
  const log = logger.child({ layer: "sanctions" });
  const screenedAt = new Date().toISOString();
  const counterpartyCounts = new Map<string, { display: string; txnCount: number }>();
  for (const t of txns) {
    const id = parseIdentity(t.counterpartyName);
    if (!id || id.kind !== "name") continue;
    if (nameRefersToSubject(id.display, subjectName)) continue;
    const existing = counterpartyCounts.get(id.key);
    if (existing) existing.txnCount += 1;
    else counterpartyCounts.set(id.key, { display: id.display, txnCount: 1 });
  }

  let index: SanctionsIndex;
  try {
    index = await withDeadline(getIndex(), SCREEN_WAIT_MS, "sanctions list loading");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error({ err }, "sanctions screening unavailable");
    return {
      engineVersion: SANCTIONS_ENGINE_VERSION,
      status: "unavailable",
      screenedAt,
      reason: `Sanctions lists could not be retrieved and no cached copy exists (${reason}). Screening was NOT performed - this is not a clean result.`,
      lists: [],
      namesScreened: 0,
      subject: { name: subjectName, txnCount: null, matches: [] },
      counterpartyMatches: [],
      totals: { exact: 0, strong: 0, possible: 0 },
    };
  }

  const subject: ScreenedName = {
    name: subjectName,
    txnCount: null,
    matches: index.screen(subjectName),
  };
  const counterpartyMatches: ScreenedName[] = [];
  for (const { display, txnCount } of counterpartyCounts.values()) {
    const matches = index.screen(display);
    if (matches.length > 0) counterpartyMatches.push({ name: display, txnCount, matches });
  }
  counterpartyMatches.sort(
    (a, b) =>
      TIER_RANK[a.matches[0]!.tier] - TIER_RANK[b.matches[0]!.tier] ||
      (b.txnCount ?? 0) - (a.txnCount ?? 0),
  );
  const trimmed = counterpartyMatches.slice(0, MAX_COUNTERPARTY_RESULTS);

  const totals = { exact: 0, strong: 0, possible: 0 };
  for (const m of subject.matches) totals[m.tier] += 1;
  for (const c of trimmed) for (const m of c.matches) totals[m.tier] += 1;

  log.info(
    {
      namesScreened: counterpartyCounts.size + 1,
      subjectMatches: subject.matches.length,
      counterpartiesWithMatches: trimmed.length,
      totals,
    },
    "sanctions screening complete",
  );

  return {
    engineVersion: SANCTIONS_ENGINE_VERSION,
    status: "complete",
    screenedAt,
    reason: null,
    lists: index.lists,
    namesScreened: counterpartyCounts.size + 1,
    subject,
    counterpartyMatches: trimmed,
    totals,
  };
}

/* ------------------------------------------------------------------ */
/* Freshness status (for the scheduler and status endpoint)           */
/* ------------------------------------------------------------------ */

export interface SanctionsIndexStatus {
  state: "ready" | "loading" | "error";
  error: string | null;
  lists: SanctionsListMeta[];
}

/**
 * Non-blocking view of the shared list index. Kicks a (re)load if the cached
 * index is past TTL, but reports "loading" rather than blocking beyond waitMs.
 */
export async function getSanctionsIndexStatus(waitMs = 5_000): Promise<SanctionsIndexStatus> {
  try {
    const idx = await withDeadline(getIndex(), waitMs, "Sanctions list load");
    return { state: "ready", error: null, lists: idx.lists };
  } catch (err) {
    return {
      state: indexPromise ? "loading" : "error",
      error: err instanceof Error ? err.message : String(err),
      lists: [],
    };
  }
}
