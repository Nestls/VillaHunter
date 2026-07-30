export default function handler(_request, response) {
  const directListings = Boolean(process.env.BRAVE_SEARCH_API_KEY);
  response.status(200).json({
    ok: true,
    service: "VillaHunter search API",
    version: "0.5.0",
    extendedSearch: directListings,
    directListings,
    resultMode: "strict-vacation-rentals",
    excludes: ["hotels", "guest-houses", "property-sales", "long-term-rentals", "unrequested-apartments"],
    time: new Date().toISOString(),
  });
}
