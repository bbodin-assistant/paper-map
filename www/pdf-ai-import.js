import { loadLibrary, putPapers, putTopics } from "./db.js";
import {
  mergePaperRecords,
  normalizeDoi,
  normalizedTitle,
  paperIdentityKey,
} from "./import-export.js";
import { MAX_INLINE_PDF_BYTES, slugTopic } from "./pdf-ai.js";
import { analyzePdfWithAi } from "./ai-provider.js";
import {
  loadAiConfig,
  providerLabel,
  providerNeedsApiKey,
  providerUsesDirectPdf,
} from "./ai-config.js";
import { aiConfigSnapshot } from "./ai-config-ui.js";
import { extractPdfCitationsLocally } from "./pdf-local.js";
import { resolvePaper as resolveOnlinePaper } from "./paper-provider.js";
import { loadPaperProviderConfig, paperProviderLabel } from "./paper-provider-config.js";
import {
  applyMergedMetadataToDraft,
  mergeReviewMetadataSources,
  reviewedPaperIdentity,
} from "./pdf-review-merge.js";

const $ = (selector, root = document) => root.querySelector(selector);
const LOCAL_EXTRACTION_CONCURRENCY = 2;

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

function uniqueStrings(values = []) {
  const result = [];
  const seen = new Set();
  for (const raw of values) {
    const value = clean(raw);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function fileStem(name) {
  return clean(name)
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Untitled paper";
}

function setGlobalStatus(message, tone = "ready") {
  const status = $("#library-status");
  const text = $("#library-status-text");
  if (status) status.className = `status ${tone}`;
  if (text) text.textContent = message;
}

function createUi() {
  const actions = $(".toolbar-actions");
  if (!actions || $("#add-pdf-button")) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "add-pdf-button";
  button.textContent = "Add PDFs";
  const reset = $("#reset-view", actions);
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
  dialog.innerHTML = `
    <div class="pdf-ai-shell" id="pdf-ai-shell">
      <header class="pdf-ai-header">
        <div>
          <span class="drawer-kicker">Reviewed import</span>
          <h2>PDF metadata, citations & topics</h2>
        </div>
        <button type="button" class="icon-button" id="pdf-ai-close" aria-label="Close PDF import">×</button>
      </header>

      <nav id="pdf-review-tabs" class="pdf-review-tabs" role="tablist" aria-label="Selected PDF files"></nav>

      <section class="pdf-ai-step" id="pdf-ai-analysis-step">
        <div class="pdf-ai-file-card">
          <strong id="pdf-ai-file-name">No PDF selected</strong>
          <span><span id="pdf-ai-queue-progress" aria-live="polite"></span><span id="pdf-ai-file-separator"> · </span><span id="pdf-ai-file-size"></span></span>
        </div>

        <p class="pdf-ai-explainer">Every selected PDF is extracted locally with Rust/WebAssembly. On an individual tab you can additionally run <strong>AI extraction</strong> or <strong>Online extraction</strong> using the paper-information method selected in Config. Results are merged without overwriting fields you have edited manually. PDF bytes remain transient browser input and are not stored in IndexedDB.</p>

        <div id="pdf-source-status" class="pdf-source-status" aria-live="polite"></div>

        <div class="pdf-ai-analysis-actions pdf-extraction-actions">
          <button type="button" id="pdf-local-extract" class="quiet-button">Run local again</button>
          <button type="button" id="pdf-ai-analyze" class="quiet-button">Run AI extraction</button>
          <button type="button" id="pdf-online-extract" class="quiet-button">Run online extraction</button>
          <button type="button" id="pdf-ai-cancel-analysis" class="quiet-button" hidden>Cancel network extraction</button>
          <span id="pdf-ai-analysis-status" class="muted" role="status" aria-live="polite"></span>
        </div>
      </section>

      <section class="pdf-ai-review" id="pdf-ai-review">
        <div class="section-heading">
          <div>
            <span class="drawer-kicker" id="pdf-review-source-kicker">Merged proposal</span>
            <h3>Review before saving</h3>
          </div>
          <span id="pdf-ai-duplicate" class="pdf-ai-duplicate" hidden></span>
        </div>

        <div class="pdf-ai-metadata-grid">
          <label class="full-width">Title
            <input id="pdf-review-title" type="text" required />
          </label>
          <label class="full-width">Authors <span class="field-hint">one per line</span>
            <textarea id="pdf-review-authors" rows="4"></textarea>
          </label>
          <label>Year
            <input id="pdf-review-year" type="number" min="0" step="1" />
          </label>
          <label>Publication type
            <input id="pdf-review-type" type="text" />
          </label>
          <label class="full-width">Venue
            <input id="pdf-review-venue" type="text" />
          </label>
          <label>DOI
            <input id="pdf-review-doi" type="text" spellcheck="false" />
          </label>
          <label>arXiv ID
            <input id="pdf-review-arxiv" type="text" spellcheck="false" />
          </label>
          <label class="full-width">Source URL
            <input id="pdf-review-url" type="url" />
          </label>
          <label class="full-width">Abstract
            <textarea id="pdf-review-abstract" rows="7"></textarea>
          </label>
          <label class="full-width">Keywords <span class="field-hint">comma-separated</span>
            <input id="pdf-review-keywords" type="text" />
          </label>
        </div>

        <section class="pdf-ai-topic-section">
          <div class="section-heading">
            <div>
              <h3>Proposed topics</h3>
              <span class="muted">AI and online topics are merged by name. You can accept, reject, edit, or add topics before saving.</span>
            </div>
            <button type="button" id="pdf-ai-add-topic" class="quiet-button">+ Topic</button>
          </div>
          <div id="pdf-ai-topics" class="pdf-ai-topics"></div>
        </section>

        <section class="pdf-reference-section" id="pdf-reference-section" hidden>
          <div class="section-heading">
            <div>
              <h3>Extracted references</h3>
              <span id="pdf-reference-summary" class="muted"></span>
            </div>
            <div class="pdf-reference-bulk-actions">
              <button type="button" id="pdf-reference-accept-all" class="quiet-button">Accept all</button>
              <button type="button" id="pdf-reference-reject-all" class="quiet-button">Reject all</button>
            </div>
          </div>
          <p class="muted pdf-reference-note">Accepted references are saved with the paper and linked to unambiguous matches in your library. Importing a cited paper later also connects it automatically.</p>
          <div id="pdf-reference-list" class="pdf-reference-list"></div>
        </section>

        <section id="pdf-ai-warnings-section" class="pdf-ai-warnings" hidden>
          <h3>Extraction warnings</h3>
          <ul id="pdf-ai-warnings"></ul>
        </section>

        <div class="pdf-ai-review-actions">
          <button type="button" id="pdf-ai-save">Save & close tab</button>
          <button type="button" id="pdf-ai-skip-file" class="quiet-button">Skip tab</button>
          <button type="button" id="pdf-ai-discard" class="quiet-button">Close remaining tabs</button>
        </div>
      </section>
    </div>
  `;
  document.body.append(dialog);
  return { button, input, dialog };
}

function authorsFromTextarea(value) {
  return String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function commaList(value) {
  return uniqueStrings(String(value || "").split(/[,;]+/));
}

function topicRow(topic = {}) {
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

function referenceKey(reference = {}) {
  const doi = normalizeDoi(reference.doi);
  if (doi) return `doi:${doi}`;
  if (reference.arxivId) return `arxiv:${clean(reference.arxivId).toLowerCase()}`;
  return clean(reference.rawText).replace(/\s+/g, " ").toLowerCase();
}

function referenceRow(reference = {}) {
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

function preserveReferenceSelections(previous = [], incoming = []) {
  const previousByKey = new Map(previous.map((reference) => [referenceKey(reference), reference]));
  return incoming.map((reference) => {
    const prior = previousByKey.get(referenceKey(reference));
    return {
      ...structuredClone(reference),
      use: prior ? prior.use !== false : true,
      ...(prior?.resolution ? { resolution: structuredClone(prior.resolution) } : {}),
    };
  });
}

function emptyDraft(file) {
  return {
    title: fileStem(file?.name),
    authors: [],
    year: null,
    type: "article",
    venue: "",
    doi: "",
    semanticScholarId: "",
    openAlexId: "",
    arxivId: "",
    url: "",
    abstract: "",
    citationCount: null,
    keywords: [],
    topics: [],
    references: [],
    warnings: [],
    metadataSources: [],
    providerPrimary: "",
    localExtraction: null,
    aiTransport: null,
  };
}

function createReviewItem(file) {
  return {
    id: `pdf-review:${crypto.randomUUID()}`,
    file,
    sources: { local: null, ai: null, online: null },
    draft: emptyDraft(file),
    dirtyFields: new Set(),
    status: { local: "queued", ai: "idle", online: "idle" },
    errors: { local: "", ai: "", online: "" },
    aiContext: null,
    onlineContext: null,
    networkController: null,
    localToken: 0,
    networkToken: 0,
  };
}

function matchingPaper(library, incoming) {
  const identity = paperIdentityKey(incoming);
  const fallback = `${normalizedTitle(incoming.title)}:${incoming.year || ""}`;
  return library.papers.find((paper) => paperIdentityKey(paper) === identity)
    || library.papers.find((paper) => `${normalizedTitle(paper.title)}:${paper.year || ""}` === fallback)
    || null;
}

function matchingTopic(library, name) {
  const key = clean(name).toLowerCase();
  return library.topics.find((topic) => clean(topic.name).toLowerCase() === key) || null;
}

function init() {
  const ui = createUi();
  if (!ui) return;

  let items = [];
  let activeId = null;
  let savedCount = 0;
  let skippedCount = 0;
  let localQueue = [];
  let localActive = 0;
  let duplicateToken = 0;

  const tabs = $("#pdf-review-tabs", ui.dialog);
  const analysisStatus = $("#pdf-ai-analysis-status", ui.dialog);
  const sourceStatus = $("#pdf-source-status", ui.dialog);
  const analyzeButton = $("#pdf-ai-analyze", ui.dialog);
  const onlineButton = $("#pdf-online-extract", ui.dialog);
  const localButton = $("#pdf-local-extract", ui.dialog);
  const skipButton = $("#pdf-ai-skip-file", ui.dialog);
  const cancelButton = $("#pdf-ai-cancel-analysis", ui.dialog);
  const saveButton = $("#pdf-ai-save", ui.dialog);

  const fieldMap = new Map([
    ["#pdf-review-title", "title"],
    ["#pdf-review-authors", "authors"],
    ["#pdf-review-year", "year"],
    ["#pdf-review-type", "type"],
    ["#pdf-review-venue", "venue"],
    ["#pdf-review-doi", "doi"],
    ["#pdf-review-arxiv", "arxivId"],
    ["#pdf-review-url", "url"],
    ["#pdf-review-abstract", "abstract"],
    ["#pdf-review-keywords", "keywords"],
  ]);

  function activeItem() {
    return items.find((item) => item.id === activeId) || null;
  }

  function captureTopics() {
    return Array.from(ui.dialog.querySelectorAll(".pdf-ai-topic-row")).map((row) => ({
      name: clean($("[data-topic-name]", row).value),
      description: clean($("[data-topic-description]", row).value),
      confidence: Math.max(0, Math.min(1, Number(clean($("[data-topic-confidence]", row).textContent).replace("%", "")) / 100 || 0)),
      source: row.dataset.topicSource || "manual",
      use: $("[data-topic-use]", row).checked,
    })).filter((topic) => topic.name);
  }

  function captureReferences() {
    return Array.from(ui.dialog.querySelectorAll(".pdf-reference-row")).map((row) => ({
      ...structuredClone(row.__paperMapReference || {}),
      use: $("[data-reference-use]", row)?.checked !== false,
    }));
  }

  function captureActive() {
    const item = activeItem();
    if (!item) return null;
    item.draft = {
      ...item.draft,
      title: clean($("#pdf-review-title", ui.dialog).value),
      authors: authorsFromTextarea($("#pdf-review-authors", ui.dialog).value),
      year: Number.isInteger(Number($("#pdf-review-year", ui.dialog).value)) && Number($("#pdf-review-year", ui.dialog).value) > 0
        ? Number($("#pdf-review-year", ui.dialog).value)
        : null,
      type: clean($("#pdf-review-type", ui.dialog).value),
      venue: clean($("#pdf-review-venue", ui.dialog).value),
      doi: normalizeDoi($("#pdf-review-doi", ui.dialog).value),
      arxivId: clean($("#pdf-review-arxiv", ui.dialog).value).replace(/^arxiv:\s*/i, ""),
      url: clean($("#pdf-review-url", ui.dialog).value),
      abstract: clean($("#pdf-review-abstract", ui.dialog).value),
      keywords: commaList($("#pdf-review-keywords", ui.dialog).value),
      topics: captureTopics(),
      references: captureReferences(),
    };
    return item;
  }

  function statusLabel(status) {
    if (status === "complete") return "ready";
    if (status === "running" || status === "queued") return "working";
    if (status === "error") return "failed";
    return "not run";
  }

  function renderSourceStatus(item) {
    const provider = loadPaperProviderConfig();
    sourceStatus.innerHTML = `
      <span class="pdf-source-chip ${item.status.local}">Local: ${statusLabel(item.status.local)}</span>
      <span class="pdf-source-chip ${item.status.ai}">AI: ${statusLabel(item.status.ai)}</span>
      <span class="pdf-source-chip ${item.status.online}">Online (${escapeHtml(paperProviderLabel(provider.provider))}): ${statusLabel(item.status.online)}</span>
    `;
  }

  function renderTabs() {
    tabs.replaceChildren(...items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "tab";
      button.dataset.pdfTabId = item.id;
      button.dataset.localStatus = item.status.local;
      button.className = item.id === activeId ? "selected" : "";
      button.setAttribute("aria-selected", String(item.id === activeId));
      button.title = item.file.name;
      const state = item.status.local === "complete" ? "✓" : item.status.local === "error" ? "!" : "…";
      button.textContent = `${state} ${item.file.name}`;
      return button;
    }));
  }

  function renderTopics(item) {
    const container = $("#pdf-ai-topics", ui.dialog);
    const rows = (item.draft.topics || []).map(topicRow);
    container.replaceChildren(...rows);
  }

  function renderReferences(item) {
    const references = item.draft.references || [];
    const section = $("#pdf-reference-section", ui.dialog);
    $("#pdf-reference-list", ui.dialog).replaceChildren(...references.map(referenceRow));
    section.hidden = references.length === 0;
    $("#pdf-reference-summary", ui.dialog).textContent = item.draft.localExtraction?.summary || `${references.length} references`;
  }

  function renderWarnings(item) {
    const warnings = $("#pdf-ai-warnings", ui.dialog);
    warnings.replaceChildren(...(item.draft.warnings || []).map((warning) => {
      const li = document.createElement("li");
      li.textContent = warning;
      return li;
    }));
    $("#pdf-ai-warnings-section", ui.dialog).hidden = warnings.children.length === 0;
  }

  function networkBusy(item) {
    return item.status.ai === "running" || item.status.online === "running";
  }

  function refreshButtons(item) {
    const config = loadAiConfig();
    const tooLarge = providerUsesDirectPdf(config) && item.file.size > MAX_INLINE_PDF_BYTES;
    const busy = networkBusy(item);
    localButton.disabled = item.status.local === "running";
    analyzeButton.disabled = busy || tooLarge;
    onlineButton.disabled = busy;
    cancelButton.hidden = !busy;
    saveButton.disabled = item.status.local === "queued" || item.status.local === "running" || busy;
    skipButton.disabled = false;
    if (tooLarge && item.status.ai === "idle") {
      analysisStatus.textContent = `${providerLabel(config.provider)} direct PDF input is limited to 25 MB. Local and online extraction remain available.`;
    }
  }

  async function updateDuplicateHint(item) {
    const token = ++duplicateToken;
    const library = await loadLibrary();
    if (token !== duplicateToken || item !== activeItem()) return;
    const existing = item.draft.title ? matchingPaper(library, item.draft) : null;
    const hint = $("#pdf-ai-duplicate", ui.dialog);
    hint.hidden = !existing;
    hint.textContent = existing ? `Will merge with existing: ${existing.title}` : "";
  }

  function renderActive({ focus = false } = {}) {
    const item = activeItem();
    renderTabs();
    if (!item) return;
    $("#pdf-ai-file-name", ui.dialog).textContent = item.file.name;
    $("#pdf-ai-file-size", ui.dialog).textContent = `${(item.file.size / 1024 / 1024).toFixed(1)} MB`;
    $("#pdf-ai-queue-progress", ui.dialog).textContent = `${items.findIndex((candidate) => candidate.id === item.id) + 1} of ${items.length}`;
    $("#pdf-review-title", ui.dialog).value = item.draft.title || "";
    $("#pdf-review-authors", ui.dialog).value = (item.draft.authors || []).join("\n");
    $("#pdf-review-year", ui.dialog).value = item.draft.year || "";
    $("#pdf-review-type", ui.dialog).value = item.draft.type || "article";
    $("#pdf-review-venue", ui.dialog).value = item.draft.venue || "";
    $("#pdf-review-doi", ui.dialog).value = item.draft.doi || "";
    $("#pdf-review-arxiv", ui.dialog).value = item.draft.arxivId || "";
    $("#pdf-review-url", ui.dialog).value = item.draft.url || "";
    $("#pdf-review-abstract", ui.dialog).value = item.draft.abstract || "";
    $("#pdf-review-keywords", ui.dialog).value = (item.draft.keywords || []).join(", ");
    renderTopics(item);
    renderReferences(item);
    renderWarnings(item);
    renderSourceStatus(item);
    refreshButtons(item);
    updateDuplicateHint(item);
    if (focus) $("#pdf-review-title", ui.dialog).focus();
  }

  function mergeSources(item) {
    const previousReferences = item.draft.references || [];
    const merged = mergeReviewMetadataSources(item.sources);
    item.draft = applyMergedMetadataToDraft(item.draft, merged, item.dirtyFields);
    item.draft.references = preserveReferenceSelections(previousReferences, merged.references || []);
    if (item.id === activeId) renderActive();
    else renderTabs();
  }

  async function runLocal(item) {
    if (!items.includes(item)) return;
    const token = ++item.localToken;
    item.status.local = "running";
    item.errors.local = "";
    if (item.id === activeId) {
      analysisStatus.textContent = "Parsing PDF layout and detecting bibliography locally…";
      renderActive();
    } else renderTabs();
    try {
      const metadata = await extractPdfCitationsLocally(item.file);
      if (!items.includes(item) || token !== item.localToken) return;
      item.sources.local = metadata;
      item.status.local = "complete";
      mergeSources(item);
      if (item.id === activeId) analysisStatus.textContent = `Local extraction complete: ${metadata.localExtraction?.summary || "review the proposal"}.`;
    } catch (error) {
      if (!items.includes(item) || token !== item.localToken) return;
      item.status.local = "error";
      item.errors.local = error.message || String(error);
      item.draft.warnings = uniqueStrings([...(item.draft.warnings || []), `Local extraction failed: ${item.errors.local}`]);
      if (item.id === activeId) {
        analysisStatus.textContent = item.errors.local;
        renderActive();
      } else renderTabs();
    }
  }

  function drainLocalQueue() {
    while (localActive < LOCAL_EXTRACTION_CONCURRENCY && localQueue.length) {
      const item = localQueue.shift();
      if (!items.includes(item) || item.status.local === "running") continue;
      localActive += 1;
      runLocal(item).finally(() => {
        localActive -= 1;
        drainLocalQueue();
        if (localActive === 0 && localQueue.length === 0 && items.length) {
          setGlobalStatus(`Local extraction finished for ${items.length} remaining PDF tab${items.length === 1 ? "" : "s"}.`, "ready");
        }
      });
    }
  }

  function queueLocal(item, { first = false } = {}) {
    if (!items.includes(item)) return;
    item.status.local = "queued";
    localQueue = localQueue.filter((candidate) => candidate !== item);
    if (first) localQueue.unshift(item);
    else localQueue.push(item);
    renderTabs();
    if (item.id === activeId) renderActive();
    drainLocalQueue();
  }

  async function runAi(item) {
    if (!items.includes(item) || networkBusy(item)) return;
    captureActive();
    const { config, apiKey } = aiConfigSnapshot();
    if (!config.model) {
      analysisStatus.textContent = "Configure an AI model in Config before analysis.";
      return;
    }
    if (providerNeedsApiKey(config) && !clean(apiKey)) {
      analysisStatus.textContent = `Configure an API key for ${providerLabel(config.provider)} in Config before analysis.`;
      return;
    }
    if (providerUsesDirectPdf(config) && item.file.size > MAX_INLINE_PDF_BYTES) {
      refreshButtons(item);
      return;
    }

    const token = ++item.networkToken;
    const controller = new AbortController();
    item.networkController = controller;
    item.status.ai = "running";
    analysisStatus.textContent = `Analyzing ${item.file.name} with ${providerLabel(config.provider)}…`;
    renderActive();
    try {
      const metadata = await analyzePdfWithAi({ file: item.file, config, apiKey, signal: controller.signal });
      if (!items.includes(item) || token !== item.networkToken) return;
      item.sources.ai = metadata;
      item.aiContext = {
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        transport: metadata.aiTransport || null,
        extractedAt: new Date().toISOString(),
      };
      item.status.ai = "complete";
      mergeSources(item);
      analysisStatus.textContent = `${providerLabel(config.provider)} AI extraction merged into this tab.`;
    } catch (error) {
      if (!items.includes(item) || token !== item.networkToken) return;
      if (error?.name === "AbortError") {
        item.status.ai = "idle";
        analysisStatus.textContent = "AI extraction cancelled.";
      } else {
        item.status.ai = "error";
        item.errors.ai = error.message || String(error);
        analysisStatus.textContent = item.errors.ai;
      }
      renderActive();
    } finally {
      if (items.includes(item) && token === item.networkToken) {
        item.networkController = null;
        refreshButtons(item);
      }
    }
  }

  function onlineQuery(item) {
    const draft = item.draft;
    if (normalizeDoi(draft.doi)) return normalizeDoi(draft.doi);
    if (clean(draft.arxivId)) return `arxiv:${clean(draft.arxivId)}`;
    return clean(draft.title) || fileStem(item.file.name);
  }

  async function runOnline(item) {
    if (!items.includes(item) || networkBusy(item)) return;
    captureActive();
    const query = onlineQuery(item);
    const providerConfig = loadPaperProviderConfig();
    const token = ++item.networkToken;
    const controller = new AbortController();
    item.networkController = controller;
    item.status.online = "running";
    analysisStatus.textContent = `Looking up ${item.file.name} with ${paperProviderLabel(providerConfig.provider)}…`;
    renderActive();
    try {
      const metadata = await resolveOnlinePaper(query, { signal: controller.signal });
      if (!items.includes(item) || token !== item.networkToken) return;
      item.sources.online = metadata;
      item.onlineContext = {
        provider: metadata.providerPrimary || metadata.source || providerConfig.provider,
        metadataSources: metadata.metadataSources || [metadata.providerPrimary || metadata.source || providerConfig.provider],
        query,
        extractedAt: new Date().toISOString(),
      };
      item.status.online = "complete";
      mergeSources(item);
      analysisStatus.textContent = `${paperProviderLabel(providerConfig.provider)} metadata merged into this tab.`;
    } catch (error) {
      if (!items.includes(item) || token !== item.networkToken) return;
      if (error?.name === "AbortError") {
        item.status.online = "idle";
        analysisStatus.textContent = "Online extraction cancelled.";
      } else {
        item.status.online = "error";
        item.errors.online = error.message || String(error);
        analysisStatus.textContent = item.errors.online;
      }
      renderActive();
    } finally {
      if (items.includes(item) && token === item.networkToken) {
        item.networkController = null;
        refreshButtons(item);
      }
    }
  }

  function topicResult(item, library) {
    const topics = [];
    const ids = [];
    for (const topic of item.draft.topics || []) {
      if (topic.use === false) continue;
      const name = clean(topic.name);
      if (!name) continue;
      const existing = matchingTopic(library, name);
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const source = clean(topic.source) || "reviewed-pdf";
      const namespace = source === "ai" ? "ai" : source === "manual" ? "manual" : "provider";
      const id = `topic:${namespace}:${slugTopic(name) || crypto.randomUUID()}`;
      topics.push({
        id,
        name,
        description: clean(topic.description),
        source,
        confidence: Math.max(0, Math.min(1, Number(topic.confidence) || 0)),
        createdAt: new Date().toISOString(),
      });
      ids.push(id);
    }
    return { topics, ids: Array.from(new Set(ids)) };
  }

  function paperFromItem(item) {
    const draft = item.draft;
    const reviewedAt = new Date().toISOString();
    const extractedReferences = (draft.references || [])
      .filter((reference) => reference.use !== false)
      .map((reference) => ({ ...structuredClone(reference), use: undefined, reviewed: true }));
    for (const reference of extractedReferences) delete reference.use;
    const metadataSources = uniqueStrings([
      ...(draft.metadataSources || []),
      ...(item.aiContext ? [`ai:${item.aiContext.provider}`] : []),
      ...(item.onlineContext?.metadataSources || []),
    ]);
    const paper = {
      id: reviewedPaperIdentity(draft, `local:${crypto.randomUUID()}`),
      semanticScholarId: clean(draft.semanticScholarId),
      openAlexId: clean(draft.openAlexId),
      doi: normalizeDoi(draft.doi),
      arxivId: clean(draft.arxivId),
      title: clean(draft.title),
      authors: Array.isArray(draft.authors) ? draft.authors : [],
      year: Number.isInteger(Number(draft.year)) && Number(draft.year) > 0 ? Number(draft.year) : null,
      venue: clean(draft.venue),
      type: clean(draft.type) || "article",
      url: clean(draft.url),
      pdfUrl: "",
      abstract: clean(draft.abstract),
      keywords: uniqueStrings(draft.keywords || []),
      topics: [],
      tags: [],
      notes: "",
      status: "unread",
      relevance: 3,
      starred: false,
      citationCount: Number.isFinite(Number(draft.citationCount)) ? Number(draft.citationCount) : null,
      source: "reviewed-pdf",
      sourceFileName: item.file.name,
      metadataSources,
      extractedReferences,
      pdfExtraction: draft.localExtraction ? {
        provider: "rust-wasm",
        engine: draft.localExtraction.engine || "paper-map-rust-pdf",
        layout: draft.localExtraction.layout || null,
        reviewedAt,
      } : null,
      importedAt: reviewedAt,
    };
    if (item.aiContext) paper.aiExtraction = { ...item.aiContext, reviewedAt };
    if (item.onlineContext) paper.onlineExtraction = { ...item.onlineContext, reviewedAt };
    return paper;
  }

  function mergeExtractedReferences(existing = [], incoming = []) {
    const records = new Map();
    for (const reference of [...existing, ...incoming]) {
      const key = referenceKey(reference);
      if (key) records.set(key, reference);
    }
    return Array.from(records.values());
  }

  function removeItem(item, { skipped = false, message = "" } = {}) {
    item.localToken += 1;
    item.networkToken += 1;
    item.networkController?.abort();
    item.networkController = null;
    localQueue = localQueue.filter((candidate) => candidate !== item);
    const index = items.indexOf(item);
    items = items.filter((candidate) => candidate !== item);
    if (skipped) skippedCount += 1;
    if (!items.length) {
      activeId = null;
      ui.dialog.close();
      const summary = `${savedCount} saved, ${skippedCount} skipped.`;
      setGlobalStatus(message ? `${message} ${summary}` : `PDF review complete: ${summary}`, "ready");
      if (savedCount) window.location.reload();
      return;
    }
    const next = items[Math.min(Math.max(index, 0), items.length - 1)];
    activeId = next.id;
    analysisStatus.textContent = message;
    renderActive();
  }

  function closeRemaining() {
    for (const item of items) {
      item.localToken += 1;
      item.networkToken += 1;
      item.networkController?.abort();
    }
    const discarded = items.length;
    localQueue = [];
    items = [];
    activeId = null;
    ui.dialog.close();
    setGlobalStatus(`PDF review closed: ${savedCount} saved, ${skippedCount} skipped, ${discarded} remaining discarded.`, "ready");
    if (savedCount) window.location.reload();
  }

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-pdf-tab-id]");
    if (!button || button.dataset.pdfTabId === activeId) return;
    captureActive();
    activeId = button.dataset.pdfTabId;
    analysisStatus.textContent = "";
    renderActive();
  });

  ui.button.addEventListener("click", () => ui.input.click());
  ui.input.addEventListener("change", () => {
    const files = Array.from(ui.input.files || []);
    ui.input.value = "";
    if (!files.length) return;
    const pdfFiles = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    const rejectedCount = files.length - pdfFiles.length;
    if (!pdfFiles.length) {
      setGlobalStatus("PDF import requires .pdf files.", "error");
      return;
    }

    closeOutstandingWithoutClosing();
    items = pdfFiles.map(createReviewItem);
    activeId = items[0].id;
    savedCount = 0;
    skippedCount = 0;
    analysisStatus.textContent = "Local extraction queued for every selected PDF.";
    if (!ui.dialog.open) ui.dialog.showModal();
    renderActive();
    for (const item of items) queueLocal(item);
    setGlobalStatus(
      rejectedCount
        ? `${rejectedCount} non-PDF file${rejectedCount === 1 ? " was" : "s were"} ignored. Local extraction started for ${items.length} PDFs.`
        : `Local extraction started for ${items.length} PDF${items.length === 1 ? "" : "s"}.`,
      "loading",
    );
  });

  function closeOutstandingWithoutClosing() {
    for (const item of items) {
      item.localToken += 1;
      item.networkToken += 1;
      item.networkController?.abort();
    }
    localQueue = [];
    items = [];
    activeId = null;
  }

  $("#pdf-ai-close", ui.dialog).addEventListener("click", closeRemaining);
  $("#pdf-ai-discard", ui.dialog).addEventListener("click", closeRemaining);
  ui.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeRemaining();
  });

  localButton.addEventListener("click", () => {
    const item = captureActive();
    if (item) queueLocal(item, { first: true });
  });
  analyzeButton.addEventListener("click", () => {
    const item = activeItem();
    if (item) runAi(item);
  });
  onlineButton.addEventListener("click", () => {
    const item = activeItem();
    if (item) runOnline(item);
  });
  cancelButton.addEventListener("click", () => activeItem()?.networkController?.abort());
  skipButton.addEventListener("click", () => {
    const item = activeItem();
    if (item) removeItem(item, { skipped: true, message: `Skipped ${item.file.name}.` });
  });

  for (const [selector, field] of fieldMap) {
    const input = $(selector, ui.dialog);
    input.addEventListener("input", () => {
      const item = activeItem();
      if (item) item.dirtyFields.add(field);
    });
    input.addEventListener("change", () => {
      const item = captureActive();
      if (item && ["title", "year", "doi", "arxivId"].includes(field)) updateDuplicateHint(item);
    });
  }

  $("#pdf-ai-add-topic", ui.dialog).addEventListener("click", () => {
    const item = captureActive();
    if (!item) return;
    item.dirtyFields.add("topics");
    item.draft.topics.push({ name: "", description: "", confidence: 1, source: "manual", use: true });
    renderTopics(item);
    $("#pdf-ai-topics [data-topic-name]:last-of-type", ui.dialog)?.focus();
  });

  $("#pdf-ai-topics", ui.dialog).addEventListener("input", () => activeItem()?.dirtyFields.add("topics"));
  $("#pdf-ai-topics", ui.dialog).addEventListener("change", () => activeItem()?.dirtyFields.add("topics"));
  $("#pdf-ai-topics", ui.dialog).addEventListener("click", (event) => {
    const remove = event.target.closest("[data-topic-remove]");
    if (!remove) return;
    const item = activeItem();
    if (!item) return;
    item.dirtyFields.add("topics");
    remove.closest(".pdf-ai-topic-row")?.remove();
    item.draft.topics = captureTopics();
  });

  $("#pdf-reference-list", ui.dialog).addEventListener("change", () => {
    const item = activeItem();
    if (item) item.draft.references = captureReferences();
  });
  $("#pdf-reference-accept-all", ui.dialog).addEventListener("click", () => {
    for (const checkbox of ui.dialog.querySelectorAll("[data-reference-use]")) checkbox.checked = true;
    const item = activeItem();
    if (item) item.draft.references = captureReferences();
  });
  $("#pdf-reference-reject-all", ui.dialog).addEventListener("click", () => {
    for (const checkbox of ui.dialog.querySelectorAll("[data-reference-use]")) checkbox.checked = false;
    const item = activeItem();
    if (item) item.draft.references = captureReferences();
  });

  saveButton.addEventListener("click", async () => {
    const item = captureActive();
    if (!item || saveButton.disabled) return;
    saveButton.disabled = true;
    try {
      if (!clean(item.draft.title)) throw new Error("Title is required before saving.");
      const library = await loadLibrary();
      const incoming = paperFromItem(item);
      const existing = matchingPaper(library, incoming);
      const topics = topicResult(item, library);
      incoming.topics = topics.ids;
      incoming.libraryEntry = existing ? undefined : {
        method: "reviewed-pdf",
        addedAt: incoming.importedAt,
        fileName: item.file.name,
        detail: uniqueStrings(incoming.metadataSources).join(", "),
        parentPaperId: "",
      };

      let paper = existing ? mergePaperRecords(existing, incoming) : incoming;
      if (existing) {
        paper = {
          ...paper,
          id: existing.id,
          source: existing.source || paper.source,
          libraryEntry: existing.libraryEntry || paper.libraryEntry,
          metadataSources: uniqueStrings([
            ...(existing.metadataSources || [existing.source].filter(Boolean)),
            ...(incoming.metadataSources || []),
          ]),
          extractedReferences: mergeExtractedReferences(existing.extractedReferences || [], incoming.extractedReferences || []),
        };
      }

      await Promise.all([putPapers([paper]), putTopics(topics.topics)]);
      savedCount += 1;
      removeItem(item, { message: `${existing ? "Merged" : "Saved"} ${item.file.name}.` });
    } catch (error) {
      analysisStatus.textContent = error.message || String(error);
      setGlobalStatus(error.message || String(error), "error");
      const current = activeItem();
      if (current) refreshButtons(current);
    }
  });

  document.addEventListener("paper-map-ai-config-changed", () => {
    const item = activeItem();
    if (item) refreshButtons(item);
  });
  document.addEventListener("paper-map-paper-provider-config-changed", () => {
    const item = activeItem();
    if (item) renderSourceStatus(item);
  });
}

if (typeof document !== "undefined") init();
