import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPlatform,
  evaluateSnapshot,
  nightsBetween,
  normalizeUrl,
  parseLinks,
} from "../src/core.js";

test("detects supported platforms", () => {
  assert.equal(detectPlatform("https://www.airbnb.fr/rooms/42"), "airbnb");
  assert.equal(detectPlatform("https://www.booking.com/hotel/fr/demo.html"), "booking");
  assert.equal(detectPlatform("not-a-url"), "invalide");
});

test("injects exact Airbnb criteria", () => {
  const result = new URL(normalizeUrl("https://www.airbnb.fr/s/Grasse/homes?flexible_trip_lengths=one_week", {
    checkin: "2026-08-17",
    checkout: "2026-08-24",
    adults: 4,
    children: 2,
    infants: 1,
  }));
  assert.equal(result.searchParams.get("checkin"), "2026-08-17");
  assert.equal(result.searchParams.get("checkout"), "2026-08-24");
  assert.equal(result.searchParams.get("adults"), "4");
  assert.equal(result.searchParams.get("date_picker_type"), "calendar");
});

test("removes tracking parameters", () => {
  const result = new URL(normalizeUrl("https://example.com/listing?utm_source=x&foo=bar"));
  assert.equal(result.searchParams.get("utm_source"), null);
  assert.equal(result.searchParams.get("foo"), "bar");
});

test("deduplicates normalized links", () => {
  const result = parseLinks("https://example.com/a?utm_source=x\nhttps://example.com/a");
  assert.equal(result.valid.length, 1);
  assert.equal(result.invalid.length, 0);
});

test("classifies obvious unavailable snapshots conservatively", () => {
  assert.deepEqual(evaluateSnapshot("Ces dates ne sont pas disponibles"), {
    status: "indisponible",
    confidence: "moyenne",
  });
  assert.equal(evaluateSnapshot("Réserver maintenant").status, "à vérifier");
});

test("counts strict nights", () => {
  assert.equal(nightsBetween("2026-08-17", "2026-08-24"), 7);
  assert.equal(nightsBetween("2026-08-24", "2026-08-17"), 0);
});
