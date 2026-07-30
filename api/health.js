export default function handler(_request, response) {
  const directListings = Boolean(process.env.BRAVE_SEARCH_API_KEY);
  response.status(200).json({
    ok: true,
    service: "VillaHunter search API",
    version: "0.4.0",
    extendedSearch: directListings,
    directListings,
    resultMode: "verified-listings-only",
    time: new Date().toISOString(),
  });
}
