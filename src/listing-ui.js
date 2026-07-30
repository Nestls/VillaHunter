const STORAGE_KEY = "villahunter-v02";
const API_KEY = "villahunter-api-url";
const ENGINE_VERSION = "0.6.0";
const resultsContainer = document.querySelector("#results");
const resultMeta = document.querySelector("#resultMeta");
const nativeFetch = globalThis.fetch.bind(globalThis);

const mustReload = synchronizeRuntime();

if (mustReload) {
  location.reload();
} else {
  installSearchResponseGuard();
  injectStyles();
  enhanceListingCards();

  if (resultsContainer) {
    new MutationObserver(enhanceListingCards).observe(resultsContainer, {
      childList: true,
      subtree: true,
    });
  }
}

function synchronizeRuntime() {
  let reloadRequired = false;
  const hostedTogether = !location.hostname.endsWith("github.io") && location.protocol !== "file:";

  if (hostedTogether && localStorage.getItem(API_KEY)) {
    localStorage.removeItem(API_KEY);
    reloadRequired = true;
  }

  const stored = readState();
  if (!stored) return reloadRequired;

  const previousVersion = stored.lastSearch?.sources?.engineVersion
    || stored.lastSearch?.engineVersion
    || stored.runtimeVersion;
  const hasPersistedResults = Array.isArray(stored.results) && stored.results.length > 0;

  if (hasPersistedResults && previousVersion !== ENGINE_VERSION) {
    stored.results = [];
    stored.lastSearch = null;
    stored.showFavoritesOnly = false;
    stored.runtimeVersion = ENGINE_VERSION;
    writeState(stored);
    return true;
  }

  if (stored.runtimeVersion !== ENGINE_VERSION) {
    stored.runtimeVersion = ENGINE_VERSION;
    writeState(stored);
  }

  return reloadRequired;
}

function installSearchResponseGuard() {
  globalThis.fetch = async (input, options = {}) => {
    const response = await nativeFetch(input, options);
    if (!isAutomaticSearchRequest(input, options) || !response.ok) return response;

    try {
      const payload = await response.clone().json();
      const responseVersion = payload?.engineVersion || payload?.sources?.engineVersion;
      const unverifiedResult = Array.isArray(payload?.results)
        && payload.results.some((item) => item?.vacationRentalVerified !== true);

      if (responseVersion !== ENGINE_VERSION || unverifiedResult) {
        const headers = new Headers(response.headers);
        headers.set("Content-Type", "application/json;charset=UTF-8");
        return new Response(JSON.stringify({
          error: `Moteur VillaHunter désynchronisé. Version attendue : ${ENGINE_VERSION}. Recharge la page puis relance la recherche.`,
          expectedEngineVersion: ENGINE_VERSION,
          receivedEngineVersion: responseVersion || "absente",
        }), {
          status: 409,
          statusText: "VillaHunter runtime mismatch",
          headers,
        });
      }
    } catch {
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "application/json;charset=UTF-8");
      return new Response(JSON.stringify({
        error: "La réponse du moteur VillaHunter n’a pas pu être vérifiée. Recharge la page avant de relancer la recherche.",
      }), {
        status: 409,
        statusText: "VillaHunter response verification failed",
        headers,
      });
    }

    return response;
  };
}

function isAutomaticSearchRequest(input, options = {}) {
  try {
    const value = typeof input === "string" || input instanceof URL ? input : input?.url;
    const url = new URL(value, location.href);
    const method = String(options.method || input?.method || "GET").toUpperCase();
    return method === "POST" && /\/api\/search\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function enhanceListingCards() {
  const state = readState();
  const results = Array.isArray(state?.results) ? state.results : [];
  const byUrl = new Map(results.filter((item) => item?.url).map((item) => [canonicalUrl(item.url), item]));

  document.querySelectorAll(".result-card").forEach((card) => {
    const href = card.querySelector(".open-result")?.href;
    const result = byUrl.get(canonicalUrl(href));
    if (!result) return;

    card.classList.toggle("direct-listing-card", Boolean(result.listing || result.vacationRentalVerified));
    const confidence = card.querySelector(".confidence-badge");
    if (confidence && result.vacationRentalVerified) confidence.textContent = "Location saisonnière vérifiée";
    else if (confidence && result.listing) confidence.textContent = confidenceLabel(result.confidence);

    if (result.image && !card.querySelector(".listing-image")) {
      const image = document.createElement("img");
      image.className = "listing-image";
      image.src = result.image;
      image.alt = result.title ? `Photo de ${result.title}` : "Photo du logement";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove());
      const top = card.querySelector(".result-card-top");
      top?.insertAdjacentElement("afterend", image);
    }
  });

  const directCount = Number(state?.lastSearch?.sources?.directListings || 0);
  if (resultMeta && directCount > 0 && !resultMeta.textContent.includes("annonce directe")) {
    resultMeta.textContent += ` · ${directCount} annonce${directCount > 1 ? "s" : ""} directe${directCount > 1 ? "s" : ""}`;
  }

  const engineVersion = state?.lastSearch?.sources?.engineVersion;
  if (resultMeta && engineVersion && !resultMeta.textContent.includes("moteur v")) {
    resultMeta.textContent += ` · moteur v${engineVersion}`;
  }
}

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeState(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function canonicalUrl(value) {
  try {
    const url = new URL(value, location.href);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => url.searchParams.delete(key));
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`.toLowerCase();
  } catch {
    return "";
  }
}

function confidenceLabel(value) {
  if (value === "structured-listing") return "Fiche structurée";
  if (value === "public-listing-page") return "Fiche publique analysée";
  if (value === "search-listing") return "Annonce trouvée sur le Web";
  return "Annonce à confirmer";
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .direct-listing-card { border-color: rgba(19, 111, 80, .42); }
    .listing-image {
      display: block;
      width: calc(100% + 2.3rem);
      height: 220px;
      margin: -.2rem -1.15rem .15rem;
      object-fit: cover;
      background: #eaf1ed;
      border-block: 1px solid var(--line, #dbe5df);
    }
    @media (max-width: 680px) {
      .listing-image { height: 190px; }
    }
  `;
  document.head.append(style);
}
