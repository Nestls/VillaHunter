import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("search responses expose the synchronized engine version", async () => {
  const source = await readFile(new URL("api/search-v5.js", root), "utf8");
  assert.match(source, /const ENGINE_VERSION = "0\.6\.0"/);
  assert.match(source, /engineVersion: ENGINE_VERSION/);
  assert.match(source, /vacationRentalVerified: true/);
});

test("browser removes stale results and old Vercel API overrides", async () => {
  const source = await readFile(new URL("src/listing-ui.js", root), "utf8");
  assert.match(source, /previousVersion !== ENGINE_VERSION/);
  assert.match(source, /stored\.results = \[\]/);
  assert.match(source, /localStorage\.removeItem\(API_KEY\)/);
});

test("browser rejects mismatched or unverified search responses", async () => {
  const source = await readFile(new URL("src/listing-ui.js", root), "utf8");
  assert.match(source, /responseVersion !== ENGINE_VERSION/);
  assert.match(source, /vacationRentalVerified !== true/);
  assert.match(source, /status: 409/);
});

test("health endpoint reports runtime synchronization", async () => {
  const source = await readFile(new URL("api/health.js", root), "utf8");
  assert.match(source, /version: ENGINE_VERSION/);
  assert.match(source, /runtimeSync: true/);
});
