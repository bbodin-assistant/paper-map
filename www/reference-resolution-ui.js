import { normalizeDoi } from "./import-export.js";
import { resolveExtractedReference, selectReferenceCandidate } from "./reference-resolver.js";

const $ = (selector, root = document) => root.querySelector(selector);
const resolutionCache = new Map();
const resolvingTabs = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value) {
  return String(value ?? "").trim();
}

function providerLabel(provider) {
  if (provider === "crossref") return "Crossref";
  if (provider === "semantic-scholar") return "Semantic Scholar";
  return clean(provider) || "Resolver";
}

function canonicalSummary(canonical = {}) {
  const value = canonical || {};
  const authors = Array.isArray(value.authors) ? value.authors.filter(Boolean) : [];
  const detail = [
    authors.length ? authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : "") : "",
    value.year || "",
    value.venue || value.publisher || "",
  ].filter(Boolean).join(" · ");
  return { title: clean(value.title), detail };
}

function resolutionLabel(resolution) {
  if (!resolution) return "Ready to resolve";
  if (resolution.status === "matched") {
    return `${providerLabel(resolution.provider)} · ${Math.round((Number(resolution.confidence) || 0) * 100)}% match`;
  }
  if (resolution.status === "candidates") {
    const count = resolution.candidates?.length || 0;
    return `${count} candidate${count === 1 ? "" : "s"} · review required`;
  }
  if (resolution.status === "no-identifier") return "No searchable citation text";
  if (resolution.status === "unresolved") return "No conservative canonical match";
  return "Resolution unavailable";
}

function activeTabId(dialog) {
  return $("#pdf-review-tabs button[aria-selected='true']", dialog)?.dataset.pdfTabId || "single-review";
}

function referenceKey(reference = {}) {
  const doi = normalizeDoi(reference.doi);
  if (doi) return `doi:${doi}`;
  const arxivId = clean(reference.arxivId).replace(/^arxiv:\s*/i, "").toLowerCase();
  if (arxivId) return `arxiv:${arxivId}`;
  return clean(reference.rawText).replace(/\s+/g, " ").toLowerCase();
}

function cacheForTab(tabId) {
  if (!resolutionCache.has(tabId)) resolutionCache.set(tabId, new Map());
  return resolutionCache.get(tabId);
}

function rememberResolution(tabId, reference) {
  const key = referenceKey(reference);
  if (!key || !reference?.resolution) return;
  cacheForTab(tabId).set(key, structuredClone(reference.resolution));
}

function restoreResolution(tabId, row) {
  const reference = row.__paperMapReference || {};
  if (reference.resolution) {
    rememberResolution(tabId, reference);
    return;
  }
  const cached = resolutionCache.get(tabId)?.get(referenceKey(reference));
  if (cached) row.__paperMapReference = { ...reference, resolution: structuredClone(cached) };
}

function referenceRows(dialog) {
  return Array.from(dialog.querySelectorAll("#pdf-reference-list .pdf-reference-row"));
}

function updateSummary(dialog) {
  const rows = referenceRows(dialog);
  const matched = rows.filter((row) => row.__paperMapReference?.resolution?.status === "matched").length;
  const candidates = rows.filter((row) => row.__paperMapReference?.resolution?.status === "candidates").length;
  const unresolved = rows.filter((row) => row.__paperMapReference?.resolution?.status === "unresolved").length;
  const identifiable = rows.filter((row) => row.__paperMapReference?.doi || row.__paperMapReference?.arxivId).length;
  const textOnlySearchable = rows.filter((row) => {
    const reference = row.__paperMapReference || {};
    return !reference.doi && !reference.arxivId && clean(reference.rawText);
  }).length;
  const status = $("#pdf-reference-resolution-status", dialog);
  if (!status) return;
  if (!rows.length) status.textContent = "";
  else if (matched || candidates || unresolved) {
    status.textContent = `${matched} matched · ${candidates} need review · ${unresolved} unresolved`;
  } else {
    status.textContent = `${identifiable} identifier matches available · ${textOnlySearchable} text-only references searchable`;
  }
}

function refreshResolveButton(dialog) {
  const resolveButton = $("#pdf-reference-resolve", dialog);
  if (!resolveButton) return;
  const progress = resolvingTabs.get(activeTabId(dialog));
  resolveButton.disabled = Boolean(progress);
  resolveButton.textContent = progress || "Resolve identifiers";
}

function unexpectedResolution(error) {
  return {
    status: "unresolved",
    provider: "",
    matchedBy: "title-author-year",
    queriedIdentifier: "",
    confidence: 0,
    canonical: null,
    resolvedAt: new Date().toISOString(),
    attempts: [{
      provider: "semantic-scholar",
      status: "failed",
      message: clean(error?.message || error || "Reference resolution failed unexpectedly."),
    }],
  };
}

function renderResolution(row, dialog, tabId = activeTabId(dialog)) {
  const body = $(".pdf-reference-body", row);
  if (!body) return;
  let panel = $(".pdf-reference-resolution", row);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "pdf-reference-resolution";
    body.append(panel);
  }

  const reference = row.__paperMapReference || {};
  const resolution = reference.resolution || null;
  const hasIdentifier = Boolean(reference.doi || reference.arxivId);
  const hasSearchText = Boolean(clean(reference.rawText));
  const summary = canonicalSummary(resolution?.canonical);
  const confidence = Math.round((Number(resolution?.confidence) || 0) * 100);
  row.dataset.resolutionStatus = resolution?.status || (hasIdentifier ? "ready" : "no-identifier");
  row.dataset.resolutionConfidence = String(confidence);

  if (!resolution) {
    if (hasIdentifier) {
      panel.innerHTML = `<span class="reference-resolution-badge ready">${escapeHtml(resolutionLabel(null))}</span>`;
      return;
    }
    if (hasSearchText) {
      panel.innerHTML = `
        <div class="reference-resolution-match reference-resolution-review">
          <span class="reference-resolution-badge ready">Ready to match by title/author/year</span>
          <span>Search this reference conservatively against Semantic Scholar metadata.</span>
          <button type="button" class="quiet-button reference-resolution-search" data-reference-search>Find metadata candidates</button>
        </div>
      `;
      const searchButton = $("[data-reference-search]", panel);
      searchButton?.addEventListener("click", async () => {
        if (searchButton.disabled) return;
        searchButton.disabled = true;
        row.dataset.resolutionStatus = "resolving";
        searchButton.textContent = "Searching…";
        let resolved;
        try {
          resolved = await resolveExtractedReference(reference);
        } catch (error) {
          resolved = unexpectedResolution(error);
        }
        row.__paperMapReference = { ...reference, resolution: resolved };
        rememberResolution(tabId, row.__paperMapReference);
        if (row.isConnected && activeTabId(dialog) === tabId) {
          renderResolution(row, dialog, tabId);
          updateSummary(dialog);
        }
      });
      return;
    }
    panel.innerHTML = `<span class="reference-resolution-badge muted">No searchable citation text</span>`;
    return;
  }

  if (resolution.status === "matched") {
    panel.innerHTML = `
      <div class="reference-resolution-match">
        <span class="reference-resolution-badge matched">${escapeHtml(resolutionLabel(resolution))}</span>
        <strong>${escapeHtml(summary.title || "Canonical metadata match")}</strong>
        ${summary.detail ? `<span>${escapeHtml(summary.detail)}</span>` : ""}
        ${resolution.selectedBy === "user" ? `<span class="muted">Selected explicitly from resolver candidates.</span>` : ""}
      </div>
    `;
    return;
  }

  if (resolution.status === "candidates") {
    const candidates = resolution.candidates || [];
    panel.innerHTML = `
      <div class="reference-resolution-match unresolved reference-resolution-review">
        <span class="reference-resolution-badge ready">${escapeHtml(resolutionLabel(resolution))}</span>
        <span>Semantic Scholar returned plausible metadata matches. Choose one explicitly; none is selected automatically.</span>
        <div class="reference-resolution-candidate-list">
          ${candidates.map((candidate, index) => {
            const candidateSummary = canonicalSummary(candidate.canonical);
            const candidateConfidence = Math.round((Number(candidate.confidence) || 0) * 100);
            return `
              <button type="button" class="quiet-button reference-resolution-candidate" data-reference-candidate="${index}">
                <strong>${escapeHtml(candidateSummary.title || "Untitled candidate")}</strong>
                ${candidateSummary.detail ? `<span>${escapeHtml(candidateSummary.detail)}</span>` : ""}
                <span>${candidateConfidence}% evidence match</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
    for (const button of panel.querySelectorAll("[data-reference-candidate]")) {
      button.addEventListener("click", () => {
        const selected = selectReferenceCandidate(resolution, Number(button.dataset.referenceCandidate));
        row.__paperMapReference = { ...reference, resolution: selected };
        rememberResolution(tabId, row.__paperMapReference);
        renderResolution(row, dialog, tabId);
        if (activeTabId(dialog) === tabId) updateSummary(dialog);
      });
    }
    return;
  }

  const lastAttempt = resolution.attempts?.[resolution.attempts.length - 1];
  panel.innerHTML = `
    <div class="reference-resolution-match unresolved">
      <span class="reference-resolution-badge unresolved">${escapeHtml(resolutionLabel(resolution))}</span>
      ${lastAttempt?.message ? `<span>${escapeHtml(lastAttempt.message)}</span>` : ""}
    </div>
  `;
}

function decorateRows(dialog) {
  const tabId = activeTabId(dialog);
  for (const row of referenceRows(dialog)) {
    restoreResolution(tabId, row);
    renderResolution(row, dialog, tabId);
  }
  updateSummary(dialog);
  refreshResolveButton(dialog);
}

function install(dialog) {
  if (dialog.dataset.referenceResolverInstalled === "true") return;
  dialog.dataset.referenceResolverInstalled = "true";

  const actions = $(".pdf-reference-bulk-actions", dialog);
  if (!actions) return;

  const resolveButton = document.createElement("button");
  resolveButton.type = "button";
  resolveButton.id = "pdf-reference-resolve";
  resolveButton.className = "quiet-button";
  resolveButton.textContent = "Resolve identifiers";
  actions.prepend(resolveButton);

  const status = document.createElement("span");
  status.id = "pdf-reference-resolution-status";
  status.className = "muted pdf-reference-resolution-status";
  actions.after(status);

  const note = $(".pdf-reference-note", dialog);
  if (note) {
    note.textContent = "Resolve DOI/arXiv identifiers exactly, or search an individual text-only reference conservatively by title/author/year. Ambiguous candidates require an explicit choice before persistence. Saving accepted references connects unambiguous matches already in your library; other references stay available for later resolution.";
  }

  const list = $("#pdf-reference-list", dialog);
  const listObserver = new MutationObserver(() => decorateRows(dialog));
  if (list) listObserver.observe(list, { childList: true });
  const tabs = $("#pdf-review-tabs", dialog);
  const tabsObserver = new MutationObserver(() => refreshResolveButton(dialog));
  if (tabs) tabsObserver.observe(tabs, { childList: true, attributes: true, subtree: true, attributeFilter: ["aria-selected"] });
  decorateRows(dialog);

  resolveButton.addEventListener("click", async () => {
    const tabId = activeTabId(dialog);
    if (resolvingTabs.has(tabId)) return;
    const rows = referenceRows(dialog);
    const targets = rows
      .filter((row) => row.__paperMapReference?.doi || row.__paperMapReference?.arxivId)
      .map((row) => ({ row, reference: structuredClone(row.__paperMapReference || {}) }));
    if (!targets.length) {
      status.textContent = "No DOI or arXiv identifiers are available to resolve.";
      return;
    }

    let matched = 0;
    let unresolved = 0;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        resolvingTabs.set(tabId, `Resolving ${index + 1}/${targets.length}…`);
        refreshResolveButton(dialog);
        const { row, reference } = targets[index];
        if (row.isConnected && activeTabId(dialog) === tabId) {
          row.dataset.resolutionStatus = "resolving";
          const panel = $(".pdf-reference-resolution", row);
          if (panel) panel.innerHTML = `<span class="reference-resolution-badge resolving">Resolving…</span>`;
        }
        let resolution;
        try {
          resolution = await resolveExtractedReference(reference);
        } catch (error) {
          resolution = unexpectedResolution(error);
        }
        const resolvedReference = { ...reference, resolution };
        row.__paperMapReference = resolvedReference;
        rememberResolution(tabId, resolvedReference);
        if (resolution.status === "matched") matched += 1;
        else unresolved += 1;
        if (row.isConnected && activeTabId(dialog) === tabId) renderResolution(row, dialog, tabId);
      }
      if (activeTabId(dialog) === tabId) {
        status.textContent = `${matched} canonical matches · ${unresolved} unresolved. Review confidence before saving.`;
      }
    } finally {
      resolvingTabs.delete(tabId);
      if (activeTabId(dialog) === tabId) updateSummary(dialog);
      refreshResolveButton(dialog);
    }
  });
}

function start() {
  const existing = $("#pdf-ai-dialog");
  if (existing) {
    install(existing);
    return;
  }
  const observer = new MutationObserver(() => {
    const dialog = $("#pdf-ai-dialog");
    if (!dialog) return;
    observer.disconnect();
    install(dialog);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== "undefined") start();
