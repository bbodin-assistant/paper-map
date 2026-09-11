import { loadLibrary } from "./db.js";
import { fitTransform } from "./graph-layout.js";
import { isCitationEdge } from "./research-relations.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const TIMELINE_STORAGE_KEY = "paper-map-timeline-mode-v1";
const GROUP_COUNT = 5;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.2;
const CARD_WIDTH = 176;
const CARD_HEIGHT = 54;
const YEAR_STEP = 205;
const LEFT_GUTTER = 166;
const BAND_TOP_PADDING = 46;
const ROW_STEP = 62;

const STOP_WORDS = new Set(`
a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just may me might more most must my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves
abstract approach approaches based data dataset datasets method methods model models paper results study system systems using use used via new propose proposed show shows work
`.trim().split(/\s+/));

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  return element;
}

function shortText(value, max = 30) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9][a-z0-9-]{1,}/g)?.filter((token) => token.length > 2 && !STOP_WORDS.has(token) && !/^\d+$/.test(token)) || [];
}

function paperTermCounts(paper) {
  const counts = new Map();
  const add = (value, weight) => {
    for (const token of tokenize(value)) counts.set(token, (counts.get(token) || 0) + weight);
  };
  add(paper.title, 3);
  const keywords = Array.isArray(paper.keywords) ? paper.keywords : String(paper.keywords || "").split(/[,;]+/);
  for (const keyword of keywords) add(keyword, 5);
  add(paper.abstract, 1);
  return counts;
}

function dot(left, right) {
  let total = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const [term, value] of small) total += value * (large.get(term) || 0);
  return total;
}

function normalized(vector) {
  let squared = 0;
  for (const value of vector.values()) squared += value * value;
  const norm = Math.sqrt(squared);
  if (!norm) return new Map();
  return new Map(Array.from(vector, ([term, value]) => [term, value / norm]));
}

function averageVectors(vectors) {
  const result = new Map();
  if (!vectors.length) return result;
  for (const vector of vectors) {
    for (const [term, value] of vector) result.set(term, (result.get(term) || 0) + value / vectors.length);
  }
  return normalized(result);
}

function buildVectors(papers) {
  const countsByPaper = papers.map(paperTermCounts);
  const documentFrequency = new Map();
  for (const counts of countsByPaper) {
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  return countsByPaper.map((counts, index) => {
    const vector = new Map();
    for (const [term, count] of counts) {
      const idf = Math.log((papers.length + 1) / ((documentFrequency.get(term) || 0) + 1)) + 1;
      vector.set(term, count * idf);
    }
    if (!vector.size) vector.set(`__paper_${index}`, 1);
    return normalized(vector);
  });
}

function farthestFirstSeeds(papers, vectors, count) {
  const first = papers
    .map((paper, index) => ({ index, size: vectors[index].size, id: String(paper.id || index) }))
    .sort((a, b) => b.size - a.size || a.id.localeCompare(b.id))[0]?.index ?? 0;
  const seeds = [first];
  while (seeds.length < count) {
    let bestIndex = -1;
    let bestDistance = -Infinity;
    for (let index = 0; index < vectors.length; index += 1) {
      if (seeds.includes(index)) continue;
      let nearestSimilarity = -Infinity;
      for (const seed of seeds) nearestSimilarity = Math.max(nearestSimilarity, dot(vectors[index], vectors[seed]));
      const distance = 1 - Math.max(0, nearestSimilarity);
      if (distance > bestDistance || (distance === bestDistance && String(papers[index].id).localeCompare(String(papers[bestIndex]?.id || "")) < 0)) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    seeds.push(bestIndex);
  }
  return seeds;
}

function centroidTerms(centroid, limit = 3) {
  return Array.from(centroid)
    .filter(([term]) => !term.startsWith("__paper_"))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

export function clusterPapers(papers = [], requestedGroups = GROUP_COUNT) {
  if (!papers.length) return { groups: [], assignmentByPaperId: new Map() };
  const groupCount = Math.max(1, Math.min(Number(requestedGroups) || GROUP_COUNT, papers.length));
  const vectors = buildVectors(papers);
  const seeds = farthestFirstSeeds(papers, vectors, groupCount);
  let centroids = seeds.map((index) => vectors[index]);
  let assignments = new Array(papers.length).fill(-1);

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const nextAssignments = vectors.map((vector) => {
      let bestGroup = 0;
      let bestSimilarity = -Infinity;
      for (let group = 0; group < centroids.length; group += 1) {
        const similarity = dot(vector, centroids[group]);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestGroup = group;
        }
      }
      return bestGroup;
    });

    const unchanged = nextAssignments.every((value, index) => value === assignments[index]);
    assignments = nextAssignments;
    centroids = centroids.map((centroid, group) => {
      const members = vectors.filter((_, index) => assignments[index] === group);
      return members.length ? averageVectors(members) : centroid;
    });
    if (unchanged) break;
  }

  const rawGroups = centroids.map((centroid, index) => ({
    originalIndex: index,
    centroid,
    terms: centroidTerms(centroid),
    paperIds: papers.filter((_, paperIndex) => assignments[paperIndex] === index).map((paper) => paper.id),
  })).filter((group) => group.paperIds.length);

  rawGroups.sort((left, right) => {
    const leftLabel = left.terms.join(" ") || "miscellaneous";
    const rightLabel = right.terms.join(" ") || "miscellaneous";
    return leftLabel.localeCompare(rightLabel) || left.originalIndex - right.originalIndex;
  });

  const assignmentByPaperId = new Map();
  const groups = rawGroups.map((group, index) => {
    for (const paperId of group.paperIds) assignmentByPaperId.set(paperId, index);
    return {
      id: `timeline-group-${index + 1}`,
      name: `Theme ${index + 1}`,
      terms: group.terms,
      label: group.terms.length ? group.terms.join(" · ") : "Miscellaneous",
      paperIds: group.paperIds,
    };
  });
  return { groups, assignmentByPaperId };
}

export function buildTimelineLayout(papers = [], viewportWidth = 1200, viewportHeight = 720, requestedGroups = GROUP_COUNT) {
  const { groups, assignmentByPaperId } = clusterPapers(papers, requestedGroups);
  const years = Array.from(new Set(papers.map((paper) => Number(paper.year)).filter(Number.isFinite))).sort((a, b) => a - b);
  const yearIndex = new Map(years.map((year, index) => [year, index]));
  const middleBucket = years.length ? Math.floor((years.length - 1) / 2) : 0;
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const bandSpecs = [];
  let y = BAND_TOP_PADDING;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const bucketCounts = new Map();
    for (const paperId of group.paperIds) {
      const paper = paperById.get(paperId);
      const year = Number(paper?.year);
      const bucket = Number.isFinite(year) ? yearIndex.get(year) : middleBucket;
      bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
    }
    const maxRows = Math.max(1, ...bucketCounts.values());
    const height = Math.max(142, 64 + maxRows * ROW_STEP);
    bandSpecs.push({ ...group, index: groupIndex, y, height });
    y += height + 12;
  }

  const nodes = [];
  for (const band of bandSpecs) {
    const slotByBucket = new Map();
    const bandPapers = band.paperIds
      .map((paperId) => paperById.get(paperId))
      .filter(Boolean)
      .sort((left, right) => (Number(left.year) || 0) - (Number(right.year) || 0) || String(left.title || "").localeCompare(String(right.title || "")));
    for (const paper of bandPapers) {
      const year = Number(paper.year);
      const bucket = Number.isFinite(year) ? yearIndex.get(year) : middleBucket;
      const slot = slotByBucket.get(bucket) || 0;
      slotByBucket.set(bucket, slot + 1);
      nodes.push({
        paper,
        groupIndex: band.index,
        bucket,
        x: LEFT_GUTTER + bucket * YEAR_STEP,
        y: band.y + 48 + slot * ROW_STEP,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
    }
  }

  const width = Math.max(Number(viewportWidth) || 1200, LEFT_GUTTER + Math.max(0, years.length - 1) * YEAR_STEP + CARD_WIDTH + 76);
  const height = Math.max(Number(viewportHeight) || 720, y + 28);
  return { width, height, years, groups: bandSpecs, nodes, assignmentByPaperId };
}

function rectBoundary(node, towardX, towardY, padding = 0) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  const halfW = node.width / 2 + padding;
  const halfH = node.height / 2 + padding;
  const scale = 1 / Math.max(Math.abs(dx) / Math.max(1, halfW), Math.abs(dy) / Math.max(1, halfH), 0.001);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function timelineEdgePath(source, target) {
  const sourceCx = source.x + source.width / 2;
  const sourceCy = source.y + source.height / 2;
  const targetCx = target.x + target.width / 2;
  const targetCy = target.y + target.height / 2;
  const start = rectBoundary(source, targetCx, targetCy, 0);
  const end = rectBoundary(target, sourceCx, sourceCy, 7);
  const dx = end.x - start.x;
  const bend = Math.max(26, Math.min(120, Math.abs(dx) * 0.42));
  const direction = dx >= 0 ? 1 : -1;
  const c1x = start.x + bend * direction;
  const c2x = end.x - bend * direction;
  return `M ${start.x} ${start.y} C ${c1x} ${start.y}, ${c2x} ${end.y}, ${end.x} ${end.y}`;
}

function installStyles(root = document) {
  if (root.querySelector("#timeline-map-styles")) return;
  const style = root.createElement("style");
  style.id = "timeline-map-styles";
  style.textContent = `
    #map-mode.timeline-enabled { grid-template-columns: repeat(3, minmax(0, 1fr)); width: 326px; }
    .timeline-year-guide { stroke: #d8ddda; stroke-width: 1; stroke-dasharray: 3 6; }
    .timeline-year-label { fill: #6f7a82; font-size: 10px; font-weight: 800; text-anchor: middle; }
    .timeline-band { fill: #fafaf6; stroke: #e0e4e0; stroke-width: 1; }
    .timeline-band.alt { fill: #f6f7f3; }
    .timeline-band-name { fill: #25313b; font-size: 11px; font-weight: 850; }
    .timeline-band-terms { fill: #899198; font-size: 8px; font-weight: 650; }
    .timeline-axis-note { fill: #929a9f; font-size: 8px; font-weight: 650; }
    .timeline-citation-edge { fill: none; stroke: #9ca6a6; stroke-width: 1; opacity: .18; pointer-events: none; }
    .timeline-citation-edge.selected { stroke: #47545e; stroke-width: 1.8; opacity: .62; }
    .timeline-paper { cursor: pointer; outline: none; }
    .timeline-paper rect { fill: #fffef9; stroke: #69757e; stroke-width: 1.15; }
    .timeline-paper:hover rect, .timeline-paper:focus rect { fill: #fff6cd; stroke: #26333e; stroke-width: 1.5; }
    .timeline-paper.selected rect { fill: #f6c445; stroke: #1f2933; stroke-width: 2; }
    .timeline-paper.starred rect { stroke: #ad7810; stroke-width: 2; }
    .timeline-paper-year { fill: #7d878e; font-size: 8px; font-weight: 850; }
    .timeline-paper-title { fill: #202b35; font-size: 10px; font-weight: 800; }
    .timeline-paper-meta { fill: #79838b; font-size: 8px; font-weight: 650; }
    .timeline-empty { fill: #7d878e; font-size: 13px; font-weight: 650; }
    @media (max-width: 720px) { #map-mode.timeline-enabled { width: 286px; } #map-mode.timeline-enabled button { padding-inline: 8px; } }
  `;
  root.head.append(style);
}

function visiblePaperIds(root) {
  return new Set(Array.from(root.querySelectorAll("#paper-list .paper-list-item[data-paper-id]"), (button) => button.dataset.paperId));
}

function selectedPaperId(root) {
  return root.querySelector("#paper-list .paper-list-item.selected")?.dataset.paperId || null;
}

function selectPaperThroughApp(root, paperId) {
  const button = Array.from(root.querySelectorAll("#paper-list .paper-list-item[data-paper-id]")).find((candidate) => candidate.dataset.paperId === paperId);
  button?.click();
}

function restoreGraphTransform(svg, viewport) {
  const x = Number(svg.dataset.graphX) || 0;
  const y = Number(svg.dataset.graphY) || 0;
  const k = Number(svg.dataset.graphZoom) || 1;
  viewport.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
}

export function initTimelineMap(root = document) {
  if (!root?.querySelector || !root?.createElement) return false;
  const modeControl = root.querySelector("#map-mode");
  const svg = root.querySelector("#paper-map");
  const viewport = svg?.querySelector(".graph-viewport");
  const paperList = root.querySelector("#paper-list");
  const resetButton = root.querySelector("#reset-view");
  const mapHelp = root.querySelector(".map-help");
  if (!modeControl || !svg || !viewport || !paperList) return false;
  if (modeControl.querySelector('button[data-mode="timeline"]')) return true;

  installStyles(root);
  modeControl.classList.add("timeline-enabled");
  const timelineButton = root.createElement("button");
  timelineButton.type = "button";
  timelineButton.dataset.mode = "timeline";
  timelineButton.setAttribute("aria-pressed", "false");
  timelineButton.textContent = "Timeline";
  modeControl.append(timelineButton);

  const defaultHelp = mapHelp?.textContent || "";
  let active = false;
  let renderVersion = 0;
  let renderQueued = false;
  let currentLayout = null;
  let currentSignature = "";
  let timelineTransform = { x: 0, y: 0, k: 1 };
  const pointers = new Map();
  let panGesture = null;
  let pinchGesture = null;

  function applyTimelineTransform() {
    viewport.setAttribute("transform", `translate(${timelineTransform.x} ${timelineTransform.y}) scale(${timelineTransform.k})`);
  }

  function resetTimelineView() {
    if (!currentLayout) return;
    timelineTransform = fitTransform(
      Math.max(1, svg.clientWidth || 1200),
      Math.max(1, svg.clientHeight || 720),
      currentLayout.width,
      currentLayout.height,
      { minZoom: MIN_ZOOM, maxZoom: 1, padding: 28 },
    );
    applyTimelineTransform();
  }

  function syncModeButtons() {
    for (const button of modeControl.querySelectorAll("button[data-mode]")) {
      const selected = active && button.dataset.mode === "timeline";
      if (active) {
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      }
    }
  }

  async function renderTimeline() {
    if (!active) return;
    const version = ++renderVersion;
    const library = await loadLibrary();
    if (!active || version !== renderVersion) return;
    const ids = visiblePaperIds(root);
    const papers = library.papers.filter((paper) => ids.has(paper.id));
    const paperIds = new Set(papers.map((paper) => paper.id));
    const citations = library.edges.filter((edge) => isCitationEdge(edge) && paperIds.has(edge.source) && paperIds.has(edge.target));
    const selectedId = selectedPaperId(root);

    viewport.replaceChildren();
    syncModeButtons();
    if (mapHelp) mapHelp.textContent = "Timeline: observed years are evenly spaced · vertical bands are text clusters · drag background, pinch or wheel to zoom";

    if (!papers.length) {
      currentLayout = null;
      const text = svgElement("text", { x: 28, y: 44, class: "timeline-empty" });
      text.textContent = "No papers match the current filters.";
      viewport.append(text);
      applyTimelineTransform();
      return;
    }

    const viewportWidth = Math.max(800, svg.clientWidth || 1200);
    const viewportHeight = Math.max(520, svg.clientHeight || 720);
    const layout = buildTimelineLayout(papers, viewportWidth, viewportHeight, GROUP_COUNT);
    currentLayout = layout;
    const signature = `${viewportWidth}x${viewportHeight}|${papers.map((paper) => `${paper.id}:${paper.year || ""}:${paper.title || ""}:${(paper.keywords || []).join?.("|") || paper.keywords || ""}:${String(paper.abstract || "").length}`).sort().join(";")}`;
    const shouldReset = signature !== currentSignature;
    currentSignature = signature;

    const guideLayer = svgElement("g", { class: "timeline-guides" });
    const bandLayer = svgElement("g", { class: "timeline-bands" });
    const edgeLayer = svgElement("g", { class: "timeline-citation-edges" });
    const paperLayer = svgElement("g", { class: "timeline-papers" });
    viewport.append(guideLayer, bandLayer, edgeLayer, paperLayer);

    const axisNote = svgElement("text", { x: LEFT_GUTTER, y: 14, class: "timeline-axis-note" });
    axisNote.textContent = "Chronology → equal spacing between observed years; empty calendar gaps are compressed";
    guideLayer.append(axisNote);
    for (let index = 0; index < layout.years.length; index += 1) {
      const x = LEFT_GUTTER + index * YEAR_STEP + CARD_WIDTH / 2;
      const line = svgElement("line", { x1: x, y1: 28, x2: x, y2: layout.height - 24, class: "timeline-year-guide" });
      const label = svgElement("text", { x, y: 34, class: "timeline-year-label" });
      label.textContent = String(layout.years[index]);
      guideLayer.append(line, label);
    }

    for (const band of layout.groups) {
      const rect = svgElement("rect", {
        x: 10,
        y: band.y,
        width: layout.width - 20,
        height: band.height,
        rx: 8,
        class: `timeline-band${band.index % 2 ? " alt" : ""}`,
      });
      const name = svgElement("text", { x: 24, y: band.y + 27, class: "timeline-band-name" });
      name.textContent = band.name;
      const terms = svgElement("text", { x: 24, y: band.y + 42, class: "timeline-band-terms" });
      terms.textContent = shortText(band.label, 22);
      bandLayer.append(rect, name, terms);
    }

    const nodeById = new Map(layout.nodes.map((node) => [node.paper.id, node]));
    for (const edge of citations) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;
      const selected = edge.source === selectedId || edge.target === selectedId;
      const path = svgElement("path", {
        d: timelineEdgePath(source, target),
        class: `timeline-citation-edge${selected ? " selected" : ""}`,
        "marker-end": "url(#citation-arrow)",
        "data-edge-id": edge.id,
      });
      const title = svgElement("title");
      title.textContent = `Cites · ${edge.source} → ${edge.target}`;
      path.append(title);
      edgeLayer.append(path);
    }

    for (const node of layout.nodes) {
      const paper = node.paper;
      const group = svgElement("g", {
        class: `timeline-paper${paper.id === selectedId ? " selected" : ""}${paper.starred ? " starred" : ""}`,
        transform: `translate(${node.x} ${node.y})`,
        tabindex: "0",
        role: "button",
        "data-paper-id": paper.id,
        "aria-label": `${paper.title || "Untitled"}, ${paper.year || "year unknown"}`,
      });
      const rect = svgElement("rect", { width: CARD_WIDTH, height: CARD_HEIGHT, rx: 6 });
      const year = svgElement("text", { x: 10, y: 14, class: "timeline-paper-year" });
      year.textContent = paper.year ? String(paper.year) : "YEAR UNKNOWN";
      const title = svgElement("text", { x: 10, y: 31, class: "timeline-paper-title" });
      title.textContent = shortText(paper.title || "Untitled", 28);
      const meta = svgElement("text", { x: 10, y: 46, class: "timeline-paper-meta" });
      const citationMeta = Number.isFinite(Number(paper.citationCount)) ? `${paper.citationCount} cites` : "";
      meta.textContent = shortText([(paper.authors || [])[0], citationMeta].filter(Boolean).join(" · "), 31);
      const tooltip = svgElement("title");
      tooltip.textContent = `${paper.title || "Untitled"}\n${(paper.authors || []).join(", ")}\n${paper.year || "Year unknown"}`;
      group.append(rect, year, title, meta, tooltip);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          selectPaperThroughApp(root, paper.id);
        }
      });
      paperLayer.append(group);
    }

    if (shouldReset) resetTimelineView();
    else applyTimelineTransform();
  }

  function queueRender() {
    if (!active || renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderTimeline().catch(() => {
        if (!active) return;
        viewport.replaceChildren();
        const text = svgElement("text", { x: 28, y: 44, class: "timeline-empty" });
        text.textContent = "Timeline could not read the local library.";
        viewport.append(text);
      });
    });
  }

  function activate() {
    active = true;
    try { localStorage.setItem(TIMELINE_STORAGE_KEY, "true"); } catch { /* Non-critical UI preference. */ }
    syncModeButtons();
    queueRender();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    renderVersion += 1;
    pointers.clear();
    panGesture = null;
    pinchGesture = null;
    if (mapHelp) mapHelp.textContent = defaultHelp;
    try { localStorage.removeItem(TIMELINE_STORAGE_KEY); } catch { /* Non-critical UI preference. */ }
    restoreGraphTransform(svg, viewport);
  }

  modeControl.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-mode]");
    if (!button) return;
    if (button.dataset.mode === "timeline") {
      event.preventDefault();
      event.stopImmediatePropagation();
      activate();
      return;
    }
    deactivate();
  }, true);

  resetButton?.addEventListener("click", (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    resetTimelineView();
  }, true);

  svg.addEventListener("click", (event) => {
    if (!active) return;
    const paper = event.target.closest?.(".timeline-paper");
    event.preventDefault();
    event.stopImmediatePropagation();
    if (paper?.dataset.paperId) selectPaperThroughApp(root, paper.dataset.paperId);
  }, true);

  svg.addEventListener("wheel", (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = svg.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const previous = timelineTransform.k;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previous * (event.deltaY > 0 ? 0.9 : 1.1)));
    const worldX = (pointer.x - timelineTransform.x) / previous;
    const worldY = (pointer.y - timelineTransform.y) / previous;
    timelineTransform.k = next;
    timelineTransform.x = pointer.x - worldX * next;
    timelineTransform.y = pointer.y - worldY * next;
    applyTimelineTransform();
  }, { capture: true, passive: false });

  function localPoint(event) {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startPinch() {
    if (pointers.size < 2) return;
    const [first, second] = Array.from(pointers.values()).slice(0, 2);
    pinchGesture = {
      transform: { ...timelineTransform },
      midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    };
    panGesture = null;
  }

  svg.addEventListener("pointerdown", (event) => {
    if (!active) return;
    event.stopImmediatePropagation();
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    try { svg.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers may not be capturable. */ }
    if (pointers.size >= 2) startPinch();
    else if (!event.target.closest?.(".timeline-paper")) panGesture = { pointerId: event.pointerId, start: point, origin: { ...timelineTransform } };
  }, true);

  svg.addEventListener("pointermove", (event) => {
    if (!active || !pointers.has(event.pointerId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size >= 2) {
      if (!pinchGesture) startPinch();
      const [first, second] = Array.from(pointers.values()).slice(0, 2);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const ratio = distance / pinchGesture.distance;
      const nextK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchGesture.transform.k * ratio));
      const worldX = (pinchGesture.midpoint.x - pinchGesture.transform.x) / pinchGesture.transform.k;
      const worldY = (pinchGesture.midpoint.y - pinchGesture.transform.y) / pinchGesture.transform.k;
      timelineTransform = { k: nextK, x: midpoint.x - worldX * nextK, y: midpoint.y - worldY * nextK };
      applyTimelineTransform();
      return;
    }
    if (panGesture?.pointerId === event.pointerId) {
      timelineTransform.x = panGesture.origin.x + point.x - panGesture.start.x;
      timelineTransform.y = panGesture.origin.y + point.y - panGesture.start.y;
      applyTimelineTransform();
    }
  }, true);

  function endPointer(event) {
    if (!active) return;
    event.stopImmediatePropagation();
    pointers.delete(event.pointerId);
    if (panGesture?.pointerId === event.pointerId) panGesture = null;
    if (pointers.size < 2) pinchGesture = null;
    try { if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId); } catch { /* Ignore capture differences. */ }
  }
  svg.addEventListener("pointerup", endPointer, true);
  svg.addEventListener("pointercancel", endPointer, true);

  const observer = new MutationObserver(() => queueRender());
  observer.observe(paperList, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", queueRender);

  try {
    if (localStorage.getItem(TIMELINE_STORAGE_KEY) === "true") requestAnimationFrame(activate);
  } catch {
    // Ignore unavailable localStorage.
  }
  return true;
}

function initWhenReady() {
  if (typeof document === "undefined") return;
  if (initTimelineMap(document)) return;
  const observer = new MutationObserver(() => {
    if (!initTimelineMap(document)) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

initWhenReady();
