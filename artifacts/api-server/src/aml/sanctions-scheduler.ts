import { desc, eq } from "drizzle-orm";
import { db, analysisRunsTable, casesTable, transactionsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  getSanctionsIndexStatus,
  screenCase,
  type SanctionsScreening,
} from "./sanctions";
import type { Txn } from "./types";

/**
 * Sanctions freshness scheduler.
 *
 * The list index already refreshes itself daily (24h TTL). What was missing
 * is the second half of the loop: when fresher lists arrive, previously
 * screened cases keep showing results computed against the OLD lists until
 * someone manually re-runs a full analysis. This scheduler closes that gap:
 * every CHECK_INTERVAL it compares each case's latest-run screening against
 * the current list versions and silently re-screens (screening only - the
 * deterministic score and AI layers are never touched).
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // freshness check every 6 hours
const BOOT_DELAY_MS = 3 * 60 * 1000; // let boot warm-up settle first
const MAX_CHANGES_KEPT = 20;

interface MatchTotals {
  exact: number;
  strong: number;
  possible: number;
}

export interface RescreenChange {
  caseId: number;
  runId: number;
  before: MatchTotals | null;
  after: MatchTotals;
}

export interface SanctionsSchedulerStatus {
  running: boolean;
  sweeping: boolean;
  intervalHours: number;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  lastResult: "idle" | "up_to_date" | "rescreened" | "lists_unavailable" | "error";
  lastError: string | null;
  lastRescreenAt: string | null;
  casesRescreened: number;
  lastChanges: RescreenChange[];
}

const state: SanctionsSchedulerStatus = {
  running: false,
  sweeping: false,
  intervalHours: CHECK_INTERVAL_MS / 3_600_000,
  lastCheckAt: null,
  nextCheckAt: null,
  lastResult: "idle",
  lastError: null,
  lastRescreenAt: null,
  casesRescreened: 0,
  lastChanges: [],
};

export function getSanctionsSchedulerStatus(): SanctionsSchedulerStatus {
  return { ...state, lastChanges: [...state.lastChanges] };
}

const maxFetchedAt = (lists: { fetchedAt: string }[]): number => {
  let max = 0;
  for (const l of lists) {
    const t = new Date(l.fetchedAt).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
};

const totalsDiffer = (a: MatchTotals | null, b: MatchTotals): boolean =>
  !a || a.exact !== b.exact || a.strong !== b.strong || a.possible !== b.possible;

async function loadCaseTxns(caseId: number): Promise<Txn[]> {
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.caseId, caseId));
  // Screening only reads counterparty names; netting flags are irrelevant here.
  return rows.map((r) => ({
    id: r.id,
    fileId: r.fileId,
    bank: r.bank,
    accountId: r.accountId,
    postingDate: r.postingDate,
    direction: r.direction as Txn["direction"],
    amountKwd: r.amountKwd,
    currency: r.currency,
    channel: r.channel as Txn["channel"],
    counterpartyName: r.counterpartyName,
    counterpartyBank: r.counterpartyBank,
    counterpartyCountry: r.counterpartyCountry,
    narrative: r.narrative,
    runningBalance: r.runningBalance,
    isInternalTransfer: false,
    internalPairId: null,
  }));
}

/**
 * One freshness sweep: if lists are loadable, re-screen every case whose
 * latest run was screened against older list versions (or never screened).
 * Updates ONLY the sanctionsScreening column - never scores or AI output.
 */
export async function runSanctionsSweep(): Promise<void> {
  const log = logger.child({ layer: "sanctions-scheduler" });
  // Single-flight for BOTH the interval timer and manual kicks: the
  // synchronous check-and-set below cannot interleave in one JS thread.
  if (state.sweeping) return;
  state.sweeping = true;
  state.lastCheckAt = new Date().toISOString();
  try {
    const idx = await getSanctionsIndexStatus(60_000);
    if (idx.state !== "ready") {
      state.lastResult = "lists_unavailable";
      state.lastError = idx.error;
      log.warn({ state: idx.state, err: idx.error }, "freshness sweep skipped - lists not ready");
      return;
    }
    const currentVersion = maxFetchedAt(idx.lists);

    const runs = await db
      .select({
        id: analysisRunsTable.id,
        caseId: analysisRunsTable.caseId,
        sanctionsScreening: analysisRunsTable.sanctionsScreening,
      })
      .from(analysisRunsTable)
      .orderBy(desc(analysisRunsTable.createdAt), desc(analysisRunsTable.id));
    const latestByCase = new Map<number, (typeof runs)[number]>();
    for (const r of runs) if (!latestByCase.has(r.caseId)) latestByCase.set(r.caseId, r);

    const cases = await db
      .select({ id: casesTable.id, subjectName: casesTable.subjectName })
      .from(casesTable);
    const subjectByCase = new Map(cases.map((c) => [c.id, c.subjectName]));

    let rescreened = 0;
    const changes: RescreenChange[] = [];

    for (const run of latestByCase.values()) {
      const prev = (run.sanctionsScreening ?? null) as SanctionsScreening | null;
      const prevComplete = prev?.status === "complete";
      const prevVersion = prevComplete && prev ? maxFetchedAt(prev.lists) : 0;
      if (prevComplete && prevVersion >= currentVersion) continue; // already fresh

      const subjectName = subjectByCase.get(run.caseId);
      if (!subjectName) continue;
      const txns = await loadCaseTxns(run.caseId);
      if (txns.length === 0) continue;

      const next = await screenCase(subjectName, txns);
      if (next.status !== "complete") continue; // never overwrite with a worse result

      // A new analysis may have landed while we screened; stamping the old
      // run would attach current-ledger results to historical evidence.
      // Skip it - the new run screened itself, and the next sweep re-checks.
      const [latestNow] = await db
        .select({ id: analysisRunsTable.id })
        .from(analysisRunsTable)
        .where(eq(analysisRunsTable.caseId, run.caseId))
        .orderBy(desc(analysisRunsTable.createdAt), desc(analysisRunsTable.id))
        .limit(1);
      if (!latestNow || latestNow.id !== run.id) {
        log.warn(
          { caseId: run.caseId, staleRunId: run.id, latestRunId: latestNow?.id ?? null },
          "skipping re-screen - a newer analysis run appeared mid-sweep",
        );
        continue;
      }

      await db
        .update(analysisRunsTable)
        .set({ sanctionsScreening: next as unknown })
        .where(eq(analysisRunsTable.id, run.id));
      rescreened++;

      const before = prevComplete && prev ? prev.totals : null;
      if (totalsDiffer(before, next.totals)) {
        changes.push({ caseId: run.caseId, runId: run.id, before, after: next.totals });
        log.warn(
          { caseId: run.caseId, runId: run.id, before, after: next.totals },
          "sanctions match totals CHANGED after re-screen with fresher lists",
        );
      }
    }

    state.lastError = null;
    if (rescreened > 0) {
      state.lastResult = "rescreened";
      state.lastRescreenAt = new Date().toISOString();
      state.casesRescreened = rescreened;
      state.lastChanges = changes.slice(0, MAX_CHANGES_KEPT);
      log.info({ rescreened, changed: changes.length }, "freshness sweep re-screened cases");
    } else {
      state.lastResult = "up_to_date";
      state.casesRescreened = 0;
      log.info("freshness sweep - all screenings already current");
    }
  } catch (err) {
    state.lastResult = "error";
    state.lastError = err instanceof Error ? err.message : String(err);
    log.error({ err }, "sanctions freshness sweep failed");
  } finally {
    state.sweeping = false;
  }
}

/** Fire a sweep now (for the manual endpoint). Returns false if one is already running. */
export function kickSanctionsSweep(): boolean {
  if (state.sweeping) return false;
  void runSanctionsSweep();
  return true;
}

export function startSanctionsScheduler(): void {
  if (state.running) return;
  state.running = true;
  const schedule = (ms: number) => {
    state.nextCheckAt = new Date(Date.now() + ms).toISOString();
    const t = setTimeout(async () => {
      await runSanctionsSweep().catch(() => undefined);
      schedule(CHECK_INTERVAL_MS);
    }, ms);
    if (typeof t.unref === "function") t.unref();
  };
  schedule(BOOT_DELAY_MS);
  logger.info(
    { firstCheckInMin: BOOT_DELAY_MS / 60_000, intervalHours: state.intervalHours },
    "sanctions freshness scheduler started",
  );
}
