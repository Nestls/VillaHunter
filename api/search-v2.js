import searchHandler from "./search.js";

const nativeFetch = globalThis.fetch.bind(globalThis);
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 8_000;
const EXCLUDED_OSM_TYPES = new Set([
  "hotel",
  "hostel",
  "motel",
  "resort",
  "camp_site",
  "caravan_site",
]);

async function resilientFetch(input, options = {}) {
  const requestedUrl = typeof input === "string" || input instanceof URL
    ? String(input)
    : String(input?.url ?? "");

  if (requestedUrl.includes("api.search.brave.com/res/v1/web/search")) {
    return filterSearchProviderResponse(await nativeFetch(input, options));
  }

  if (!requestedUrl.includes("overpass-api.de/api/interpreter")) {
    return nativeFetch(input, options);
  }

  const optimizedOptions = optimizeOverpassOptions(options);
  const errors = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await nativeFetch(endpoint, {
        ...optimizedOptions,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed?.elements)) {
        throw new Error("Réponse Overpass invalide");
      }
      parsed.elements = parsed.elements.filter((element) => !isExcludedOsmElement(element));

      return jsonResponse(parsed, response);
    } catch (error) {
      errors.push(`${new URL(endpoint).hostname}: ${error?.message ?? error}`);
    }
  }

  throw new Error(`Découverte OpenStreetMap indisponible (${errors.join(" ; ")})`);
}

function optimizeOverpassOptions(options) {
  const params = options.body instanceof URLSearchParams
    ? new URLSearchParams(options.body)
    : new URLSearchParams(String(options.body ?? ""));
  const originalQuery = params.get("data") ?? "";
  const location = originalQuery.match(/around:(\d+),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);

  if (!location) return options;

  const radius = Math.min(35_000, Math.max(5_000, Number(location[1]) || 20_000));
  const lat = location[2];
  const lon = location[3];
  const around = `around:${radius},${lat},${lon}`;
  const query = `[out:json][timeout:15][maxsize:67108864];(
    nwr(${around})["office"~"estate_agent|travel_agent"]["website"];
    nwr(${around})["office"~"estate_agent|travel_agent"]["contact:website"];
    nwr(${around})["tourism"~"apartment|chalet|guest_house"]["website"];
    nwr(${around})["tourism"~"apartment|chalet|guest_house"]["contact:website"];
    nwr(${around})["tourism"="information"]["website"];
    nwr(${around})["tourism"="information"]["contact:website"];
    nwr(${around})["name"~"conciergerie|location.*vacance|g[iî]te",i]["website"];
    nwr(${around})["name"~"conciergerie|location.*vacance|g[iî]te",i]["contact:website"];
  );out tags center qt 80;`;

  params.set("data", query);
  return {
    ...options,
    body: params,
    headers: {
      ...(options.headers ?? {}),
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
  };
}

async function filterSearchProviderResponse(response) {
  const text = await response.text();
  if (!response.ok) return textResponse(text, response);

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.web?.results)) {
      parsed.web.results = parsed.web.results.filter((item) => !isHotelLike([
        item?.title,
        item?.description,
        item?.url,
      ].filter(Boolean).join(" ")));
    }
    return jsonResponse(parsed, response);
  } catch {
    return textResponse(text, response);
  }
}

function isExcludedOsmElement(element) {
  const tags = element?.tags ?? {};
  const tourism = String(tags.tourism ?? "").toLowerCase();
  if (EXCLUDED_OSM_TYPES.has(tourism)) return true;

  return isHotelLike([
    tags.name,
    tags.brand,
    tags.operator,
    tags.description,
    tags["description:fr"],
    tags.website,
    tags["contact:website"],
  ].filter(Boolean).join(" "));
}

function isHotelLike(value = "") {
  const normalized = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ");
  return /(^|[^a-z])(hotel|hotelier|hoteliere|hostel|motel|resort|camping|camp site|camp-site|caravan site|holiday park|aparthotel|appart hotel|residence hoteliere|auberge)([^a-z]|$)/i.test(normalized);
}

function jsonResponse(value, originalResponse) {
  const headers = new Headers(originalResponse.headers);
  headers.set("Content-Type", "application/json;charset=UTF-8");
  return new Response(JSON.stringify(value), {
    status: originalResponse.status,
    headers,
  });
}

function textResponse(value, originalResponse) {
  return new Response(value, {
    status: originalResponse.status,
    headers: originalResponse.headers,
  });
}

if (!globalThis.__VILLAHUNTER_OVERPASS_FALLBACK__) {
  globalThis.fetch = resilientFetch;
  globalThis.__VILLAHUNTER_OVERPASS_FALLBACK__ = true;
}

export default searchHandler;
