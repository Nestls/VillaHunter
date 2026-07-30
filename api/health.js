const ENGINE_VERSION = "0.6.0";

export default function handler(_request, response) {
  const directListings = Boolean(process.env.BRAVE_SEARCH_API_KEY);
  response.status(200).json({
    ok: true,
    service: "VillaHunter search API",
    version: ENGINE_VERSION,
    engineVersion: ENGINE_VERSION,
    extendedSearch: directListings,
    directListings,
    resultMode: "strict-vacation-rentals",
    runtimeSync: true,
    excludes: ["hotels", "guest-houses", "property-sales", "long-term-rentals", "unrequested-apartments"],
    time: new Date().toISOString(),
  });
}
