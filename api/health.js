export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    service: "VillaHunter search API",
    version: "0.2.0",
    extendedSearch: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    time: new Date().toISOString(),
  });
}
