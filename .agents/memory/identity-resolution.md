---
name: Counterparty identity resolution
description: Conventions for the identity.ts clustering layer - what may merge, what must never merge, and why digits are preserved.
---

# Counterparty identity resolution

The rule: all counterparty-counting analytics (fan-in, HHI, funnel, cross-bank
bridging) key on resolved identity clusters, never on raw uppercase strings.

- Reference identities ("Account 100600XXXX", "InstaPay 6999XXXX") merge ONLY on
  literally identical visible fragments, and findings label them "masked
  reference matched literally".
- Name identities merge ONLY under mutual token coverage (every token matched
  exactly or by initial) with at least one shared substantive token. A shared
  first name alone never merges; conflicting initials never merge.
- Identity normalization PRESERVES digits, unlike display normalizeName.
  **Why:** digit-stripping collapsed "01673XXXXX" and "00077XXXXX" into one
  phantom "XXXXX" party and merged "Sender 1..10" fixtures into one cluster.
  **How to apply:** never route identity keys through vocab.normalizeName;
  use identity.ts's own normalizer.
- Subject self-references (extracted names whose tokens are all covered by the
  subject's name) are nulled at ingestion so they cannot pose as identified
  senders. Suppression happens in ingestFile, not parseWorkbook.
- Deterministic-score isolation still holds: identity changes shift FEATURE
  inputs and TECH findings, not rule logic. FAHAD re-ingest changed findings
  (NET-02 appeared, NET-01 high->medium, bridging ungated) while probability
  stayed 0.4609 exactly.
