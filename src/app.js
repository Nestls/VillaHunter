import {
  AMENITIES,
  PROPERTY_TYPES,
  SOURCE_TYPES,
  SPECIAL_CRITERIA,
  amenityLabel,
  buildDateWindows,
  defaultCriteria,
  nightsBetween,
  normalizeCriteria,
  validateCriteria,
} from "./search-model.js";

const STORAGE_KEY = "villahunter-v02";
const API_KEY = "villahunter-api-url";
const state = loadState();

const form = document.querySelector("#searchForm");
const settingsDialog = document.querySelector("#settingsDialog");
const elements = {
  apiStatus: document.querySelector("#apiStatus"),
  hostingNotice: document.querySelector("#hostingNotice"),
  resultsSection: document.querySelector("#resultsSection"),
  results: document.querySelector("#results"),
  warnings: document.querySelector("#warnings"),
  progressPanel: document.querySelector("#progressPanel"),
  progressTitle: document.querySelector("#progressTitle"),
  progressText: document.querySelector("#progressText"),
  resultMeta: document.querySelector("#resultMeta"),
  exactDates: document.querySelector("#exactDates"),
  flexibleDates: document.querySelector("#flexibleDates"),
  dateMode: document.querySelector("#dateMode"),
  searchSummary: document.querySelector("#searchSummary"),
  searchHint: document.querySelector("#searchHint"),
  exactDateSummary: document.querySelector("#exactDateSummary"),
  apiUrl: document.querySelector("#apiUrl"),
};

initialize();

function initialize() {
  renderChoiceGroups();
  applyCriteriaToForm(state.criteria);
  bindEvents();
  updateDateMode(state.criteria.dateMode);
  updateSummary();
  renderResults();
  checkApi();
}

function renderChoiceGroups() {
  renderChoices("#propertyTypeChoices", PROPERTY_TYPES, "propertyTypes", true);
  renderChoices("#amenityChoices", AMENITIES.map(([key, label]) => [key, label]), "amenities");
  renderChoices("#specialChoices", SPECIAL_CRITERIA, "specialCriteria");
  renderChoices("#sourceChoices", SOURCE_TYPES, "sources");
}

function renderChoices(selector, choices, fieldName, checkedByDefault = false) {
  const container = document.querySelector(selector);
  container.replaceChildren();
  choices.forEach(([key, label]) => {
    const wrapper = document.createElement("label");
    wrapper.className = "choice-chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = fieldName;
    input.value = key;
    input.checked = state.criteria[fieldName]?.includes(key) ?? checkedByDefault;
    const text = document.createElement("span");
    text.textContent = label;
    wrapper.append(input, text);
    container.append(wrapper);
  });
}

function bindEvents() {
  form.addEventListener("input", () => {
    state.criteria = readCriteriaFromForm();
    saveState();
    updateSummary();
  });
  form.addEventListener("change", () => {
    state.criteria = readCriteriaFromForm();
    saveState();
    updateSummary();
  });
  form.addEventListener("submit", runSearch);

  document.querySelectorAll("[data-date-mode]").forEach((button) => {
    button.addEventListener("click", () => updateDateMode(button.dataset.dateMode));
  });

  document.querySelector("#openSettingsButton").addEventListener("click", openSettings);
  document.querySelector("#saveSettingsButton").addEventListener("click", saveApiSettings);
  document.querySelector("#exportButton").addEventListener("click", exportProject);
  document.querySelector("#clearResultsButton").addEventListener("click", clearResults);
  document.querySelector("#showFavoritesButton").addEventListener("click", toggleFavorites);
}

function applyCriteriaToForm(criteriaInput) {
  const criteria = normalizeCriteria(criteriaInput);
  for (const [key, value] of Object.entries(criteria)) {
    if (Array.isArray(value)) continue;
    const input = form.elements.namedItem(key);
    if (input) input.value = value;
  }
  for (const field of ["propertyTypes", "amenities", "specialCriteria", "sources"]) {
    form.querySelectorAll(`input[name="${field}"]`).forEach((input) => {
      input.checked = criteria[field].includes(input.value);
    });
  }
}

function readCriteriaFromForm() {
  const data = new FormData(form);
  return normalizeCriteria({
    place: data.get("place"),
    maxTravelMinutes: data.get("maxTravelMinutes"),
    travelMode: data.get("travelMode"),
    dateMode: data.get("dateMode"),
    checkin: data.get("checkin"),
    checkout: data.get("checkout"),
    flexibleStart: data.get("flexibleStart"),
    flexibleEnd: data.get("flexibleEnd"),
    stayNights: data.get("stayNights"),
    flexibilityDays: data.get("flexibilityDays"),
    adults: data.get("adults"),
    children: data.get("children"),
    infants: data.get("infants"),
    pets: data.get("pets"),
    bedrooms: data.get("bedrooms"),
    beds: data.get("beds"),
    bathrooms: data.get("bathrooms"),
    minBudget: data.get("minBudget"),
    maxBudget: data.get("maxBudget"),
    sortBy: data.get("sortBy"),
    specialNotes: data.get("specialNotes"),
    propertyTypes: data.getAll("propertyTypes"),
    amenities: data.getAll("amenities"),
    specialCriteria: data.getAll("specialCriteria"),
    sources: data.getAll("sources"),
  });
}

function updateDateMode(mode) {
  const selected = mode === "flexible" ? "flexible" : "exact";
  elements.dateMode.value = selected;
  elements.exactDates.hidden = selected !== "exact";
  elements.flexibleDates.hidden = selected !== "flexible";
  document.querySelectorAll("[data-date-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.dateMode === selected);
  });
  state.criteria = readCriteriaFromForm();
  saveState();
  updateSummary();
}

function updateSummary() {
  const criteria = readCriteriaFromForm();
  const guests = criteria.adults + criteria.children + criteria.infants;
  const petText = criteria.pets ? ` · ${criteria.pets} animal${criteria.pets > 1 ? "ux" : ""}` : "";
  const place = criteria.place || "lieu non défini";
  let dateText = "dates à préciser";

  if (criteria.dateMode === "exact") {
    const nights = nightsBetween(criteria.checkin, criteria.checkout);
    if (nights) dateText = `${nights} nuit${nights > 1 ? "s" : ""}`;
    elements.exactDateSummary.textContent = nights ? `${criteria.checkin} → ${criteria.checkout} · ${nights} nuits` : "Dates à renseigner";
  } else {
    const windows = buildDateWindows(criteria);
    if (windows.length) dateText = `${windows.length} période${windows.length > 1 ? "s" : ""} possible${windows.length > 1 ? "s" : ""}`;
  }

  elements.searchSummary.textContent = `${place} · ${criteria.maxTravelMinutes} min maximum · ${dateText}`;
  elements.searchHint.textContent = `${guests} voyageur${guests > 1 ? "s" : ""}${petText} · ${criteria.amenities.length} équipement${criteria.amenities.length > 1 ? "s" : ""} · ${criteria.sources.length} source${criteria.sources.length > 1 ? "s" : ""}`;
}

async function runSearch(event) {
  event.preventDefault();
  const validation = validateCriteria(readCriteriaFromForm());
  if (!validation.valid) {
    showError(validation.errors.join("\n"));
    return;
  }
  state.criteria = validation.criteria;
  saveState();

  const endpoint = apiEndpoint();
  if (!endpoint) {
    openSettings();
    showError("Le moteur automatique doit d’abord être relié à son API.");
    return;
  }

  setLoading(true);
  try {
    progressMessage("Découverte des sources locales…", "Recherche des agences, hébergements directs et offices de tourisme autour du lieu.");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ criteria: validation.criteria }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}`);
    state.results = payload.results ?? [];
    state.lastSearch = {
      generatedAt: payload.generatedAt,
      geocode: payload.geocode,
      sources: payload.sources,
      warnings: payload.warnings ?? [],
      durationMs: payload.durationMs,
    };
    state.showFavoritesOnly = false;
    saveState();
    renderResults();
  } catch (error) {
    setLoading(false);
    showError(`Recherche impossible : ${error.message}`);
    return;
  }
  setLoading(false);
}

function renderResults() {
  const allResults = state.results ?? [];
  const results = state.showFavoritesOnly
    ? allResults.filter((result) => state.favorites.includes(result.id))
    : allResults;

  elements.resultsSection.hidden = allResults.length === 0;
  elements.results.replaceChildren();
  if (!allResults.length) return;

  const meta = state.lastSearch?.sources;
  const duration = state.lastSearch?.durationMs ? `${Math.round(state.lastSearch.durationMs / 100) / 10} s` : "";
  elements.resultMeta.textContent = [
    `${allResults.length} résultat${allResults.length > 1 ? "s" : ""}`,
    meta ? `${meta.discovered} source${meta.discovered > 1 ? "s" : ""} découverte${meta.discovered > 1 ? "s" : ""}` : "",
    duration,
  ].filter(Boolean).join(" · ");

  renderWarnings(state.lastSearch?.warnings ?? []);
  const template = document.querySelector("#resultTemplate");
  results.forEach((result) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".result-card");
    const favorite = fragment.querySelector(".favorite-button");
    const isFavorite = state.favorites.includes(result.id);

    fragment.querySelector(".source-badge").textContent = sourceLabel(result);
    fragment.querySelector(".confidence-badge").textContent = confidenceLabel(result.confidence);
    fragment.querySelector(".score").textContent = `${result.score ?? 0}/100`;
    fragment.querySelector(".score-meter span").style.width = `${result.score ?? 0}%`;
    fragment.querySelector(".result-title").textContent = result.title || "Source sans titre";
    fragment.querySelector(".result-description").textContent = result.description || "Aucune description publique extraite.";
    favorite.textContent = isFavorite ? "♥" : "♡";
    favorite.classList.toggle("active", isFavorite);
    favorite.addEventListener("click", () => toggleFavorite(result.id));

    renderFacts(fragment.querySelector(".facts"), result);
    renderAmenities(fragment.querySelector(".amenities"), result);
    renderList(fragment.querySelector(".reasons"), result.reasons, "positive");
    renderList(fragment.querySelector(".result-warnings"), result.warnings, "warning");

    const open = fragment.querySelector(".open-result");
    if (result.url) open.href = result.url;
    else {
      open.removeAttribute("href");
      open.classList.add("disabled");
      open.textContent = "Coordonnées uniquement";
    }
    fragment.querySelector(".copy-result").addEventListener("click", () => copyResult(result));
    card.dataset.score = result.score;
    elements.results.append(fragment);
  });
}

function renderWarnings(warnings) {
  elements.warnings.replaceChildren();
  warnings.forEach((warning) => {
    const item = document.createElement("p");
    item.textContent = warning;
    elements.warnings.append(item);
  });
}

function renderFacts(container, result) {
  const facts = [
    Number.isFinite(result.travelMinutes) ? `${result.travelMinutes} min` : "",
    Number.isFinite(result.distanceKm) ? `${result.distanceKm} km` : "",
    result.totalPrice ? `${formatMoney(result.totalPrice)} total` : "",
    result.capacity ? `${result.capacity} personnes` : "",
    availabilityLabel(result.availability),
    result.address,
  ].filter(Boolean);
  facts.forEach((fact) => {
    const span = document.createElement("span");
    span.textContent = fact;
    container.append(span);
  });
}

function renderAmenities(container, result) {
  const found = Object.entries(result.amenities ?? {}).filter(([, value]) => value).slice(0, 8);
  found.forEach(([key]) => {
    const span = document.createElement("span");
    span.textContent = amenityLabel(key);
    container.append(span);
  });
  if (!found.length) {
    const empty = document.createElement("span");
    empty.className = "muted-chip";
    empty.textContent = "Équipements non extraits";
    container.append(empty);
  }
}

function renderList(container, items = [], className) {
  items.forEach((item) => {
    const line = document.createElement("p");
    line.className = className;
    line.textContent = item;
    container.append(line);
  });
}

function toggleFavorite(id) {
  state.favorites = state.favorites.includes(id)
    ? state.favorites.filter((candidate) => candidate !== id)
    : [...state.favorites, id];
  saveState();
  renderResults();
}

function toggleFavorites() {
  state.showFavoritesOnly = !state.showFavoritesOnly;
  document.querySelector("#showFavoritesButton").textContent = state.showFavoritesOnly ? "Tous les résultats" : "Favoris";
  renderResults();
}

function clearResults() {
  state.results = [];
  state.lastSearch = null;
  state.showFavoritesOnly = false;
  saveState();
  renderResults();
}

function setLoading(isLoading) {
  elements.progressPanel.hidden = !isLoading;
  document.querySelector("#searchButton").disabled = isLoading;
  document.querySelector("#searchButton").textContent = isLoading ? "Recherche en cours…" : "Lancer la recherche automatique";
  if (isLoading) elements.progressPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function progressMessage(title, text) {
  elements.progressTitle.textContent = title;
  elements.progressText.textContent = text;
}

function showError(message) {
  elements.progressPanel.hidden = false;
  elements.progressPanel.classList.add("error");
  progressMessage("Action nécessaire", message);
  setTimeout(() => elements.progressPanel.classList.remove("error"), 4_000);
  elements.progressPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function checkApi() {
  const endpoint = apiEndpoint();
  const onGithubPages = location.hostname.endsWith("github.io");
  elements.hostingNotice.hidden = Boolean(endpoint) || !onGithubPages;
  if (!endpoint) {
    setApiStatus("Moteur non connecté", "warning");
    return;
  }
  try {
    const healthUrl = endpoint.replace(/\/api\/search\/?$/, "/api/health");
    const response = await fetch(healthUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    setApiStatus(payload.extendedSearch ? "Moteur complet prêt" : "Moteur local prêt", "success");
  } catch {
    setApiStatus("API à vérifier", "warning");
  }
}

function openSettings() {
  elements.apiUrl.value = localStorage.getItem(API_KEY) || "";
  settingsDialog.showModal();
}

async function saveApiSettings() {
  const value = elements.apiUrl.value.trim().replace(/\/$/, "");
  if (value && !/^https?:\/\//i.test(value)) {
    showError("L’adresse de l’API doit commencer par https://");
    return;
  }
  localStorage.setItem(API_KEY, value);
  settingsDialog.close();
  await checkApi();
}

function apiEndpoint() {
  const configured = localStorage.getItem(API_KEY)?.trim();
  if (configured) return configured.endsWith("/api/search") ? configured : `${configured.replace(/\/$/, "")}/api/search`;
  if (!location.hostname.endsWith("github.io") && location.protocol !== "file:") return `${location.origin}/api/search`;
  return "";
}

function exportProject() {
  const payload = {
    schema: "villahunter-project@2",
    exportedAt: new Date().toISOString(),
    criteria: state.criteria,
    favorites: state.favorites,
    results: state.results,
    lastSearch: state.lastSearch,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `villahunter-${state.criteria.place?.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "recherche"}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function copyResult(result) {
  const text = [
    `${result.title} — ${result.score}/100`,
    result.travelMinutes ? `${result.travelMinutes} min du lieu` : "",
    result.totalPrice ? `${formatMoney(result.totalPrice)} total` : "",
    result.url,
  ].filter(Boolean).join("\n");
  await navigator.clipboard.writeText(text);
}

function sourceLabel(result) {
  if (result.sourceType === "local") return "Agence locale";
  if (result.sourceType === "tourism") return "Office de tourisme";
  if (result.sourceType === "direct") return "Site direct";
  return result.source || "Plateforme";
}

function confidenceLabel(value) {
  const labels = {
    "page-signal": "Page analysée",
    "public-page": "Page publique",
    "public-source": "Source publique",
    "search-index": "Trouvé sur le web",
    "directory-only": "À ouvrir",
    "search-link": "Recherche préparée",
  };
  return labels[value] || "À confirmer";
}

function availabilityLabel(value) {
  if (value === "available") return "Disponible annoncé";
  if (value === "possible") return "Disponibilité possible";
  if (value === "unavailable") return "Indisponible";
  return "Disponibilité à confirmer";
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function setApiStatus(text, type) {
  elements.apiStatus.textContent = text;
  elements.apiStatus.className = `status-pill ${type}`;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.criteria) {
      return {
        criteria: normalizeCriteria(stored.criteria),
        results: Array.isArray(stored.results) ? stored.results : [],
        favorites: Array.isArray(stored.favorites) ? stored.favorites : [],
        lastSearch: stored.lastSearch ?? null,
        showFavoritesOnly: false,
      };
    }
  } catch {
    // Start with a clean state when local data is invalid.
  }
  return { criteria: defaultCriteria(), results: [], favorites: [], lastSearch: null, showFavoritesOnly: false };
}
