import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("routes searches through the direct listing engine", async () => {
  const config = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));
  assert.deepEqual(config.rewrites, [
    { source: "/api/search", destination: "/api/search-v3" },
  ]);
  assert.equal(config.functions["api/search-v3.js"].maxDuration, 60);
});

test("discovers and enriches individual property pages", async () => {
  const source = await readFile(new URL("api/search-v3.js", root), "utf8");
  assert.match(source, /BRAVE_SEARCH_API_KEY/);
  assert.match(source, /searchListingPages/);
  assert.match(source, /site:gites-de-france\.com/);
  assert.match(source, /site:clevacances\.com/);
  assert.match(source, /extractStructuredListing/);
  assert.match(source, /og:image/);
  assert.match(source, /listing: true/);
  assert.match(source, /directListings/);
});

test("keeps collective lodging out of direct results", async () => {
  const source = await readFile(new URL("api/search-v3.js", root), "utf8");
  assert.match(source, /EXCLUDED_LODGING/);
  assert.match(source, /-hotel -hôtel -camping/);
  assert.match(source, /airbnb.*booking.*abritel.*vrbo/i);
});
