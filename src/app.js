import { exportProject, nightsBetween, parseLinks } from "./core.js";

const STORAGE_KEY = "villahunter-project-v1";
const state = loadState();

const fields = {
  checkin: document.querySelector("#checkin"),
  checkout: document.querySelector("#checkout"),
  adults: document.querySelector("#adults"),
  children: document.querySelector("#children"),
  infants: document.querySelector("#infants"),
  budget: document.querySelector("#budget"),
};

for (const [key, input] of Object.entries(fields)) {
  input.value = state.criteria[key] ?? "";
  input.addEventListener("input", () => {
    state.criteria[key] = input.value;
    saveAndRender();
  });
}

document.querySelector("#addButton").addEventListener("click", addLinks);
document.querySelector("#clearButton").addEventListener("click", () => {
  document.querySelector("#links").value = "";
  showMessage("");
});
document.querySelector("#exportButton").addEventListener("click", downloadProject);

function addLinks() {
  const input = document.querySelector("#links");
  const { valid, invalid } = parseLinks(input.value, state.criteria);
  const existing = new Set(state.items.map((item) => item.url));
  const additions = valid.filter((item) => !existing.has(item.url));

  state.items.push(
    ...additions.map((item) => ({
      ...item,
      status: "à vérifier",
      price: "",
      rating: "",
      notes: "",
      addedAt: new Date().toISOString(),
    })),
  );

  input.value = "";
  const details = [
    `${additions.length} lien${additions.length > 1 ? "s" : ""} ajouté${additions.length > 1 ? "s" : ""}`,
    invalid.length ? `${invalid.length} invalide${invalid.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  showMessage(details.join(" · "));
  saveAndRender();
}

function render() {
  const nights = nightsBetween(state.criteria.checkin, state.criteria.checkout);
  const travelers = Number(state.criteria.adults || 0)
    + Number(state.criteria.children || 0)
    + Number(state.criteria.infants || 0);
  document.querySelector("#tripSummary").textContent = nights
    ? `${nights} nuits · ${travelers} voyageurs · dates non flexibles`
    : "Renseigne des dates exactes avant d’ajouter les liens.";

  const container = document.querySelector("#results");
  const template = document.querySelector("#cardTemplate");
  container.replaceChildren();

  for (const item of state.items) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    fragment.querySelector(".platform").textContent = item.platform;

    const link = fragment.querySelector(".url");
    link.href = item.url;
    link.textContent = compactUrl(item.url);

    const open = fragment.querySelector(".open");
    open.href = item.url;

    bindField(fragment, ".status", item, "status");
    bindField(fragment, ".price", item, "price");
    bindField(fragment, ".rating", item, "rating");
    bindField(fragment, ".notes", item, "notes");

    fragment.querySelector(".remove").addEventListener("click", () => {
      state.items = state.items.filter((candidate) => candidate.id !== item.id);
      saveAndRender();
    });

    card.dataset.status = item.status;
    container.append(fragment);
  }

  document.querySelector("#emptyState").hidden = state.items.length > 0;
  document.querySelector("#countBadge").textContent = `${state.items.length} lien${state.items.length > 1 ? "s" : ""}`;
}

function bindField(fragment, selector, item, key) {
  const input = fragment.querySelector(selector);
  input.value = item[key] ?? "";
  input.addEventListener("input", () => {
    item[key] = input.value;
    saveAndRender(false);
    if (key === "status") input.closest(".card").dataset.status = input.value;
  });
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.criteria && Array.isArray(stored?.items)) return stored;
  } catch {
    // Ignore corrupt local data and start fresh.
  }
  return {
    criteria: { adults: "4", children: "2", infants: "1", checkin: "", checkout: "", budget: "" },
    items: [],
  };
}

function saveAndRender(shouldRender = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (shouldRender) render();
}

function compactUrl(value) {
  const url = new URL(value);
  return `${url.hostname}${url.pathname}`.slice(0, 90);
}

function showMessage(text) {
  document.querySelector("#message").textContent = text;
}

function downloadProject() {
  const blob = new Blob([exportProject(state)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `villahunter-${state.criteria.checkin || "projet"}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

render();
