import "./timeline.js?v=0.4.10";
import "./timeline-selection.js?v=0.4.4";

const DESKTOP_LAYOUT_MEDIA = "(min-width: 1001px)";
const EMPTY_LIBRARY_MESSAGE = "Local library is empty. Load the demo, import BibTeX, add PDFs, or add a paper.";
const PDF_REVIEW_FIELD_SELECTORS = Object.freeze({
  title: "#pdf-review-title",
  authors: "#pdf-review-authors",
  year: "#pdf-review-year",
  type: "#pdf-review-type",
  venue: "#pdf-review-venue",
  doi: "#pdf-review-doi",
  arxivId: "#pdf-review-arxiv",
  url: "#pdf-review-url",
  abstract: "#pdf-review-abstract",
  keywords: "#pdf-review-keywords",
});

function installTimelineInteractionPolish(root = document) {
  if (!root?.querySelector || !root?.createElement) return false;

  if (!root.querySelector("#timeline-interaction-polish")) {
    const style = root.createElement("style");
    style.id = "timeline-interaction-polish";
    style.textContent = `
      #paper-map .timeline-citation-edge {
        stroke: #7d898f;
        stroke-width: 1.25;
        opacity: .34;
      }
      #paper-map .timeline-citation-edge.selected {
        stroke: #35424b;
        stroke-width: 2.1;
        opacity: .9;
      }
      #paper-map:has(.timeline-papers) .citation-arrow {
        fill: #4b5861;
        stroke: #4b5861;
        stroke-width: .45;
      }
    `;
    root.head?.append(style);
  }

  return Boolean(root.querySelector("#paper-map"));
}

function installDesktopLayoutStyles(root = document) {
  if (!root?.querySelector || !root?.createElement || !root.head) return false;
  if (root.querySelector('link[data-paper-map-desktop-layout]')) return true;
  const link = root.createElement("link");
  link.rel = "stylesheet";
  link.href = "./desktop-layout.css?v=0.4.7";
  link.dataset.paperMapDesktopLayout = "true";
  root.head.append(link);
  return true;
}

function initTopicFocusLayout(root = document) {
  const toolbar = root.querySelector(".atlas-toolbar");
  const topicBar = root.querySelector("#active-topic-filter");
  const mapStage = root.querySelector(".map-stage");
  const paperPanel = root.querySelector("#paper-list-panel");
  if (!toolbar || !topicBar || !mapStage || !paperPanel) return false;

  const syncAtlasContentTop = () => {
    const height = Math.max(0, toolbar.getBoundingClientRect().height);
    const top = `${height}px`;
    mapStage.style.top = top;
    paperPanel.style.top = top;
  };

  if (toolbar.dataset.topicFocusLayout !== "true") {
    toolbar.dataset.topicFocusLayout = "true";
    const mutationObserver = new MutationObserver(syncAtlasContentTop);
    mutationObserver.observe(topicBar, { attributes: true, attributeFilter: ["hidden"] });

    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncAtlasContentTop) : null;
    resizeObserver?.observe(toolbar);
    window.addEventListener("resize", syncAtlasContentTop);
  }

  syncAtlasContentTop();
  return true;
}

function pdfFileStem(name) {
  return String(name ?? "")
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedPdfMetadataText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function pdfMetadataTextMissing(value) {
  return !String(value ?? "").trim();
}

function pdfMetadataYearMissing(value) {
  const cleanValue = String(value ?? "").trim();
  if (!cleanValue) return true;
  const year = Number(cleanValue);
  return !Number.isInteger(year) || year <= 0;
}

function pdfMetadataDoiMissing(value) {
  const cleanValue = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  return !cleanValue || !/^10\.\d{4,9}\/\S+$/i.test(cleanValue);
}

function pdfMetadataArxivMissing(value) {
  const cleanValue = String(value ?? "").trim().replace(/^arxiv:\s*/i, "");
  return !cleanValue || !/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i.test(cleanValue);
}

function pdfMetadataUrlMissing(value) {
  const cleanValue = String(value ?? "").trim();
  if (!cleanValue) return true;
  try {
    const parsed = new URL(cleanValue);
    return parsed.protocol !== "http:" && parsed.protocol !== "https:";
  } catch {
    return true;
  }
}

export function pdfReviewMissingMetadata({
  title = "",
  authors = "",
  year = "",
  type = "",
  venue = "",
  doi = "",
  arxivId = "",
  url = "",
  abstract = "",
  keywords = "",
  fileName = "",
  localStatus = "",
} = {}) {
  const result = {
    title: false,
    authors: false,
    year: false,
    type: false,
    venue: false,
    doi: false,
    arxivId: false,
    url: false,
    abstract: false,
    keywords: false,
  };
  if (localStatus !== "complete" && localStatus !== "error") return result;

  const cleanTitle = String(title).trim();
  const authorsMissing = pdfMetadataTextMissing(authors);
  const titleMatchesFilenameFallback = Boolean(cleanTitle)
    && normalizedPdfMetadataText(cleanTitle) === normalizedPdfMetadataText(pdfFileStem(fileName));

  return {
    title: !cleanTitle || (titleMatchesFilenameFallback && (authorsMissing || localStatus === "error")),
    authors: authorsMissing,
    year: pdfMetadataYearMissing(year),
    type: pdfMetadataTextMissing(type),
    venue: pdfMetadataTextMissing(venue),
    doi: pdfMetadataDoiMissing(doi),
    arxivId: pdfMetadataArxivMissing(arxivId),
    url: pdfMetadataUrlMissing(url),
    abstract: pdfMetadataTextMissing(abstract),
    keywords: Array.isArray(keywords) ? keywords.length === 0 : pdfMetadataTextMissing(keywords),
  };
}

export function pdfReviewHasMissingMetadata(metadata = {}) {
  return Object.values(pdfReviewMissingMetadata(metadata)).some(Boolean);
}

function installPdfReviewPolish(root = document) {
  if (!root?.querySelector) return false;
  const dialog = root.querySelector("#pdf-ai-dialog");
  if (!dialog || dialog.dataset.requiredMetadataPolish === "true") return false;

  const fields = new Map(Object.entries(PDF_REVIEW_FIELD_SELECTORS).map(([key, selector]) => [key, dialog.querySelector(selector)]));
  const fileName = dialog.querySelector("#pdf-ai-file-name");
  if (!fileName || Array.from(fields.values()).some((field) => !field?.closest("label"))) return false;

  for (const field of fields.values()) field.closest("label").classList.add("pdf-required-metadata");

  if (!root.querySelector("#pdf-review-metadata-tab-warning-style")) {
    const style = root.createElement("style");
    style.id = "pdf-review-metadata-tab-warning-style";
    style.textContent = `
      #pdf-review-tabs button.metadata-warning,
      #pdf-review-tabs button.metadata-warning.success,
      #pdf-review-tabs button.metadata-warning.selected,
      #pdf-review-tabs button.metadata-warning.success.selected {
        border-color: #d7a8a1;
        background: #fff0ed;
        color: #823c32;
      }
    `;
    root.head?.append(style);
  }

  const missingByTabId = new Map();

  const localStatus = () => {
    const chip = Array.from(dialog.querySelectorAll(".pdf-source-chip"))
      .find((candidate) => candidate.textContent.trim().startsWith("Local:"));
    if (!chip) return "";
    if (chip.classList.contains("complete")) return "complete";
    if (chip.classList.contains("error")) return "error";
    if (chip.classList.contains("running")) return "running";
    if (chip.classList.contains("queued")) return "queued";
    return "idle";
  };

  const syncTabWarnings = (hasMissing, status) => {
    const activeTab = dialog.querySelector('#pdf-review-tabs button[aria-selected="true"]');
    const activeTabId = activeTab?.dataset.pdfTabId;
    if (activeTabId) {
      if (status === "complete" || status === "error") missingByTabId.set(activeTabId, hasMissing);
      else missingByTabId.delete(activeTabId);
    }

    for (const tab of dialog.querySelectorAll("#pdf-review-tabs button[data-pdf-tab-id]")) {
      const finalLocalState = tab.dataset.localStatus === "complete" || tab.dataset.localStatus === "error";
      tab.classList.toggle("metadata-warning", finalLocalState && missingByTabId.get(tab.dataset.pdfTabId) === true);
    }
  };

  const sync = () => {
    const status = localStatus();
    const values = Object.fromEntries(Array.from(fields, ([key, field]) => [key, field.value]));
    const missing = pdfReviewMissingMetadata({
      ...values,
      fileName: fileName.textContent,
      localStatus: status,
    });

    for (const [key, field] of fields) {
      const isMissing = Boolean(missing[key]);
      field.closest("label").classList.toggle("missing-extracted-metadata", isMissing);
      field.setAttribute("aria-invalid", String(isMissing));
    }
    syncTabWarnings(Object.values(missing).some(Boolean), status);
  };

  dialog.addEventListener("input", (event) => {
    if (Array.from(fields.values()).includes(event.target)) sync();
  });
  const observer = new MutationObserver(sync);
  observer.observe(dialog, { subtree: true, childList: true, characterData: true });
  dialog.dataset.requiredMetadataPolish = "true";
  sync();
  return true;
}

function placementOf(element) {
  return element ? { parent: element.parentNode, next: element.nextSibling } : null;
}

function restorePlacement(element, placement) {
  if (!element || !placement?.parent) return;
  if (placement.next?.parentNode === placement.parent) placement.parent.insertBefore(element, placement.next);
  else placement.parent.append(element);
}

function createDesktopLayoutController(root = document, view = window) {
  if (!root?.querySelector || !root?.createElement || !view?.matchMedia) return null;
  const media = view.matchMedia(DESKTOP_LAYOUT_MEDIA);
  let active = false;
  let state = null;
  let statusObserver = null;

  function syncEmptyLibraryMessage() {
    if (!active) return;
    const count = root.querySelector("#visible-paper-count")?.textContent?.trim();
    const status = root.querySelector("#library-status");
    const statusText = root.querySelector("#library-status-text");
    if (count !== "0" || !status?.classList.contains("ready") || !statusText) return;
    const current = statusText.textContent.trim();
    if (/^(?:0 papers\b|Local library cleared\.?$)/i.test(current)) statusText.textContent = EMPTY_LIBRARY_MESSAGE;
  }

  function apply() {
    if (active || !media.matches) return active;

    const header = root.querySelector(".app-header");
    const brand = root.querySelector(".app-header .brand");
    const headerSearch = root.querySelector(".header-search");
    const headerTools = root.querySelector(".header-tools");
    const status = root.querySelector("#library-status");
    const mapSummary = root.querySelector(".map-summary");
    const filterMenu = root.querySelector("#filter-menu");
    const filterPanel = filterMenu?.querySelector(".filter-panel");
    const filterGrid = filterPanel?.querySelector(".filter-grid");
    const toolbarPrimary = root.querySelector(".toolbar-primary");
    const toolbarActions = root.querySelector(".toolbar-actions");
    const paperListButton = root.querySelector("#paper-list-button");
    const mapMode = root.querySelector("#map-mode");
    const libraryMenu = root.querySelector("#library-menu");
    const addPaperForm = root.querySelector("#add-paper-form");
    const addPaperQuery = root.querySelector("#add-paper-query");
    const addPaperSubmit = addPaperForm?.querySelector('button[type="submit"]');
    const addFileButton = root.querySelector("#add-pdf-button");
    const resetView = root.querySelector("#reset-view");
    const mapStage = root.querySelector(".map-stage");

    if (!header || !brand || !headerTools || !status || !mapSummary || !filterMenu || !filterPanel || !filterGrid
      || !toolbarPrimary || !toolbarActions || !paperListButton || !mapMode || !libraryMenu || !addPaperForm
      || !addPaperQuery || !addPaperSubmit || !addFileButton || !resetView || !mapStage) return false;

    state = {
      placements: new Map([
        [headerSearch, placementOf(headerSearch)],
        [mapSummary, placementOf(mapSummary)],
        [filterMenu, placementOf(filterMenu)],
        [paperListButton, placementOf(paperListButton)],
        [mapMode, placementOf(mapMode)],
        [addPaperForm, placementOf(addPaperForm)],
        [resetView, placementOf(resetView)],
      ]),
      libraryMenuHidden: libraryMenu.hidden,
      paperListText: paperListButton.textContent,
      addPaperPlaceholder: addPaperQuery.placeholder,
      addPaperSubmitText: addPaperSubmit.textContent,
      addFileText: addFileButton.textContent,
      filterToggleHandler: null,
      headerOverview: null,
      toolbarLeft: null,
      toolbarRight: null,
    };

    const headerOverview = root.createElement("div");
    headerOverview.className = "desktop-header-overview";
    header.insertBefore(headerOverview, headerTools);
    headerOverview.append(mapSummary);
    state.headerOverview = headerOverview;

    if (headerSearch) {
      headerSearch.classList.add("desktop-filter-search");
      filterPanel.insertBefore(headerSearch, filterGrid);
    }

    const toolbarLeft = root.createElement("div");
    toolbarLeft.className = "desktop-toolbar-left";
    toolbarPrimary.insertBefore(toolbarLeft, toolbarActions);
    toolbarLeft.append(paperListButton, mapMode);
    state.toolbarLeft = toolbarLeft;

    toolbarActions.classList.add("desktop-add-actions");
    toolbarActions.insertBefore(addPaperForm, addFileButton);
    addPaperForm.classList.add("desktop-add-paper-form");
    paperListButton.textContent = "Papers ↓";
    addPaperQuery.placeholder = "Name of a paper to add";
    addPaperSubmit.textContent = "Add";
    addFileButton.textContent = "Add paper";
    libraryMenu.hidden = true;

    const toolbarRight = root.createElement("div");
    toolbarRight.className = "desktop-toolbar-right";
    const filterButton = root.createElement("button");
    filterButton.type = "button";
    filterButton.id = "desktop-filter-button";
    filterButton.textContent = "Filters";
    filterButton.setAttribute("aria-controls", "filter-menu");
    filterButton.setAttribute("aria-expanded", String(filterMenu.open));
    const toggleFilter = () => {
      filterMenu.open = !filterMenu.open;
      filterButton.setAttribute("aria-expanded", String(filterMenu.open));
    };
    const syncFilterToggle = () => filterButton.setAttribute("aria-expanded", String(filterMenu.open));
    filterButton.addEventListener("pointerdown", (event) => event.stopPropagation());
    filterButton.addEventListener("click", toggleFilter);
    filterMenu.addEventListener("toggle", syncFilterToggle);
    state.filterToggleHandler = syncFilterToggle;
    toolbarRight.append(filterButton, filterMenu);
    toolbarPrimary.append(toolbarRight);
    state.toolbarRight = toolbarRight;

    resetView.classList.add("map-reset-button");
    mapStage.insertBefore(resetView, mapStage.firstChild);

    header.classList.add("desktop-layout-active");
    toolbarPrimary.classList.add("desktop-layout-active");
    active = true;

    statusObserver = new MutationObserver(syncEmptyLibraryMessage);
    statusObserver.observe(root.querySelector("#library-status"), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    statusObserver.observe(root.querySelector("#visible-paper-count"), { subtree: true, childList: true, characterData: true });
    syncEmptyLibraryMessage();
    return true;
  }

  function restore() {
    if (!active || !state) return;
    statusObserver?.disconnect();
    statusObserver = null;

    const headerSearch = root.querySelector(".header-search");
    const mapSummary = root.querySelector(".map-summary");
    const filterMenu = root.querySelector("#filter-menu");
    const paperListButton = root.querySelector("#paper-list-button");
    const mapMode = root.querySelector("#map-mode");
    const libraryMenu = root.querySelector("#library-menu");
    const addPaperForm = root.querySelector("#add-paper-form");
    const addPaperQuery = root.querySelector("#add-paper-query");
    const addPaperSubmit = addPaperForm?.querySelector('button[type="submit"]');
    const addFileButton = root.querySelector("#add-pdf-button");
    const resetView = root.querySelector("#reset-view");
    const toolbarActions = root.querySelector(".toolbar-actions");

    if (filterMenu && state.filterToggleHandler) filterMenu.removeEventListener("toggle", state.filterToggleHandler);

    restorePlacement(resetView, state.placements.get(resetView));
    restorePlacement(addPaperForm, state.placements.get(addPaperForm));
    restorePlacement(filterMenu, state.placements.get(filterMenu));
    restorePlacement(paperListButton, state.placements.get(paperListButton));
    restorePlacement(mapSummary, state.placements.get(mapSummary));
    restorePlacement(mapMode, state.placements.get(mapMode));
    restorePlacement(headerSearch, state.placements.get(headerSearch));

    headerSearch?.classList.remove("desktop-filter-search");
    addPaperForm?.classList.remove("desktop-add-paper-form");
    resetView?.classList.remove("map-reset-button");
    toolbarActions?.classList.remove("desktop-add-actions");
    root.querySelector(".app-header")?.classList.remove("desktop-layout-active");
    root.querySelector(".toolbar-primary")?.classList.remove("desktop-layout-active");

    if (paperListButton) paperListButton.textContent = state.paperListText;
    if (addPaperQuery) addPaperQuery.placeholder = state.addPaperPlaceholder;
    if (addPaperSubmit) addPaperSubmit.textContent = state.addPaperSubmitText;
    if (addFileButton) addFileButton.textContent = state.addFileText;
    if (libraryMenu) libraryMenu.hidden = state.libraryMenuHidden;

    state.headerOverview?.remove();
    state.toolbarLeft?.remove();
    state.toolbarRight?.remove();
    active = false;
    state = null;
  }

  function sync() {
    if (media.matches) apply();
    else restore();
  }

  const observer = new MutationObserver(sync);
  observer.observe(root.documentElement, { childList: true, subtree: true });
  media.addEventListener?.("change", sync);
  view.requestAnimationFrame?.(sync) ?? sync();
  return { apply, restore, sync };
}

export function desktopLayoutMediaQuery() {
  return DESKTOP_LAYOUT_MEDIA;
}

export function emptyLibraryDesktopMessage() {
  return EMPTY_LIBRARY_MESSAGE;
}

if (typeof document !== "undefined") {
  installTimelineInteractionPolish(document);
  installDesktopLayoutStyles(document);
  initTopicFocusLayout(document);
  installPdfReviewPolish(document);
  if (!globalThis.__paperMapDesktopLayoutController) {
    globalThis.__paperMapDesktopLayoutController = createDesktopLayoutController(document, window);
  }
}
