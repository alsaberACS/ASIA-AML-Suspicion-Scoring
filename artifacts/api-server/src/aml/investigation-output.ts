import type {
  AiInvestigation,
  InvestigationAction,
  InvestigationHypothesis,
} from "./types";

export function coerceAiInvestigation(
  raw: unknown,
  validIds: Set<number>,
  validFindingIds: Set<string>,
): AiInvestigation {
  const root = ((raw as Record<string, unknown>)?.aiInvestigation ?? raw ?? {}) as Record<
    string,
    unknown
  >;
  const rawHypotheses = Array.isArray(root.hypotheses) ? root.hypotheses : [];
  const hypotheses: InvestigationHypothesis[] = rawHypotheses.slice(0, 8).map((value, index) => {
    const item = (value ?? {}) as Record<string, unknown>;
    const supportingTxnIds = validTxnIds(item.supportingTxnIds, validIds);
    const requestedStatus = enumValue(
      item.status,
      ["supported", "plausible", "inconclusive", "not_supported"] as const,
      "inconclusive",
    );
    const rationale = guardedText(item.rationale, validIds, validFindingIds);
    return {
      hypothesisId: guardedText(
        item.hypothesisId || `AI-HYP-${index + 1}`,
        validIds,
        validFindingIds,
      ),
      title: guardedText(item.title, validIds, validFindingIds),
      priority: enumValue(item.priority, ["high", "medium", "low"] as const, "medium"),
      status:
        supportingTxnIds.length === 0 &&
        (requestedStatus === "supported" || requestedStatus === "plausible")
          ? "inconclusive"
          : requestedStatus,
      rationale:
        supportingTxnIds.length > 0 && !/\[txn\s+\d+/i.test(rationale)
          ? `${rationale} Supporting evidence: [txn ${supportingTxnIds.join(", ")}].`
          : rationale,
      supportingTxnIds,
      contradictoryTxnIds: validTxnIds(item.contradictoryTxnIds, validIds),
      technicalFindingIds: (
        Array.isArray(item.technicalFindingIds) ? item.technicalFindingIds : []
      )
        .map(String)
        .filter((id) => validFindingIds.has(id))
        .slice(0, 10),
      benignExplanations: guardedStrArr(item.benignExplanations, validIds, validFindingIds),
      unresolvedQuestions: guardedStrArr(item.unresolvedQuestions, validIds, validFindingIds),
    };
  });

  const rawActions = Array.isArray(root.recommendedActions) ? root.recommendedActions : [];
  const recommendedActions: InvestigationAction[] = rawActions.slice(0, 10).map((value) => {
    const item = (value ?? {}) as Record<string, unknown>;
    return {
      priority: enumValue(item.priority, ["high", "medium", "low"] as const, "medium"),
      action: guardedText(item.action, validIds, validFindingIds),
      rationale: guardedText(item.rationale, validIds, validFindingIds),
      evidenceNeeded: guardedText(item.evidenceNeeded, validIds, validFindingIds),
    };
  });

  const executiveAssessment = guardedText(
    root.executiveAssessment,
    validIds,
    validFindingIds,
  );
  const executiveEvidence = [
    ...new Set(hypotheses.flatMap((hypothesis) => hypothesis.supportingTxnIds)),
  ].slice(0, 12);

  return {
    executiveAssessment:
      executiveEvidence.length > 0 && !/\[txn\s+\d+/i.test(executiveAssessment)
        ? `${executiveAssessment} Linked transaction evidence: [txn ${executiveEvidence.join(", ")}].`
        : executiveAssessment,
    hypotheses,
    recommendedActions,
    limitations: guardedStrArr(root.limitations, validIds, validFindingIds),
  };
}

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

function validTxnIds(value: unknown, validIds: Set<number>): number[] {
  return (Array.isArray(value) ? value : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && validIds.has(id))
    .slice(0, 30);
}

function guardedStrArr(
  value: unknown,
  validIds: Set<number>,
  validFindingIds: Set<string>,
): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string")
    .map((item) => guardedText(item, validIds, validFindingIds))
    .filter(Boolean)
    .slice(0, 12);
}

export function guardedText(
  value: unknown,
  validIds: Set<number>,
  validFindingIds: Set<string>,
): string {
  return String(value ?? "")
    .replace(
      /\[(?:txn|transaction)s?\s+([^\]]+)\]/gi,
      (_reference, contents: string) => {
        const ids = [...contents.matchAll(/\d+/g)]
          .map((match) => Number(match[0]))
          .filter((id) => validIds.has(id));
        return ids.length > 0
          ? `[txn ${[...new Set(ids)].join(", ")}]`
          : "[unsupported transaction reference removed]";
      },
    )
    .replace(
      /\b(?:txn|transaction)s?\s+(?:id\s*)?#?\s*(\d+)\b/gi,
      (reference, rawId: string) =>
        validIds.has(Number(rawId)) ? reference : "[unsupported transaction reference removed]",
    )
    .replace(/\bTECH-[A-Z]+-\d+\b/gi, (reference) =>
      validFindingIds.has(reference.toUpperCase())
        ? reference.toUpperCase()
        : "[unsupported technical finding removed]",
    )
    .replace(/\b\d+(?:\.\d+)?\s*%\s+of\b/gi, "a material share of")
    .replace(/\b\d+(?:\.\d+)?\s*%/g, "an unquantified proportion")
    .replace(
      /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[-\s]+(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred))*\s+percent\b/gi,
      "an unquantified proportion",
    )
    .replace(/\b(?:suspicion|illicit(?:-activity)?|laundering)\s+(?:probability|likelihood|odds)\b/gi, "AI classification withheld")
    .replace(/\b(?:risk|suspicion)\s+(?:score|rating|band|level)\b/gi, "AI classification withheld")
    .replace(/\b(?:low|moderate|elevated|high|critical)[-\s]+risk\b/gi, "AI classification withheld")
    .replace(/\brisk\s*(?:is|:|=|remains|appears)\s*(?:low|moderate|elevated|high|critical)\b/gi, "AI classification withheld")
    .replace(/\b(?:rating|band|classification)\s*(?::|is|=)\s*(?:low|moderate|elevated|high|critical)\b/gi, "AI classification withheld")
    .replace(/\b(?:case|subject|customer|activity|transaction|suspicion)\s+(?:is|appears|looks|seems|remains|rated|classified)?\s*(?:an?\s+)?(?:low|moderate|elevated|high|critical)[-\s]+risk\b/gi, "AI classification withheld")
    .replace(/\b(?:probability|percentage|risk\s+score|risk\s+band)\b/gi, "AI classification withheld")
    .trim();
}