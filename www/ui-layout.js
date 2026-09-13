import "./timeline.js?v=0.4.4";
import "./timeline-selection.js?v=0.4.4";

const DESKTOP_LAYOUT_MEDIA = "(min-width: 1001px)";
const EMPTY_LIBRARY_MESSAGE = "Local library is empty. Load the demo, import BibTeX, add PDFs, or add a paper.";

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
  link.href = "./desktop-layout.css?v=0.4.6";
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
      statusLabel: null,
    };

    const headerOverview = root.createElement("div");
    headerOverview.className = "desktop-header-overview";
    header.insertBefore(headerOverview, headerTools);
    headerOverview.append(mapSummary, filterMenu);
    state.headerOverview = headerOverview;

    if (headerSearch) {
      headerSearch.classList.add("desktop-filter-search");
      filterPanel.insertBefore(headerSearch, filterGrid);
    }

    const statusLabel = root.createElement("strong");
    statusLabel.className = "desktop-status-label";
    statusLabel.textContent = "Status";
    status.insertBefore(statusLabel, root.querySelector("#library-status-text"));
    state.statusLabel = statusLabel;

    const toolbarLeft = root.createElement("div");
    toolbarLeft.className = "desktop-toolbar-left";
    toolbarPrimary.insertBefore(toolbarLeft, toolbarActions);
    toolbarLeft.append(paperListButton, mapMode);
    state.toolbarLeft = toolbarLeft;

    toolbarActions.classList.add("desktop-add-actions");
    toolbarActions.insertBefore(addPaperForm, addFileButton);
    addPaperForm.classList.add("desktop-add-paper-form");
    paperListButton.textContent = "Show papers";
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
    toolbarRight.append(filterButton);
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

    state.statusLabel?.remove();
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
  if (!globalThis.__paperMapDesktopLayoutController) {
    globalThis.__paperMapDesktopLayoutController = createDesktopLayoutController(document, window);
  }
}
