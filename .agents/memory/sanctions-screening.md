---
name: Sanctions screening layer
description: List sources, caching, and matcher-tier lessons for the sanctions screening engine
---

## List sources (all redirect - follow, no Range requests)
- OFAC: sanctionslistservice.ofac.treas.gov/api/download/sdn.csv and alt.csv (CSV, `-0-` = null). HEAD returns 405; ranged GETs return empty 302s - plain GET with redirect-follow works.
- UN: scsanctions.un.org/resources/xml/en/consolidated.xml (regenerated daily). Dropping the /resources/ prefix 404s with "Unsupported regime, language, or route."
- ALT.csv holds official aliases keyed by ent_num; keep only aka/fka types. Quoted CSV fields contain literal newlines - parser must be quote-aware, not line-split.

## Matcher tier design
- exact = sorted canonical-token equality. **Why:** OFAC lists names as "LAST, FIRST"; order-sensitive comparison silently downgrades true exact hits to strong.
- strong = namesLikelySame (mutual coverage, shared substantive token) reused from identity.ts.
- possible = >=2 shared DISTINCTIVE tokens. **Why:** without a non-distinctive filter (AND/THE/BIN/ABU/GENERAL/TRADING/GROUP/INTERNATIONAL...), function words and Gulf trade-name fillers create junk hits, e.g. "BAQALA AND MORE" matched "NINGBO MORE INTEREST IMP. AND EXP. CO." via AND+MORE.
- **How to apply:** distinctiveness only gates the possible tier; exact/strong require full coverage and stay unaffected.

## Engine invariants
- Screening is evidence-only JSONB on the analysis run; it never feeds the Bayesian score.
- Honest failure: no fresh download AND no cache => status "unavailable" with explicit "not a clean result" reason. Stale cache is used but flagged per list. Parse floors reject implausibly small lists so a truncated file can never pass as clean.
- Cache publication must be atomic (temp-write + rename) with PER-FILE meta written after its data file. **Why:** a shared meta.json updated read-modify-write by three concurrent list downloads lost updates (observed live: one list's meta entry vanished, silently disabling its stale-fallback).
- Warm the lists at boot, but bound the screening wait (deadline => honest unavailable) so an analyze request never hangs on a cold load; the load continues in the background.
- OFAC ALT types must be normalized (strip non-letters) before filtering: the feed has used "aka" and "a.k.a." spellings; keep aka/fka/nka, drop weak aliases.

## Report PDF numbering trap
Section numbers appear in THREE places in the report: static titles (1-5), AI-conditional titles (7-11), and aiComplete-ternary titles near the end (Analyst Disposition, Method & Limitations, which render different numbers per variant). Inserting a section requires renumbering all three, and verifying BOTH PDF variants (AI-complete run and fresh non-AI run).
