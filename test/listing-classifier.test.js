import test from "node:test";
import assert from "node:assert/strict";
import { classifyVacationRental } from "../src/listing-classifier.js";

const wholeHomeCriteria = {
  propertyTypes: ["house", "villa", "cottage", "chalet", "farm", "estate"],
  specialCriteria: ["entireHome"],
};

function listing(overrides = {}) {
  return {
    url: "https://example.fr/location/villa-des-pins",
    title: "Villa des Pins",
    description: "Location de vacances avec réservation en ligne et disponibilités.",
    rawText: "Tarifs à la semaine. Séjour de 7 nuits pour 6 voyageurs.",
    image: "https://example.fr/villa.jpg",
    capacity: 6,
    confidence: "structured-listing",
    ...overrides,
  };
}

test("accepts a whole vacation villa", () => {
  const result = classifyVacationRental(listing(), wholeHomeCriteria);
  assert.equal(result.accepted, true);
  assert.equal(result.propertyType, "villa");
});

test("rejects a house offered for sale", () => {
  const result = classifyVacationRental(listing({
    title: "Maison à vendre avec piscine",
    description: "Prix de vente 495 000 euros",
    rawText: "DPE C. Honoraires à la charge du vendeur. Mandat exclusif.",
  }), wholeHomeCriteria);
  assert.deepEqual(result, { accepted: false, reason: "property-for-sale" });
});

test("rejects an apartment unless apartment is explicitly selected", () => {
  const candidate = listing({
    url: "https://example.fr/location/appartement-centre",
    title: "Appartement de vacances en centre-ville",
  });
  assert.equal(classifyVacationRental(candidate, wholeHomeCriteria).reason, "apartment-not-requested");
  assert.equal(classifyVacationRental(candidate, {
    ...wholeHomeCriteria,
    propertyTypes: ["apartment"],
  }).accepted, true);
});

test("rejects guest houses and bed and breakfasts", () => {
  const result = classifyVacationRental(listing({
    title: "Chambres d'hôtes La Roseraie",
    description: "Bed and breakfast avec réservation à la nuit.",
  }), wholeHomeCriteria);
  assert.equal(result.reason, "collective-or-shared-lodging");
});

test("rejects long-term residential rentals", () => {
  const result = classifyVacationRental(listing({
    title: "Maison en location à l'année",
    description: "Loyer mensuel, bail et charges comprises.",
    rawText: "Dossier locataire et dépôt de garantie obligatoires.",
  }), wholeHomeCriteria);
  assert.equal(result.reason, "long-term-rental");
});

test("rejects a property page without vacation booking evidence", () => {
  const result = classifyVacationRental(listing({
    title: "Villa contemporaine avec piscine",
    description: "Belle propriété de 180 m² dans un secteur résidentiel.",
    rawText: "Six pièces, jardin, garage et vue dégagée.",
  }), wholeHomeCriteria);
  assert.equal(result.reason, "not-confirmed-as-vacation-rental");
});

test("accepts a gite with strong booking evidence", () => {
  const result = classifyVacationRental(listing({
    url: "https://example.fr/gite/les-oliviers",
    title: "Gîte Les Oliviers",
    description: "Réserver votre séjour",
    rawText: "Calendrier de disponibilités, tarifs par nuit et par semaine, arrivée le samedi.",
  }), wholeHomeCriteria);
  assert.equal(result.accepted, true);
  assert.equal(result.propertyType, "cottage");
});
