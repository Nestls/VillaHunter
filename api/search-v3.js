import searchHandler from "./search-v2.js";
import { analyzeText, normalizeCriteria, scoreResult } from "../src/search-model.js";

const USER_AGENT = "VillaHunter/0.3 (+https://github.com/Nestls/VillaHunter)";
const SEARCH_TIMEOUT_MS = 7_000;
const PAGE_TIMEOUT_MS = 5_000;
const MAX_SEARCH_RESULTS = 36;
const MAX_PAGES_TO_ANALYZE = 18;
const EXCLUDED_HOSTS = /(^|\.)(airbnb\.|booking\.com$|abritel\.|vrbo\.|tripadvisor\.|expedia\.|hotels\.com$)/i;
const EXCLUDED_LODGING = /(^|[^a-z])(hotel|hotelier|hoteliere|hostel|motel|resort|camping|camp site|camp-site|caravan site|holiday park|aparthotel|appart hotel|residence hoteliere|auberge)([^a-z]|$)/i;
const LISTING_TERMS = /villa|maison|gite|gîte|chalet|mas|ferme|domaine|location saisonniere|location saisonnière|location de vacances|hebergement|hébergement|vacation rental|cottage/i;

export default async function handler(request, response) {
  const originalJson = response.json.bind(response);

  response.json = async (payload) => {
    if (request.method !== "POST" || !payload || !Array.isArray(payload.results)) {
      return originalJson(payload);
    }

    const criteria = normalizeCriteria(request.body?.criteria ?? request.body ?? {});
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;

    if (!apiKey) {
      return originalJson(addMissingIndexWarning(payload));
    }

    try {
      const listings = await discoverDirectListings(criteria, apiKey);
      const scoredListings = listings.map((listing) => ({
        ...listing,
        ...scoreResult(listing, criteria),
      }));
      const mergedResults = deduplicateResults([
        ...scoredListings,
        ...payload.results.filter((item) => item.sourceType !== "platform"),
        ...payload.results.filter((item) => item.sourceType === "platform"),
      ]).sort(resultSorter(criteria.sortBy));

      return originalJson({
        ...payload,
        results: mergedResults.slice(0, 80),
        sources: {
          ...(payload.sources ?? {}),
          directListings: scoredListings.length,
          listingSearchConfigured: true,
        },
        warnings: buildListingWarnings(payload.warnings, scoredListings.length),
      });
    } catch (error) {
      console.error("VillaHunter direct listing search failed", error);
      return originalJson({
        ...payload,
        sources: {
          ...(payload.sources ?? {}),
          directListings: 0,
          listingSearchConfigured: true,
        },
        warnings: [
          ...(payload.warnings ?? []),
          "La recherche des fiches de maisons a rencontré une erreur temporaire. Les autres résultats restent disponibles.",
        ],
      });
    }
  };

  return searchHandler(request, response);
}

function addMissingIndexWarning(payload) {
  const warnings = (payload.warnings ?? []).filter(
    (warning) => !String(warning).includes("recherche web étendue"),
  );
  warnings.push(
    "Pour afficher directement les annonces de maisons, ajoute BRAVE_SEARCH_API_KEY dans Vercel. Sans index Web, VillaHunter ne peut afficher que les sources OpenStreetMap et les raccourcis de plateformes.",
  );
  return {
    ...payload,
    sources: {
      ...(payload.sources ?? {}),
      directListings: 0,
      listingSearchConfigured: false,
    },
    warnings,
  };
}

async function discoverDirectListings(criteria, apiKey) {
  const candidates = await searchListingPages(criteria, apiKey);
  const selected = candidates.slice(0, MAX_PAGES_TO_ANALYZE);
  const detailed = await mapWithConcurrency(selected, 4, (candidate) => enrichCandidate(candidate, criteria));
  return detailed.filter(Boolean);
}

async function searchListingPages(criteria, apiKey) {
  const place = criteria.place;
  const propertyWords = propertySearchWords(criteria.propertyTypes);
  const amenities = criteria.amenities.slice(0, 3).map(amenitySearchWord).filter(Boolean).join(" ");
  const exclusions = "-hotel -hôtel -camping -booking -airbnb -abritel -vrbo";
  const queries = [
    `\"location vacances\" ${place} (${propertyWords}) ${amenities} ${exclusions}`,
    `${place} (${propertyWords}) \"réservation directe\" ${amenities} ${exclusions}`,
    `site:gites-de-france.com ${place} (${propertyWords}) ${amenities}`,
    `site:clevacances.com ${place} (${propertyWords}) ${amenities}`,
  ];
  const results = [];

  for (const query of queries) {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "20");
    url.searchParams.set("country", "fr");
    url.searchParams.set("search_lang", "fr");
    url.searchParams.set("safesearch", "moderate");
    url.searchParams.set("extra_snippets", "true");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);
    const data = await response.json();

    for (const item of data?.web?.results ?? []) {
      const candidate = normalizeSearchResult(item);
      if (candidate) results.push(candidate);
    }
  }

  return deduplicateResults(results).slice(0, MAX_SEARCH_RESULTS);
}

function normalizeSearchResult(item) {
  const url = normalizePublicUrl(item?.url);
  if (!url || EXCLUDED_HOSTS.test(new URL(url).hostname)) return null;

  const title = cleanText(item?.title);
  const description = cleanText([
    item?.description,
    ...(Array.isArray(item?.extra_snippets) ? item.extra_snippets : []),
  ].filter(Boolean).join(" "));
  const combined = normalizeText(`${title} ${description} ${url}`);
  if (EXCLUDED_LODGING.test(combined) || !LISTING_TERMS.test(combined)) return null;

  return {
    id: `listing-search-${stableId(url)}`,
    title: title || hostnameLabel(url),
    description: description || "Annonce de location trouvée dans l’index Web.",
    url,
    source: hostnameLabel(url),
    sourceType: "direct",
    listing: true,
    availability: "unknown",
    confidence: "search-listing",
    rawText: combined,
  };
}

async function enrichCandidate(candidate) {
  if (!(await isCrawlAllowed(candidate.url))) return candidate;

  try {
    const response = await fetch(candidate.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!response.ok) return candidate;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|text|json|xml/i.test(contentType)) return candidate;
    const html = (await response.text()).slice(0, 1_500_000);
    const page = extractListingPage(candidate.url, html);
    const combined = normalizeText(`${page.title} ${page.description} ${page.rawText}`);
    if (EXCLUDED_LODGING.test(combined)) return null;

    return {
      ...candidate,
      ...page,
      id: `listing-page-${stableId(candidate.url)}`,
      source: hostnameLabel(candidate.url),
      sourceType: "direct",
      listing: true,
      confidence: page.structured ? "structured-listing" : "public-listing-page",
      availability: "unknown",
      checkedAt: new Date().toISOString(),
      amenities: analyzeText(combined).amenities,
      capacity: page.capacity,
      totalPrice: page.totalPrice,
      reasons: ["Fiche de logement trouvée directement"],
      warnings: ["Disponibilité et prix à confirmer sur le site"],
    };
  } catch {
    return candidate;
  }
}

function extractListingPage(url, html) {
  const structured = extractStructuredListing(html);
  const title = structured?.name
    || metaContent(html, "property", "og:title")
    || metaContent(html, "name", "twitter:title")
    || cleanText(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = structured?.description
    || metaContent(html, "property", "og:description")
    || metaContent(html, "name", "description")
    || metaContent(html, "name", "twitter:description");
  const image = normalizeImageUrl(
    structured?.image
    || metaContent(html, "property", "og:image")
    || metaContent(html, "name", "twitter:image"),
    url,
  );
  const rawText = stripHtml(html).replace(/\s+/g, " ").slice(0, 40_000);

  return {
    title: cleanText(title) || hostnameLabel(url),
    description: cleanText(description) || cleanText(rawText).slice(0, 320),
    image,
    address: structured?.address || "",
    capacity: numberOrUndefined(structured?.capacity) || extractCapacity(rawText),
    totalPrice: numberOrUndefined(structured?.price) || extractPrice(rawText),
    bedrooms: numberOrUndefined(structured?.bedrooms),
    bathrooms: numberOrUndefined(structured?.bathrooms),
    rawText,
    structured: Boolean(structured),
  };
}

function extractStructuredListing(html) {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]).trim());
      const roots = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      for (const item of flattenStructuredItems(roots)) {
        const type = String(item?.["@type"] ?? "");
        const text = normalizeText(`${type} ${item?.name ?? ""} ${item?.description ?? ""}`);
        if (EXCLUDED_LODGING.test(text)) continue;
        if (!/vacationrental|accommodation|house|apartment|product|lodgingbusiness/i.test(type) && !LISTING_TERMS.test(text)) continue;

        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        const occupancy = item.occupancy?.maxValue ?? item.maximumAttendeeCapacity ?? item.numberOfGuests;
        return {
          name: item.name,
          description: item.description,
          image: Array.isArray(item.image) ? item.image[0] : item.image?.url || item.image,
          address: structuredAddress(item.address),
          capacity: occupancy,
          bedrooms: item.numberOfBedrooms ?? item.numberOfRooms,
          bathrooms: item.numberOfBathroomsTotal,
          price: offer?.price ?? offer?.lowPrice,
        };
      }
    } catch {
      // Ignore malformed structured data.
    }
  }
  return null;
}

function flattenStructuredItems(items) {
  const result = [];
  for (const item of items ?? []) {
    if (!item || typeof item !== "object") continue;
    result.push(item);
    if (Array.isArray(item.itemListElement)) {
      result.push(...item.itemListElement.map((entry) => entry?.item ?? entry).filter(Boolean));
    }
  }
  return result;
}

async function isCrawlAllowed(urlValue) {
  try {
    const robotsUrl = new URL("/robots.txt", urlValue);
    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return true;
    const text = await response.text();
    const blocks = text.split(/(?=^user-agent\s*:)/gim);
    const relevant = blocks.filter((block) => /user-agent\s*:\s*(\*|VillaHunter)/i.test(block));
    return !relevant.some((block) => /disallow\s*:\s*\/\s*$/im.test(block));
  } catch {
    return true;
  }
}

function buildListingWarnings(existing = [], count) {
  const warnings = existing.filter((warning) => !String(warning).includes("recherche web étendue"));
  if (count) {
    warnings.push(`${count} fiche${count > 1 ? "s" : ""} de maison trouvée${count > 1 ? "s" : ""} directement sur des sites publics.`);
  } else {
    warnings.push("La recherche Web est active, mais aucune fiche de maison suffisamment fiable n’a été trouvée pour ces critères.");
  }
  return warnings;
}

function propertySearchWords(types = []) {
  const labels = {
    house: "maison",
    villa: "villa",
    cottage: "gîte",
    chalet: "chalet",
    apartment: "appartement de vacances",
    farm: "mas OR ferme",
    estate: "domaine",
  };
  const words = types.map((type) => labels[type]).filter(Boolean);
  return words.length ? words.join(" OR ") : "villa OR maison OR gîte OR chalet OR mas";
}

function amenitySearchWord(key) {
  const words = {
    privatePool: "piscine privée",
    pool: "piscine",
    heatedPool: "piscine chauffée",
    securedPool: "piscine sécurisée",
    jacuzzi: "jacuzzi",
    barbecue: "barbecue",
    airConditioning: "climatisation",
    fencedGarden: "jardin clôturé",
    petsAllowed: "animaux acceptés",
  };
  return words[key] ?? "";
}

function resultSorter(sortBy) {
  if (sortBy === "price") return (a, b) => (a.totalPrice || Infinity) - (b.totalPrice || Infinity);
  if (sortBy === "travel") return (a, b) => (a.travelMinutes || Infinity) - (b.travelMinutes || Infinity);
  return (a, b) => (b.score ?? 0) - (a.score ?? 0);
}

function deduplicateResults(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = canonicalUrl(item?.url) || item?.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => url.searchParams.delete(key));
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`.toLowerCase();
  } catch {
    return "";
  }
}

function normalizePublicUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeImageUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function metaContent(html, attribute, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escaped}["']`, "i"),
  ];
  return decodeEntities(patterns.map((pattern) => firstMatch(html, pattern)).find(Boolean) ?? "");
}

function extractCapacity(text) {
  const match = text.match(/(?:jusqu['’]a|jusqu['’]à|pour|capacite|capacité|sleeps|accueille)\s*(?:de\s*)?(\d{1,2})\s*(?:personnes|voyageurs|people|pers)/i);
  return match ? Number(match[1]) : undefined;
}

function extractPrice(text) {
  const matches = [...text.matchAll(/(?:prix|tarif|à partir de|from)?\s*(\d{2,5}(?:[\s.,]\d{2})?)\s*(?:€|EUR)/gi)];
  const prices = matches.map((match) => Number(String(match[1]).replace(/\s/g, "").replace(",", "."))).filter((value) => Number.isFinite(value) && value >= 50);
  return prices.length ? Math.min(...prices) : undefined;
}

function structuredAddress(address) {
  if (typeof address === "string") return address;
  return [address?.streetAddress, address?.postalCode, address?.addressLocality, address?.addressRegion].filter(Boolean).join(" ");
}

function hostnameLabel(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Site direct";
  }
}

function firstMatch(value, pattern) {
  return String(value ?? "").match(pattern)?.[1] ?? "";
}

function stripHtml(value = "") {
  return decodeEntities(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function cleanText(value = "") {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText(value = "") {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stableId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await mapper(items[index]);
      } catch {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
