import { normalizeDoi, normalizedTitle } from "./import-export.js";
import { onlineCandidateSummary } from "./online-candidates.js";

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function authorsFromTextarea(value) {
  return String(value || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

export function commaList(value) {
  const result = [];
  const seen = new Set();
  for (const raw of String(value || "").split(/[,;]+/)) {
    const item = clean(raw);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function referenceKey(reference = {}) {
  const doi = normalizeDoi(reference.doi);
  if (doi) return `doi:${doi}`;
  if (reference.arxivId) return `arxiv:${clean(reference.arxivId).toLowerCase()}`;
  return clean(reference.rawText).replace(/\s+/g, " ").toLowerCase();
}

export function topicRow(topic = {}) {
  const row = document.createElement("div");
  row.className = "pdf-ai-topic-row";
  row.dataset.topicSource = topic.source || "manual";
  row.innerHTML = `
    <label class="pdf-ai-topic-use" title="Include this topic">
      <input type="checkbox" data-topic-use ${topic.use === false ? "" : "checked"} />
      <span class="visually-hidden">Include topic</span>
    </label>
    <div class="pdf-ai-topic-fields">
      <input type="text" data-topic-name placeholder="Topic name" value="${escapeHtml(topic.name || "")}" />
      <textarea rows="2" data-topic-description placeholder="Short thematic description">${escapeHtml(topic.description || "")}</textarea>
      <span class="field-hint">source: ${escapeHtml(topic.source || "manual")}</span>
    </div>
    <div class="pdf-ai-topic-confidence">
      <span>confidence</span>
      <strong data-topic-confidence>${Math.round((Number(topic.confidence) || 0) * 100)}%</strong>
    </div>
    <button type="button" class="icon-button" data-topic-remove aria-label="Remove topic">×</button>
  `;
  return row;
}

export function onlineCandidateRow(paper, index, query, disabled = false) {
  const summary = onlineCandidateSummary(paper);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pdf-online-candidate";
  button.dataset.onlineCandidateIndex = String(index);
  button.disabled = disabled;
  const exactTitle = normalizedTitle(summary.title) === normalizedTitle(query);
  button.innerHTML = `
    <span class="pdf-online-candidate-rank">#${index + 1}</span>
    <span class="pdf-online-candidate-copy">
      <strong>${escapeHtml(summary.title)}</strong>
      <span>${escapeHtml(summary.authors.length ? summary.authors.join(", ") : "Authors unavailable")}</span>
      <span>${escapeHtml([summary.year || "", summary.venue].filter(Boolean).join(" · ") || "Year / venue unavailable")}</span>
    </span>
    ${exactTitle ? '<span class="pdf-online-exact-title">Exact title</span>' : ""}
  `;
  return button;
}

export function referenceRow(reference = {}) {
  const row = document.createElement("article");
  row.className = "pdf-reference-row";
  row.__paperMapReference = structuredClone(reference);
  const identifiers = [];
  if (reference.doi) identifiers.push(`<span class="reference-id">DOI ${escapeHtml(reference.doi)}</span>`);
  if (reference.arxivId) identifiers.push(`<span class="reference-id">arXiv ${escapeHtml(reference.arxivId)}</span>`);
  if (reference.year) identifiers.push(`<span class="reference-id">${escapeHtml(reference.year)}</span>`);
  const pageStart = Number(reference.pageStart) || "?";
  const pageEnd = Number(reference.pageEnd) || pageStart;
  const pages = pageStart === pageEnd ? `p. ${pageStart}` : `pp. ${pageStart}–${pageEnd}`;
  row.innerHTML = `
    <label class="pdf-reference-use" title="Include this extracted reference">
      <input type="checkbox" data-reference-use ${reference.use === false ? "" : "checked"} />
      <span class="visually-hidden">Include reference</span>
    </label>
    <div class="pdf-reference-body">
      <div class="pdf-reference-meta">
        <strong>${escapeHtml(reference.label ? `[${reference.label}]` : `#${reference.index || "?"}`)}</strong>
        <span>${escapeHtml(pages)}</span>
        <span>${Math.round((Number(reference.confidence) || 0) * 100)}% confidence</span>
        ${identifiers.join("")}
      </div>
      <p>${escapeHtml(reference.rawText || "")}</p>
    </div>
  `;
  return row;
}

export function createPdfReviewUi() {
  const actions = document.querySelector(".toolbar-actions");
  if (!actions || document.querySelector("#add-pdf-button")) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "add-pdf-button";
  button.textContent = "Add files";
  const reset = actions.querySelector("#reset-view");
  if (reset) actions.insertBefore(button, reset);
  else actions.append(button);

  const input = document.createElement("input");
  input.id = "pdf-ai-file";
  input.type = "file";
  input.accept = ".pdf,application/pdf";
  input.multiple = true;
  input.hidden = true;
  document.body.append(input);

  const dialog = document.createElement("dialog");
  dialog.id = "pdf-ai-dialog";
  dialog.className = "pdf-ai-dialog";
  dialog.dataset.requiredMetadataPolish = "true";
  dialog.innerHTML = `
    <div class="pdf-ai-shell" id="pdf-ai-shell">
      <header class="pdf-ai-header">
        <div><span class="drawer-kicker">Reviewed import</span><h2>PDF metadata, citations & topics</h2></div>
        <button type="button" class="icon-button" id="pdf-ai-close" aria-label="Close PDF import">×</button>
      </header>
      <nav id="pdf-review-tabs" class="pdf-review-tabs" role="tablist" aria-label="Selected PDF files"></nav>
      <section class="pdf-ai-step" id="pdf-ai-analysis-step">
        <div class="pdf-ai-file-card">
          <div class="pdf-ai-file-meta">
            <strong id="pdf-ai-file-name">No PDF selected</strong>
            <span><span id="pdf-ai-queue-progress" aria-live="polite"></span><span id="pdf-ai-file-separator"> · </span><span id="pdf-ai-file-size"></span></span>
          </div>
          <button type="button" id="pdf-ai-open-file" class="quiet-button">Open PDF ↗</button>
        </div>
        <p class="pdf-ai-explainer">Every selected PDF is extracted locally with Rust/WebAssembly. You can optionally run <strong>AI extraction</strong>, or search online explicitly from the <strong>Title</strong>, <strong>DOI</strong>, or <strong>arXiv ID</strong> field below using the paper-information method selected in Config. Results are merged without overwriting fields you have edited manually.</p>
        <div id="pdf-source-status" class="pdf-source-status" aria-live="polite"></div>
        <div class="pdf-ai-analysis-actions pdf-extraction-actions">
          <button type="button" id="pdf-local-extract" class="quiet-button">Run local again</button>
          <button type="button" id="pdf-ai-analyze" class="quiet-button">Run AI extraction</button>
          <button type="button" id="pdf-ai-cancel-analysis" class="quiet-button" hidden>Cancel network extraction</button>
          <span id="pdf-ai-analysis-status" class="muted" role="status" aria-live="polite"></span>
        </div>
        <section id="pdf-online-candidates" class="pdf-online-candidates" hidden aria-label="OpenAlex paper candidates">
          <div class="section-heading"><div><span class="drawer-kicker">OpenAlex title search</span><h3>Choose the matching paper</h3></div><span id="pdf-online-candidate-summary" class="muted"></span></div>
          <p class="muted pdf-online-candidate-note">Title searches are not merged automatically. Review the ranked title, authors, year, and venue, then choose the intended work.</p>
          <div id="pdf-online-candidate-list" class="pdf-online-candidate-list"></div>
        </section>
      </section>
      <section class="pdf-ai-review" id="pdf-ai-review">
        <div class="section-heading"><div><span class="drawer-kicker" id="pdf-review-source-kicker">Merged proposal</span><h3>Review before saving</h3></div><span id="pdf-ai-duplicate" class="pdf-ai-duplicate" hidden></span></div>
        <div class="pdf-ai-metadata-grid">
          <label class="full-width pdf-review-lookup-field">Title
            <span class="pdf-online-field-control"><input id="pdf-review-title" type="text" required /><button type="button" id="pdf-online-search-title" class="quiet-button pdf-field-online-search">Search online</button></span>
          </label>
          <label class="full-width pdf-review-lookup-field">Authors <span class="field-hint">one per line</span><textarea id="pdf-review-authors" rows="4"></textarea></label>
          <label class="pdf-review-lookup-field">Year<input id="pdf-review-year" type="number" min="0" step="1" /></label>
          <label>Publication type<input id="pdf-review-type" type="text" /></label>
          <label class="full-width">Venue<input id="pdf-review-venue" type="text" /></label>
          <label class="pdf-review-lookup-field">DOI
            <span class="pdf-online-field-control"><input id="pdf-review-doi" type="text" spellcheck="false" /><button type="button" id="pdf-online-search-doi" class="quiet-button pdf-field-online-search">Search online</button></span>
          </label>
          <label class="pdf-review-lookup-field">arXiv ID
            <span class="pdf-online-field-control"><input id="pdf-review-arxiv" type="text" spellcheck="false" /><button type="button" id="pdf-online-search-arxiv" class="quiet-button pdf-field-online-search">Search online</button></span>
          </label>
          <label class="full-width">Source URL<input id="pdf-review-url" type="url" /></label>
          <label class="full-width">Abstract<textarea id="pdf-review-abstract" rows="7"></textarea></label>
          <label class="full-width">Keywords <span class="field-hint">comma-separated</span><input id="pdf-review-keywords" type="text" /></label>
        </div>
        <section class="pdf-ai-topic-section">
          <div class="section-heading"><div><h3>Proposed topics</h3><span class="muted">AI and online topics are merged by name. You can accept, reject, edit, or add topics before saving.</span></div><button type="button" id="pdf-ai-add-topic" class="quiet-button">+ Topic</button></div>
          <div id="pdf-ai-topics" class="pdf-ai-topics"></div>
        </section>
        <section class="pdf-reference-section" id="pdf-reference-section" hidden>
          <div class="section-heading"><div><h3>Extracted references</h3><span id="pdf-reference-summary" class="muted"></span></div><div class="pdf-reference-bulk-actions"><button type="button" id="pdf-reference-accept-all" class="quiet-button">Accept all</button><button type="button" id="pdf-reference-reject-all" class="quiet-button">Reject all</button></div></div>
          <p class="muted pdf-reference-note">Accepted references are saved with the paper and linked to unambiguous matches in your library. Importing a cited paper later also connects it automatically.</p>
          <div id="pdf-reference-list" class="pdf-reference-list"></div>
        </section>
        <section id="pdf-ai-warnings-section" class="pdf-ai-warnings" hidden><h3>Extraction warnings</h3><ul id="pdf-ai-warnings"></ul></section>
        <div class="pdf-ai-review-actions"><button type="button" id="pdf-ai-save">Save & close tab</button><button type="button" id="pdf-ai-skip-file" class="quiet-button">Skip tab</button><button type="button" id="pdf-ai-discard" class="quiet-button">Close remaining tabs</button></div>
      </section>
    </div>
  `;
  document.body.append(dialog);
  return { button, input, dialog };
}
