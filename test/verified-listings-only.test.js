import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("shows only verified individual property pages", async () => {
  const source = await readFile(new URL("api/search-v4.js", root), "utf8");
  assert.match(source, /VERIFIED_CONFIDENCE/);
  assert.match(source, /structured-listing/);
  assert.match(source, /public-listing-page/);
  assert.match(source, /results: verifiedListings/);
  assert.doesNotMatch(source, /\.\.\.payload\.results/);
});

test("rejects hotels, generic pages and unverified search snippets", async () => {
  const source = await readFile(new URL("api/search-v4.js", root), "utf8");
  assert.match(source, /EXCLUDED_LODGING/);
  assert.match(source, /GENERIC_PAGE/);
  assert.match(source, /VERIFIED_CONFIDENCE\.has\(item\.confidence\)/);
  assert.match(source, /item\?\.listing/);
  assert.match(source, /hasPropertyEvidence/);
});

test("reports only verified listings in displayed discovery count", async () => {
  const source = await readFile(new URL("api/search-v4.js", root), "utf8");
  assert.match(source, /discovered: verifiedListings\.length/);
  assert.match(source, /verifiedDirectListings: verifiedListings\.length/);
  assert.match(source, /resultMode: "verified-listings-only"/);
});
