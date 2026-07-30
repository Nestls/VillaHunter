import searchHandler from "./search-v4.js";
import { classifyVacationRental } from "../src/listing-classifier.js";
import { normalizeCriteria } from "../src/search-model.js";

export default async function handler(request, response) {
  const originalJson = response.json.bind(response);

  response.json = (payload) => {
    if (request.method !== "POST" || !payload || !Array.isArray(payload.results)) {
      return originalJson(payload);
    }

    const criteria = normalizeCriteria(request.body?.criteria ?? request.body ?? {});
    const accepted = [];
    const rejectionCounts = {};

    for (const item of payload.results) {
      const classification = classifyVacationRental(item, criteria);
      if (!classification.accepted) {
        rejectionCounts[classification.reason] = (rejectionCounts[classification.reason] ?? 0) + 1;
        continue;
      }
      accepted.push({
        ...item,
        propertyType: classification.propertyType,
        vacationRentalVerified: true,
        classification: classification.reason,
      });
    }

    return originalJson({
      ...payload,
      results: accepted,
      sources: {
        ...(payload.sources ?? {}),
        discovered: accepted.length,
        withinTravelTime: accepted.length,
        crawled: accepted.length,
        directListings: accepted.length,
        verifiedDirectListings: accepted.length,
        strictVacationRentals: accepted.length,
        rejectedByStrictClassifier: rejectionCounts,
        resultMode: "strict-vacation-rentals",
      },
      warnings: strictWarnings(payload.warnings, accepted.length, rejectionCounts),
    });
  };

  return searchHandler(request, response);
}

function strictWarnings(existing = [], count, rejectionCounts = {}) {
  const warnings = (existing ?? []).filter((warning) => {
    const text = normalizeText(warning);
    return !text.includes("annonce individuelle")
      && !text.includes("fiche individuelle")
      && !text.includes("pages d agences")
      && !text.includes("hôtels")
      && !text.includes("hotels");
  });

  if (count > 0) {
    warnings.push(`${count} location${count > 1 ? "s" : ""} saisonnière${count > 1 ? "s" : ""} entière${count > 1 ? "s" : ""} correspondant aux types cochés.`);
  } else {
    warnings.push("Aucune location saisonnière entière suffisamment fiable ne correspond aux types cochés. Les ventes immobilières, locations longue durée, appartements non demandés et chambres d’hôtes ont été masqués.");
  }

  const rejectedTotal = Object.values(rejectionCounts).reduce((sum, value) => sum + value, 0);
  if (rejectedTotal > 0) {
    warnings.push(`${rejectedTotal} résultat${rejectedTotal > 1 ? "s" : ""} hors critères ont été écartés automatiquement.`);
  }

  return warnings;
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
