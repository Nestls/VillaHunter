import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("routes automatic search through the resilient endpoint", async () => {
  const config = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));
  assert.deepEqual(config.rewrites, [
    { source: "/api/search", destination: "/api/search-v2" },
  ]);
});

test("provides multiple Overpass instances", async () => {
  const source = await readFile(new URL("api/search-v2.js", root), "utf8");
  const endpoints = source.match(/https:\/\/[^"\s]+\/api\/interpreter/g) ?? [];
  assert.ok(new Set(endpoints).size >= 3);
  assert.match(source, /AbortSignal\.timeout\(3_000\)/);
});
