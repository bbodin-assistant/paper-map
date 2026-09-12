import "./activity-log.js";
import {
  installSourceFilterControl,
  paperEntrySource,
  sourceLabel,
} from "./paper-source.js";
import {
  clearLibrary,
  deleteEdge,
  deletePaper,
  loadLibrary,
  putEdges,
  putPapers,
  putTopics,
  replaceLibrary,
} from "./db.js";
import { createGraph } from "./graph.js";
import {
  downloadText,
  libraryToBibTeX,
  mergePaperRecords,
  normalizeDoi,
  normalizedTitle,
  paperIdentityKey,
  paperToBibTeX,
  parseBibTeX,
  parsePaperMapJson,
  serializeLibrary,
} from "./import-export.js";
import {
  enrichPaper,
  fetchCitations,
  fetchReferences,
  resolvePaper,
} from "./paper-provider.js";
import {
  createResearchRelationEdge,
  isCitationEdge,
  isResearchRelation,
  relationLabel,
  RESEARCH_RELATIONS,
  researchRelationEdgeId,
} from "./research-relations.js";
import { DEMO_LIBRARY } from "./demo-data.js";

const UI_STORAGE_KEY = "paper-map-ui-v1";
const EXPANSION_SIZE = 50;

installSourceFilterControl();

const $ = (selector) => document.querySelector(selector);
const els = {
  status: $("#library-status"),
  statusText: $("#library-status-text"),
  search: $("#global-search"),
  mapMode: $("#map-mode"),
  map: $("#paper-map"),
  visiblePaperCount: $("#visible-paper-count"),
  visibleEdgeCount: $("#visible-edge-count"),
  filterCount: $("#filter-count"),
  yearMin: $("#filter-year-min"),
  yearMax: $("#filter-year-max"),
  author: $("#filter-author"),
  venue: $("#filter-venue"),
  type: $("#filter-type"),
  topic: $("#filter-topic"),
  source: $("#filter-source"),
  starred: $("#filter-starred"),
  clearFilters: $("#clear-filters"),
  activeTopicFilter: $("#active-topic-filter"),
  activeTopicFilterName: $("#active-topic-filter-name"),
  clearTopicFocus: $("#clear-topic-focus"),
  resetView: $("#reset-view"),
  paperListButton: $("#paper-list-button"),
  paperListPanel: $("#paper-list-panel"),
  closePaperList: $("#close-paper-list"),
  paperList: $("#paper-list"),
  addPaperForm: $("#add-paper-form"),
  addPaperQuery: $("#add-paper-query"),
  loadDemo: $("#load-demo"),
  importButton: $("#import-button"),
  importFile: $("#import-file"),
  exportJson: $("#export-json"),
  exportBibtex: $("#export-bibtex"),
  clearLibrary: $("#clear-library"),
  aboutButton: $("#about-button"),
  aboutPanel: $("#about-panel"),
  detail: $("#paper-detail"),
  detailDismiss: $("#detail-dismiss-layer"),
  closeDetail: $("#close-detail"),
  detailKicker: $("#detail-kicker"),
  detailTitle: $("#detail-title"),
  detailMeta: $("#detail-meta"),
  detailAbstract: $("#detail-abstract"),
  detailLinks: $("#detail-links"),
  detailStar: $("#detail-star"),
  detailCopyCitation: $("#detail-copy-citation"),
  detailCopyBibtex: $("#detail-copy-bibtex"),
  detailStatus: $("#detail-status"),
  detailRelevance: $("#detail-relevance"),
  detailRelevanceValue: $("#detail-relevance-value"),
  detailTags: $("#detail-tags"),
  detailTopic: $("#detail-topic"),
  detailNotes: $("#detail-notes"),
  detailCitationCount: $("#detail-citation-count"),
  expandReferences: $("#expand-references"),
  expandCitations: $("#expand-citations"),
  relationType: $("#detail-relation-type"),
  relationTarget: $("#detail-relation-target"),
  addRelation: $("#detail-add-relation"),
  relationList: $("#detail-relations"),
  provenance: $("#detail-provenance"),
  removePaper: $("#remove-paper"),
};

function defaultFilters() {
  return { query: "", yearMin: "", yearMax: "", author: "", venue: "", type: "", topic: "", source: "", starred: false };
}

function loadUiState() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || "{}");
    return {
      mode: saved.mode === "topics" ? "topics" : "citations",
      filters: { ...defaultFilters(), ...(saved.filters || {}) },
    };
  } catch {
    return { mode: "citations", filters: defaultFilters() };
  }
}

const storedUi = loadUiState();
const state = {
  library: { schemaVersion: 1, papers: [], edges: [], topics: [], meta: {} },
  mode: storedUi.mode,
  filters: storedUi.filters,
  selectedPaperId: null,
  selectedTopicId: null,
  expansionOffsets: new Map(),
  busy: false,
};

function saveUiState() {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ mode: state.mode, filters: state.filters }));
  } catch {
    // UI preferences are non-critical.
  }
}

function setStatus(message, tone = "ready") {
  els.status.className = `status ${tone}`;
  els.statusText.textContent = message;
}

function setBusy(isBusy, message = "Working…") {
  state.busy = isBusy;
  if (isBusy) setStatus(message, "loading");
  for (const control of [els.loadDemo, els.importButton, els.exportJson, els.exportBibtex, els.clearLibrary, els.expandReferences, els.expandCitations, els.addRelation]) {
    if (control) control.disabled = isBusy;
  }
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function topicName(topicId) {
  return state.library.topics.find((topic) => topic.id === topicId)?.name || topicId?.replace(/^topic:[^:]+:/, "") || "Uncategorized";
}

function providerTopics(paper) {
  const topics = [];
  const ids = [];
  const providerSource = paper.providerPrimary || paper.source || "provider";
  for (const name of paper.topicNames || []) {
    const id = `topic:provider:${slug(name)}`;
    if (!id.endsWith(":")) {
      ids.push(id);
      topics.push({ id, name, source: providerSource });
    }
  }
  const normalized = { ...paper, topics: Array.from(new Set([...(paper.topics || []), ...ids])) };
  delete normalized.topicNames;
  return { paper: normalized, topics };
}

function titleYearKey(paper) {
  return `${normalizedTitle(paper.title)}:${paper.year || ""}`;
}

function libraryEntryFor(paper, context = {}) {
  if (paper.libraryEntry) return paper.libraryEntry;
  return {
    method: context.method || paper.source || "unknown",
    addedAt: paper.importedAt || paper.createdAt || new Date().toISOString(),
    fileName: context.fileName || paper.sourceFileName || "",
    detail: context.detail || "",
    parentPaperId: context.parentPaperId || "",
  };
}

function mergedMetadataSources(existing, incoming) {
  return Array.from(new Set([
    ...(existing?.metadataSources || [existing?.providerPrimary || existing?.source].filter(Boolean)),
    ...(incoming?.metadataSources || [incoming?.providerPrimary || incoming?.source].filter(Boolean)),
  ]));
}

async function mergeIntoLibrary(incomingPapers = [], incomingEdges = [], incomingTopics = [], context = {}) {
  const existingPapers = state.library.papers;
  const byIdentity = new Map(existingPapers.map((paper) => [paperIdentityKey(paper), paper]));
  const byTitleYear = new Map(existingPapers.map((paper) => [titleYearKey(paper), paper]));
  const idMap = new Map(existingPapers.map((paper) => [paper.id, paper.id]));
  const writes = [];
  let addedCount = 0;

  const topicMap = new Map(state.library.topics.map((topic) => [topic.id, topic]));
  for (const topic of incomingTopics) topicMap.set(topic.id, { ...(topicMap.get(topic.id) || {}), ...topic });

  for (const rawPaper of incomingPapers) {
    const converted = providerTopics(rawPaper);
    for (const topic of converted.topics) topicMap.set(topic.id, { ...(topicMap.get(topic.id) || {}), ...topic });
    const paper = converted.paper;
    const identity = paperIdentityKey(paper);
    const fallback = titleYearKey(paper);
    const existing = byIdentity.get(identity) || byTitleYear.get(fallback);

    if (existing) {
      const merged = {
        ...mergePaperRecords(existing, paper),
        id: existing.id,
        source: existing.source || paper.source,
        libraryEntry: existing.libraryEntry || paper.libraryEntry,
        metadataSources: mergedMetadataSources(existing, paper),
      };
      idMap.set(rawPaper.id, existing.id);
      idMap.set(paper.id, existing.id);
      byIdentity.set(paperIdentityKey(merged), merged);
      byTitleYear.set(titleYearKey(merged), merged);
      writes.push(merged);
    } else {
      let id = paper.id || `local:${crypto.randomUUID()}`;
      if (idMap.has(id)) id = `local:${crypto.randomUUID()}`;
      const created = {
        ...paper,
        id,
        createdAt: paper.createdAt || new Date().toISOString(),
        libraryEntry: libraryEntryFor(paper, context),
      };
      idMap.set(rawPaper.id, id);
      idMap.set(paper.id, id);
      byIdentity.set(paperIdentityKey(created), created);
      byTitleYear.set(titleYearKey(created), created);
      writes.push(created);
      addedCount += 1;
    }
  }

  const existingEdgeIds = new Set(state.library.edges.map((edge) => edge.id));
  const edgeWrites = [];
  for (const edge of incomingEdges) {
    const source = idMap.get(edge.source) || edge.source;
    const target = idMap.get(edge.target) || edge.target;
    if (!source || !target || source === target) continue;
    const research = isResearchRelation(edge);
    const id = research ? researchRelationEdgeId(source, target, edge.relation) : `${source}->${target}`;
    if (existingEdgeIds.has(id)) continue;
    existingEdgeIds.add(id);
    edgeWrites.push({ ...edge, id, source, target, kind: research ? "research-relation" : (edge.kind || "citation") });
  }

  await Promise.all([
    putPapers(writes),
    putTopics(Array.from(topicMap.values())),
    putEdges(edgeWrites),
  ]);
  await refreshLibrary();
  return { idMap, addedCount, edgeCount: edgeWrites.length };
}

function currentPaper() {
  return state.library.papers.find((paper) => paper.id === state.selectedPaperId) || null;
}

function filterValue(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesPaper(paper) {
  const filters = state.filters;
  const query = filterValue(filters.query);
  if (query) {
    const haystack = [
      paper.title,
      ...(paper.authors || []),
      paper.abstract,
      paper.venue,
      paper.type,
      ...(paper.tags || []),
      ...(paper.keywords || []),
      ...(paper.topics || []).map(topicName),
    ].join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  const year = Number(paper.year);
  if (filters.yearMin && (!Number.isFinite(year) || year < Number(filters.yearMin))) return false;
  if (filters.yearMax && (!Number.isFinite(year) || year > Number(filters.yearMax))) return false;
  if (filters.author && !(paper.authors || []).some((author) => filterValue(author).includes(filterValue(filters.author)))) return false;
  if (filters.venue && !filterValue(paper.venue).includes(filterValue(filters.venue))) return false;
  if (filters.type && paper.type !== filters.type) return false;
  if (filters.source && paperEntrySource(paper) !== filters.source) return false;
  if (filters.starred && !paper.starred) return false;

  if (filters.topic) {
    const [kind, value] = filters.topic.split("|", 2);
    if (kind === "topic" && !(paper.topics || []).includes(value)) return false;
    if (kind === "tag" && !(paper.tags || []).includes(value)) return false;
  }

  if (state.selectedTopicId && !(paper.topics || []).includes(state.selectedTopicId)) return false;
  return true;
}

function visibleGraph() {
  const papers = state.library.papers.filter(matchesPaper);
  const ids = new Set(papers.map((paper) => paper.id));
  const edges = state.library.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { papers, edges };
}

function activeFilterCount() {
  return Object.entries(state.filters).filter(([key, value]) => key !== "query" && Boolean(value)).length + (state.filters.query ? 1 : 0);
}

function updateFilterInputs() {
  els.search.value = state.filters.query || "";
  els.yearMin.value = state.filters.yearMin || "";
  els.yearMax.value = state.filters.yearMax || "";
  els.author.value = state.filters.author || "";
  els.venue.value = state.filters.venue || "";
  els.source.value = state.filters.source || "";
  els.starred.checked = Boolean(state.filters.starred);
}

function populateFilterOptions() {
  const typeValue = state.filters.type;
  const types = Array.from(new Set(state.library.papers.map((paper) => paper.type).filter(Boolean))).sort();
  els.type.replaceChildren(new Option("Any type", ""), ...types.map((type) => new Option(type, type)));
  els.type.value = types.includes(typeValue) ? typeValue : "";
  if (typeValue && !types.includes(typeValue)) state.filters.type = "";

  const sourceValue = state.filters.source;
  const sources = Array.from(new Set(state.library.papers.map(paperEntrySource))).sort((left, right) => sourceLabel(left).localeCompare(sourceLabel(right)));
  els.source.replaceChildren(new Option("Any entry source", ""), ...sources.map((source) => new Option(sourceLabel(source), source)));
  els.source.value = sources.includes(sourceValue) ? sourceValue : "";
  if (sourceValue && !sources.includes(sourceValue)) state.filters.source = "";

  const topicValue = state.filters.topic;
  const options = [new Option("Any topic or tag", "")];
  const topics = [...state.library.topics].sort((left, right) => left.name.localeCompare(right.name));
  if (topics.length) {
    const group = document.createElement("optgroup");
    group.label = "Topics";
    for (const topic of topics) group.append(new Option(topic.name, `topic|${topic.id}`));
    options.push(group);
  }
  const tags = Array.from(new Set(state.library.papers.flatMap((paper) => paper.tags || []))).sort();
  if (tags.length) {
    const group = document.createElement("optgroup");
    group.label = "Tags";
    for (const tag of tags) group.append(new Option(tag, `tag|${tag}`));
    options.push(group);
  }
  els.topic.replaceChildren(...options);
  els.topic.value = topicValue;
  if (els.topic.value !== topicValue) state.filters.topic = "";
}

function renderPaperList(papers) {
  const selectedId = state.selectedPaperId;
  const sorted = [...papers].sort((left, right) => (Number(right.year) || 0) - (Number(left.year) || 0) || left.title.localeCompare(right.title));
  if (!sorted.length) {
    els.paperList.innerHTML = '<div class="paper-list-empty">No papers match the current view.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const paper of sorted) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.paperId = paper.id;
    button.className = `paper-list-item${paper.id === selectedId ? " selected" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `${paper.starred ? "★ " : ""}${paper.title}`;
    const meta = document.createElement("span");
    meta.textContent = [(paper.authors || [])[0], paper.year, paper.venue].filter(Boolean).join(" · ");
    button.append(title, meta);
    button.addEventListener("click", () => selectPaper(paper.id));
    fragment.append(button);
  }
  els.paperList.replaceChildren(fragment);
}

function renderModeButtons() {
  for (const button of els.mapMode.querySelectorAll("button[data-mode]")) {
    const selected = button.dataset.mode === state.mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function renderAll() {
  const { papers, edges } = visibleGraph();
  els.visiblePaperCount.textContent = String(papers.length);
  els.visibleEdgeCount.textContent = String(edges.length);
  const count = activeFilterCount();
  els.filterCount.hidden = count === 0;
  els.filterCount.textContent = String(count);

  els.activeTopicFilter.hidden = !state.selectedTopicId;
  if (state.selectedTopicId) els.activeTopicFilterName.textContent = topicName(state.selectedTopicId);

  renderModeButtons();
  renderPaperList(papers);
  graph.render({
    mode: state.mode,
    papers,
    edges,
    topics: state.library.topics,
    selectedId: state.selectedPaperId,
    selectedTopicId: state.selectedTopicId,
  });

  if (state.selectedPaperId) renderDetail();
}

async function migrateLegacyReadingStates(library) {
  const legacy = library.papers.filter((paper) => paper.status === "key");
  if (!legacy.length) return library;
  const replacements = legacy.map((paper) => ({ ...paper, status: "read", updatedAt: new Date().toISOString() }));
  await putPapers(replacements);
  const byId = new Map(replacements.map((paper) => [paper.id, paper]));
  return { ...library, papers: library.papers.map((paper) => byId.get(paper.id) || paper) };
}

async function refreshLibrary() {
  state.library = await migrateLegacyReadingStates(await loadLibrary());
  populateFilterOptions();
  renderAll();
  setStatus(`${state.library.papers.length} papers · ${state.library.edges.length} directed links stored locally`, "ready");
}

function formattedCitation(paper) {
  const authors = (paper.authors || []).join(", ") || "Unknown author";
  return `${authors} (${paper.year || "n.d."}). ${paper.title}.${paper.venue ? ` ${paper.venue}.` : ""}${paper.doi ? ` https://doi.org/${paper.doi}` : ""}`;
}

function linkButton(label, href) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = `${label} ↗`;
  return anchor;
}

function fillDetailTopicSelect(paper) {
  const options = [new Option("Uncategorized", "")];
  for (const topic of [...state.library.topics].sort((a, b) => a.name.localeCompare(b.name))) {
    options.push(new Option(topic.name, topic.id));
  }
  options.push(new Option("+ New manual topic…", "__new__"));
  els.detailTopic.replaceChildren(...options);
  els.detailTopic.value = paper.topics?.[0] || "";
}

function fillRelationControls(paper) {
  if (!els.relationType.options.length) {
    els.relationType.replaceChildren(...RESEARCH_RELATIONS.map((relation) => new Option(relation.label, relation.id)));
  }
  const previous = els.relationTarget.value;
  const otherPapers = state.library.papers
    .filter((candidate) => candidate.id !== paper.id)
    .sort((left, right) => left.title.localeCompare(right.title));
  els.relationTarget.replaceChildren(
    new Option(otherPapers.length ? "Select another paper…" : "Add another paper first", ""),
    ...otherPapers.map((candidate) => new Option(`${candidate.title}${candidate.year ? ` (${candidate.year})` : ""}`, candidate.id)),
  );
  if (otherPapers.some((candidate) => candidate.id === previous)) els.relationTarget.value = previous;
  els.addRelation.disabled = state.busy || !otherPapers.length;
}

function researchRelationsFor(paperId) {
  return state.library.edges.filter((edge) => isResearchRelation(edge) && (edge.source === paperId || edge.target === paperId));
}

function renderResearchRelations(paper) {
  const relations = researchRelationsFor(paper.id);
  if (!relations.length) {
    const empty = document.createElement("p");
    empty.className = "relation-empty";
    empty.textContent = "No semantic research relationships recorded yet.";
    els.relationList.replaceChildren(empty);
    return;
  }

  const paperById = new Map(state.library.papers.map((item) => [item.id, item]));
  const fragment = document.createDocumentFragment();
  for (const edge of relations.sort((left, right) => left.relation.localeCompare(right.relation))) {
    const outgoing = edge.source === paper.id;
    const otherId = outgoing ? edge.target : edge.source;
    const other = paperById.get(otherId);
    if (!other) continue;

    const row = document.createElement("div");
    row.className = "research-relation-row";
    row.dataset.edgeId = edge.id;

    const direction = document.createElement("span");
    direction.className = `relation-direction ${outgoing ? "outgoing" : "incoming"}`;
    direction.textContent = outgoing ? "OUT" : "IN";

    const body = document.createElement("div");
    body.className = "relation-body";
    const label = document.createElement("strong");
    label.textContent = relationLabel(edge.relation, { inverse: !outgoing });
    const paperButton = document.createElement("button");
    paperButton.type = "button";
    paperButton.className = "relation-paper-link";
    paperButton.dataset.paperId = other.id;
    paperButton.textContent = other.title;
    const meta = document.createElement("small");
    meta.textContent = [other.year, other.venue, edge.provenance ? `source: ${edge.provenance}` : ""].filter(Boolean).join(" · ");
    body.append(label, paperButton, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "relation-remove quiet-button";
    remove.dataset.edgeId = edge.id;
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${label.textContent} relationship`);

    row.append(direction, body, remove);
    fragment.append(row);
  }
  els.relationList.replaceChildren(fragment);
}

function provenanceMethodLabel(value) {
  return sourceLabel(value);
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderProvenance(paper) {
  const entry = paper.libraryEntry || {};
  const method = entry.method || paper.source || "unknown";
  const addedAt = entry.addedAt || paper.importedAt || paper.createdAt;
  const fileName = entry.fileName || paper.sourceFileName || "";
  const rows = [
    ["Added via", provenanceMethodLabel(method)],
    ["Added", formatTimestamp(addedAt)],
    ["Original source", paper.source ? provenanceMethodLabel(paper.source) : ""],
    ["Source file", fileName],
    ["Lookup", entry.detail || ""],
    ["Expanded from", entry.parentPaperId ? state.library.papers.find((item) => item.id === entry.parentPaperId)?.title || entry.parentPaperId : ""],
    ["PDF extraction", paper.pdfExtraction?.provider ? `${paper.pdfExtraction.provider}${paper.pdfExtraction.engine ? ` · ${paper.pdfExtraction.engine}` : ""}` : ""],
    ["AI extraction", paper.aiExtraction?.provider ? `${paper.aiExtraction.provider}${paper.aiExtraction.model ? ` · ${paper.aiExtraction.model}` : ""}` : ""],
    ["Online extraction", paper.onlineExtraction?.provider ? `${paper.onlineExtraction.provider}${paper.onlineExtraction.metadataSources?.length > 1 ? ` · merged ${paper.onlineExtraction.metadataSources.join(", ")}` : ""}` : ""],
    ["Metadata sources", paper.metadataSources?.length ? paper.metadataSources.join(", ") : ""],
    ["Last enriched", formatTimestamp(paper.enrichedAt)],
  ].filter(([, value]) => Boolean(value));

  const fragment = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    item.append(term, description);
    fragment.append(item);
  }
  els.provenance.replaceChildren(fragment);
}

function renderDetail() {
  const paper = currentPaper();
  if (!paper) {
    closeDetail();
    return;
  }

  els.detail.hidden = false;
  els.detailDismiss.hidden = true;
  els.detailKicker.textContent = paper.source === "demo" ? "Demo paper" : "Paper";
  els.detailTitle.textContent = paper.title;
  els.detailMeta.textContent = [
    (paper.authors || []).join(", "),
    paper.year,
    paper.venue,
    paper.type,
  ].filter(Boolean).join(" · ");
  els.detailAbstract.textContent = paper.abstract || "No abstract stored locally.";
  els.detailStar.textContent = paper.starred ? "★ Starred" : "☆ Star";
  els.detailStatus.value = ["unread", "reading", "read"].includes(paper.status) ? paper.status : "unread";
  els.detailRelevance.value = String(Number(paper.relevance || 3));
  els.detailRelevanceValue.textContent = `${els.detailRelevance.value} / 5`;
  els.detailTags.value = (paper.tags || []).join(", ");
  els.detailNotes.value = paper.notes || "";
  fillDetailTopicSelect(paper);
  fillRelationControls(paper);
  renderResearchRelations(paper);
  renderProvenance(paper);

  const links = [];
  if (paper.doi) links.push(linkButton("DOI", `https://doi.org/${normalizeDoi(paper.doi)}`));
  if (paper.url) links.push(linkButton("Source", paper.url));
  if (paper.pdfUrl) links.push(linkButton("PDF", paper.pdfUrl));
  if (paper.arxivId) links.push(linkButton("arXiv", `https://arxiv.org/abs/${paper.arxivId}`));
  els.detailLinks.replaceChildren(...links);

  const citationEdges = state.library.edges.filter(isCitationEdge);
  const localReferences = citationEdges.filter((edge) => edge.source === paper.id).length;
  const localCitations = citationEdges.filter((edge) => edge.target === paper.id).length;
  const semanticLinks = researchRelationsFor(paper.id).length;
  const snapshot = Number.isFinite(Number(paper.citationCount)) ? `${paper.citationCount} provider citations · ` : "";
  els.detailCitationCount.textContent = `${snapshot}${localReferences} refs / ${localCitations} citing stored · ${semanticLinks} research link${semanticLinks === 1 ? "" : "s"}`;
}

function timelineViewActive() {
  return Boolean(
    els.map.querySelector(".timeline-papers")
    && els.mapMode.querySelector('button[data-mode="timeline"].selected'),
  );
}

function renderTimelinePaperSelection() {
  for (const button of els.paperList.querySelectorAll(".paper-list-item[data-paper-id]")) {
    button.classList.toggle("selected", button.dataset.paperId === state.selectedPaperId);
  }
  if (state.selectedPaperId) renderDetail();
  else {
    els.detail.hidden = true;
    els.detailDismiss.hidden = true;
  }
}

function selectPaper(paperId) {
  state.selectedPaperId = paperId;
  if (timelineViewActive()) {
    renderTimelinePaperSelection();
    return;
  }
  if (!paperId) {
    closeDetail();
    renderAll();
    return;
  }
  renderAll();
}

function closeDetail() {
  state.selectedPaperId = null;
  els.detail.hidden = true;
  els.detailDismiss.hidden = true;
}

async function saveSelectedPaperPatch(patch) {
  const paper = currentPaper();
  if (!paper) return;
  const updated = { ...paper, ...patch, updatedAt: new Date().toISOString() };
  await putPapers([updated]);
  state.library.papers = state.library.papers.map((item) => item.id === updated.id ? updated : item);
  populateFilterOptions();
  renderAll();
}

async function ensureExpandablePaper() {
  let paper = currentPaper();
  if (!paper) throw new Error("Select a paper first.");
  if (paper.doi || paper.semanticScholarId || paper.openAlexId || paper.arxivId) return paper;

  setStatus("Resolving this paper before citation expansion…", "loading");
  const enriched = await enrichPaper(paper);
  const provider = enriched.providerPrimary || enriched.source || "paper-provider";
  const result = await mergeIntoLibrary([enriched], [], [], { method: `${provider}-enrichment` });
  const canonicalId = result.idMap.get(enriched.id) || paper.id;
  state.selectedPaperId = canonicalId;
  paper = state.library.papers.find((item) => item.id === canonicalId) || paper;
  return paper;
}

async function expand(direction) {
  if (state.busy) return;
  const selectedBefore = state.selectedPaperId;
  if (!selectedBefore) return;
  const offsetKey = `${selectedBefore}:${direction}`;
  const savedOffset = state.expansionOffsets.get(offsetKey) ?? 0;
  if (savedOffset === -1) {
    setStatus(`No more ${direction} reported for this paper.`, "ready");
    return;
  }

  try {
    setBusy(true, direction === "references" ? "Fetching references…" : "Fetching citing papers…");
    const paper = await ensureExpandablePaper();
    const result = direction === "references"
      ? await fetchReferences(paper, savedOffset, EXPANSION_SIZE)
      : await fetchCitations(paper, savedOffset, EXPANSION_SIZE);
    const provider = result.provider || "paper-provider";

    const relationshipEdges = result.papers.map((related) => direction === "references"
      ? { source: paper.id, target: related.id, kind: "citation", provenance: provider }
      : { source: related.id, target: paper.id, kind: "citation", provenance: provider });
    const merged = await mergeIntoLibrary(result.papers, relationshipEdges, [], {
      method: `${provider}-expansion`,
      detail: direction,
      parentPaperId: paper.id,
    });
    state.expansionOffsets.set(offsetKey, result.next ?? -1);
    state.selectedPaperId = paper.id;
    renderAll();
    setStatus(`Added ${merged.addedCount} papers and ${merged.edgeCount} directed citation links from ${direction} via ${sourceLabel(provider)}.`, "ready");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

const graph = createGraph({
  svg: els.map,
  onSelectPaper: (paperId) => {
    if (paperId) selectPaper(paperId);
    else if (state.selectedPaperId) {
      closeDetail();
      renderAll();
    }
  },
  onSelectTopic: (topicId) => {
    state.selectedTopicId = state.selectedTopicId === topicId ? null : topicId;
    renderAll();
  },
});

function updateFilterFromInputs() {
  state.filters = {
    query: els.search.value,
    yearMin: els.yearMin.value,
    yearMax: els.yearMax.value,
    author: els.author.value,
    venue: els.venue.value,
    type: els.type.value,
    topic: els.topic.value,
    source: els.source.value,
    starred: els.starred.checked,
  };
  saveUiState();
  renderAll();
}

for (const input of [els.search, els.yearMin, els.yearMax, els.author, els.venue, els.type, els.topic, els.source, els.starred]) {
  input.addEventListener(input.tagName === "SELECT" || input.type === "checkbox" ? "change" : "input", updateFilterFromInputs);
}

els.clearFilters.addEventListener("click", () => {
  state.filters = defaultFilters();
  state.selectedTopicId = null;
  updateFilterInputs();
  populateFilterOptions();
  saveUiState();
  renderAll();
});

els.clearTopicFocus.addEventListener("click", () => {
  state.selectedTopicId = null;
  renderAll();
});

els.mapMode.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  state.mode = button.dataset.mode === "topics" ? "topics" : "citations";
  saveUiState();
  renderAll();
});

els.resetView.addEventListener("click", () => graph.resetView());

function setPaperListOpen(open) {
  els.paperListPanel.hidden = !open;
  els.paperListButton.setAttribute("aria-expanded", String(open));
}
els.paperListButton.addEventListener("click", () => setPaperListOpen(els.paperListPanel.hidden));
els.closePaperList.addEventListener("click", () => setPaperListOpen(false));

els.aboutButton.addEventListener("click", () => {
  const open = els.aboutPanel.hidden;
  els.aboutPanel.hidden = !open;
  els.aboutButton.setAttribute("aria-expanded", String(open));
});

for (const details of document.querySelectorAll("details.toolbar-menu")) {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    for (const other of document.querySelectorAll("details.toolbar-menu")) {
      if (other !== details) other.open = false;
    }
  });
}

document.addEventListener("pointerdown", (event) => {
  for (const details of document.querySelectorAll("details.toolbar-menu[open]")) {
    if (!details.contains(event.target)) details.open = false;
  }
  if (!els.aboutPanel.hidden && !els.aboutPanel.contains(event.target) && !els.aboutButton.contains(event.target)) {
    els.aboutPanel.hidden = true;
    els.aboutButton.setAttribute("aria-expanded", "false");
  }
});

els.addPaperForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = els.addPaperQuery.value.trim();
  if (!query || state.busy) return;
  try {
    setBusy(true, "Resolving paper…");
    const paper = await resolvePaper(query);
    const provider = paper.providerPrimary || paper.source || "paper-provider";
    const merged = await mergeIntoLibrary([paper], [], [], { method: `${provider}-resolve`, detail: query });
    const canonicalId = merged.idMap.get(paper.id) || paper.id;
    state.selectedPaperId = canonicalId;
    els.addPaperQuery.value = "";
    document.querySelector("#library-menu").open = false;
    renderAll();
    setStatus(merged.addedCount ? `Paper added via ${sourceLabel(provider)}.` : `Existing paper enriched via ${sourceLabel(provider)} and merged.`, "ready");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

els.loadDemo.addEventListener("click", async () => {
  try {
    setBusy(true, "Loading demo library…");
    if (state.library.papers.length === 0) {
      await replaceLibrary(DEMO_LIBRARY);
    } else {
      await mergeIntoLibrary(DEMO_LIBRARY.papers, DEMO_LIBRARY.edges, DEMO_LIBRARY.topics, { method: "demo-dataset" });
    }
    await refreshLibrary();
    setStatus("Demo papers loaded into the local library.", "ready");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

els.importButton.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = "";
  if (!file) return;

  try {
    setBusy(true, `Importing ${file.name}…`);
    const text = await file.text();
    if (file.name.toLowerCase().endsWith(".bib")) {
      const papers = parseBibTeX(text);
      if (!papers.length) throw new Error("No BibTeX entries were found in this file.");
      const merged = await mergeIntoLibrary(papers, [], [], { method: "bibtex-import", fileName: file.name });
      setStatus(`Imported ${papers.length} BibTeX entries; ${merged.addedCount} were new papers.`, "ready");
    } else {
      const backup = parsePaperMapJson(text);
      const replace = window.confirm("Restore this backup by replacing the current local library? Choose Cancel to merge the backup instead.");
      if (replace) {
        await replaceLibrary(backup);
        await refreshLibrary();
        setStatus("Local library restored from backup.", "ready");
      } else {
        const merged = await mergeIntoLibrary(backup.papers, backup.edges, backup.topics, { method: "backup-merge", fileName: file.name });
        setStatus(`Backup merged: ${merged.addedCount} new papers and ${merged.edgeCount} new links.`, "ready");
      }
    }
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

els.exportJson.addEventListener("click", () => {
  downloadText(`paper-map-backup-${new Date().toISOString().slice(0, 10)}.json`, serializeLibrary(state.library));
  setStatus("Local database backup downloaded.", "ready");
});

els.exportBibtex.addEventListener("click", () => {
  const { papers } = visibleGraph();
  if (!papers.length) {
    setStatus("There are no visible papers to export.", "error");
    return;
  }
  downloadText(`paper-map-visible-${new Date().toISOString().slice(0, 10)}.bib`, libraryToBibTeX(papers), "application/x-bibtex");
  setStatus(`Exported ${papers.length} visible papers as BibTeX.`, "ready");
});

els.clearLibrary.addEventListener("click", async () => {
  if (!window.confirm("Delete the entire local Paper Map library from this browser? Export a backup first if you need to keep it.")) return;
  try {
    setBusy(true, "Clearing local library…");
    await clearLibrary();
    state.selectedPaperId = null;
    state.selectedTopicId = null;
    closeDetail();
    await refreshLibrary();
    setStatus("Local library cleared.", "ready");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

els.closeDetail.addEventListener("click", () => { closeDetail(); renderAll(); });

els.detailStar.addEventListener("click", () => {
  const paper = currentPaper();
  if (paper) saveSelectedPaperPatch({ starred: !paper.starred });
});

els.detailCopyCitation.addEventListener("click", async () => {
  const paper = currentPaper();
  if (!paper) return;
  await navigator.clipboard.writeText(formattedCitation(paper));
  setStatus("Citation copied to clipboard.", "ready");
});

els.detailCopyBibtex.addEventListener("click", async () => {
  const paper = currentPaper();
  if (!paper) return;
  await navigator.clipboard.writeText(paperToBibTeX(paper));
  setStatus("BibTeX copied to clipboard.", "ready");
});

els.detailStatus.addEventListener("change", () => saveSelectedPaperPatch({ status: els.detailStatus.value }));
els.detailRelevance.addEventListener("input", () => {
  els.detailRelevanceValue.textContent = `${els.detailRelevance.value} / 5`;
});
els.detailRelevance.addEventListener("change", () => saveSelectedPaperPatch({ relevance: Number(els.detailRelevance.value) }));

let annotationTimer = null;
function scheduleAnnotationSave() {
  if (annotationTimer !== null) clearTimeout(annotationTimer);
  annotationTimer = window.setTimeout(() => {
    annotationTimer = null;
    saveSelectedPaperPatch({
      tags: els.detailTags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
      notes: els.detailNotes.value,
    });
  }, 350);
}
els.detailTags.addEventListener("input", scheduleAnnotationSave);
els.detailNotes.addEventListener("input", scheduleAnnotationSave);

els.detailTopic.addEventListener("change", async () => {
  const paper = currentPaper();
  if (!paper) return;
  let topicId = els.detailTopic.value;
  if (topicId === "__new__") {
    const name = window.prompt("Name for the new research topic:");
    if (!name?.trim()) {
      fillDetailTopicSelect(paper);
      return;
    }
    topicId = `topic:manual:${slug(name)}`;
    await putTopics([{ id: topicId, name: name.trim(), source: "manual" }]);
    state.library.topics = [...state.library.topics.filter((topic) => topic.id !== topicId), { id: topicId, name: name.trim(), source: "manual" }];
  }
  const remaining = (paper.topics || []).filter((id) => id !== topicId);
  const topics = topicId ? [topicId, ...remaining] : remaining.slice(1);
  await saveSelectedPaperPatch({ topics });
});

els.addRelation.addEventListener("click", async () => {
  const paper = currentPaper();
  const target = els.relationTarget.value;
  const relation = els.relationType.value;
  if (!paper || !target || !relation) {
    setStatus("Choose another paper before adding a research relationship.", "error");
    return;
  }
  try {
    const edge = createResearchRelationEdge({ source: paper.id, target, relation, provenance: "manual" });
    await putEdges([edge]);
    state.library.edges = [...state.library.edges.filter((item) => item.id !== edge.id), edge];
    renderAll();
    setStatus(`${relationLabel(relation)} relationship added.`, "ready");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

els.relationList.addEventListener("click", async (event) => {
  const paperButton = event.target.closest("button.relation-paper-link");
  if (paperButton?.dataset.paperId) {
    selectPaper(paperButton.dataset.paperId);
    return;
  }
  const remove = event.target.closest("button.relation-remove");
  if (!remove?.dataset.edgeId) return;
  try {
    await deleteEdge(remove.dataset.edgeId);
    state.library.edges = state.library.edges.filter((edge) => edge.id !== remove.dataset.edgeId);
    renderAll();
    setStatus("Research relationship removed.", "ready");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

els.expandReferences.addEventListener("click", () => expand("references"));
els.expandCitations.addEventListener("click", () => expand("citations"));

els.removePaper.addEventListener("click", async () => {
  const paper = currentPaper();
  if (!paper) return;
  if (!window.confirm(`Remove “${paper.title}” and its local graph links?`)) return;
  try {
    await deletePaper(paper.id);
    closeDetail();
    await refreshLibrary();
    setStatus("Paper removed from the local library.", "ready");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

window.addEventListener("resize", () => renderAll());

updateFilterInputs();
openLibrary();

async function openLibrary() {
  try {
    setStatus("Opening local library…", "loading");
    await refreshLibrary();
    if (!state.library.papers.length) setStatus("Local library is empty. Load the demo, import BibTeX, add PDFs, or add a paper.", "ready");
  } catch (error) {
    setStatus(`Could not open local library: ${error.message || error}`, "error");
  }
}
