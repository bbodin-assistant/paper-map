import { onlineCandidateSummary } from "./online-candidates.js";
import { paperProviderLabel } from "./paper-provider-config.js?v=0.4.11";
import { searchHighlightParts } from "./search-highlight.js?v=0.4.9";

function appendSearchHighlightedText(element, text, query) {
  const parts = searchHighlightParts(text, query);
  for (const part of parts) {
    if (!part.match) {
      element.append(document.createTextNode(part.text));
      continue;
    }
    const strong = document.createElement("strong");
    strong.className = "add-paper-search-match";
    strong.textContent = part.text;
    element.append(strong);
  }
}

export function paperCandidateProviderStatus(item) {
  if (item.status === "searching") return `Searching… up to ${item.limit}`;
  if (item.status === "error") return item.error || "Search failed";
  return `${item.candidates.length} result${item.candidates.length === 1 ? "" : "s"} · limit ${item.limit}`;
}

export function renderPaperCandidatePicker(container, {
  query,
  providerStates = [],
  totals = null,
  onSelect,
  disabled = false,
  heading = "Choose a paper",
  detail = "",
} = {}) {
  if (!container) return;
  const count = totals || {
    candidates: providerStates.reduce((sum, item) => sum + (item.candidates?.length || 0), 0),
    finished: providerStates.filter((item) => item.status !== "searching").length,
    providers: providerStates.length,
  };
  const fragment = document.createDocumentFragment();

  const headingRow = document.createElement("div");
  headingRow.className = "add-paper-candidates-heading";
  const title = document.createElement("strong");
  title.textContent = heading;
  const summary = document.createElement("small");
  summary.textContent = detail || `${count.candidates} result${count.candidates === 1 ? "" : "s"} so far · ${count.finished}/${count.providers} providers finished · “${query}”`;
  headingRow.append(title, summary);
  fragment.append(headingRow);

  for (const item of providerStates) {
    const section = document.createElement("section");
    section.className = `add-paper-provider-results ${item.status}`;
    section.dataset.paperCandidateProvider = item.id;

    const sectionHeading = document.createElement("div");
    sectionHeading.className = "add-paper-provider-heading";
    const providerName = document.createElement("strong");
    providerName.textContent = item.label || paperProviderLabel(item.id);
    const providerStatus = document.createElement("small");
    providerStatus.className = "add-paper-provider-status";
    providerStatus.textContent = paperCandidateProviderStatus(item);
    sectionHeading.append(providerName, providerStatus);
    section.append(sectionHeading);

    for (const [index, paper] of (item.candidates || []).entries()) {
      const candidate = onlineCandidateSummary(paper);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "add-paper-candidate";
      button.dataset.paperCandidateIndex = String(index);
      button.dataset.paperCandidateProvider = item.id;
      button.disabled = disabled;

      const candidateTitle = document.createElement("span");
      candidateTitle.className = "add-paper-candidate-title";
      appendSearchHighlightedText(candidateTitle, candidate.title, query);

      const candidateAuthors = document.createElement("span");
      candidateAuthors.className = "add-paper-candidate-authors";
      appendSearchHighlightedText(
        candidateAuthors,
        candidate.authors.length ? candidate.authors.join(", ") : "Authors not provided",
        query,
      );

      const candidateMeta = document.createElement("span");
      candidateMeta.className = "add-paper-candidate-meta";
      appendSearchHighlightedText(
        candidateMeta,
        [candidate.year, candidate.venue, item.label || paperProviderLabel(item.id)].filter(Boolean).join(" · "),
        query,
      );

      button.append(candidateTitle, candidateAuthors, candidateMeta);
      if (typeof onSelect === "function") {
        button.addEventListener("click", () => onSelect(paper, item.id, index + 1));
      }
      section.append(button);
    }
    fragment.append(section);
  }

  container.replaceChildren(fragment);
  container.hidden = false;
}
