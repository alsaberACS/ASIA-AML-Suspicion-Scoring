import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseOfac, parseUn, SanctionsIndex } from "./sanctions.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const SDN_CSV = [
  '9001,"HUSSAIN, MOHAMMED AHMED","individual","SDGT] [IFSR",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"Senior operative."',
  '9002,"GLOBAL TRADING HOUSE",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
  '9003,"SPLIT',
  'LINE COMPANY",-0- ,"SDNTK",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
  '9004,"ALPHA GENERAL TRADING",-0- ,"SDNTK",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
  '9005,"DELTA AND MORE",-0- ,"SDNTK",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
].join("\r\n");

const ALT_CSV = [
  '9001,101,"aka","ABU AHMED",-0- ',
  '9001,102,"weak alias","IGNORED NAME",-0- ',
  '9001,104,"n.k.a.","KARIM WAHID",-0- ',
  '9002,103,"fka","OLD TRADING HOUSE",-0- ',
  '9002,105,"a.k.a.","GTH WORLDWIDE",-0- ',
].join("\r\n");

const UN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST dateGenerated="2026-08-20">
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>123</DATAID>
      <FIRST_NAME>ALI</FIRST_NAME>
      <SECOND_NAME>HASSAN</SECOND_NAME>
      <THIRD_NAME>SALEH</THIRD_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
      <REFERENCE_NUMBER>QDi.001</REFERENCE_NUMBER>
      <LISTED_ON>2001-10-08</LISTED_ON>
      <INDIVIDUAL_ALIAS>
        <QUALITY>Good</QUALITY>
        <ALIAS_NAME>ABU KARRAR</ALIAS_NAME>
      </INDIVIDUAL_ALIAS>
      <COMMENTS1>Test comment.</COMMENTS1>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>456</DATAID>
      <FIRST_NAME>DESERT LOGISTICS NETWORK</FIRST_NAME>
      <UN_LIST_TYPE>ISIL (Da'esh)</UN_LIST_TYPE>
      <ENTITY_ALIAS>
        <QUALITY>a.k.a.</QUALITY>
        <ALIAS_NAME>DLN GROUP</ALIAS_NAME>
      </ENTITY_ALIAS>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`;

const meta = (id, entryCount) => ({
  id,
  label: id,
  fetchedAt: "2026-01-01T00:00:00.000Z",
  stale: false,
  entryCount,
});

function buildIndex() {
  const ofac = parseOfac(SDN_CSV, ALT_CSV);
  const un = parseUn(UN_XML);
  return new SanctionsIndex([
    { meta: meta("ofac_sdn", ofac.length), entries: ofac },
    { meta: meta("un_consolidated", un.length), entries: un },
  ]);
}

/* ------------------------------------------------------------------ */
/* CSV parsing                                                        */
/* ------------------------------------------------------------------ */

test("parseCsv handles quoted commas, escaped quotes and multiline fields", () => {
  const rows = parseCsv('1,"A, B","say ""hi""",plain\r\n2,"MULTI\nLINE",x,y\r\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["1", "A, B", 'say "hi"', "plain"]);
  assert.equal(rows[1][1], "MULTI\nLINE");
});

test("parseOfac builds entries with aliases, programs, remarks", () => {
  const entries = parseOfac(SDN_CSV, ALT_CSV);
  assert.equal(entries.length, 5);

  const hussain = entries.find((e) => e.entryId === "SDN-9001");
  assert.equal(hussain.entryType, "individual");
  assert.deepEqual(hussain.programs, ["SDGT", "IFSR"]);
  assert.equal(hussain.remarks, "Senior operative.");
  assert.equal(hussain.names.length, 3); // primary + aka + n.k.a.; weak alias skipped
  assert.ok(hussain.names.some((n) => n.isAlias && n.text === "ABU AHMED"));
  assert.ok(!hussain.names.some((n) => n.text === "IGNORED NAME"));

  const global = entries.find((e) => e.entryId === "SDN-9002");
  assert.equal(global.entryType, "entity"); // -0- type defaults to entity
  assert.ok(global.names.some((n) => n.isAlias)); // fka kept

  const split = entries.find((e) => e.entryId === "SDN-9003");
  // Multiline quoted name is one field; COMPANY is stripped as a legal suffix
  // by the shared canonical tokenizer (consistent with identity clustering).
  assert.deepEqual(split.names[0].tokens, ["SPLIT", "LINE"]);
});

test("parseUn composes names and aliases for individuals and entities", () => {
  const entries = parseUn(UN_XML);
  assert.equal(entries.length, 2);

  const ind = entries.find((e) => e.entryId === "UN-123");
  assert.equal(ind.primaryName, "ALI HASSAN SALEH");
  assert.equal(ind.entryType, "individual");
  assert.equal(ind.referenceNumber, "QDi.001");
  assert.equal(ind.listedOn, "2001-10-08");
  assert.deepEqual(ind.programs, ["Al-Qaida"]);
  assert.ok(ind.names.some((n) => n.isAlias && n.text === "ABU KARRAR"));

  const ent = entries.find((e) => e.entryId === "UN-456");
  assert.equal(ent.entryType, "entity");
  assert.ok(ent.names.some((n) => n.isAlias && n.text === "DLN GROUP"));
});

/* ------------------------------------------------------------------ */
/* Matching tiers                                                     */
/* ------------------------------------------------------------------ */

test("exact tier is order-insensitive (LAST, FIRST vs natural order)", () => {
  const idx = buildIndex();
  const matches = idx.screen("MOHAMMED AHMED HUSSAIN");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, "exact");
  assert.equal(matches[0].entryId, "SDN-9001");
  assert.equal(matches[0].matchedAlias, null);
});

test("honorifics are stripped before matching", () => {
  const idx = buildIndex();
  const matches = idx.screen("MR MOHAMMED AHMED HUSSAIN");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, "exact");
});

test("strong tier covers initials against full names", () => {
  const idx = buildIndex();
  const matches = idx.screen("M A HUSSAIN");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, "strong");
  assert.equal(matches[0].entryId, "SDN-9001");
});

test("alias matches are reported with the listed alias", () => {
  const idx = buildIndex();
  const matches = idx.screen("ABU AHMED");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, "exact");
  assert.equal(matches[0].matchedAlias, "ABU AHMED");
  assert.equal(matches[0].listedName, "HUSSAIN, MOHAMMED AHMED");
});

test("possible tier requires two shared distinctive tokens", () => {
  const idx = buildIndex();
  // GLOBAL + HOUSE shared with "GLOBAL TRADING HOUSE"; TRADING would not
  // count (non-distinctive), and mutual coverage fails - so: possible.
  const matches = idx.screen("GLOBAL HOUSE NETWORK");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, "possible");
  assert.equal(matches[0].entryId, "SDN-9002");
});

test("a single shared common token does not match", () => {
  const idx = buildIndex();
  assert.equal(idx.screen("GLOBAL LOGISTICS").length, 0);
  assert.equal(idx.screen("AHMED KHALID").length, 0);
});

test("dotted and n.k.a. alias types from the real feed are accepted", () => {
  const idx = buildIndex();
  const nka = idx.screen("KARIM WAHID");
  assert.equal(nka[0]?.tier, "exact");
  assert.equal(nka[0]?.matchedAlias, "KARIM WAHID");
  const dotted = idx.screen("GTH WORLDWIDE");
  assert.equal(dotted[0]?.tier, "exact");
  assert.equal(dotted[0]?.entryId, "SDN-9002");
});

test("generic tokens never establish a possible match on their own", () => {
  const idx = buildIndex();
  // "AND" + "MORE" vs DELTA AND MORE: only MORE is distinctive - no match.
  assert.equal(idx.screen("BAQALA AND MORE").length, 0);
  // GENERAL + TRADING are Gulf trade-name fillers - no match either.
  assert.equal(idx.screen("OMEGA GENERAL TRADING").length, 0);
  // Full coverage still matches: exact tier is unaffected by the filter.
  assert.equal(idx.screen("ALPHA GENERAL TRADING")[0]?.tier, "exact");
});

test("UN entries match through the same tiers", () => {
  const idx = buildIndex();
  const matches = idx.screen("SALEH ALI HASSAN");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, "exact");
  assert.equal(matches[0].listId, "un_consolidated");
});
