import searchHandler from "./search.js";

const nativeFetch = globalThis.fetch.bind(globalThis);
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 8_000;

async function resilientFetch(input, options = {}) {
  const requestedUrl = typeof input === "string" || input instanceof URL
    ? String(input)
    : String(input?.url ?? "");

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

      return new Response(text, {
        status: response.status,
        headers: response.headers,
      });
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
    nwr(${around})["tourism"~"apartment|chalet|guest_house|hotel"]["website"];
    nwr(${around})["tourism"~"apartment|chalet|guest_house|hotel"]["contact:website"];
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

if (!globalThis.__VILLAHUNTER_OVERPASS_FALLBACK__) {
  globalThis.fetch = resilientFetch;
  globalThis.__VILLAHUNTER_OVERPASS_FALLBACK__ = true;
}

export default searchHandler;
