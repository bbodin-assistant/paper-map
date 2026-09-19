import { loadLibrary, putPapers, putTopics } from "./db.js";
import { mergePaperRecords, normalizeDoi, normalizedTitle, paperIdentityKey } from "./import-export.js";
import { MAX_INLINE_PDF_BYTES, slugTopic } from "./pdf-ai.js";
import { analyzePdfWithAi } from "./ai-provider.js";
import { loadAiConfig, providerLabel, providerNeedsApiKey, providerUsesDirectPdf } from "./ai-config.js";
import { aiConfigSnapshot } from "./ai-config-ui.js?v=0.4.10";
import { extractPdfCitationsLocally } from "./pdf-local.js";
import { fetchReferences as fetchOnlineReferences, fetchReferencesWithProvider, resolvePaper as resolveOnlinePaper } from "./paper-provider.js?v=0.4.11";
import { mergeReferenceRecords, providerPapersToReferences } from "./provider-references.js?v=0.4.5";
import { loadPaperProviderConfig, paperProviderLabel } from "./paper-provider-config.js?v=0.4.11";
import { paperCandidateSearchTotals, startPaperCandidateSearch } from "./paper-candidate-search.js?v=0.4.11";
import { renderPaperCandidatePicker } from "./paper-candidate-ui.js?v=0.4.11";
import { pdfReviewLookupState, pdfReviewOnlineQuery } from "./pdf-review-state.js";
import { applyMergedMetadataToDraft, mergeReviewMetadataSources, reviewedPaperIdentity } from "./pdf-review-merge.js?v=0.4.5";
import { authorsFromTextarea, commaList, createPdfReviewUi, referenceKey, referenceRow, topicRow } from "./pdf-review-ui.js?v=0.4.11";

const $ = (selector, root = document) => root.querySelector(selector);
const LOCAL_EXTRACTION_CONCURRENCY = 2;
const LOOKUP_FIELD_SELECTORS = Object.freeze({
  title: "#pdf-review-title",
  authors: "#pdf-review-authors",
  year: "#pdf-review-year",
  doi: "#pdf-review-doi",
  arxivId: "#pdf-review-arxiv",
});

function clean(value) { return String(value ?? "").trim(); }
function fileStem(name) { return clean(name).replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled paper"; }
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
function setGlobalStatus(message, tone = "ready") {
  const status = $("#library-status");
  const text = $("#library-status-text");
  if (status) status.className = `status ${tone}`;
  if (text) text.textContent = message;
}
function emptyDraft(file) {
  return {
    title: fileStem(file?.name), authors: [], year: null, type: "article", venue: "", doi: "",
    semanticScholarId: "", openAlexId: "", arxivId: "", url: "", abstract: "", citationCount: null,
    keywords: [], topics: [], references: [], warnings: [], metadataSources: [], providerPrimary: "",
    localExtraction: null, aiTransport: null,
  };
}
function createReviewItem(file) {
  return {
    id: `pdf-review:${crypto.randomUUID()}`, file, sources: { local: null, ai: null, online: null },
    draft: emptyDraft(file), dirtyFields: new Set(), status: { local: "queued", ai: "idle", online: "idle" },
    errors: { local: "", ai: "", online: "" }, aiContext: null, onlineContext: null,
    onlineCandidates: [], onlineCandidateStates: [], onlineCandidateQuery: "", onlineSearchSession: null,
    networkController: null, localToken: 0, networkToken: 0,
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
function preserveReferenceSelections(previous = [], incoming = []) {
  const previousByKey = new Map(previous.map((reference) => [referenceKey(reference), reference]));
  return incoming.map((reference) => {
    const prior = previousByKey.get(referenceKey(reference));
    return { ...structuredClone(reference), use: prior ? prior.use !== false : true, ...(prior?.resolution ? { resolution: structuredClone(prior.resolution) } : {}) };
  });
}

export function initPdfReviewController() {
  const ui = createPdfReviewUi();
  if (!ui) return false;

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
  const localButton = $("#pdf-local-extract", ui.dialog);
  const titleSearchButton = $("#pdf-online-search-title", ui.dialog);
  const doiSearchButton = $("#pdf-online-search-doi", ui.dialog);
  const arxivSearchButton = $("#pdf-online-search-arxiv", ui.dialog);
  const skipButton = $("#pdf-ai-skip-file", ui.dialog);
  const cancelButton = $("#pdf-ai-cancel-analysis", ui.dialog);
  const saveButton = $("#pdf-ai-save", ui.dialog);
  const openFileButton = $("#pdf-ai-open-file", ui.dialog);
  const onlineCandidateList = $("#pdf-online-candidate-list", ui.dialog);
  const fieldMap = new Map([
    ["#pdf-review-title", "title"], ["#pdf-review-authors", "authors"], ["#pdf-review-year", "year"],
    ["#pdf-review-type", "type"], ["#pdf-review-venue", "venue"], ["#pdf-review-doi", "doi"],
    ["#pdf-review-arxiv", "arxivId"], ["#pdf-review-url", "url"], ["#pdf-review-abstract", "abstract"],
    ["#pdf-review-keywords", "keywords"],
  ]);

  function activeItem() { return items.find((item) => item.id === activeId) || null; }
  function captureTopics() {
    return Array.from(ui.dialog.querySelectorAll(".pdf-ai-topic-row")).map((row) => ({
      name: clean($("[data-topic-name]", row).value), description: clean($("[data-topic-description]", row).value),
      confidence: Math.max(0, Math.min(1, Number(clean($("[data-topic-confidence]", row).textContent).replace("%", "")) / 100 || 0)),
      source: row.dataset.topicSource || "manual", use: $("[data-topic-use]", row).checked,
    })).filter((topic) => topic.name);
  }
  function captureReferences() {
    return Array.from(ui.dialog.querySelectorAll(".pdf-reference-row")).map((row) => ({
      ...structuredClone(row.__paperMapReference || {}), use: $("[data-reference-use]", row)?.checked !== false,
    }));
  }
  function captureActive() {
    const item = activeItem();
    if (!item) return null;
    item.draft = {
      ...item.draft,
      title: clean($("#pdf-review-title", ui.dialog).value),
      authors: authorsFromTextarea($("#pdf-review-authors", ui.dialog).value),
      year: Number.isInteger(Number($("#pdf-review-year", ui.dialog).value)) && Number($("#pdf-review-year", ui.dialog).value) > 0 ? Number($("#pdf-review-year", ui.dialog).value) : null,
      type: clean($("#pdf-review-type", ui.dialog).value), venue: clean($("#pdf-review-venue", ui.dialog).value),
      doi: normalizeDoi($("#pdf-review-doi", ui.dialog).value), arxivId: clean($("#pdf-review-arxiv", ui.dialog).value).replace(/^arxiv:\s*/i, ""),
      url: clean($("#pdf-review-url", ui.dialog).value), abstract: clean($("#pdf-review-abstract", ui.dialog).value),
      keywords: commaList($("#pdf-review-keywords", ui.dialog).value), topics: captureTopics(), references: captureReferences(),
    };
    return item;
  }
  function lookupState(item) {
    return pdfReviewLookupState({ ...item.draft, fileName: item.file.name, localStatus: item.status.local, onlineStatus: item.status.online });
  }
  function networkBusy(item) { return item.status.ai === "running" || item.status.online === "running"; }
  function statusLabel(status) {
    if (status === "complete") return "ready";
    if (status === "candidates") return "choose match";
    if (status === "running" || status === "queued") return "working";
    if (status === "error") return "failed";
    return "not run";
  }
  function renderSourceStatus(item) {
    const provider = loadPaperProviderConfig();
    const selectedProvider = item.onlineContext?.provider;
    const onlineName = selectedProvider
      ? `Online (${paperProviderLabel(selectedProvider)})`
      : item.onlineCandidateStates.length
        ? "Online search"
        : `Online (${paperProviderLabel(provider.provider)})`;
    sourceStatus.innerHTML = `<span class="pdf-source-chip ${item.status.local}">Local: ${statusLabel(item.status.local)}</span><span class="pdf-source-chip ${item.status.ai}">AI: ${statusLabel(item.status.ai)}</span><span class="pdf-source-chip ${item.status.online}">${onlineName}: ${statusLabel(item.status.online)}</span>`;
  }
  function renderTabs() {
    tabs.replaceChildren(...items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "tab";
      button.dataset.pdfTabId = item.id;
      button.dataset.localStatus = item.status.local;
      const outcome = lookupState(item).tab;
      button.dataset.reviewStatus = outcome;
      button.className = `${item.id === activeId ? "selected " : ""}${outcome}`.trim();
      button.setAttribute("aria-selected", String(item.id === activeId));
      button.title = item.file.name;
      const symbol = outcome === "resolved" ? "✓" : outcome === "searchable" ? "?" : outcome === "error" ? "!" : "…";
      button.textContent = `${symbol} ${item.file.name}`;
      return button;
    }));
  }
  function renderLookupFieldStates(item) {
    const state = lookupState(item);
    for (const [key, selector] of Object.entries(LOOKUP_FIELD_SELECTORS)) {
      const field = $(selector, ui.dialog);
      const label = field?.closest("label");
      if (!field || !label) continue;
      const value = state.fields[key] || "neutral";
      label.classList.toggle("lookup-metadata-available", value === "available");
      label.classList.toggle("lookup-metadata-missing", value === "missing");
      label.classList.toggle("lookup-metadata-invalid", value === "invalid");
      field.setAttribute("aria-invalid", String(value === "missing" || value === "invalid"));
    }
  }
  function renderTopics(item) { $("#pdf-ai-topics", ui.dialog).replaceChildren(...(item.draft.topics || []).map(topicRow)); }
  function renderReferences(item) {
    const references = item.draft.references || [];
    const section = $("#pdf-reference-section", ui.dialog);
    $("#pdf-reference-list", ui.dialog).replaceChildren(...references.map(referenceRow));
    section.hidden = references.length === 0;
    $("#pdf-reference-summary", ui.dialog).textContent = `${references.length} merged reference${references.length === 1 ? "" : "s"}`;
  }
  function renderWarnings(item) {
    const warnings = $("#pdf-ai-warnings", ui.dialog);
    warnings.replaceChildren(...(item.draft.warnings || []).map((warning) => {
      const li = document.createElement("li"); li.textContent = warning; return li;
    }));
    $("#pdf-ai-warnings-section", ui.dialog).hidden = warnings.children.length === 0;
  }
  function renderOnlineCandidates(item) {
    const providerStates = item.onlineCandidateStates || [];
    const section = $("#pdf-online-candidates", ui.dialog);
    section.hidden = providerStates.length === 0;
    if (!providerStates.length) {
      onlineCandidateList.replaceChildren();
      $("#pdf-online-candidate-summary", ui.dialog).textContent = "";
      return;
    }
    const totals = paperCandidateSearchTotals(providerStates);
    $("#pdf-online-candidate-summary", ui.dialog).textContent = `${totals.candidates} candidate${totals.candidates === 1 ? "" : "s"} · ${totals.finished}/${totals.providers} providers finished`;
    renderPaperCandidatePicker(onlineCandidateList, {
      query: item.onlineCandidateQuery,
      providerStates,
      totals,
      disabled: networkBusy(item),
      heading: "Choose the matching paper",
      onSelect: (paper, providerId, rank) => selectOnlineCandidate(item, paper, providerId, rank),
    });
  }
  function refreshButtons(item) {
    const config = loadAiConfig();
    const tooLarge = providerUsesDirectPdf(config) && item.file.size > MAX_INLINE_PDF_BYTES;
    const busy = networkBusy(item);
    const searching = Boolean(item.onlineSearchSession);
    localButton.disabled = item.status.local === "running";
    analyzeButton.disabled = busy || searching || tooLarge;
    titleSearchButton.disabled = busy || searching;
    doiSearchButton.disabled = busy || searching;
    arxivSearchButton.disabled = busy || searching;
    cancelButton.hidden = !busy && !searching;
    saveButton.disabled = item.status.local === "queued" || item.status.local === "running" || busy;
    skipButton.disabled = false;
    if (tooLarge && item.status.ai === "idle") analysisStatus.textContent = `${providerLabel(config.provider)} direct PDF input is limited to 25 MB. Local and online extraction remain available.`;
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
    $("#pdf-ai-queue-progress", ui.dialog).textContent = `${items.indexOf(item) + 1} of ${items.length}`;
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
    renderLookupFieldStates(item); renderTopics(item); renderReferences(item); renderWarnings(item); renderOnlineCandidates(item); renderSourceStatus(item); refreshButtons(item); updateDuplicateHint(item);
    if (focus) $("#pdf-review-title", ui.dialog).focus();
  }
  function mergeSources(item) {
    const previousReferences = item.draft.references || [];
    const merged = mergeReviewMetadataSources(item.sources);
    item.draft = applyMergedMetadataToDraft(item.draft, merged, item.dirtyFields);
    item.draft.references = preserveReferenceSelections(previousReferences, merged.references || []);
    if (item.id === activeId) renderActive(); else renderTabs();
  }

  async function runLocal(item) {
    if (!items.includes(item)) return;
    const token = ++item.localToken;
    item.status.local = "running";
    item.errors.local = "";
    if (item.id === activeId) { analysisStatus.textContent = "Parsing PDF layout and detecting bibliography locally…"; renderActive(); } else renderTabs();
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
      if (item.id === activeId) { analysisStatus.textContent = item.errors.local; renderActive(); } else renderTabs();
    }
  }
  function drainLocalQueue() {
    while (localActive < LOCAL_EXTRACTION_CONCURRENCY && localQueue.length) {
      const item = localQueue.shift();
      if (!items.includes(item) || item.status.local === "running") continue;
      localActive += 1;
      runLocal(item).finally(() => {
        localActive -= 1; drainLocalQueue();
        if (localActive === 0 && localQueue.length === 0 && items.length) setGlobalStatus(`Local extraction finished for ${items.length} remaining PDF tab${items.length === 1 ? "" : "s"}.`, "ready");
      });
    }
  }
  function queueLocal(item, { first = false } = {}) {
    if (!items.includes(item)) return;
    item.status.local = "queued";
    localQueue = localQueue.filter((candidate) => candidate !== item);
    if (first) localQueue.unshift(item); else localQueue.push(item);
    renderTabs(); if (item.id === activeId) renderActive(); drainLocalQueue();
  }
  async function runAi(item) {
    if (!items.includes(item) || networkBusy(item)) return;
    captureActive();
    const { config, apiKey } = aiConfigSnapshot();
    if (!config.model) { analysisStatus.textContent = "Configure an AI model in Config before analysis."; return; }
    if (providerNeedsApiKey(config) && !clean(apiKey)) { analysisStatus.textContent = `Configure an API key for ${providerLabel(config.provider)} in Config before analysis.`; return; }
    if (providerUsesDirectPdf(config) && item.file.size > MAX_INLINE_PDF_BYTES) { refreshButtons(item); return; }
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
      item.aiContext = { provider: config.provider, model: config.model, baseUrl: config.baseUrl, transport: metadata.aiTransport || null, extractedAt: new Date().toISOString() };
      item.status.ai = "complete";
      mergeSources(item);
      analysisStatus.textContent = `${providerLabel(config.provider)} AI extraction merged into this tab.`;
    } catch (error) {
      if (!items.includes(item) || token !== item.networkToken) return;
      if (error?.name === "AbortError") { item.status.ai = "idle"; analysisStatus.textContent = "AI extraction cancelled."; }
      else { item.status.ai = "error"; item.errors.ai = error.message || String(error); analysisStatus.textContent = item.errors.ai; }
      renderActive();
    } finally {
      if (items.includes(item) && token === item.networkToken) { item.networkController = null; refreshButtons(item); }
    }
  }

  async function mergeOnlineMetadata(item, metadata, { query, providerId, token, controller, selectedCandidateRank = null }) {
    if (!items.includes(item) || token !== item.networkToken) return;
    const provider = metadata.providerPrimary || metadata.source || providerId;
    let providerReferences = mergeReferenceRecords(metadata.references || []);
    let referenceWarning = "";
    if (providerId !== "crossref") {
      try {
        const referenceResult = providerId === "auto"
          ? await fetchOnlineReferences(metadata, 0, 100, { signal: controller.signal })
          : await fetchReferencesWithProvider(providerId, metadata, 0, 100, { signal: controller.signal });
        providerReferences = mergeReferenceRecords(
          providerReferences,
          providerPapersToReferences(referenceResult.papers || [], referenceResult.provider || provider),
        );
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        referenceWarning = error?.message || String(error);
      }
    }
    if (!items.includes(item) || token !== item.networkToken) return;
    item.sources.online = {
      ...metadata,
      references: providerReferences,
      warnings: referenceWarning ? uniqueStrings([...(metadata.warnings || []), `Online references unavailable: ${referenceWarning}`]) : (metadata.warnings || []),
    };
    item.onlineContext = {
      provider, metadataSources: metadata.metadataSources || [provider], query, referenceCount: providerReferences.length,
      ...(selectedCandidateRank ? { selectedBy: "user", selectedCandidateRank, selectedProvider: providerId, selectedOpenAlexId: clean(metadata.openAlexId) } : {}),
      extractedAt: new Date().toISOString(),
    };
    item.status.online = "complete";
    item.onlineCandidates = [];
    item.onlineCandidateStates = [];
    item.onlineCandidateQuery = "";
    item.onlineSearchSession?.cancel();
    item.onlineSearchSession = null;
    mergeSources(item);
    analysisStatus.textContent = providerReferences.length
      ? `${paperProviderLabel(providerId)} metadata and ${providerReferences.length} provider reference${providerReferences.length === 1 ? "" : "s"} merged into this tab.`
      : referenceWarning ? `${paperProviderLabel(providerId)} metadata merged. Provider references were unavailable: ${referenceWarning}` : `${paperProviderLabel(providerId)} metadata merged into this tab.`;
  }

  async function runOnline(item, kind) {
    if (!items.includes(item) || networkBusy(item) || item.onlineSearchSession) return;
    captureActive();
    let lookup;
    try { lookup = pdfReviewOnlineQuery(item.draft, kind); }
    catch (error) { analysisStatus.textContent = error.message || String(error); renderLookupFieldStates(item); renderTabs(); return; }

    if (lookup.kind === "title") {
      const token = ++item.networkToken;
      item.status.online = "running";
      item.errors.online = "";
      item.onlineCandidates = [];
      item.onlineCandidateStates = [];
      item.onlineCandidateQuery = lookup.query;
      analysisStatus.textContent = "Searching configured paper providers by title…";
      renderActive();

      let session;
      session = startPaperCandidateSearch(lookup.query, {
        onUpdate(snapshot) {
          if (!items.includes(item) || token !== item.networkToken) return;
          if (item.onlineSearchSession && item.onlineSearchSession !== session) return;
          item.onlineCandidateStates = snapshot.providerStates;
          item.onlineCandidates = snapshot.providerStates.flatMap((state) => state.candidates || []);
          const { totals } = snapshot;
          item.status.online = totals.candidates ? "candidates" : (totals.finished < totals.providers ? "running" : "error");
          analysisStatus.textContent = totals.finished < totals.providers
            ? `Searching ${totals.providers} providers… ${totals.candidates} candidate${totals.candidates === 1 ? "" : "s"} available so far.`
            : totals.candidates
              ? `Found ${totals.candidates} candidate${totals.candidates === 1 ? "" : "s"} across ${totals.providers} providers. Choose the matching paper before metadata is merged.`
              : "No title candidates were returned by the enabled providers.";
          renderActive();
        },
      });
      item.onlineSearchSession = session;
      refreshButtons(item);
      session.promise.finally(() => {
        if (!items.includes(item) || token !== item.networkToken || item.onlineSearchSession !== session) return;
        item.onlineSearchSession = null;
        refreshButtons(item);
      });
      return;
    }

    const providerConfig = loadPaperProviderConfig();
    const token = ++item.networkToken;
    const controller = new AbortController();
    item.networkController = controller;
    item.status.online = "running";
    item.errors.online = "";
    item.onlineCandidates = [];
    item.onlineCandidateStates = [];
    item.onlineCandidateQuery = "";
    analysisStatus.textContent = `Resolving ${lookup.kind === "doi" ? "DOI" : "arXiv ID"} with ${paperProviderLabel(providerConfig.provider)}…`;
    renderActive();
    try {
      const metadata = await resolveOnlinePaper(lookup.query, { signal: controller.signal });
      await mergeOnlineMetadata(item, metadata, { query: lookup.query, providerId: providerConfig.provider, token, controller });
    } catch (error) {
      if (!items.includes(item) || token !== item.networkToken) return;
      if (error?.name === "AbortError") { item.status.online = "idle"; analysisStatus.textContent = "Online extraction cancelled."; }
      else { item.status.online = "error"; item.errors.online = error.message || String(error); analysisStatus.textContent = item.errors.online; }
      renderActive();
    } finally {
      if (items.includes(item) && token === item.networkToken) { item.networkController = null; refreshButtons(item); }
    }
  }

  async function selectOnlineCandidate(item, candidate, providerId, selectedCandidateRank) {
    if (!items.includes(item) || networkBusy(item) || !candidate) return;
    const query = item.onlineCandidateQuery || clean(item.draft.title);
    const previousStates = item.onlineCandidateStates;
    const previousCandidates = item.onlineCandidates;
    item.onlineSearchSession?.cancel();
    item.onlineSearchSession = null;
    const token = ++item.networkToken;
    const controller = new AbortController();
    item.networkController = controller;
    item.status.online = "running";
    item.errors.online = "";
    analysisStatus.textContent = `Loading selected ${paperProviderLabel(providerId)} candidate: ${candidate.title}…`;
    renderActive();
    try {
      await mergeOnlineMetadata(item, candidate, { query, providerId, token, controller, selectedCandidateRank });
    } catch (error) {
      if (!items.includes(item) || token !== item.networkToken) return;
      item.onlineCandidateStates = previousStates;
      item.onlineCandidates = previousCandidates;
      item.status.online = "candidates";
      item.errors.online = error?.name === "AbortError" ? "" : (error.message || String(error));
      analysisStatus.textContent = error?.name === "AbortError"
        ? "Selected candidate loading cancelled. Choose a candidate to try again."
        : `Could not load the selected candidate: ${item.errors.online}`;
      renderActive();
    } finally {
      if (items.includes(item) && token === item.networkToken) { item.networkController = null; refreshButtons(item); }
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
      if (existing) { ids.push(existing.id); continue; }
      const source = clean(topic.source) || "reviewed-pdf";
      const namespace = source === "ai" ? "ai" : source === "manual" ? "manual" : "provider";
      const id = `topic:${namespace}:${slugTopic(name) || crypto.randomUUID()}`;
      topics.push({ id, name, description: clean(topic.description), source, confidence: Math.max(0, Math.min(1, Number(topic.confidence) || 0)), createdAt: new Date().toISOString() });
      ids.push(id);
    }
    return { topics, ids: Array.from(new Set(ids)) };
  }
  function paperFromItem(item) {
    const draft = item.draft;
    const reviewedAt = new Date().toISOString();
    const extractedReferences = (draft.references || []).filter((reference) => reference.use !== false).map((reference) => ({ ...structuredClone(reference), reviewed: true }));
    for (const reference of extractedReferences) delete reference.use;
    const metadataSources = uniqueStrings([...(draft.metadataSources || []), ...(item.aiContext ? [`ai:${item.aiContext.provider}`] : []), ...(item.onlineContext?.metadataSources || [])]);
    const paper = {
      id: reviewedPaperIdentity(draft, `local:${crypto.randomUUID()}`), semanticScholarId: clean(draft.semanticScholarId), openAlexId: clean(draft.openAlexId),
      doi: normalizeDoi(draft.doi), arxivId: clean(draft.arxivId), title: clean(draft.title), authors: Array.isArray(draft.authors) ? draft.authors : [],
      year: Number.isInteger(Number(draft.year)) && Number(draft.year) > 0 ? Number(draft.year) : null, venue: clean(draft.venue), type: clean(draft.type) || "article",
      url: clean(draft.url), pdfUrl: "", abstract: clean(draft.abstract), keywords: uniqueStrings(draft.keywords || []), topics: [], tags: [], notes: "",
      status: "unread", relevance: 3, starred: false, citationCount: Number.isFinite(Number(draft.citationCount)) ? Number(draft.citationCount) : null,
      source: "reviewed-pdf", sourceFileName: item.file.name, metadataSources, extractedReferences,
      pdfExtraction: draft.localExtraction ? { provider: "rust-wasm", engine: draft.localExtraction.engine || "paper-map-rust-pdf", layout: draft.localExtraction.layout || null, reviewedAt } : null,
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
    item.localToken += 1; item.networkToken += 1; item.networkController?.abort(); item.onlineSearchSession?.cancel(); item.onlineSearchSession = null; item.networkController = null;
    localQueue = localQueue.filter((candidate) => candidate !== item);
    const index = items.indexOf(item);
    items = items.filter((candidate) => candidate !== item);
    if (skipped) skippedCount += 1;
    if (!items.length) {
      activeId = null; ui.dialog.close();
      const summary = `${savedCount} saved, ${skippedCount} skipped.`;
      setGlobalStatus(message ? `${message} ${summary}` : `PDF review complete: ${summary}`, "ready");
      if (savedCount) window.location.reload();
      return;
    }
    activeId = items[Math.min(Math.max(index, 0), items.length - 1)].id;
    analysisStatus.textContent = message;
    renderActive();
  }
  function closeRemaining() {
    for (const item of items) { item.localToken += 1; item.networkToken += 1; item.networkController?.abort(); item.onlineSearchSession?.cancel(); }
    const discarded = items.length;
    localQueue = []; items = []; activeId = null; ui.dialog.close();
    setGlobalStatus(`PDF review closed: ${savedCount} saved, ${skippedCount} skipped, ${discarded} remaining discarded.`, "ready");
    if (savedCount) window.location.reload();
  }
  function closeOutstandingWithoutClosing() {
    for (const item of items) { item.localToken += 1; item.networkToken += 1; item.networkController?.abort(); item.onlineSearchSession?.cancel(); }
    localQueue = []; items = []; activeId = null;
  }

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-pdf-tab-id]");
    if (!button || button.dataset.pdfTabId === activeId) return;
    captureActive(); activeId = button.dataset.pdfTabId; analysisStatus.textContent = ""; renderActive();
  });
  ui.button.addEventListener("click", () => ui.input.click());
  ui.input.addEventListener("change", () => {
    const files = Array.from(ui.input.files || []);
    ui.input.value = "";
    if (!files.length) return;
    const pdfFiles = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    const rejectedCount = files.length - pdfFiles.length;
    if (!pdfFiles.length) { setGlobalStatus("PDF import requires .pdf files.", "error"); return; }
    closeOutstandingWithoutClosing();
    items = pdfFiles.map(createReviewItem); activeId = items[0].id; savedCount = 0; skippedCount = 0;
    analysisStatus.textContent = "Local extraction queued for every selected PDF.";
    if (!ui.dialog.open) ui.dialog.showModal();
    renderActive();
    for (const item of items) queueLocal(item);
    setGlobalStatus(rejectedCount ? `${rejectedCount} non-PDF file${rejectedCount === 1 ? " was" : "s were"} ignored. Local extraction started for ${items.length} PDFs.` : `Local extraction started for ${items.length} PDF${items.length === 1 ? "" : "s"}.`, "loading");
  });
  $("#pdf-ai-close", ui.dialog).addEventListener("click", closeRemaining);
  $("#pdf-ai-discard", ui.dialog).addEventListener("click", closeRemaining);
  ui.dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeRemaining(); });
  openFileButton.addEventListener("click", () => {
    const item = activeItem(); if (!item?.file) return;
    const url = URL.createObjectURL(item.file); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  localButton.addEventListener("click", () => { const item = captureActive(); if (item) queueLocal(item, { first: true }); });
  analyzeButton.addEventListener("click", () => { const item = activeItem(); if (item) runAi(item); });
  titleSearchButton.addEventListener("click", () => { const item = activeItem(); if (item) runOnline(item, "title"); });
  doiSearchButton.addEventListener("click", () => { const item = activeItem(); if (item) runOnline(item, "doi"); });
  arxivSearchButton.addEventListener("click", () => { const item = activeItem(); if (item) runOnline(item, "arxiv"); });
  cancelButton.addEventListener("click", () => {
    const item = activeItem();
    if (!item) return;
    item.networkController?.abort();
    if (item.onlineSearchSession) {
      item.onlineSearchSession.cancel();
      item.onlineSearchSession = null;
      item.status.online = item.onlineCandidates.length ? "candidates" : "idle";
      analysisStatus.textContent = "Online title search cancelled.";
      renderActive();
    }
  });
  skipButton.addEventListener("click", () => { const item = activeItem(); if (item) removeItem(item, { skipped: true, message: `Skipped ${item.file.name}.` }); });

  for (const [selector, field] of fieldMap) {
    const input = $(selector, ui.dialog);
    input.addEventListener("input", () => {
      const item = activeItem(); if (!item) return;
      item.dirtyFields.add(field);
      if (["title", "doi", "arxivId"].includes(field) && (item.onlineCandidates.length || item.onlineSearchSession)) {
        item.onlineSearchSession?.cancel(); item.onlineSearchSession = null;
        item.onlineCandidates = []; item.onlineCandidateStates = []; item.onlineCandidateQuery = "";
        if (item.status.online === "candidates" || item.status.online === "running") item.status.online = "idle";
        renderOnlineCandidates(item); renderSourceStatus(item); refreshButtons(item);
      }
    });
    input.addEventListener("change", () => {
      const item = captureActive(); if (!item) return;
      if (["title", "year", "doi", "arxivId"].includes(field)) updateDuplicateHint(item);
      if (["title", "authors", "year", "doi", "arxivId"].includes(field)) { renderLookupFieldStates(item); renderTabs(); }
    });
  }
  $("#pdf-ai-add-topic", ui.dialog).addEventListener("click", () => {
    const item = captureActive(); if (!item) return;
    item.dirtyFields.add("topics"); item.draft.topics.push({ name: "", description: "", confidence: 1, source: "manual", use: true });
    renderTopics(item); $("#pdf-ai-topics [data-topic-name]:last-of-type", ui.dialog)?.focus();
  });
  $("#pdf-ai-topics", ui.dialog).addEventListener("input", () => activeItem()?.dirtyFields.add("topics"));
  $("#pdf-ai-topics", ui.dialog).addEventListener("change", () => activeItem()?.dirtyFields.add("topics"));
  $("#pdf-ai-topics", ui.dialog).addEventListener("click", (event) => {
    const remove = event.target.closest("[data-topic-remove]"); if (!remove) return;
    const item = activeItem(); if (!item) return;
    item.dirtyFields.add("topics"); remove.closest(".pdf-ai-topic-row")?.remove(); item.draft.topics = captureTopics();
  });
  $("#pdf-reference-list", ui.dialog).addEventListener("change", () => { const item = activeItem(); if (item) item.draft.references = captureReferences(); });
  $("#pdf-reference-accept-all", ui.dialog).addEventListener("click", () => { for (const checkbox of ui.dialog.querySelectorAll("[data-reference-use]")) checkbox.checked = true; const item = activeItem(); if (item) item.draft.references = captureReferences(); });
  $("#pdf-reference-reject-all", ui.dialog).addEventListener("click", () => { for (const checkbox of ui.dialog.querySelectorAll("[data-reference-use]")) checkbox.checked = false; const item = activeItem(); if (item) item.draft.references = captureReferences(); });

  saveButton.addEventListener("click", async () => {
    const item = captureActive(); if (!item || saveButton.disabled) return;
    saveButton.disabled = true;
    try {
      if (!clean(item.draft.title)) throw new Error("Title is required before saving.");
      const library = await loadLibrary();
      const incoming = paperFromItem(item);
      const existing = matchingPaper(library, incoming);
      const topics = topicResult(item, library);
      incoming.topics = topics.ids;
      incoming.libraryEntry = existing ? undefined : { method: "reviewed-pdf", addedAt: incoming.importedAt, fileName: item.file.name, detail: uniqueStrings(incoming.metadataSources).join(", "), parentPaperId: "" };
      let paper = existing ? mergePaperRecords(existing, incoming) : incoming;
      if (existing) {
        paper = { ...paper, id: existing.id, source: existing.source || paper.source, libraryEntry: existing.libraryEntry || paper.libraryEntry,
          metadataSources: uniqueStrings([...(existing.metadataSources || [existing.source].filter(Boolean)), ...(incoming.metadataSources || [])]),
          extractedReferences: mergeExtractedReferences(existing.extractedReferences || [], incoming.extractedReferences || []) };
      }
      await Promise.all([putPapers([paper]), putTopics(topics.topics)]);
      savedCount += 1;
      removeItem(item, { message: `${existing ? "Merged" : "Saved"} ${item.file.name}.` });
    } catch (error) {
      analysisStatus.textContent = error.message || String(error); setGlobalStatus(error.message || String(error), "error");
      const current = activeItem(); if (current) refreshButtons(current);
    }
  });
  document.addEventListener("paper-map-ai-config-changed", () => { const item = activeItem(); if (item) refreshButtons(item); });
  document.addEventListener("paper-map-paper-provider-config-changed", () => {
    const item = activeItem(); if (!item) return;
    item.onlineSearchSession?.cancel(); item.onlineSearchSession = null;
    item.onlineCandidates = []; item.onlineCandidateStates = []; item.onlineCandidateQuery = "";
    if (item.status.online === "candidates" || item.status.online === "running") item.status.online = "idle";
    renderActive();
  });
  return true;
}
