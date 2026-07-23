import {
  analyzeText,
  approximateRadiusMeters,
  buildDateWindows,
  buildPlatformSearchLinks,
  normalizeCriteria,
  scoreResult,
  validateCriteria,
} from "../src/search-model.js";

const USER_AGENT = "VillaHunter/0.2 (+https://github.com/Nestls/VillaHunter)";
const FETCH_TIMEOUT_MS = 8_000;
const MAX_AGENCIES_TO_CRAWL = 12;
const MAX_PAGES_PER_SITE = 3;

export default async function handler(request, response) {
  setCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: "Méthode non autorisée." });

  const { criteria, errors } = validateCriteria(request.body?.criteria ?? request.body ?? {});
  if (errors.length) return response.status(400).json({ error: errors.join(" "), errors });

  try {
    const startedAt = Date.now();
    const geocode = await geocodePlace(criteria.place);
    if (!geocode) return response.status(404).json({ error: "Lieu introuvable. Précise la commune, le département ou l’adresse." });

    const platformLinks = buildPlatformSearchLinks(criteria, geocode);
    const discoveries = await Promise.allSettled([
      discoverWithOpenStreetMap(criteria, geocode),
      discoverWithSearchProvider(criteria),
    ]);

    const discovered = discoveries
      .filter((item) => item.status === "fulfilled")
      .flatMap((item) => item.value);

    const uniqueSources = deduplicateSources(discovered);
    const routedSources = await attachTravelTimes(uniqueSources, geocode, criteria.maxTravelMinutes);
    const eligibleSources = routedSources
      .filter((item) => !Number.isFinite(item.travelMinutes) || item.travelMinutes <= criteria.maxTravelMinutes)
      .slice(0, MAX_AGENCIES_TO_CRAWL);

    const crawledGroups = await mapWithConcurrency(eligibleSources, 3, (source) => crawlSource(source, criteria));
    const crawled = crawledGroups.flat();
    const scored = [...crawled, ...platformLinks]
      .map((result) => ({ ...result, ...scoreResult(result, criteria) }))
      .sort(resultSorter(criteria.sortBy));

    return response.status(200).json({
      criteria: normalizeCriteria(criteria),
      geocode,
      dateWindows: buildDateWindows(criteria),
      results: deduplicateResults(scored).slice(0, 80),
      sources: {
        discovered: uniqueSources.length,
        withinTravelTime: eligibleSources.length,
        crawled: crawledGroups.filter((items) => items.length).length,
        platformSearches: platformLinks.length,
        searchProviderConfigured: Boolean(process.env.BRAVE_SEARCH_API_KEY),
      },
      warnings: buildWarnings(discoveries, criteria),
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("VillaHunter search failed", error);
    return response.status(500).json({
      error: "La recherche automatique a rencontré une erreur temporaire.",
      detail: process.env.NODE_ENV === "development" ? String(error?.message ?? error) : undefined,
    });
  }
}

async function geocodePlace(place) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", place);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  const data = await fetchJson(url, { headers: { "Accept-Language": "fr" } });
  const item = data?.[0];
  if (!item) return null;
  return {
    name: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon),
    boundingBox: item.boundingbox?.map(Number) ?? null,
  };
}

async function discoverWithOpenStreetMap(criteria, geocode) {
  const radius = approximateRadiusMeters(criteria.maxTravelMinutes);
  const query = `[out:json][timeout:20];(
    nwr(around:${radius},${geocode.lat},${geocode.lon})["tourism"~"apartment|chalet|guest_house|hotel|camp_site"];
    nwr(around:${radius},${geocode.lat},${geocode.lon})["office"="estate_agent"];
    nwr(around:${radius},${geocode.lat},${geocode.lon})["tourism"="information"];
  );out center tags;`;
  const data = await fetchJson("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: query }),
  });

  return (data?.elements ?? []).map((element) => {
    const tags = element.tags ?? {};
    const website = normalizeWebsite(tags.website || tags["contact:website"] || tags.url);
    const coordinates = element.center ?? element;
    const sourceType = tags.office === "estate_agent"
      ? "local"
      : tags.tourism === "information" ? "tourism" : "direct";
    return {
      id: `osm-${element.type}-${element.id}`,
      title: tags.name || defaultSourceTitle(sourceType),
      description: [tags.description, tags["description:fr"], tags.tourism].filter(Boolean).join(" · "),
      url: website,
      source: "OpenStreetMap",
      sourceType,
      lat: Number(coordinates.lat),
      lon: Number(coordinates.lon),
      phone: tags.phone || tags["contact:phone"] || "",
      email: tags.email || tags["contact:email"] || "",
      address: formatOsmAddress(tags),
      availability: "unknown",
      confidence: website ? "public-source" : "directory-only",
    };
  }).filter((item) => item.url || item.phone || item.email);
}

async function discoverWithSearchProvider(criteria) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  const equipmentWords = criteria.amenities.slice(0, 4).join(" ");
  const queries = [
    `location vacances ${criteria.place} agence locale ${equipmentWords}`,
    `gîte villa maison vacances ${criteria.place} réservation directe`,
    `conciergerie location saisonnière ${criteria.place}`,
  ];
  const results = [];
  for (const query of queries) {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "10");
    url.searchParams.set("country", "fr");
    url.searchParams.set("search_lang", "fr");
    const data = await fetchJson(url, {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    });
    for (const item of data?.web?.results ?? []) {
      const website = normalizeWebsite(item.url);
      if (!website || isKnownPlatform(website)) continue;
      results.push({
        id: `web-${stableId(website)}`,
        title: stripHtml(item.title) || hostnameLabel(website),
        description: stripHtml(item.description),
        url: website,
        source: "Recherche web",
        sourceType: classifySource(item.title, item.description),
        availability: "unknown",
        confidence: "search-index",
      });
    }
  }
  return results;
}

async function attachTravelTimes(sources, origin, maxMinutes) {
  const withCoordinates = sources.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
  const withoutCoordinates = sources.filter((item) => !Number.isFinite(item.lat) || !Number.isFinite(item.lon));
  const routed = [];
  for (let index = 0; index < withCoordinates.length; index += 40) {
    const chunk = withCoordinates.slice(index, index + 40);
    try {
      const coordinates = [origin, ...chunk].map((item) => `${item.lon},${item.lat}`).join(";");
      const url = new URL(`https://router.project-osrm.org/table/v1/driving/${coordinates}`);
      url.searchParams.set("sources", "0");
      url.searchParams.set("annotations", "duration,distance");
      const data = await fetchJson(url);
      const durations = data?.durations?.[0] ?? [];
      const distances = data?.distances?.[0] ?? [];
      chunk.forEach((item, itemIndex) => {
        const duration = durations[itemIndex + 1];
        const distance = distances[itemIndex + 1];
        routed.push({
          ...item,
          travelMinutes: Number.isFinite(duration) ? Math.round(duration / 60) : undefined,
          distanceKm: Number.isFinite(distance) ? Math.round(distance / 100) / 10 : undefined,
        });
      });
    } catch {
      routed.push(...chunk.map((item) => ({ ...item, travelMinutes: approximateMinutes(item, origin, maxMinutes) })));
    }
  }
  return [...routed, ...withoutCoordinates];
}

async function crawlSource(source, criteria) {
  if (!source.url || !isSafePublicUrl(source.url) || isKnownPlatform(source.url)) {
    return [directoryResult(source, criteria)];
  }
  if (!(await isCrawlAllowed(source.url))) return [directoryResult({ ...source, crawlSkipped: "robots" }, criteria)];

  try {
    const homeHtml = await fetchText(source.url);
    const home = extractPage(source.url, homeHtml, source, criteria);
    const links = extractCandidateLinks(source.url, homeHtml).slice(0, MAX_PAGES_PER_SITE - 1);
    const pages = await Promise.allSettled(links.map(async (url) => extractPage(url, await fetchText(url), source, criteria)));
    const extracted = [home, ...pages.filter((page) => page.status === "fulfilled").map((page) => page.value)]
      .filter((item) => item.title || item.description);
    return extracted.length ? extracted : [directoryResult(source, criteria)];
  } catch {
    return [directoryResult({ ...source, crawlSkipped: "fetch-failed" }, criteria)];
  }
}

function extractPage(url, html, source, criteria) {
  const title = decodeEntities(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i))
    || decodeEntities(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i))
    || source.title;
  const description = decodeEntities(
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
    || "",
  );
  const rawText = stripHtml(html).replace(/\s+/g, " ").slice(0, 30_000);
  const analysis = analyzeText(`${title} ${description} ${rawText}`);
  const totalPrice = extractPrice(rawText);
  const capacity = extractCapacity(rawText);
  const availability = detectAvailability(rawText, criteria);
  const structured = extractJsonLd(html);

  return {
    id: `page-${stableId(url)}`,
    title: structured?.name || cleanText(title) || source.title,
    description: structured?.description || cleanText(description) || source.description,
    url,
    source: source.title,
    sourceUrl: source.url,
    sourceType: source.sourceType,
    address: structured?.address || source.address,
    image: structured?.image || "",
    lat: source.lat,
    lon: source.lon,
    travelMinutes: source.travelMinutes,
    distanceKm: source.distanceKm,
    amenities: analysis.amenities,
    privacy: analysis.privacy ? true : analysis.privacyRisk ? false : undefined,
    quiet: analysis.quiet || undefined,
    totalPrice,
    capacity,
    availability,
    confidence: availability === "available" ? "page-signal" : "public-page",
    checkedAt: new Date().toISOString(),
  };
}

function directoryResult(source) {
  return {
    id: source.id,
    title: source.title,
    description: source.description || "Source locale découverte automatiquement. Consulte le site pour confirmer les logements et les dates.",
    url: source.url || "",
    source: source.source,
    sourceType: source.sourceType,
    address: source.address,
    phone: source.phone,
    email: source.email,
    lat: source.lat,
    lon: source.lon,
    travelMinutes: source.travelMinutes,
    distanceKm: source.distanceKm,
    availability: "unknown",
    confidence: source.crawlSkipped ? "directory-only" : source.confidence,
    crawlSkipped: source.crawlSkipped,
  };
}

function extractCandidateLinks(baseUrl, html) {
  const base = new URL(baseUrl);
  const candidates = [];
  const pattern = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const keywords = /location|vacance|hebergement|hébergement|gite|gîte|villa|maison|chalet|sejour|séjour|lodging|accommodation/i;
  for (const match of html.matchAll(pattern)) {
    const label = `${match[1]} ${stripHtml(match[2])}`;
    if (!keywords.test(label)) continue;
    try {
      const url = new URL(match[1], base);
      if (url.hostname !== base.hostname || !isSafePublicUrl(url.href)) continue;
      url.hash = "";
      candidates.push(url.href);
    } catch {
      // Ignore malformed links.
    }
  }
  return [...new Set(candidates)];
}

async function isCrawlAllowed(urlValue) {
  try {
    const url = new URL("/robots.txt", urlValue);
    const text = await fetchText(url.href, 3_000);
    const genericBlock = /user-agent:\s*\*[\s\S]{0,500}?disallow:\s*\/\s*(?:\r?\n|$)/i;
    return !genericBlock.test(text);
  } catch {
    return true;
  }
}

function detectAvailability(text, criteria) {
  const source = stripAccents(text.toLowerCase());
  const unavailable = ["indisponible", "ne sont pas disponibles", "complet", "sold out", "not available"];
  if (unavailable.some((signal) => source.includes(stripAccents(signal)))) return "unavailable";
  const dates = buildDateWindows(criteria)[0];
  const available = ["disponible", "reserver", "book now", "ajouter au panier"];
  if (dates && available.some((signal) => source.includes(stripAccents(signal)))) return "possible";
  return "unknown";
}

function extractPrice(text) {
  const matches = [...text.matchAll(/(?:€\s*|(?:eur|euros?)\s*)(\d[\d\s.,]{1,8})|(\d[\d\s.,]{1,8})\s*(?:€|eur|euros?)/gi)];
  const prices = matches
    .flatMap((match) => [match[1], match[2]])
    .filter(Boolean)
    .map((value) => Number(value.replace(/\s/g, "").replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value >= 50 && value <= 100_000);
  return prices.length ? Math.max(...prices.slice(0, 20)) : undefined;
}

function extractCapacity(text) {
  const match = text.match(/(?:jusqu['’]a|jusqu['’]à|pour|capacite|capacité|sleeps)\s*(?:de\s*)?(\d{1,2})\s*(?:personnes|voyageurs|people|pers)/i);
  return match ? Number(match[1]) : undefined;
}

function extractJsonLd(html) {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]).trim());
      const items = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      const item = items.find((candidate) => /lodging|accommodation|vacationrental|product/i.test(String(candidate?.["@type"] ?? "")));
      if (!item) continue;
      return {
        name: item.name,
        description: item.description,
        image: Array.isArray(item.image) ? item.image[0] : item.image?.url || item.image,
        address: typeof item.address === "string" ? item.address : [
          item.address?.streetAddress,
          item.address?.postalCode,
          item.address?.addressLocality,
        ].filter(Boolean).join(" "),
      };
    } catch {
      // Ignore malformed structured data.
    }
  }
  return null;
}

function deduplicateSources(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url ? canonicalOrigin(item.url) : `${item.title}-${item.lat}-${item.lon}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateResults(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resultSorter(sortBy) {
  if (sortBy === "price") return (a, b) => (a.totalPrice || Infinity) - (b.totalPrice || Infinity);
  if (sortBy === "travel") return (a, b) => (a.travelMinutes || Infinity) - (b.travelMinutes || Infinity);
  return (a, b) => b.score - a.score;
}

function buildWarnings(discoveries, criteria) {
  const warnings = [
    "VillaHunter analyse uniquement les pages publiques et ne contourne ni connexion, ni CAPTCHA, ni protection anti-robot.",
    "Une disponibilité détectée sur une page doit être confirmée sur le site de réservation avant paiement.",
  ];
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    warnings.push("La recherche web étendue n’est pas configurée : la découverte repose actuellement sur OpenStreetMap et les sources directes.");
  }
  if (discoveries.some((item) => item.status === "rejected")) warnings.push("Une source de découverte n’a pas répondu pendant cette recherche.");
  if (criteria.dateMode === "flexible") warnings.push("Plusieurs fenêtres de dates sont générées ; les sites peuvent présenter des résultats différents pour chacune.");
  return warnings;
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

async function fetchText(url, timeout = FETCH_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2" },
  }, timeout);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/text|html|json|xml/i.test(contentType)) throw new Error("Unsupported content type");
  return (await response.text()).slice(0, 1_500_000);
}

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT_MS) {
  return fetch(url, {
    ...options,
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(timeout),
  });
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
        results[index] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function isSafePublicUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "127.0.0.1" || host === "::1") return false;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizeWebsite(value) {
  if (!value) return "";
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    return isSafePublicUrl(url.href) ? url.href : "";
  } catch {
    return "";
  }
}

function isKnownPlatform(value) {
  try {
    return /(^|\.)(airbnb\.|booking\.com$|abritel\.|vrbo\.)/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

function canonicalOrigin(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname.replace(/^www\./, "")}`;
  } catch {
    return "";
  }
}

function formatOsmAddress(tags) {
  return [tags["addr:housenumber"], tags["addr:street"], tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ");
}

function classifySource(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();
  if (/office de tourisme|tourisme/.test(text)) return "tourism";
  if (/agence|conciergerie|immobili/.test(text)) return "local";
  return "direct";
}

function defaultSourceTitle(sourceType) {
  if (sourceType === "local") return "Agence locale";
  if (sourceType === "tourism") return "Office de tourisme";
  return "Hébergement direct";
}

function hostnameLabel(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Source locale";
  }
}

function approximateMinutes(item, origin, maxMinutes) {
  const distance = haversineKm(origin.lat, origin.lon, item.lat, item.lon);
  return Math.min(maxMinutes * 2, Math.round((distance / 45) * 60));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const earthRadius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function firstMatch(value, pattern) {
  return value.match(pattern)?.[1] ?? "";
}

function cleanText(value) {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

function stripHtml(value = "") {
  return decodeEntities(String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
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

function stripAccents(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function stableId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
}
