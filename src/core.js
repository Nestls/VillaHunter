const PLATFORM_RULES = [
  ["airbnb", /(^|\.)airbnb\./i],
  ["booking", /(^|\.)booking\.com$/i],
  ["abritel", /(^|\.)abritel\./i],
  ["vrbo", /(^|\.)vrbo\./i],
  ["leboncoin", /(^|\.)leboncoin\.fr$/i],
];

const AIRBNB_FLEXIBLE_KEYS = [
  "flexible_trip_lengths",
  "flexible_trip_lengths[]",
  "flexible_date_search_filter_type",
  "monthly_start_date",
  "monthly_end_date",
  "monthly_length",
];

export function detectPlatform(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return PLATFORM_RULES.find(([, pattern]) => pattern.test(host))?.[0] ?? "autre";
  } catch {
    return "invalide";
  }
}

export function normalizeUrl(value, criteria = {}) {
  const url = new URL(value.trim());
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|source|ref|referrer)/i.test(key)) url.searchParams.delete(key);
  }
  if (detectPlatform(url.href) === "airbnb") {
    for (const key of [...url.searchParams.keys()]) {
      if (AIRBNB_FLEXIBLE_KEYS.includes(key) || key.startsWith("flexible_")) url.searchParams.delete(key);
    }
    setIfPresent(url, "checkin", criteria.checkin);
    setIfPresent(url, "checkout", criteria.checkout);
    setIfPresent(url, "adults", criteria.adults);
    setIfPresent(url, "children", criteria.children);
    setIfPresent(url, "infants", criteria.infants);
    setIfPresent(url, "pets", criteria.pets);
    url.searchParams.set("date_picker_type", "calendar");
  }
  url.searchParams.sort();
  return url.href;
}

export function parseLinks(text, criteria = {}) {
  const candidates = text.split(/[\n,;\s]+/).map((item) => item.trim()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const candidate of candidates) {
    try {
      const normalized = normalizeUrl(candidate, criteria);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        valid.push({ id: cryptoId(normalized), url: normalized, originalUrl: candidate, platform: detectPlatform(normalized) });
      }
    } catch {
      invalid.push(candidate);
    }
  }
  return { valid, invalid };
}

export function cryptoId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `vh-${(hash >>> 0).toString(16)}`;
}

export function evaluateSnapshot(text) {
  const source = String(text ?? "").toLowerCase();
  const unavailable = ["indisponible", "not available", "sold out", "aucun logement", "no properties", "dates non disponibles", "ne sont pas disponibles"];
  const available = ["réserver", "reserve", "book now", "voir les disponibilités", "show availability"];
  if (unavailable.some((signal) => source.includes(signal))) return { status: "indisponible", confidence: "moyenne" };
  if (available.some((signal) => source.includes(signal))) return { status: "à vérifier", confidence: "faible" };
  return { status: "inconnu", confidence: "faible" };
}

export function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  const start = new Date(`${checkin}T00:00:00Z`);
  const end = new Date(`${checkout}T00:00:00Z`);
  const nights = Math.round((end - start) / 86_400_000);
  return Number.isFinite(nights) && nights > 0 ? nights : 0;
}

export function exportProject(project) {
  return JSON.stringify({ schema: "villahunter-project@2", exportedAt: new Date().toISOString(), ...project }, null, 2);
}

function setIfPresent(url, key, value) {
  if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
}
