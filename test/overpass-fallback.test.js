import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("routes automatic search through the direct listing endpoint", async () => {
  const config = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));
  assert.deepEqual(config.rewrites, [
    { source: "/api/search", destination: "/api/search-v3" },
  ]);
  assert.equal(config.functions["api/search-v2.js"].maxDuration, 60);
  assert.equal(config.functions["api/search-v3.js"].maxDuration, 60);
});

test("provides multiple Overpass instances and a targeted query", async () => {
  const source = await readFile(new URL("api/search-v2.js", root), "utf8");
  const endpoints = source.match(/https:\/\/[^"\s]+\/api\/interpreter/g) ?? [];
  assert.ok(new Set(endpoints).size >= 3);
  assert.match(source, /OVERPASS_TIMEOUT_MS = 8_000/);
  assert.match(source, /contact:website/);
  assert.match(source, /out tags center qt 80/);
  assert.match(source, /Math\.min\(35_000/);
});

test("excludes hotels and similar collective lodging", async () => {
  const source = await readFile(new URL("api/search-v2.js", root), "utf8");
  assert.doesNotMatch(source, /tourism"~"apartment\|chalet\|guest_house\|hotel/);
  assert.match(source, /EXCLUDED_OSM_TYPES/);
  assert.match(source, /hotel\|hotelier\|hoteliere\|hostel\|motel\|resort/);
  assert.match(source, /filterSearchProviderResponse/);
});
