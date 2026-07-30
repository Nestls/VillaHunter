const STORAGE_KEY = "villahunter-v02";
const resultsContainer = document.querySelector("#results");
const resultMeta = document.querySelector("#resultMeta");

injectStyles();
enhanceListingCards();

if (resultsContainer) {
  new MutationObserver(enhanceListingCards).observe(resultsContainer, {
    childList: true,
    subtree: true,
  });
}

function enhanceListingCards() {
  const state = readState();
  const results = Array.isArray(state?.results) ? state.results : [];
  const byUrl = new Map(results.filter((item) => item?.url).map((item) => [canonicalUrl(item.url), item]));

  document.querySelectorAll(".result-card").forEach((card) => {
    const href = card.querySelector(".open-result")?.href;
    const result = byUrl.get(canonicalUrl(href));
    if (!result) return;

    card.classList.toggle("direct-listing-card", Boolean(result.listing));
    const confidence = card.querySelector(".confidence-badge");
    if (confidence && result.listing) confidence.textContent = confidenceLabel(result.confidence);

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
}

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
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
