import test from "node:test";
import assert from "node:assert/strict";

import { parseIdentity, buildIdentityIndex, nameRefersToSubject } from "./identity.ts";
import { classifyChannel, extractCounterpartyFromNarrative } from "./vocab.ts";

test("reference identities key on their literal masked fragment", () => {
  assert.equal(parseIdentity("Account 100600XXXX").key, "acct:100600XXXX");
  assert.equal(parseIdentity("Account 100600XXXX").kind, "account_ref");
  assert.equal(parseIdentity("InstaPay 6999XXXX").key, "ip:6999XXXX");
  assert.equal(parseIdentity("InstaPay 6999XXXX").kind, "instapay_ref");
  assert.notEqual(parseIdentity("Account 100600XXXX").key, parseIdentity("Account 100601XXXX").key);
});

test("legal suffixes collapse company spellings into one key", () => {
  const a = parseIdentity("ALBURAIMI AUTO RENT COMPANY");
  const b = parseIdentity("ALBURAIMI AUTO RENT CO");
  assert.equal(a.key, b.key);
  assert.equal(a.kind, "name");
});

test("person-name variants merge only under mutual coverage", () => {
  const idx = buildIdentityIndex([
    "ANWAR H A",
    "ANWAR H",
    "ANWAR HAMAD ALI",
    "MOHAMMED A",
    "MOHAMMED K",
    "FAISAL AL MUTAIRI",
    "FAISAL AL AZMI",
    "ANWAR",
  ]);
  // The three ANWAR H* variants are one party...
  assert.equal(idx.keyOf("ANWAR H A"), idx.keyOf("ANWAR HAMAD ALI"));
  assert.equal(idx.keyOf("ANWAR H"), idx.keyOf("ANWAR HAMAD ALI"));
  // ...and the fullest spelling represents the cluster.
  assert.equal(idx.displayOf(idx.keyOf("ANWAR H")), "ANWAR HAMAD ALI");
  // Conflicting initials never merge.
  assert.notEqual(idx.keyOf("MOHAMMED A"), idx.keyOf("MOHAMMED K"));
  // A shared first name alone is never enough.
  assert.notEqual(idx.keyOf("FAISAL AL MUTAIRI"), idx.keyOf("FAISAL AL AZMI"));
  // A bare single token stays alone rather than absorbing initialed variants.
  assert.notEqual(idx.keyOf("ANWAR"), idx.keyOf("ANWAR H"));
});

test("subject self-references are recognized for suppression", () => {
  assert.equal(nameRefersToSubject("FAHAD", "FAHAD AL RASHIDI"), true);
  assert.equal(nameRefersToSubject("FAHAD AL RASHIDI", "FAHAD AL RASHIDI"), true);
  assert.equal(nameRefersToSubject("FAHAD ALOTAIBI", "FAHAD AL RASHIDI"), false);
  assert.equal(nameRefersToSubject("OBAID MOHAMMAD", "FAHAD AL RASHIDI"), false);
});

test("narrative extraction: internal-operations account reference", () => {
  const got = extractCounterpartyFromNarrative(
    "INTRNL OPR | INTERNAL OPERATIONS To  # 22926,correct wrong transfer | correct wrong transfer",
  );
  assert.equal(got, "Account 22926");
});

test("narrative extraction: inward SWIFT party name", () => {
  const got = extractCounterpartyFromNarrative(
    "IN SWIFT | INWARD SWIFT PAYMENT   # XXXXXXXX,  46000.000 KWD,FAHAD | 46000.000 KWD | FAHAD | NORMAL | NORMAL",
  );
  assert.equal(got, "FAHAD");
});

test("narrative extraction: POS merchant lines", () => {
  const multiline = extractCounterpartyFromNarrative(
    "POS PRCH\nALKUBAIZI MOTOR                                                          SHUWEKH         KWT",
  );
  assert.equal(multiline, "ALKUBAIZI MOTOR");
  const prefixed = extractCounterpartyFromNarrative("POS-ALRAWAD EXCHANGE EST  SHARQ");
  assert.equal(prefixed, "ALRAWAD EXCHANGE EST");
  // Generic purchase rows yield nothing.
  assert.equal(extractCounterpartyFromNarrative("PURCHASE\n            DUBAI"), null);
});

test("KNET WDL rows classify as cash withdrawals, balance inquiries stay other", () => {
  assert.equal(
    classifyChannel({
      narrative: "KNT WDL-NBK KUW XXXX          KUWAIT B",
      extra: null,
      direction: "debit",
      hasCounterparty: false,
    }),
    "cash_withdrawal",
  );
  assert.equal(
    classifyChannel({
      narrative: "KNT BAL INQ-NBK KUW XXXX",
      extra: null,
      direction: "debit",
      hasCounterparty: false,
    }),
    "other",
  );
});
