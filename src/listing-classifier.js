const DEFAULT_PROPERTY_TYPES = ["house", "villa", "cottage", "chalet", "farm", "estate"];

const PROPERTY_PATTERNS = {
  house: /\b(maison|house|holiday home|maison de vacances)\b/i,
  villa: /\bvilla\b/i,
  cottage: /\b(gite|cottage)\b/i,
  chalet: /\bchalet\b/i,
  apartment: /\b(appartement|apartment|studio|loft|flat)\b/i,
  farm: /\b(mas|ferme|farmhouse|corps de ferme)\b/i,
  estate: /\b(domaine|estate|propriete)\b/i,
};

const HOTEL_OR_SHARED = /\b(hotel|hostel|motel|resort|aparthotel|appart hotel|residence hoteliere|camping|caravaning|holiday park|auberge|chambre d hote|chambres d hotes|maison d hotes|bed and breakfast|guest house|guesthouse|guest room)\b/i;
const ROOM_ONLY = /\b(chambre privee|chambre chez l habitant|chambre partagee|shared room|private room|room in)\b/i;
const GENERIC_PAGE = /\b(accueil|home page|office de tourisme|agence immobiliere|agence de voyage|conciergerie|nos hebergements|nos locations|toutes les locations|liste des locations|resultats de recherche|annuaire)\b/i;

const SALE_STRONG = /\b(a vendre|en vente|vente immobiliere|prix de vente|acheter|achat immobilier|bien immobilier|for sale|sale price|real estate listing)\b/i;
const SALE_CONTEXT = /\b(vente|immobilier|acquereur|proprietaire vendeur)\b/i;
const SALE_SUPPORT = [
  /\bdpe\b/i,
  /\bdiagnostic(?:s)? immobilier(?:s)?\b/i,
  /\bhonoraires\b/i,
  /\bmandat\b/i,
  /\bcopropriete\b/i,
  /\bclasse energie\b/i,
  /\btaxe fonciere\b/i,
  /\bsurface habitable\b/i,
  /\bfrais d agence\b/i,
  /\bges\b/i,
];

const LONG_TERM_STRONG = /\b(location a l annee|location longue duree|bail(?:leur)?|loyer mensuel|loyer hors charges|charges comprises|dossier locataire|garant exige|monthly rent|long term rental|long-term rental|lease)\b/i;
const LONG_TERM_SUPPORT = [
  /\bpar mois\b/i,
  /\bmois charges\b/i,
  /\bdepot de garantie\b/i,
  /\bpreavis\b/i,
  /\blocataire\b/i,
  /\bbail\b/i,
];

const VACATION_STRONG = /\b(location de vacances|location vacances|location saisonniere|meuble de tourisme|gite de france|clevacances|vacation rental|holiday rental|holiday home|short term rental|short-term rental)\b/i;
const BOOKING_EVIDENCE = [
  /\breserver\b/i,
  /\breservation\b/i,
  /\bdisponibilite\b/i,
  /\bcalendrier\b/i,
  /\bsejour\b/i,
  /\bnuit(?:s)?\b/i,
  /\bsemaine(?:s)?\b/i,
  /\btarif(?:s)?\b/i,
  /\barrivee\b/i,
  /\bdepart\b/i,
  /\bvoyageur(?:s)?\b/i,
  /\bbook now\b/i,
  /\bavailability\b/i,
  /\bnight(?:s|ly)?\b/i,
  /\bstay\b/i,
];

export function classifyVacationRental(item = {}, criteria = {}) {
  const parsedUrl = safeUrl(item.url);
  if (!parsedUrl) return reject("invalid-url");

  const primary = normalizeListingText([
    item.title,
    item.description,
    parsedUrl.pathname,
  ].filter(Boolean).join(" "));
  const body = normalizeListingText(item.rawText ?? "");
  const combined = `${primary} ${body}`.trim();

  if (HOTEL_OR_SHARED.test(combined)) return reject("collective-or-shared-lodging");
  if (GENERIC_PAGE.test(primary)) return reject("generic-page");
  if (ROOM_ONLY.test(combined)) return reject("room-only");

  if (SALE_STRONG.test(primary)) return reject("property-for-sale");
  const saleSupportCount = countPatterns(body, SALE_SUPPORT);
  if (SALE_CONTEXT.test(body) && saleSupportCount >= 2) return reject("property-for-sale");

  if (LONG_TERM_STRONG.test(primary)) return reject("long-term-rental");
  if (countPatterns(body, LONG_TERM_SUPPORT) >= 3) return reject("long-term-rental");

  const selectedTypes = new Set(
    Array.isArray(criteria.propertyTypes) && criteria.propertyTypes.length
      ? criteria.propertyTypes
      : DEFAULT_PROPERTY_TYPES,
  );
  const detectedTypes = detectPropertyTypes(primary || body.slice(0, 4_000));

  if (detectedTypes.includes("apartment") && !selectedTypes.has("apartment")) {
    return reject("apartment-not-requested");
  }

  const matchingTypes = detectedTypes.filter((type) => selectedTypes.has(type));
  if (!matchingTypes.length) return reject("property-type-not-requested");

  const bookingEvidenceCount = countPatterns(combined, BOOKING_EVIDENCE);
  if (!VACATION_STRONG.test(combined) && bookingEvidenceCount < 3) {
    return reject("not-confirmed-as-vacation-rental");
  }

  if (criteria.specialCriteria?.includes("entireHome") && ROOM_ONLY.test(combined)) {
    return reject("not-entire-home");
  }

  const concreteEvidenceCount = [
    item.image,
    item.capacity,
    item.totalPrice,
    item.bedrooms,
    item.bathrooms,
    item.address,
    item.confidence === "structured-listing",
  ].filter(Boolean).length;
  if (concreteEvidenceCount < 2) return reject("insufficient-listing-evidence");

  return {
    accepted: true,
    reason: "strict-vacation-rental",
    propertyType: matchingTypes[0],
    bookingEvidenceCount,
    concreteEvidenceCount,
  };
}

export function normalizeListingText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectPropertyTypes(text) {
  return Object.entries(PROPERTY_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([type]) => type);
}

function countPatterns(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function reject(reason) {
  return { accepted: false, reason };
}
