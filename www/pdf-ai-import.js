import { loadLibrary, putPapers, putTopics } from "./db.js";
import {
  mergePaperRecords,
  normalizeDoi,
  normalizedTitle,
  paperIdentityKey,
} from "./import-export.js";
import {
  MAX_INLINE_PDF_BYTES,
  slugTopic,
} from "./pdf-ai.js";
import { analyzePdfWithAi } from "./ai-provider.js";
import {
  loadAiConfig,
  providerLabel,
  providerNeedsApiKey,
  providerUsesDirectPdf,
} from "./ai-config.js";
import {
  aiConfigSnapshot,
  bindPdfAiConfigSummary,
} from "./ai-config-ui.js";
import { extractPdfCitationsLocally } from "./pdf-local.js";

const $ = (selector, root = document) => root.querySelector(selector);

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

function setGlobalStatus(message, tone = "ready") {
  const status = $("#library-status");
  const text = $("#library-status-text");
  if (status) status.className = `status ${tone}`;
  if (text) text.textContent = message;
}

function createUi() {
  const actions = $(".library-actions");
  if (!actions || $("#import-pdf-ai")) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "import-pdf-ai";
  button.textContent = "Import PDFs with AI / local";

  const input = document.createElement("input");
  input.id = "pdf-ai-file";
  input.type = "file";
  input.accept = ".pdf,application/pdf";
  input.multiple = true;
  input.hidden = true;

  const reference = $("#import-button", actions);
  if (reference) reference.before(button, input);
  else actions.prepend(button, input);

  const dialog = document.createElement("dialog");
  dialog.id = "pdf-ai-dialog";
  dialog.className = "pdf-ai-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="pdf-ai-shell" id="pdf-ai-shell">
      <header class="pdf-ai-header">
        <div>
          <span class="drawer-kicker">Reviewed import</span>
          <h2>PDF metadata, citations & topics</h2>
        </div>
        <button type="button" class="icon-button" id="pdf-ai-close" aria-label="Close PDF import">×</button>
      </header>

      <section class="pdf-ai-step" id="pdf-ai-analysis-step">
        <div class="pdf-ai-file-card">
          <strong id="pdf-ai-file-name">No PDF selected</strong>
          <span><span id="pdf-ai-queue-progress" aria-live="polite"></span><span id="pdf-ai-file-separator"> · </span><span id="pdf-ai-file-size"></span></span>
        </div>

        <p class="pdf-ai-explainer"><strong>Local extraction</strong> runs Rust/WebAssembly entirely in this browser and systematically detects the bibliography, reference entries, DOI and arXiv identifiers. <strong>AI analysis</strong> is optional and uses the AI server selected in the global configuration. For a batch, Paper Map reviews one PDF at a time; saved items keep their own file provenance. Nothing is saved until you review it and press <strong>Save reviewed paper</strong>.</p>

        <div class="pdf-ai-analysis-actions pdf-extraction-actions">
          <button type="button" id="pdf-local-extract">Extract citations locally</button>
          <button type="button" id="pdf-ai-analyze" class="quiet-button">Analyze PDF with AI</button>
          <button type="button" id="pdf-ai-skip-file" class="quiet-button">Skip PDF</button>
          <button type="button" id="pdf-ai-cancel-analysis" class="quiet-button" hidden>Cancel</button>
          <span id="pdf-ai-analysis-status" class="muted" role="status" aria-live="polite"></span>
        </div>

        <details class="pdf-ai-provider-settings">
          <summary>AI server settings</summary>
        </details>
      </section>

      <section class="pdf-ai-review" id="pdf-ai-review" hidden>
        <div class="section-heading">
          <div>
            <span class="drawer-kicker" id="pdf-review-source-kicker">Extraction proposal</span>
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
              <span class="muted">AI suggestions can be accepted, rejected or edited. Local citation extraction does not invent topics.</span>
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
          <p class="muted pdf-reference-note">Accepted entries are stored as reviewed extraction provenance on the paper. Citation graph edges are created only after a later resolver maps a reference to a canonical paper.</p>
          <div id="pdf-reference-list" class="pdf-reference-list"></div>
        </section>

        <section id="pdf-ai-warnings-section" class="pdf-ai-warnings" hidden>
          <h3>Extraction warnings</h3>
          <ul id="pdf-ai-warnings"></ul>
        </section>

        <div class="pdf-ai-review-actions">
          <button type="button" id="pdf-ai-save">Save reviewed paper</button>
          <button type="button" id="pdf-ai-reanalyze" class="quiet-button">Run extraction again</button>
          <button type="button" id="pdf-ai-discard" class="quiet-button">Discard remaining</button>
        </div>
      </section>
    </form>
  `;
  document.body.append(dialog);
  bindPdfAiConfigSummary(dialog);
  return { button, input, dialog };
}

function topicRow(topic = {}) {
  const row = document.createElement("div");
  row.className = "pdf-ai-topic-row";
  row.innerHTML = `
    <label class="pdf-ai-topic-use" title="Include this topic">
      <input type="checkbox" data-topic-use checked />
      <span class="visually-hidden">Include topic</span>
    </label>
    <div class="pdf-ai-topic-fields">
      <input type="text" data-topic-name placeholder="Topic name" value="${escapeHtml(topic.name || "")}" />
      <textarea rows="2" data-topic-description placeholder="Short thematic description">${escapeHtml(topic.description || "")}</textarea>
    </div>
    <div class="pdf-ai-topic-confidence">
      <span>confidence</span>
      <strong data-topic-confidence>${Math.round((Number(topic.confidence) || 0) * 100)}%</strong>
    </div>
    <button type="button" class="icon-button" data-topic-remove aria-label="Remove topic">×</button>
  `;
  $("[data-topic-remove]", row).addEventListener("click", () => row.remove());
  return row;
}

function referenceRow(reference = {}) {
  const row = document.createElement("article");
  row.className = "pdf-reference-row";
  row.__paperMapReference = structuredClone(reference);
  const identifiers = [];
  if (reference.doi) identifiers.push(`<span class="reference-id">DOI ${escapeHtml(reference.doi)}</span>`);
  if (reference.arxivId) identifiers.push(`<span class="reference-id">arXiv ${escapeHtml(reference.arxivId)}</span>`);
  if (reference.year) identifiers.push(`<span class="reference-id">${escapeHtml(reference.year)}</span>`);
  const pages = reference.pageStart === reference.pageEnd
    ? `p. ${reference.pageStart}`
    : `pp. ${reference.pageStart}–${reference.pageEnd}`;
  row.innerHTML = `
    <label class="pdf-reference-use" title="Include this extracted reference">
      <input type="checkbox" data-reference-use checked />
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

function authorsFromTextarea(value) {
  return String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function commaList(value) {
  return Array.from(new Set(String(value || "").split(/[,;]+/).map((item) => item.trim()).filter(Boolean)));
}

function reviewedReferences(ui) {
  return Array.from(ui.dialog.querySelectorAll(".pdf-reference-row"))
    .filter((row) => $("[data-reference-use]", row)?.checked)
    .map((row) => ({
      ...structuredClone(row.__paperMapReference || {}),
      reviewed: true,
    }));
}

function paperFromReview(ui, file, context) {
  const yearValue = Number($("#pdf-review-year", ui.dialog).value);
  const doi = normalizeDoi($("#pdf-review-doi", ui.dialog).value);
  const arxivId = clean($("#pdf-review-arxiv", ui.dialog).value).replace(/^arxiv:\s*/i, "");
  const local = context.mode === "local";
  const reviewedAt = new Date().toISOString();
  const paper = {
    id: doi ? `doi:${doi}` : arxivId ? `arxiv:${arxivId.toLowerCase()}` : `local:${crypto.randomUUID()}`,
    title: clean($("#pdf-review-title", ui.dialog).value),
    authors: authorsFromTextarea($("#pdf-review-authors", ui.dialog).value),
    year: Number.isInteger(yearValue) && yearValue > 0 ? yearValue : null,
    venue: clean($("#pdf-review-venue", ui.dialog).value),
    type: clean($("#pdf-review-type", ui.dialog).value) || "article",
    doi,
    arxivId,
    url: clean($("#pdf-review-url", ui.dialog).value),
    pdfUrl: "",
    abstract: clean($("#pdf-review-abstract", ui.dialog).value),
    keywords: commaList($("#pdf-review-keywords", ui.dialog).value),
    topics: [],
    tags: [],
    notes: "",
    status: "unread",
    relevance: 3,
    starred: false,
    citationCount: null,
    source: local ? "local-pdf" : "ai-pdf",
    sourceFileName: file?.name || "",
    extractedReferences: reviewedReferences(ui),
    pdfExtraction: {
      provider: local ? "rust-wasm" : context.provider,
      engine: local ? context.details?.engine || "paper-map-rust-pdf" : context.model,
      layout: local ? context.details?.layout || null : null,
      reviewedAt,
    },
    importedAt: reviewedAt,
  };
  if (!local) {
    paper.aiExtraction = {
      provider: context.provider,
      model: context.model,
      baseUrl: context.baseUrl,
      transport: context.details?.transport || null,
      reviewedAt,
    };
  }
  return paper;
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

function reviewedTopics(ui, library) {
  const topics = [];
  const ids = [];
  for (const row of ui.dialog.querySelectorAll(".pdf-ai-topic-row")) {
    if (!$("[data-topic-use]", row).checked) continue;
    const name = clean($("[data-topic-name]", row).value);
    if (!name) continue;
    const existing = matchingTopic(library, name);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const id = `topic:ai:${slugTopic(name) || crypto.randomUUID()}`;
    const confidenceText = clean($("[data-topic-confidence]", row).textContent).replace("%", "");
    topics.push({
      id,
      name,
      description: clean($("[data-topic-description]", row).value),
      source: "ai",
      confidence: Math.max(0, Math.min(1, Number(confidenceText) / 100 || 0)),
      createdAt: new Date().toISOString(),
    });
    ids.push(id);
  }
  return { topics, ids: Array.from(new Set(ids)) };
}

function fillReview(ui, metadata, mode) {
  $("#pdf-review-source-kicker", ui.dialog).textContent = mode === "local" ? "Local Rust/WASM proposal" : "AI proposal";
  $("#pdf-review-title", ui.dialog).value = metadata.title || "";
  $("#pdf-review-authors", ui.dialog).value = (metadata.authors || []).join("\n");
  $("#pdf-review-year", ui.dialog).value = metadata.year || "";
  $("#pdf-review-type", ui.dialog).value = metadata.type || "article";
  $("#pdf-review-venue", ui.dialog).value = metadata.venue || "";
  $("#pdf-review-doi", ui.dialog).value = metadata.doi || "";
  $("#pdf-review-arxiv", ui.dialog).value = metadata.arxivId || "";
  $("#pdf-review-url", ui.dialog).value = metadata.url || "";
  $("#pdf-review-abstract", ui.dialog).value = metadata.abstract || "";
  $("#pdf-review-keywords", ui.dialog).value = (metadata.keywords || []).join(", ");

  const topicContainer = $("#pdf-ai-topics", ui.dialog);
  topicContainer.replaceChildren(...(metadata.topics || []).map(topicRow));
  if (!topicContainer.children.length) topicContainer.append(topicRow({ confidence: 0 }));

  const references = metadata.references || [];
  const referenceSection = $("#pdf-reference-section", ui.dialog);
  const referenceList = $("#pdf-reference-list", ui.dialog);
  referenceList.replaceChildren(...references.map(referenceRow));
  referenceSection.hidden = references.length === 0;
  $("#pdf-reference-summary", ui.dialog).textContent = metadata.localExtraction?.summary || `${references.length} references`;

  const warnings = $("#pdf-ai-warnings", ui.dialog);
  const warningSection = $("#pdf-ai-warnings-section", ui.dialog);
  warnings.replaceChildren(...(metadata.warnings || []).map((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    return item;
  }));
  warningSection.hidden = warnings.children.length === 0;
}

async function updateDuplicateHint(ui, file, context) {
  const library = await loadLibrary();
  const incoming = paperFromReview(ui, file, context);
  const existing = incoming.title ? matchingPaper(library, incoming) : null;
  const hint = $("#pdf-ai-duplicate", ui.dialog);
  hint.hidden = !existing;
  if (existing) hint.textContent = `Will merge with existing: ${existing.title}`;
  return { library, existing, incoming };
}

function init() {
  const ui = createUi();
  if (!ui) return;

  let selectedFile = null;
  let fileQueue = [];
  let queueIndex = -1;
  let batchSavedCount = 0;
  let batchSkippedCount = 0;
  let controller = null;
  let processing = false;
  let operationToken = 0;
  const initialAi = loadAiConfig();
  let extractionContext = {
    mode: "ai",
    provider: initialAi.provider,
    model: initialAi.model,
    baseUrl: initialAi.baseUrl,
    details: null,
  };

  const analysisStatus = $("#pdf-ai-analysis-status", ui.dialog);
  const analyzeButton = $("#pdf-ai-analyze", ui.dialog);
  const localButton = $("#pdf-local-extract", ui.dialog);
  const skipButton = $("#pdf-ai-skip-file", ui.dialog);
  const cancelButton = $("#pdf-ai-cancel-analysis", ui.dialog);
  const discardButton = $("#pdf-ai-discard", ui.dialog);
  const closeButton = $("#pdf-ai-close", ui.dialog);
  const review = $("#pdf-ai-review", ui.dialog);

  function queueProgress() {
    if (!fileQueue.length || queueIndex < 0) return "";
    return `${queueIndex + 1} of ${fileQueue.length}`;
  }

  function isPdfFile(file) {
    return Boolean(file) && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  }

  function currentAiTooLarge() {
    if (!selectedFile) return false;
    return providerUsesDirectPdf(loadAiConfig()) && selectedFile.size > MAX_INLINE_PDF_BYTES;
  }

  function refreshAiAvailability({ updateStatus = true } = {}) {
    const config = loadAiConfig();
    const tooLarge = currentAiTooLarge();
    analyzeButton.disabled = processing || tooLarge;
    localButton.disabled = processing;
    skipButton.disabled = processing || !selectedFile;
    discardButton.disabled = processing || !selectedFile;
    if (!updateStatus || !selectedFile || processing) return;
    if (tooLarge) {
      analysisStatus.textContent = `Ready for local extraction. ${providerLabel(config.provider)} direct PDF input is limited to 25 MB; choose Ollama/OpenAI-compatible text mode or extract locally.`;
    } else {
      analysisStatus.textContent = `Ready for local extraction or AI analysis with ${providerLabel(config.provider)} (${config.model || "model not configured"}).`;
    }
  }

  function clearQueueState() {
    selectedFile = null;
    fileQueue = [];
    queueIndex = -1;
    batchSavedCount = 0;
    batchSkippedCount = 0;
    processing = false;
    $("#pdf-ai-queue-progress", ui.dialog).textContent = "";
  }

  function stopOutstandingWork() {
    operationToken += 1;
    controller?.abort();
    controller = null;
    processing = false;
  }

  function finishQueue(message) {
    const shouldReload = batchSavedCount > 0;
    const total = fileQueue.length;
    const saved = batchSavedCount;
    const skipped = batchSkippedCount;
    stopOutstandingWork();
    clearQueueState();
    ui.dialog.close();
    if (total > 1) {
      setGlobalStatus(`PDF batch complete: ${saved} saved, ${skipped} skipped.`, "ready");
    } else {
      setGlobalStatus(message, "ready");
    }
    if (shouldReload) window.location.reload();
  }

  function discardRemaining() {
    if (!fileQueue.length) {
      stopOutstandingWork();
      ui.dialog.close();
      return;
    }
    const shouldReload = batchSavedCount > 0;
    const saved = batchSavedCount;
    const skipped = batchSkippedCount;
    const discarded = Math.max(0, fileQueue.length - Math.max(queueIndex, 0));
    stopOutstandingWork();
    clearQueueState();
    ui.dialog.close();
    setGlobalStatus(`PDF batch stopped: ${saved} saved, ${skipped} skipped, ${discarded} discarded.`, "ready");
    if (shouldReload) window.location.reload();
  }

  function showFile(file, index = queueIndex) {
    operationToken += 1;
    selectedFile = file;
    queueIndex = index;
    processing = false;
    const config = loadAiConfig();
    extractionContext = {
      mode: "ai",
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      details: null,
    };
    $("#pdf-ai-file-name", ui.dialog).textContent = file.name;
    $("#pdf-ai-file-size", ui.dialog).textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
    $("#pdf-ai-queue-progress", ui.dialog).textContent = queueProgress();
    review.hidden = true;
    $("#pdf-reference-list", ui.dialog).replaceChildren();
    $("#pdf-reference-section", ui.dialog).hidden = true;
    const hint = $("#pdf-ai-duplicate", ui.dialog);
    hint.hidden = true;
    hint.textContent = "";
    const saveButton = $("#pdf-ai-save", ui.dialog);
    saveButton.disabled = false;
    refreshAiAvailability();
    if (!ui.dialog.open) ui.dialog.showModal();
  }

  function advanceQueue(message) {
    if (processing || !selectedFile) return;
    const nextIndex = queueIndex + 1;
    if (nextIndex >= fileQueue.length) {
      finishQueue(message);
      return;
    }
    showFile(fileQueue[nextIndex], nextIndex);
    setGlobalStatus(`${message} Reviewing ${queueProgress()}: ${selectedFile.name}.`, "ready");
  }

  ui.button.addEventListener("click", () => ui.input.click());
  ui.input.addEventListener("change", () => {
    const files = Array.from(ui.input.files || []);
    ui.input.value = "";
    if (!files.length) return;
    const pdfFiles = files.filter(isPdfFile);
    const rejectedCount = files.length - pdfFiles.length;
    if (!pdfFiles.length) {
      setGlobalStatus("PDF import requires .pdf files.", "error");
      return;
    }
    stopOutstandingWork();
    fileQueue = pdfFiles;
    queueIndex = 0;
    batchSavedCount = 0;
    batchSkippedCount = 0;
    showFile(fileQueue[0], 0);
    if (rejectedCount) {
      setGlobalStatus(`${rejectedCount} non-PDF file${rejectedCount === 1 ? " was" : "s were"} ignored. Reviewing ${queueProgress()}.`, "ready");
    } else if (pdfFiles.length > 1) {
      setGlobalStatus(`PDF review queue ready: ${pdfFiles.length} files selected.`, "ready");
    }
  });

  closeButton.addEventListener("click", discardRemaining);
  discardButton.addEventListener("click", discardRemaining);
  skipButton.addEventListener("click", () => {
    if (!selectedFile || processing) return;
    const skippedName = selectedFile.name;
    batchSkippedCount += 1;
    advanceQueue(`Skipped ${skippedName}.`);
  });
  ui.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    discardRemaining();
  });
  document.addEventListener("paper-map-ai-config-changed", refreshAiAvailability);

  $("#pdf-ai-add-topic", ui.dialog).addEventListener("click", () => $("#pdf-ai-topics", ui.dialog).append(topicRow({ confidence: 1 })));
  $("#pdf-reference-accept-all", ui.dialog).addEventListener("click", () => {
    for (const checkbox of ui.dialog.querySelectorAll("[data-reference-use]")) checkbox.checked = true;
  });
  $("#pdf-reference-reject-all", ui.dialog).addEventListener("click", () => {
    for (const checkbox of ui.dialog.querySelectorAll("[data-reference-use]")) checkbox.checked = false;
  });

  async function extractLocal() {
    if (!selectedFile || processing) return;
    const file = selectedFile;
    const token = operationToken;
    processing = true;
    refreshAiAvailability({ updateStatus: false });
    analysisStatus.textContent = "Parsing PDF layout and detecting bibliography locally…";
    setGlobalStatus(`Extracting citations from ${file.name} locally…`, "loading");
    try {
      const metadata = await extractPdfCitationsLocally(file);
      if (token !== operationToken || file !== selectedFile) return;
      extractionContext = {
        mode: "local",
        provider: "rust-wasm",
        model: metadata.localExtraction?.engine || "paper-map-rust-pdf",
        baseUrl: "",
        details: metadata.localExtraction,
      };
      fillReview(ui, metadata, "local");
      review.hidden = false;
      await updateDuplicateHint(ui, file, extractionContext);
      if (token !== operationToken || file !== selectedFile) return;
      analysisStatus.textContent = `Local extraction complete: ${metadata.localExtraction?.summary || "review the detected references"}.`;
      setGlobalStatus(`Local extraction complete for ${queueProgress()}; awaiting your review.`, "ready");
      $("#pdf-review-title", ui.dialog).focus();
    } catch (error) {
      if (token !== operationToken || file !== selectedFile) return;
      analysisStatus.textContent = error.message || String(error);
      setGlobalStatus(error.message || String(error), "error");
    } finally {
      if (token === operationToken && file === selectedFile) {
        processing = false;
        refreshAiAvailability({ updateStatus: false });
      }
    }
  }

  async function analyze() {
    if (!selectedFile || processing) return;
    const file = selectedFile;
    const token = operationToken;
    const { config, apiKey } = aiConfigSnapshot();
    if (!config.model) {
      analysisStatus.textContent = "Configure an AI model before analysis.";
      setGlobalStatus("AI model is not configured.", "error");
      return;
    }
    if (providerNeedsApiKey(config) && !clean(apiKey)) {
      analysisStatus.textContent = `Configure an API key for ${providerLabel(config.provider)} before analysis.`;
      setGlobalStatus("AI API key is not configured.", "error");
      return;
    }
    if (providerUsesDirectPdf(config) && file.size > MAX_INLINE_PDF_BYTES) {
      refreshAiAvailability();
      return;
    }

    controller = new AbortController();
    processing = true;
    refreshAiAvailability({ updateStatus: false });
    cancelButton.hidden = false;
    analysisStatus.textContent = `Analyzing PDF with ${providerLabel(config.provider)}…`;
    setGlobalStatus(`Analyzing ${file.name} with ${providerLabel(config.provider)}…`, "loading");

    try {
      const metadata = await analyzePdfWithAi({
        file,
        config,
        apiKey,
        signal: controller.signal,
      });
      if (token !== operationToken || file !== selectedFile) return;
      extractionContext = {
        mode: "ai",
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        details: { transport: metadata.aiTransport || null },
      };
      fillReview(ui, metadata, "ai");
      review.hidden = false;
      await updateDuplicateHint(ui, file, extractionContext);
      if (token !== operationToken || file !== selectedFile) return;
      analysisStatus.textContent = `${providerLabel(config.provider)} AI analysis complete. Review all fields before saving.`;
      setGlobalStatus(`PDF AI analysis complete for ${queueProgress()}; awaiting your review.`, "ready");
      $("#pdf-review-title", ui.dialog).focus();
    } catch (error) {
      if (token !== operationToken || file !== selectedFile) return;
      if (error?.name === "AbortError") {
        analysisStatus.textContent = "Analysis cancelled.";
        setGlobalStatus("PDF analysis cancelled.", "ready");
      } else {
        analysisStatus.textContent = error.message || String(error);
        setGlobalStatus(error.message || String(error), "error");
      }
    } finally {
      if (token === operationToken && file === selectedFile) {
        controller = null;
        processing = false;
        cancelButton.hidden = true;
        refreshAiAvailability({ updateStatus: false });
      }
    }
  }

  localButton.addEventListener("click", extractLocal);
  analyzeButton.addEventListener("click", analyze);
  $("#pdf-ai-reanalyze", ui.dialog).addEventListener("click", () => {
    if (extractionContext.mode === "local") extractLocal();
    else analyze();
  });
  cancelButton.addEventListener("click", () => controller?.abort());

  for (const selector of ["#pdf-review-title", "#pdf-review-year", "#pdf-review-doi", "#pdf-review-arxiv"]) {
    $(selector, ui.dialog).addEventListener("change", () => updateDuplicateHint(ui, selectedFile, extractionContext));
  }

  $("#pdf-ai-save", ui.dialog).addEventListener("click", async () => {
    if (!selectedFile || processing) return;
    const file = selectedFile;
    const saveButton = $("#pdf-ai-save", ui.dialog);
    saveButton.disabled = true;
    try {
      const { library, existing, incoming } = await updateDuplicateHint(ui, file, extractionContext);
      if (file !== selectedFile) return;
      if (!incoming.title) throw new Error("Title is required before saving.");

      const topicResult = reviewedTopics(ui, library);
      incoming.topics = topicResult.ids;
      const paper = existing ? mergePaperRecords(existing, incoming) : incoming;
      if (existing) paper.id = existing.id;

      await Promise.all([
        putPapers([paper]),
        putTopics(topicResult.topics),
      ]);

      batchSavedCount += 1;
      const savedName = file.name;
      if (queueIndex + 1 < fileQueue.length) {
        saveButton.disabled = false;
        advanceQueue(`${existing ? "Merged" : "Saved"} ${savedName}.`);
      } else {
        finishQueue(existing ? "Reviewed PDF data merged into the existing paper." : "Reviewed PDF paper saved locally.");
      }
    } catch (error) {
      analysisStatus.textContent = error.message || String(error);
      setGlobalStatus(error.message || String(error), "error");
      saveButton.disabled = false;
    }
  });
}

if (typeof document !== "undefined") init();
