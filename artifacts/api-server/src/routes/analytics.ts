import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import {
  db,
  analysisRunsTable,
  casesTable,
  dispositionsTable,
  transactionsTable,
} from "@workspace/db";
import {
  buildIdentityIndex,
  canonicalNameTokens,
  namesLikelySame,
} from "../aml/identity";
import { h } from "./util";

const router: IRouter = Router();

/**
 * Cross-case rule performance: for the LATEST run of every case, which rules
 * fired, and how did analysts ultimately disposition those cases. Over time
 * this shows which rules concentrate real escalations and which mostly fire
 * on cases that get closed.
 */
router.get(
  "/analytics/rule-performance",
  h(async (_req, res) => {
    const runs = await db
      .select({
        id: analysisRunsTable.id,
        caseId: analysisRunsTable.caseId,
        createdAt: analysisRunsTable.createdAt,
        ruleHits: analysisRunsTable.ruleHits,
      })
      .from(analysisRunsTable)
      .orderBy(desc(analysisRunsTable.createdAt), desc(analysisRunsTable.id));

    const latestByCase = new Map<number, (typeof runs)[number]>();
    for (const r of runs) if (!latestByCase.has(r.caseId)) latestByCase.set(r.caseId, r);
    const latest = [...latestByCase.values()];

    const dispositions = await db.select().from(dispositionsTable);
    const dispByRun = new Map(dispositions.map((d) => [d.runId, d]));

    interface Agg {
      ruleId: string;
      title: string;
      severity: string;
      typologyName: string;
      weightLogLr: number;
      casesFired: number;
      escalate: number;
      watchlist: number;
      close: number;
      undecided: number;
    }
    const byRule = new Map<string, Agg>();

    for (const run of latest) {
      const hits = Array.isArray(run.ruleHits) ? run.ruleHits : [];
      const disp = dispByRun.get(run.id);
      for (const raw of hits) {
        const hit = raw as {
          ruleId?: string;
          title?: string;
          severity?: string;
          typologyName?: string;
          weightLogLr?: number;
          fired?: boolean;
        };
        if (!hit.ruleId || hit.fired !== true) continue;
        let agg = byRule.get(hit.ruleId);
        if (!agg) {
          agg = {
            ruleId: hit.ruleId,
            title: hit.title ?? hit.ruleId,
            severity: hit.severity ?? "low",
            typologyName: hit.typologyName ?? "",
            weightLogLr: hit.weightLogLr ?? 0,
            casesFired: 0,
            escalate: 0,
            watchlist: 0,
            close: 0,
            undecided: 0,
          };
          byRule.set(hit.ruleId, agg);
        }
        agg.casesFired++;
        if (typeof hit.weightLogLr === "number") agg.weightLogLr = hit.weightLogLr;
        if (!disp) agg.undecided++;
        else if (disp.decision === "escalate") agg.escalate++;
        else if (disp.decision === "watchlist") agg.watchlist++;
        else if (disp.decision === "close") agg.close++;
        else agg.undecided++;
      }
    }

    const rules = [...byRule.values()].sort(
      (a, b) => b.casesFired - a.casesFired || a.ruleId.localeCompare(b.ruleId),
    );

    res.json({
      casesAssessed: latest.length,
      casesDecided: latest.filter((r) => dispByRun.has(r.id)).length,
      rules,
    });
  }),
);

/**
 * Cross-case counterparty intelligence: one global identity index over every
 * counterparty string in the portfolio, reduced to clusters that appear in
 * two or more cases. A party that is itself the subject of another case is
 * flagged separately - the strongest cross-case signal there is.
 */
router.get(
  "/analytics/counterparty-intel",
  h(async (_req, res) => {
    const cases = await db
      .select({ id: casesTable.id, subjectName: casesTable.subjectName, status: casesTable.status })
      .from(casesTable);
    const caseById = new Map(cases.map((c) => [c.id, c]));

    const txns = await db
      .select({
        caseId: transactionsTable.caseId,
        counterpartyName: transactionsTable.counterpartyName,
        direction: transactionsTable.direction,
        amountKwd: transactionsTable.amountKwd,
        internalPairId: transactionsTable.internalPairId,
        flags: transactionsTable.flags,
      })
      .from(transactionsTable);

    // Internal cross-bank moves are the subject paying themself - not
    // counterparties. Nameless rows carry nothing to cluster.
    const external = txns.filter((t) => t.counterpartyName && t.internalPairId == null);
    const idx = buildIdentityIndex(external.map((t) => t.counterpartyName));

    interface PerCase {
      txnCount: number;
      totalKwd: number;
      inflowKwd: number;
      outflowKwd: number;
      flaggedCount: number;
    }
    const byCluster = new Map<string, Map<number, PerCase>>();
    for (const t of external) {
      const key = idx.keyOf(t.counterpartyName);
      if (!key) continue;
      let perCase = byCluster.get(key);
      if (!perCase) {
        perCase = new Map();
        byCluster.set(key, perCase);
      }
      let acc = perCase.get(t.caseId);
      if (!acc) {
        acc = { txnCount: 0, totalKwd: 0, inflowKwd: 0, outflowKwd: 0, flaggedCount: 0 };
        perCase.set(t.caseId, acc);
      }
      acc.txnCount++;
      acc.totalKwd += t.amountKwd;
      if (t.direction === "credit") acc.inflowKwd += t.amountKwd;
      else acc.outflowKwd += t.amountKwd;
      if (Array.isArray(t.flags) && t.flags.length > 0) acc.flaggedCount++;
    }

    const subjectTokens = cases.map((c) => ({
      id: c.id,
      tokens: canonicalNameTokens(c.subjectName),
    }));
    const r2 = (n: number) => Math.round(n * 100) / 100;

    interface ClusterOut {
      key: string;
      display: string;
      kind: string;
      caseCount: number;
      totalTxns: number;
      totalKwd: number;
      subjectOfCaseIds: number[];
      cases: {
        caseId: number;
        subjectName: string;
        caseStatus: string;
        txnCount: number;
        totalKwd: number;
        inflowKwd: number;
        outflowKwd: number;
        flaggedCount: number;
      }[];
    }
    const clusters: ClusterOut[] = [];
    for (const [key, perCase] of byCluster) {
      if (perCase.size < 2) continue;
      const display = idx.displayOf(key);
      const kind = idx.kindOf(key);
      const displayTokens = kind === "name" ? canonicalNameTokens(display) : [];
      const subjectOfCaseIds =
        kind === "name"
          ? subjectTokens.filter((s) => namesLikelySame(displayTokens, s.tokens)).map((s) => s.id)
          : [];
      const caseRows = [...perCase.entries()]
        .map(([caseId, acc]) => ({
          caseId,
          subjectName: caseById.get(caseId)?.subjectName ?? `CASE-${caseId}`,
          caseStatus: caseById.get(caseId)?.status ?? "unknown",
          txnCount: acc.txnCount,
          totalKwd: r2(acc.totalKwd),
          inflowKwd: r2(acc.inflowKwd),
          outflowKwd: r2(acc.outflowKwd),
          flaggedCount: acc.flaggedCount,
        }))
        .sort((a, b) => b.totalKwd - a.totalKwd);
      clusters.push({
        key,
        display,
        kind,
        caseCount: perCase.size,
        totalTxns: caseRows.reduce((s, c) => s + c.txnCount, 0),
        totalKwd: r2(caseRows.reduce((s, c) => s + c.totalKwd, 0)),
        subjectOfCaseIds,
        cases: caseRows,
      });
    }
    clusters.sort(
      (a, b) =>
        b.subjectOfCaseIds.length - a.subjectOfCaseIds.length ||
        b.caseCount - a.caseCount ||
        b.totalKwd - a.totalKwd,
    );

    res.json({
      casesCovered: cases.length,
      txnsScanned: external.length,
      sharedCount: clusters.length,
      clusters: clusters.slice(0, 200),
    });
  }),
);

export default router;
