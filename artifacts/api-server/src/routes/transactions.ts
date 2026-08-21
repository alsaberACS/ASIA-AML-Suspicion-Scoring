import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";
import {
  GetCaseNetworkParams,
  GetCaseTimelineParams,
  ListCaseTransactionsQueryParams,
} from "@workspace/api-zod";
import { buildIdentityIndex } from "../aml/identity";
import { txnToApi } from "../aml/serialize";
import { h } from "./util";

const router: IRouter = Router();

router.get(
  "/transactions",
  h(async (req, res) => {
    const q = ListCaseTransactionsQueryParams.parse(req.query);
    const conds: SQL[] = [eq(transactionsTable.caseId, q.caseId)];
    if (q.bank) conds.push(eq(transactionsTable.bank, q.bank));
    if (q.channel) conds.push(eq(transactionsTable.channel, q.channel));
    if (q.direction) conds.push(eq(transactionsTable.direction, q.direction));
    // zod coerce.boolean() treats any non-empty string as true, so honor the
    // raw query string for the boolean toggles.
    if (q.flaggedOnly && req.query.flaggedOnly !== "false")
      conds.push(sql`jsonb_array_length(${transactionsTable.flags}) > 0`);
    if (q.internalOnly && req.query.internalOnly !== "false")
      conds.push(eq(transactionsTable.isInternalTransfer, true));
    if (q.txnIds) {
      const ids = q.txnIds
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))
        .slice(0, 500);
      if (ids.length > 0) conds.push(inArray(transactionsTable.id, ids));
    }
    if (q.search && q.search.trim()) {
      const term = `%${q.search.trim()}%`;
      const searchCond = or(
        ilike(transactionsTable.narrative, term),
        ilike(transactionsTable.counterpartyName, term),
        ilike(transactionsTable.counterpartyBank, term),
        ilike(transactionsTable.accountId, term),
      );
      if (searchCond) conds.push(searchCond);
    }
    const where = and(...conds);
    const order =
      q.sort === "date_asc"
        ? [asc(transactionsTable.postingDate), asc(transactionsTable.id)]
        : q.sort === "amount_desc"
          ? [desc(transactionsTable.amountKwd), asc(transactionsTable.id)]
          : [desc(transactionsTable.postingDate), desc(transactionsTable.id)];

    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(transactionsTable)
        .where(where)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(transactionsTable)
        .where(where),
    ]);
    res.json({
      items: items.map(txnToApi),
      total: totalRows[0]?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    });
  }),
);

router.get(
  "/cases/:caseId/timeline",
  h(async (req, res) => {
    const { caseId } = GetCaseTimelineParams.parse(req.params);
    const rows = await db
      .select({
        postingDate: transactionsTable.postingDate,
        bank: transactionsTable.bank,
        direction: transactionsTable.direction,
        amountKwd: transactionsTable.amountKwd,
        channel: transactionsTable.channel,
      })
      .from(transactionsTable)
      .where(eq(transactionsTable.caseId, caseId));
    const agg = new Map<
      string,
      { month: string; bank: string; creditsKwd: number; debitsKwd: number; cashInKwd: number; cashOutKwd: number; txnCount: number }
    >();
    for (const r of rows) {
      const month = r.postingDate.slice(0, 7);
      const key = `${month}|${r.bank}`;
      let e = agg.get(key);
      if (!e) {
        e = { month, bank: r.bank, creditsKwd: 0, debitsKwd: 0, cashInKwd: 0, cashOutKwd: 0, txnCount: 0 };
        agg.set(key, e);
      }
      e.txnCount++;
      if (r.direction === "credit") {
        e.creditsKwd += r.amountKwd;
        if (r.channel === "cash_deposit") e.cashInKwd += r.amountKwd;
      } else {
        e.debitsKwd += r.amountKwd;
        if (r.channel === "cash_withdrawal") e.cashOutKwd += r.amountKwd;
      }
    }
    const out = [...agg.values()]
      .map((e) => ({
        ...e,
        creditsKwd: r2(e.creditsKwd),
        debitsKwd: r2(e.debitsKwd),
        cashInKwd: r2(e.cashInKwd),
        cashOutKwd: r2(e.cashOutKwd),
      }))
      .sort((a, b) => a.month.localeCompare(b.month) || a.bank.localeCompare(b.bank));
    res.json(out);
  }),
);

router.get(
  "/cases/:caseId/network",
  h(async (req, res) => {
    const { caseId } = GetCaseNetworkParams.parse(req.params);
    const rows = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.caseId, caseId));

    // Cluster counterparty spellings with the same conservative identity
    // resolution the rest of the analytics use, so graph parties line up
    // with counterparty numbers elsewhere in the app.
    const idx = buildIdentityIndex(rows.map((r) => r.counterpartyName));

    type NodeKind = "account" | "cash" | "name" | "account_ref" | "instapay_ref";
    interface NodeAcc {
      id: string;
      label: string;
      type: "subject_account" | "counterparty";
      kind: NodeKind;
      accountTail: string | null;
      bank: string | null;
      country: string | null;
      totalInKwd: number;
      totalOutKwd: number;
      txnCount: number;
      flaggedCount: number;
      flagIds: Set<string>;
    }
    interface EdgeAcc {
      source: string;
      target: string;
      valueKwd: number;
      txnCount: number;
      kind: "flow" | "internal";
      flaggedCount: number;
    }
    const nodes = new Map<string, NodeAcc>();
    const edges = new Map<string, EdgeAcc>();
    const acctNode = (bank: string, accountId: string): NodeAcc => {
      const id = `acct:${bank}|${accountId}`;
      let n = nodes.get(id);
      if (!n) {
        // Digits-only tail: masked ids ("...XXXX") and word-like ids give no
        // useful tail, so require at least two digits.
        const digits = accountId.replace(/\D+/g, "");
        const tail = digits.slice(-4);
        n = {
          id,
          label: bank,
          type: "subject_account",
          kind: "account",
          accountTail: tail.length >= 2 ? tail : null,
          bank,
          country: null,
          totalInKwd: 0,
          totalOutKwd: 0,
          txnCount: 0,
          flaggedCount: 0,
          flagIds: new Set<string>(),
        };
        nodes.set(id, n);
      }
      return n;
    };
    const cpNode = (key: string, label: string, kind: NodeKind, country: string | null): NodeAcc => {
      const id = `cp:${key}`;
      let n = nodes.get(id);
      if (!n) {
        n = {
          id,
          label,
          type: "counterparty",
          kind,
          accountTail: null,
          bank: null,
          country,
          totalInKwd: 0,
          totalOutKwd: 0,
          txnCount: 0,
          flaggedCount: 0,
          flagIds: new Set<string>(),
        };
        nodes.set(id, n);
      }
      if (!n.country && country) n.country = country;
      return n;
    };
    const addEdge = (source: string, target: string, v: number, kind: "flow" | "internal", flagged: number) => {
      const key = `${source}->${target}`;
      let e = edges.get(key);
      if (!e) {
        e = { source, target, valueKwd: 0, txnCount: 0, kind, flaggedCount: 0 };
        edges.set(key, e);
      }
      e.valueKwd += v;
      e.txnCount++;
      e.flaggedCount += flagged;
    };
    const markFlags = (n: NodeAcc, flags: string[]) => {
      if (flags.length === 0) return;
      n.flaggedCount++;
      for (const f of flags) {
        if (n.flagIds.size >= 8) break;
        n.flagIds.add(f);
      }
    };

    // Internal pair partners: map pairId -> {debit acct, credit acct}.
    const pairAcct = new Map<number, { from?: string; to?: string; value: number; flagged: number }>();
    for (const t of rows) {
      const acct = acctNode(t.bank, t.accountId);
      acct.txnCount++;
      if (t.direction === "credit") acct.totalInKwd += t.amountKwd;
      else acct.totalOutKwd += t.amountKwd;
      markFlags(acct, t.flags);
      const flagged = t.flags.length > 0 ? 1 : 0;

      if (t.isInternalTransfer && t.internalPairId != null) {
        const e = pairAcct.get(t.internalPairId) ?? { value: 0, flagged: 0 };
        if (t.direction === "debit") e.from = acct.id;
        else e.to = acct.id;
        e.value = Math.max(e.value, t.amountKwd);
        e.flagged = Math.max(e.flagged, flagged);
        pairAcct.set(t.internalPairId, e);
        continue;
      }
      if (t.channel === "cash_deposit" || t.channel === "cash_withdrawal") {
        const cash = cpNode("CASH", "Cash (physical)", "cash", null);
        cash.txnCount++;
        markFlags(cash, t.flags);
        if (t.direction === "credit") {
          cash.totalOutKwd += t.amountKwd;
          addEdge(cash.id, acct.id, t.amountKwd, "flow", flagged);
        } else {
          cash.totalInKwd += t.amountKwd;
          addEdge(acct.id, cash.id, t.amountKwd, "flow", flagged);
        }
        continue;
      }
      const clusterKey = idx.keyOf(t.counterpartyName);
      if (clusterKey) {
        const cp = cpNode(clusterKey, idx.displayOf(clusterKey), idx.kindOf(clusterKey), t.counterpartyCountry);
        cp.txnCount++;
        markFlags(cp, t.flags);
        if (t.direction === "credit") {
          cp.totalOutKwd += t.amountKwd;
          addEdge(cp.id, acct.id, t.amountKwd, "flow", flagged);
        } else {
          cp.totalInKwd += t.amountKwd;
          addEdge(acct.id, cp.id, t.amountKwd, "flow", flagged);
        }
      }
    }
    for (const [, p] of pairAcct) {
      if (p.from && p.to) addEdge(p.from, p.to, p.value, "internal", p.flagged);
    }

    // Strict counterparty budget: flagged parties are admitted first (by
    // moved value), remaining slots fill with the largest unflagged parties.
    // Subject accounts and cash live outside the budget, so the graph stays
    // bounded even in heavily flagged cases.
    const CP_BUDGET = 60;
    const cps = [...nodes.values()].filter((n) => n.type === "counterparty" && n.id !== "cp:CASH");
    cps.sort((a, b) => b.totalInKwd + b.totalOutKwd - (a.totalInKwd + a.totalOutKwd));
    const keptCps = [
      ...cps.filter((n) => n.flaggedCount > 0),
      ...cps.filter((n) => n.flaggedCount === 0),
    ].slice(0, CP_BUDGET);
    const keep = new Set<string>([
      ...[...nodes.values()].filter((n) => n.type === "subject_account").map((n) => n.id),
      "cp:CASH",
      ...keptCps.map((n) => n.id),
    ]);
    const outNodes = [...nodes.values()]
      .filter((n) => keep.has(n.id))
      .map((n) => ({
        ...n,
        flagIds: [...n.flagIds],
        totalInKwd: r2(n.totalInKwd),
        totalOutKwd: r2(n.totalOutKwd),
      }));
    const outEdges = [...edges.values()]
      .filter((e) => keep.has(e.source) && keep.has(e.target))
      .map((e) => ({ ...e, valueKwd: r2(e.valueKwd) }));
    res.json({ nodes: outNodes, edges: outEdges });
  }),
);

const r2 = (v: number) => Math.round(v * 100) / 100;

export default router;
