import searchHandler from "./search-v3.js";

const VERIFIED_CONFIDENCE = new Set(["structured-listing", "public-listing-page"]);
const EXCLUDED_HOSTS = /(^|\.)(airbnb\.|booking\.com$|abritel\.|vrbo\.|tripadvisor\.|expedia\.|hotels\.com$)/i;
const EXCLUDED_LODGING = /(^|[^a-z])(hotel|hotelier|hoteliere|hostel|motel|resort|camping|camp site|camp-site|caravan site|holiday park|aparthotel|appart hotel|residence hoteliere|auberge|bed and breakfast|b&b|chambre d hote|chambres d hotes|guest house|guesthouse)([^a-z]|$)/i;
const LISTING_TERMS = /villa|maison|gite|chalet|mas|ferme|domaine|location saisonniere|location de vacances|vacation rental|cottage|appartement de vacances/i;
const GENERIC_PAGE = /(^|[^a-z])(accueil|home|office de tourisme|agence immobiliere|agence de voyage|conciergerie|nos hebergements|nos locations|toutes les locations|liste des locations|resultats de recherche)([^a-z]|$)/i;

export default async function handler(request, response) {
  const originalJson = response.json.bind(response);

  response.json = (payload) => {
    if (request.method !== "POST" || !payload || !Array.isArray(payload.results)) {
      return originalJson(payload);
    }

    const verifiedListings = payload.results
      .filter(isVerifiedListing)
      .map((listing) => ({
        ...listing,
        sourceType: "direct",
        listing: true,
        verifiedListing: true,
      }));

    const sourceCandidates = Number(payload.sources?.discovered ?? 0);
    const discarded = Math.max(0, payload.results.length - verifiedListings.length);

    return originalJson({
      ...payload,
      results: verifiedListings,
      sources: {
        ...(payload.sources ?? {}),
        sourceCandidates,
        discovered: verifiedListings.length,
        withinTravelTime: verifiedListings.length,
        crawled: verifiedListings.length,
        directListings: verifiedListings.length,
        verifiedDirectListings: verifiedListings.length,
        discardedNonListings: discarded,
        resultMode: "verified-listings-only",
      },
      warnings: listingWarnings(payload.warnings, verifiedListings.length, sourceCandidates),
    });
  };

  return searchHandler(request, response);
}

function isVerifiedListing(item) {
  if (!item?.listing || !VERIFIED_CONFIDENCE.has(item.confidence)) return false;

  let parsedUrl;
  try {
    parsedUrl = new URL(item.url);
  } catch {
    return false;
  }

  if (EXCLUDED_HOSTS.test(parsedUrl.hostname)) return false;

  const text = normalizeText([
    item.title,
    item.description,
    item.address,
    item.rawText,
    parsedUrl.pathname,
  ].filter(Boolean).join(" "));

  if (EXCLUDED_LODGING.test(text) || GENERIC_PAGE.test(normalizeText(item.title))) return false;
  if (!LISTING_TERMS.test(text)) return false;

  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  const hasPropertyEvidence = Boolean(
    item.image
    || item.capacity
    || item.totalPrice
    || item.bedrooms
    || item.bathrooms
    || item.address
    || item.confidence === "structured-listing"
  );

  return pathSegments.length > 0 && hasPropertyEvidence;
}

function listingWarnings(existing = [], count, candidates) {
  const warnings = (existing ?? []).filter((warning) => {
    const text = normalizeText(warning);
    return !text.includes("recherche web etendue")
      && !text.includes("source de decouverte")
      && !text.includes("fiche de maison")
      && !text.includes("sources openstreetmap")
      && !text.includes("raccourcis de plateformes");
  });

  if (count > 0) {
    warnings.push(`${count} annonce${count > 1 ? "s" : ""} individuelle${count > 1 ? "s" : ""} vérifiée${count > 1 ? "s" : ""} affichée${count > 1 ? "s" : ""}. Les pages d’agences, hôtels et pages générales ont été masquées.`);
  } else {
    warnings.push(`Aucune fiche individuelle suffisamment fiable n’a été confirmée parmi ${candidates} source${candidates > 1 ? "s" : ""} examinée${candidates > 1 ? "s" : ""}. VillaHunter n’affiche plus les hôtels ni les pages générales à la place.`);
  }

  return warnings;
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
