import searchHandler from "./search.js";

const nativeFetch = globalThis.fetch.bind(globalThis);
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

async function resilientFetch(input, options = {}) {
  const requestedUrl = typeof input === "string" || input instanceof URL
    ? String(input)
    : String(input?.url ?? "");

  if (!requestedUrl.includes("overpass-api.de/api/interpreter")) {
    return nativeFetch(input, options);
  }

  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await nativeFetch(endpoint, {
        ...options,
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return response;
      lastError = new Error(`Overpass ${response.status} from ${new URL(endpoint).hostname}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Toutes les instances Overpass sont indisponibles.");
}

if (!globalThis.__VILLAHUNTER_OVERPASS_FALLBACK__) {
  globalThis.fetch = resilientFetch;
  globalThis.__VILLAHUNTER_OVERPASS_FALLBACK__ = true;
}

export default searchHandler;
