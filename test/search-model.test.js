import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeText,
  approximateRadiusMeters,
  buildDateWindows,
  buildPlatformSearchLinks,
  normalizeCriteria,
  scoreResult,
  validateCriteria,
} from "../src/search-model.js";

test("normalizes travelers and arrays", () => {
  const criteria = normalizeCriteria({ adults: "0", children: "2", amenities: ["pool", "pool"], maxTravelMinutes: 999 });
  assert.equal(criteria.adults, 1);
  assert.equal(criteria.children, 2);
  assert.deepEqual(criteria.amenities, ["pool"]);
  assert.equal(criteria.maxTravelMinutes, 180);
});

test("validates exact dates and location", () => {
  const invalid = validateCriteria({ place: "", dateMode: "exact", checkin: "2026-08-24", checkout: "2026-08-17" });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 2);
});

test("builds exact and flexible date windows", () => {
  assert.deepEqual(buildDateWindows({ dateMode: "exact", checkin: "2026-08-17", checkout: "2026-08-24" }), [
    { checkin: "2026-08-17", checkout: "2026-08-24" },
  ]);
  const flexible = buildDateWindows({ dateMode: "flexible", flexibleStart: "2026-08-01", flexibleEnd: "2026-08-15", stayNights: 7, flexibilityDays: 3 });
  assert.ok(flexible.length >= 3);
  assert.equal(flexible[0].checkin, "2026-08-01");
});

test("builds platform searches with exact criteria", () => {
  const links = buildPlatformSearchLinks({
    place: "Saint-Bernard", dateMode: "exact", checkin: "2026-08-17", checkout: "2026-08-24",
    adults: 4, children: 2, infants: 1, pets: 1, sources: ["airbnb", "booking", "vrbo"],
  });
  const airbnb = new URL(links.find((item) => item.source === "airbnb").url);
  assert.equal(airbnb.searchParams.get("checkin"), "2026-08-17");
  assert.equal(airbnb.searchParams.get("pets"), "1");
  assert.equal(links.length, 3);
});

test("detects amenities and privacy signals", () => {
  const analysis = analyzeText("Villa isolée au calme avec piscine privée, jacuzzi et jardin clôturé sans vis-à-vis");
  assert.equal(analysis.amenities.privatePool, true);
  assert.equal(analysis.amenities.jacuzzi, true);
  assert.equal(analysis.amenities.fencedGarden, true);
  assert.equal(analysis.privacy, true);
});

test("scores matching local results higher", () => {
  const criteria = {
    place: "Grasse", dateMode: "exact", checkin: "2026-08-17", checkout: "2026-08-24",
    adults: 4, children: 2, infants: 1, maxTravelMinutes: 30, maxBudget: 3000,
    amenities: ["pool", "barbecue"], specialCriteria: ["privacy", "quiet"], sources: ["local"],
  };
  const good = scoreResult({
    sourceType: "local", travelMinutes: 12, totalPrice: 2400, capacity: 8,
    title: "Villa isolée au calme", description: "Piscine et barbecue sans vis-à-vis", availability: "available",
  }, criteria);
  const weak = scoreResult({ sourceType: "platform", travelMinutes: 50, capacity: 4, description: "Appartement en résidence" }, criteria);
  assert.ok(good.score > weak.score);
  assert.ok(good.score >= 80);
});

test("converts travel time to bounded discovery radius", () => {
  assert.equal(approximateRadiusMeters(5), 5000);
  assert.ok(approximateRadiusMeters(30) > 20_000);
  assert.ok(approximateRadiusMeters(300) <= 150_000);
});
