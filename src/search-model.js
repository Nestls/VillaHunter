export const AMENITIES = [
  ["privatePool", "Piscine privée", ["piscine privée", "private pool", "piscina privada"]],
  ["pool", "Piscine", ["piscine", "swimming pool", "pool", "piscina"]],
  ["heatedPool", "Piscine chauffée", ["piscine chauffée", "heated pool", "climatisée"]],
  ["securedPool", "Piscine sécurisée", ["piscine sécurisée", "barrière piscine", "pool fence", "alarme piscine"]],
  ["jacuzzi", "Jacuzzi / spa", ["jacuzzi", "spa", "hot tub", "bain à remous"]],
  ["barbecue", "Barbecue", ["barbecue", "bbq", "plancha"]],
  ["airConditioning", "Climatisation", ["climatisation", "air conditioning", "air-conditioned", "climatisé"]],
  ["wifi", "Wi-Fi", ["wifi", "wi-fi", "internet"]],
  ["parking", "Parking", ["parking", "garage", "stationnement"]],
  ["evCharger", "Recharge électrique", ["borne de recharge", "recharge véhicule", "ev charger"]],
  ["fencedGarden", "Jardin clôturé", ["jardin clôturé", "terrain clos", "fenced garden"]],
  ["babyEquipment", "Équipement bébé", ["lit bébé", "chaise haute", "baby cot", "crib", "équipement bébé"]],
  ["petsAllowed", "Animaux acceptés", ["animaux acceptés", "pet friendly", "pets allowed", "chiens acceptés"]],
  ["washingMachine", "Lave-linge", ["lave-linge", "machine à laver", "washing machine"]],
  ["dishwasher", "Lave-vaisselle", ["lave-vaisselle", "dishwasher"]],
  ["accessible", "Accessible PMR", ["pmr", "accessible", "wheelchair", "fauteuil roulant"]],
  ["view", "Belle vue", ["vue mer", "vue lac", "vue montagne", "panoramique", "sea view", "lake view"]],
  ["fireplace", "Cheminée", ["cheminée", "fireplace", "poêle à bois"]],
  ["games", "Jeux / loisirs", ["table de ping-pong", "baby-foot", "billard", "trampoline", "aire de jeux"]],
];

export const SPECIAL_CRITERIA = [
  ["quiet", "Calme"],
  ["privacy", "Peu ou pas de voisins"],
  ["isolated", "Maison isolée"],
  ["noSharedAreas", "Aucun espace partagé"],
  ["secureChildren", "Sécurisé pour enfants"],
  ["flatAccess", "Accès facile / terrain plat"],
  ["shopsNearby", "Commerces proches"],
  ["beachNearby", "Plage ou baignade proche"],
  ["noRoadNoise", "Pas de route passante"],
  ["entireHome", "Logement entier uniquement"],
];

export const PROPERTY_TYPES = [
  ["house", "Maison"],
  ["villa", "Villa"],
  ["cottage", "Gîte"],
  ["chalet", "Chalet"],
  ["apartment", "Appartement"],
  ["farm", "Mas / ferme"],
  ["estate", "Domaine"],
];

export const SOURCE_TYPES = [
  ["local", "Agences et conciergeries locales"],
  ["direct", "Propriétaires et sites directs"],
  ["tourism", "Offices de tourisme et labels"],
  ["airbnb", "Airbnb"],
  ["booking", "Booking.com"],
  ["vrbo", "Abritel / Vrbo"],
];

const DEFAULT_CRITERIA = Object.freeze({
  place: "",
  maxTravelMinutes: 30,
  travelMode: "driving",
  dateMode: "exact",
  checkin: "",
  checkout: "",
  flexibleStart: "",
  flexibleEnd: "",
  stayNights: 7,
  flexibilityDays: 3,
  adults: 2,
  children: 0,
  infants: 0,
  pets: 0,
  minBudget: "",
  maxBudget: "",
  bedrooms: 1,
  beds: 1,
  bathrooms: 1,
  propertyTypes: ["house", "villa", "cottage", "chalet", "farm", "estate"],
  amenities: [],
  specialCriteria: ["entireHome"],
  specialNotes: "",
  sources: ["local", "direct", "tourism", "airbnb", "booking", "vrbo"],
  sortBy: "score",
});

export function defaultCriteria() {
  return structuredCloneSafe(DEFAULT_CRITERIA);
}

export function normalizeCriteria(input = {}) {
  const criteria = { ...defaultCriteria(), ...input };
  const integerFields = [
    "maxTravelMinutes", "stayNights", "flexibilityDays", "adults", "children",
    "infants", "pets", "bedrooms", "beds", "bathrooms",
  ];
  for (const field of integerFields) {
    criteria[field] = Math.max(0, Number.parseInt(criteria[field], 10) || 0);
  }
  criteria.adults = Math.max(1, criteria.adults);
  criteria.maxTravelMinutes = Math.min(180, Math.max(5, criteria.maxTravelMinutes));
  criteria.stayNights = Math.min(30, Math.max(1, criteria.stayNights));
  criteria.flexibilityDays = Math.min(14, criteria.flexibilityDays);
  criteria.propertyTypes = uniqueArray(criteria.propertyTypes);
  criteria.amenities = uniqueArray(criteria.amenities);
  criteria.specialCriteria = uniqueArray(criteria.specialCriteria);
  criteria.sources = uniqueArray(criteria.sources);
  criteria.place = String(criteria.place ?? "").trim();
  criteria.specialNotes = String(criteria.specialNotes ?? "").trim();
  criteria.minBudget = numberOrEmpty(criteria.minBudget);
  criteria.maxBudget = numberOrEmpty(criteria.maxBudget);
  return criteria;
}

export function validateCriteria(input = {}) {
  const criteria = normalizeCriteria(input);
  const errors = [];
  if (criteria.place.length < 2) errors.push("Indique un lieu de départ précis.");
  if (criteria.dateMode === "exact") {
    if (!criteria.checkin || !criteria.checkout) errors.push("Indique les dates d’arrivée et de départ.");
    if (criteria.checkin && criteria.checkout && nightsBetween(criteria.checkin, criteria.checkout) < 1) {
      errors.push("La date de départ doit être après l’arrivée.");
    }
  } else {
    if (!criteria.flexibleStart || !criteria.flexibleEnd) errors.push("Indique la période de recherche flexible.");
    if (criteria.flexibleStart && criteria.flexibleEnd && criteria.flexibleEnd < criteria.flexibleStart) {
      errors.push("La fin de période doit être après le début.");
    }
  }
  if (criteria.maxBudget !== "" && criteria.minBudget !== "" && criteria.maxBudget < criteria.minBudget) {
    errors.push("Le budget maximum doit être supérieur au minimum.");
  }
  if (!criteria.sources.length) errors.push("Sélectionne au moins une source.");
  return { criteria, errors, valid: errors.length === 0 };
}

export function buildDateWindows(input = {}) {
  const criteria = normalizeCriteria(input);
  if (criteria.dateMode === "exact") {
    if (!criteria.checkin || !criteria.checkout) return [];
    return [{ checkin: criteria.checkin, checkout: criteria.checkout }];
  }
  if (!criteria.flexibleStart || !criteria.flexibleEnd) return [];
  const start = parseDate(criteria.flexibleStart);
  const end = parseDate(criteria.flexibleEnd);
  if (!start || !end || end < start) return [];
  const windows = [];
  const latestStart = addDays(end, -criteria.stayNights);
  const step = Math.max(1, criteria.flexibilityDays || 1);
  for (let cursor = start; cursor <= latestStart; cursor = addDays(cursor, step)) {
    windows.push({
      checkin: formatDate(cursor),
      checkout: formatDate(addDays(cursor, criteria.stayNights)),
    });
    if (windows.length >= 20) break;
  }
  if (windows.length && windows.at(-1).checkin !== formatDate(latestStart)) {
    windows.push({ checkin: formatDate(latestStart), checkout: formatDate(end) });
  }
  return windows;
}

export function buildPlatformSearchLinks(input = {}, geocode = null) {
  const criteria = normalizeCriteria(input);
  const windows = buildDateWindows(criteria);
  const date = windows[0] ?? {};
  const guests = criteria.adults + criteria.children;
  const encodedPlace = encodeURIComponent(criteria.place);
  const links = [];

  if (criteria.sources.includes("airbnb")) {
    const url = new URL(`https://www.airbnb.fr/s/${encodedPlace}/homes`);
    setParams(url, {
      checkin: date.checkin,
      checkout: date.checkout,
      adults: criteria.adults,
      children: criteria.children,
      infants: criteria.infants,
      pets: criteria.pets,
      date_picker_type: "calendar",
    });
    links.push(platformLink("Airbnb", "airbnb", url.href));
  }

  if (criteria.sources.includes("booking")) {
    const url = new URL("https://www.booking.com/searchresults.fr.html");
    setParams(url, {
      ss: criteria.place,
      checkin: date.checkin,
      checkout: date.checkout,
      group_adults: criteria.adults,
      group_children: criteria.children + criteria.infants,
      no_rooms: Math.max(1, Math.ceil(guests / 4)),
      selected_currency: "EUR",
    });
    links.push(platformLink("Booking.com", "booking", url.href));
  }

  if (criteria.sources.includes("vrbo")) {
    const url = new URL(`https://www.abritel.fr/search/keywords:${encodedPlace}`);
    setParams(url, {
      startDate: date.checkin,
      endDate: date.checkout,
      adults: criteria.adults,
      children: criteria.children + criteria.infants,
      petsIncluded: criteria.pets > 0 ? "true" : "false",
    });
    links.push(platformLink("Abritel / Vrbo", "vrbo", url.href));
  }

  if (geocode?.lat && geocode?.lon) {
    links.forEach((link) => {
      link.location = { lat: Number(geocode.lat), lon: Number(geocode.lon) };
    });
  }
  return links;
}

export function analyzeText(text = "") {
  const normalized = stripAccents(String(text).toLowerCase());
  const amenities = {};
  for (const [key, , keywords] of AMENITIES) {
    amenities[key] = keywords.some((word) => normalized.includes(stripAccents(word.toLowerCase())));
  }
  const privacySignals = ["sans vis-a-vis", "sans vis à vis", "isole", "isolée", "aucun voisin", "au calme", "tranquille"];
  const negativePrivacy = ["mitoyen", "partage", "residence", "lotissement", "voisins proches", "centre-ville"];
  const quietSignals = ["calme", "tranquille", "paisible", "impasse", "pleine nature"];
  return {
    amenities,
    privacy: privacySignals.some((word) => normalized.includes(stripAccents(word))),
    privacyRisk: negativePrivacy.some((word) => normalized.includes(stripAccents(word))),
    quiet: quietSignals.some((word) => normalized.includes(stripAccents(word))),
  };
}

export function scoreResult(result = {}, input = {}) {
  const criteria = normalizeCriteria(input);
  const textAnalysis = analyzeText(`${result.title ?? ""} ${result.description ?? ""} ${result.rawText ?? ""}`);
  const resultAmenities = { ...textAnalysis.amenities, ...(result.amenities ?? {}) };
  let score = 50;
  const reasons = [];
  const warnings = [];

  if (Number.isFinite(result.travelMinutes)) {
    const travelRatio = result.travelMinutes / criteria.maxTravelMinutes;
    if (travelRatio <= 1) {
      score += Math.round(12 * (1 - travelRatio));
      reasons.push(`${Math.round(result.travelMinutes)} min du lieu`);
    } else {
      score -= 35;
      warnings.push("Hors temps de trajet demandé");
    }
  }

  const requestedAmenities = criteria.amenities;
  const foundAmenities = requestedAmenities.filter((key) => resultAmenities[key]);
  const missingAmenities = requestedAmenities.filter((key) => !resultAmenities[key]);
  score += foundAmenities.length * 6;
  score -= missingAmenities.length * 8;
  if (foundAmenities.length) reasons.push(`${foundAmenities.length}/${requestedAmenities.length} équipements trouvés`);
  if (missingAmenities.length) warnings.push(`${missingAmenities.length} équipement(s) non confirmé(s)`);

  if (criteria.specialCriteria.includes("privacy")) {
    if (textAnalysis.privacy || result.privacy === true) {
      score += 12;
      reasons.push("Indices de tranquillité / intimité");
    } else if (textAnalysis.privacyRisk || result.privacy === false) {
      score -= 18;
      warnings.push("Risque de voisins proches ou espaces partagés");
    } else {
      score -= 4;
      warnings.push("Intimité non vérifiée");
    }
  }

  if (criteria.specialCriteria.includes("quiet")) {
    if (textAnalysis.quiet || result.quiet === true) score += 8;
    else warnings.push("Calme non confirmé");
  }

  const capacity = Number(result.capacity || 0);
  const guests = criteria.adults + criteria.children + criteria.infants;
  if (capacity) {
    if (capacity >= guests) score += 8;
    else {
      score -= 30;
      warnings.push("Capacité insuffisante");
    }
  }

  const price = Number(result.totalPrice || 0);
  if (price && criteria.maxBudget !== "") {
    if (price <= criteria.maxBudget) {
      score += Math.min(10, Math.round((1 - price / criteria.maxBudget) * 10));
      reasons.push("Dans le budget");
    } else {
      score -= 25;
      warnings.push("Au-dessus du budget");
    }
  }

  if (result.availability === "available") {
    score += 15;
    reasons.push("Disponibilité annoncée");
  } else if (result.availability === "possible") {
    score += 4;
    reasons.push("Signal de disponibilité détecté");
    warnings.push("Dates exactes à confirmer sur le site");
  } else if (result.availability === "unavailable") {
    score = 0;
    warnings.push("Indisponible");
  } else {
    warnings.push("Disponibilité à confirmer");
  }

  if (result.sourceType === "local" || result.sourceType === "direct") score += 4;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons, warnings, amenities: resultAmenities };
}

export function approximateRadiusMeters(minutes) {
  const normalized = Math.min(180, Math.max(5, Number(minutes) || 30));
  const kilometers = Math.min(150, Math.max(5, normalized * 0.75));
  return Math.round(kilometers * 1000);
}

export function nightsBetween(checkin, checkout) {
  const start = parseDate(checkin);
  const end = parseDate(checkout);
  if (!start || !end) return 0;
  const nights = Math.round((end - start) / 86_400_000);
  return nights > 0 ? nights : 0;
}

export function amenityLabel(key) {
  return AMENITIES.find(([candidate]) => candidate === key)?.[1] ?? key;
}

export function specialLabel(key) {
  return SPECIAL_CRITERIA.find(([candidate]) => candidate === key)?.[1] ?? key;
}

function platformLink(title, source, url) {
  return {
    id: `platform-${source}`,
    title,
    source,
    sourceType: "platform",
    url,
    description: "Recherche préparée avec les critères et les dates de VillaHunter.",
    availability: "unknown",
    confidence: "search-link",
  };
}

function setParams(url, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function uniqueArray(value) {
  return [...new Set(Array.isArray(value) ? value.filter(Boolean) : [])];
}

function numberOrEmpty(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : "";
}

function stripAccents(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
