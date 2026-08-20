import type { InternalPair, Txn } from "./types";
import { isSelfNarrative, nameSimilarity } from "./vocab";

/**
 * Cross-bank consolidation: internal-transfer netting.
 *
 * Finds debit/credit pairs that are the same money moving between the
 * subject's own accounts at different banks, so cross-bank volume is not
 * double counted and self-circulation becomes an explicit, visible feature.
 *
 * Match criteria (per the system design):
 *  - opposite directions in different accounts (usually different banks)
 *  - amount difference <= max(0.500 KWD, 0.5%)
 *  - date gap <= 3 days (credit on or after debit)
 *  - supporting evidence: self/own narrative, counterparty name matching the
 *    subject, or counterparty bank matching the receiving bank
 */
export function findInternalPairs(txns: Txn[], subjectName: string): InternalPair[] {
  const debits = txns
    .filter((t) => t.direction === "debit" && isTransferish(t))
    .sort((a, b) => b.amountKwd - a.amountKwd);
  const credits = txns.filter((t) => t.direction === "credit" && isTransferish(t));

  const usedCredits = new Set<number>();
  const pairs: InternalPair[] = [];
  let nextId = 1;

  for (const d of debits) {
    let best: { c: Txn; conf: number; basis: string[]; gap: number } | null = null;
    for (const c of credits) {
      if (usedCredits.has(c.id)) continue;
      if (c.bank === d.bank && c.accountId === d.accountId) continue;
      const gap = daysBetween(d.postingDate, c.postingDate);
      if (gap < -0.5 || gap > 3) continue; // credit must land 0-3 days after debit
      const tol = Math.max(0.5, d.amountKwd * 0.005);
      const diff = Math.abs(d.amountKwd - c.amountKwd);
      if (diff > tol) continue;

      const basis: string[] = [];
      let conf = 0.35; // base: amount + window matched
      if (diff < 0.001) {
        conf += 0.15;
        basis.push("exact amount");
      } else {
        basis.push(`amount within ${diff.toFixed(3)} KWD`);
      }
      if (gap <= 1) {
        conf += 0.1;
        basis.push(gap === 0 ? "same day" : "next day");
      } else {
        basis.push(`${Math.round(gap)}-day gap`);
      }
      const dSelf = isSelfNarrative(d.narrative) || isSelfNarrative(c.narrative);
      if (dSelf) {
        conf += 0.2;
        basis.push("own-transfer narrative");
      }
      const nameEvidence = Math.max(
        d.counterpartyName ? nameSimilarity(d.counterpartyName, subjectName) : 0,
        c.counterpartyName ? nameSimilarity(c.counterpartyName, subjectName) : 0,
      );
      if (nameEvidence >= 0.5) {
        conf += 0.2;
        basis.push("counterparty name matches subject");
      }
      const bankEvidence =
        (d.counterpartyBank && bankMatches(d.counterpartyBank, c.bank)) ||
        (c.counterpartyBank && bankMatches(c.counterpartyBank, d.bank));
      if (bankEvidence) {
        conf += 0.1;
        basis.push("counterparty bank matches receiving bank");
      }
      if (d.bank !== c.bank) conf += 0.05;

      if (conf >= 0.55 && (!best || conf > best.conf)) {
        best = { c, conf: Math.min(0.99, conf), basis, gap: Math.max(0, gap) };
      }
    }
    if (best) {
      usedCredits.add(best.c.id);
      pairs.push({
        id: nextId++,
        debitTxnId: d.id,
        creditTxnId: best.c.id,
        amountKwd: d.amountKwd,
        dateGapDays: best.gap,
        fromBank: d.bank,
        toBank: best.c.bank,
        matchBasis: best.basis.join("; "),
        confidence: best.conf,
      });
    }
  }
  return pairs;
}

function isTransferish(t: Txn): boolean {
  if (t.channel === "transfer_in" || t.channel === "transfer_out") return true;
  if (t.channel === "other" && t.amountKwd >= 100) return true;
  if (isSelfNarrative(t.narrative)) return true;
  return false;
}

export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return (db - da) / 86400000;
}

function bankMatches(label: string, bank: string): boolean {
  const a = label.toUpperCase();
  const b = bank.toUpperCase();
  if (a.includes(b) || b.includes(a)) return true;
  const tokens = b.split(/\s+/).filter((w) => w.length > 3);
  return tokens.some((w) => a.includes(w));
}
