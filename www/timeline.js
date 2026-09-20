import { loadLibrary } from "./db.js";
import { fitTransform } from "./graph-layout.js";
import {
  DEFAULT_GRAPH_CONFIG,
  loadGraphConfig,
  TIMELINE_CLUSTER_FIELD_OPTIONS,
} from "./graph-config.js?v=0.4.10";
import { isCitationEdge } from "./research-relations.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const TIMELINE_STORAGE_KEY = "paper-map-timeline-mode-v1";
const GROUP_COUNT = DEFAULT_GRAPH_CONFIG.timelineClusterCount;
const DEFAULT_CLUSTER_FIELDS = DEFAULT_GRAPH_CONFIG.timelineClusterFields;
const CLUSTER_FIELD_IDS = new Set(TIMELINE_CLUSTER_FIELD_OPTIONS.map(({ id }) => id));
const TIMELINE_CLUSTER_COLORS = Object.freeze([
  Object.freeze({ band: "#f2effd", paper: "#fbfaff", accent: "#6e5aa6" }),
  Object.freeze({ band: "#edf5fc", paper: "#f9fcff", accent: "#477aa4" }),
  Object.freeze({ band: "#eaf7f3", paper: "#f8fcfb", accent: "#3f806d" }),
  Object.freeze({ band: "#f1f7e8", paper: "#fbfdf7", accent: "#687f3f" }),
  Object.freeze({ band: "#fff6df", paper: "#fffdf7", accent: "#a7781e" }),
  Object.freeze({ band: "#fff0e6", paper: "#fffaf7", accent: "#a96138" }),
  Object.freeze({ band: "#fceeed", paper: "#fff9f8", accent: "#a65350" }),
  Object.freeze({ band: "#fcecf4", paper: "#fff9fc", accent: "#a45479" }),
  Object.freeze({ band: "#f4edfc", paper: "#fbf9ff", accent: "#7657a0" }),
  Object.freeze({ band: "#eaf7f9", paper: "#f8fcfd", accent: "#3d7b85" }),
  Object.freeze({ band: "#f5efe8", paper: "#fcfaf7", accent: "#82664c" }),
  Object.freeze({ band: "#edf2f5", paper: "#fafcfd", accent: "#5d7384" }),
]);
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.2;
const CARD_WIDTH = 176;
const CARD_HEIGHT = 54;
const YEAR_STEP = 205;
const LEFT_GUTTER = 166;
const BAND_TOP_PADDING = 28;
const ROW_STEP = 62;
const YEAR_TICK_MIN_SCREEN_GAP = 105;

export function timelineYearTickStep(zoom = 1) {
  const boundedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(zoom) || 1));
  return Math.max(1, Math.ceil(YEAR_TICK_MIN_SCREEN_GAP / (YEAR_STEP * boundedZoom)));
}

export function clampTimelineTransform(transform, viewportWidth, viewportHeight, worldWidth, worldHeight) {
  const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(transform?.k) || 1));
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const scaledWidth = Math.max(1, Number(worldWidth) || width) * k;
  const scaledHeight = Math.max(1, Number(worldHeight) || height) * k;
  const minX = Math.min(0, width - scaledWidth);
  const minY = Math.min(0, height - scaledHeight);
  return {
    k,
    x: Math.max(minX, Math.min(0, Number(transform?.x) || 0)),
    y: Math.max(minY, Math.min(0, Number(transform?.y) || 0)),
  };
}

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

function normalizedClusterFields(fields) {
  const requested = Array.isArray(fields) ? fields : DEFAULT_CLUSTER_FIELDS;
  const normalized = Array.from(new Set(requested.filter((field) => CLUSTER_FIELD_IDS.has(field))));
  return normalized.length ? normalized : [...DEFAULT_CLUSTER_FIELDS];
}

function paperTermCounts(paper, fields = DEFAULT_CLUSTER_FIELDS) {
  const selected = new Set(normalizedClusterFields(fields));
  const counts = new Map();
  const add = (value, weight) => {
    for (const token of tokenize(value)) counts.set(token, (counts.get(token) || 0) + weight);
  };
  if (selected.has("title")) add(paper.title, 3);
  if (selected.has("keywords")) {
    const keywords = Array.isArray(paper.keywords) ? paper.keywords : String(paper.keywords || "").split(/[,;]+/);
    for (const keyword of keywords) add(keyword, 5);
  }
  if (selected.has("abstract")) add(paper.abstract, 1);
  if (selected.has("authors")) {
    const authors = Array.isArray(paper.authors) ? paper.authors : String(paper.authors || "").split(/[,;]+/);
    for (const author of authors) add(author, 2);
  }
  if (selected.has("venue")) add(paper.venue, 2);
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

function buildVectors(papers, fields = DEFAULT_CLUSTER_FIELDS) {
  const countsByPaper = papers.map((paper) => paperTermCounts(paper, fields));
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

export function clusterPapers(papers = [], requestedGroups = GROUP_COUNT, options = {}) {
  if (!papers.length) return { groups: [], assignmentByPaperId: new Map() };
  const groupCount = Math.max(1, Math.min(Number(requestedGroups) || GROUP_COUNT, papers.length));
  const fields = normalizedClusterFields(options.fields);
  const vectors = buildVectors(papers, fields);
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

export function buildTimelineLayout(papers = [], viewportWidth = 1200, viewportHeight = 720, requestedGroups = GROUP_COUNT, options = {}) {
  const { groups, assignmentByPaperId } = clusterPapers(papers, requestedGroups, options);
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

export function timelineClusterColor(index) {
  const normalized = Math.max(0, Math.floor(Number(index) || 0));
  return TIMELINE_CLUSTER_COLORS[normalized % TIMELINE_CLUSTER_COLORS.length];
}

export function timelineEdgePath(source, target) {
  const sourceCx = source.x + source.width / 2;
  const sourceCy = source.y + source.height / 2;
  const targetCx = target.x + target.width / 2;
  const targetCy = target.y + target.height / 2;
  const start = rectBoundary(source, targetCx, targetCy, 0);
  const end = rectBoundary(target, sourceCx, sourceCy, 7);
  const distance = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  const bend = Math.max(26, Math.min(120, distance * 0.34));
  const startDistance = Math.max(1, Math.hypot(targetCx - start.x, targetCy - start.y));
  const endDistance = Math.max(1, Math.hypot(targetCx - end.x, targetCy - end.y));
  const startUx = (targetCx - start.x) / startDistance;
  const startUy = (targetCy - start.y) / startDistance;
  const endUx = (targetCx - end.x) / endDistance;
  const endUy = (targetCy - end.y) / endDistance;
  const c1x = start.x + startUx * bend;
  const c1y = start.y + startUy * bend;
  const c2x = end.x - endUx * bend;
  const c2y = end.y - endUy * bend;
  return `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
}

function installStyles(root = document) {
  if (root.querySelector("#timeline-map-styles")) return;
  const style = root.createElement("style");
  style.id = "timeline-map-styles";
  style.textContent = `
    #map-mode.timeline-enabled { grid-template-columns: repeat(4, minmax(0, 1fr)); width: 440px; }
    .timeline-year-guide { stroke: #d8ddda; stroke-width: 1; stroke-dasharray: 3 6; }
    .timeline-band { fill: var(--timeline-cluster-band, #fafaf6); stroke: var(--timeline-cluster-accent, #e0e4e0); stroke-width: 1.2; }
    .timeline-citation-edge { fill: none; stroke: #9ca6a6; stroke-width: 1; opacity: .18; pointer-events: none; }
    .timeline-citation-edge.selected { stroke: #47545e; stroke-width: 1.8; opacity: .62; }
    .timeline-paper { cursor: pointer; outline: none; }
    .timeline-paper rect { fill: var(--timeline-cluster-paper, #fffef9); stroke: var(--timeline-cluster-accent, #69757e); stroke-width: 1.3; }
    .timeline-paper:hover rect, .timeline-paper:focus rect { fill: #fff6cd; stroke: #26333e; stroke-width: 1.5; }
    .timeline-paper.citation-neighbor rect { stroke: #3f4b55; stroke-width: 2.5; }
    .timeline-paper.selected rect { fill: #f6c445; stroke: #1f2933; stroke-width: 2.8; }
    .timeline-paper.starred rect { stroke: #ad7810; stroke-width: 2; }
    .timeline-paper.selected.starred rect { stroke: #1f2933; stroke-width: 2.8; }
    .timeline-paper-year { fill: var(--timeline-cluster-accent, #7d878e); font-size: 8px; font-weight: 850; }
    .timeline-paper-title { fill: #202b35; font-size: 10px; font-weight: 800; }
    .timeline-paper-meta { fill: #79838b; font-size: 8px; font-weight: 650; }
    .timeline-paper-star { fill: #a56f08; font-size: 12px; font-weight: 900; text-anchor: end; }
    .timeline-empty { fill: #7d878e; font-size: 13px; font-weight: 650; }
    .timeline-sticky-overlay { pointer-events: none; }
    .timeline-sticky-year-strip { fill: rgba(255, 254, 249, .94); stroke: #e0e3df; stroke-width: 0 0 1 0; }
    .timeline-sticky-year-label { fill: #5f6971; font-size: clamp(10px, 1vw, 12px); font-weight: 850; text-anchor: middle; }
    .timeline-sticky-theme-bg { fill: var(--timeline-cluster-band, #fafaf6); stroke: var(--timeline-cluster-accent, #cfd4d1); stroke-width: 1; }
    .timeline-sticky-theme-name { fill: var(--timeline-cluster-accent, #25313b); font-size: clamp(11px, 1.05vw, 13px); font-weight: 850; }
    .timeline-sticky-theme-terms { fill: #657079; font-size: clamp(8px, .8vw, 10px); font-weight: 650; }
    @media (max-width: 720px) {
      #map-mode.timeline-enabled { width: 100%; }
      #map-mode.timeline-enabled button { padding-inline: 7px; }
      .timeline-sticky-theme-name { font-size: 11px; }
      .timeline-sticky-theme-terms { font-size: 8px; }
    }
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
  if (!paperId) return;
  root.dispatchEvent(new CustomEvent("paper-map-timeline-paper-activate", {
    bubbles: true,
    detail: { paperId },
  }));
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
  let stickyOverlay = null;

  function removeStickyOverlay() {
    stickyOverlay?.remove();
    stickyOverlay = null;
  }

  function rebuildStickyOverlay() {
    removeStickyOverlay();
    if (!active || !currentLayout) return;
    stickyOverlay = svgElement("g", { class: "timeline-sticky-overlay", "aria-hidden": "true" });

    const yearStrip = svgElement("rect", {
      x: 0,
      y: 0,
      width: Math.max(1, svg.clientWidth || 1200),
      height: 28,
      class: "timeline-sticky-year-strip",
    });
    const yearLayer = svgElement("g", { class: "timeline-sticky-years" });
    for (let index = 0; index < currentLayout.years.length; index += 1) {
      const label = svgElement("text", {
        y: 18,
        class: "timeline-sticky-year-label",
        "data-year-index": index,
      });
      label.textContent = String(currentLayout.years[index]);
      yearLayer.append(label);
    }

    const themeLayer = svgElement("g", { class: "timeline-sticky-themes" });
    for (const band of currentLayout.groups) {
      const color = timelineClusterColor(band.index);
      const group = svgElement("g", {
        class: "timeline-sticky-theme",
        "data-band-index": band.index,
        style: `--timeline-cluster-band:${color.band};--timeline-cluster-accent:${color.accent}`,
      });
      const bg = svgElement("rect", { x: 0, y: 0, width: LEFT_GUTTER, height: 38, class: "timeline-sticky-theme-bg" });
      const name = svgElement("text", { x: 10, y: 15, class: "timeline-sticky-theme-name" });
      name.textContent = band.name;
      const terms = svgElement("text", { x: 10, y: 30, class: "timeline-sticky-theme-terms" });
      terms.textContent = shortText(band.label, 22);
      group.append(bg, name, terms);
      themeLayer.append(group);
    }

    stickyOverlay.append(yearStrip, yearLayer, themeLayer);
    svg.append(stickyOverlay);
    updateStickyOverlay();
  }

  function updateStickyOverlay() {
    if (!stickyOverlay || !currentLayout) return;
    const width = Math.max(1, svg.clientWidth || 1200);
    const height = Math.max(1, svg.clientHeight || 720);
    stickyOverlay.querySelector(".timeline-sticky-year-strip")?.setAttribute("width", String(width));
    const tickStep = timelineYearTickStep(timelineTransform.k);

    for (const guide of viewport.querySelectorAll(".timeline-year-guide[data-year-index]")) {
      const index = Number(guide.dataset.yearIndex);
      const show = index % tickStep === 0 || index === currentLayout.years.length - 1;
      guide.style.display = show ? "" : "none";
    }

    for (const label of stickyOverlay.querySelectorAll(".timeline-sticky-year-label[data-year-index]")) {
      const index = Number(label.dataset.yearIndex);
      const worldX = LEFT_GUTTER + index * YEAR_STEP + CARD_WIDTH / 2;
      const x = timelineTransform.x + worldX * timelineTransform.k;
      const showTick = index % tickStep === 0 || index === currentLayout.years.length - 1;
      const visible = showTick && x >= 30 && x <= width - 12;
      label.style.display = visible ? "" : "none";
      if (visible) label.setAttribute("x", String(x));
    }

    for (const group of stickyOverlay.querySelectorAll(".timeline-sticky-theme[data-band-index]")) {
      const band = currentLayout.groups[Number(group.dataset.bandIndex)];
      if (!band) continue;
      const screenTop = timelineTransform.y + band.y * timelineTransform.k;
      const screenBottom = timelineTransform.y + (band.y + band.height) * timelineTransform.k;
      const visible = screenBottom > 29 && screenTop < height;
      group.style.display = visible ? "" : "none";
      if (!visible) continue;
      const maxY = Math.max(30, Math.min(height - 40, screenBottom - 40));
      const y = Math.max(30, Math.min(maxY, screenTop + 7));
      group.setAttribute("transform", `translate(0 ${y})`);
    }
  }

  function applyTimelineTransform() {
    if (currentLayout) {
      timelineTransform = clampTimelineTransform(
        timelineTransform,
        Math.max(1, svg.clientWidth || 1200),
        Math.max(1, svg.clientHeight || 720),
        currentLayout.width,
        currentLayout.height,
      );
    }
    viewport.setAttribute("transform", `translate(${timelineTransform.x} ${timelineTransform.y}) scale(${timelineTransform.k})`);
    updateStickyOverlay();
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
    const graphConfig = loadGraphConfig();

    viewport.replaceChildren();
    syncModeButtons();
    if (mapHelp) {
      mapHelp.textContent = "Drag background to pan · pinch or wheel to zoom";
    }

    if (!papers.length) {
      currentLayout = null;
      removeStickyOverlay();
      const text = svgElement("text", { x: 28, y: 44, class: "timeline-empty" });
      text.textContent = "No papers match the current filters.";
      viewport.append(text);
      applyTimelineTransform();
      return;
    }

    const viewportWidth = Math.max(800, svg.clientWidth || 1200);
    const viewportHeight = Math.max(520, svg.clientHeight || 720);
    const layout = buildTimelineLayout(
      papers,
      viewportWidth,
      viewportHeight,
      graphConfig.timelineClusterCount,
      { fields: graphConfig.timelineClusterFields },
    );
    currentLayout = layout;
    const clusteringSignature = `${graphConfig.timelineClusterCount}:${graphConfig.timelineClusterFields.join(",")}`;
    const signature = `${viewportWidth}x${viewportHeight}|${clusteringSignature}|${papers.map((paper) => `${paper.id}:${paper.year || ""}:${paper.title || ""}:${(paper.keywords || []).join?.("|") || paper.keywords || ""}:${String(paper.abstract || "").length}:${(paper.authors || []).join?.("|") || paper.authors || ""}:${paper.venue || ""}`).sort().join(";")}`;
    const shouldReset = signature !== currentSignature;
    currentSignature = signature;

    const guideLayer = svgElement("g", { class: "timeline-guides" });
    const bandLayer = svgElement("g", { class: "timeline-bands" });
    const edgeLayer = svgElement("g", { class: "timeline-citation-edges" });
    const paperLayer = svgElement("g", { class: "timeline-papers" });
    viewport.append(guideLayer, bandLayer, edgeLayer, paperLayer);

    for (let index = 0; index < layout.years.length; index += 1) {
      const x = LEFT_GUTTER + index * YEAR_STEP + CARD_WIDTH / 2;
      const line = svgElement("line", {
        x1: x,
        y1: 28,
        x2: x,
        y2: layout.height - 24,
        class: "timeline-year-guide",
        "data-year-index": index,
      });
      guideLayer.append(line);
    }

    for (const band of layout.groups) {
      const color = timelineClusterColor(band.index);
      const bandGroup = svgElement("g", {
        class: "timeline-band-group",
        "data-timeline-cluster-index": band.index,
        "data-timeline-cluster-color": color.accent,
        style: `--timeline-cluster-band:${color.band};--timeline-cluster-paper:${color.paper};--timeline-cluster-accent:${color.accent}`,
      });
      const rect = svgElement("rect", {
        x: 0,
        y: band.y,
        width: layout.width,
        height: band.height,
        rx: 8,
        class: "timeline-band",
      });
      bandGroup.append(rect);
      bandLayer.append(bandGroup);
    }

    const nodeById = new Map(layout.nodes.map((node) => [node.paper.id, node]));
    const citationNeighbors = new Set();
    if (selectedId) {
      for (const edge of citations) {
        if (edge.source === selectedId) citationNeighbors.add(edge.target);
        if (edge.target === selectedId) citationNeighbors.add(edge.source);
      }
    }
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
        "data-source-paper-id": edge.source,
        "data-target-paper-id": edge.target,
      });
      const title = svgElement("title");
      title.textContent = `Cites · ${edge.source} → ${edge.target}`;
      path.append(title);
      edgeLayer.append(path);
    }

    for (const node of layout.nodes) {
      const paper = node.paper;
      const color = timelineClusterColor(node.groupIndex);
      const group = svgElement("g", {
        class: `timeline-paper${paper.id === selectedId ? " selected" : ""}${paper.starred ? " starred" : ""}${citationNeighbors.has(paper.id) ? " citation-neighbor" : ""}`,
        transform: `translate(${node.x} ${node.y})`,
        tabindex: "0",
        role: "button",
        "data-paper-id": paper.id,
        "data-timeline-cluster-index": node.groupIndex,
        "data-timeline-cluster-color": color.accent,
        style: `--timeline-cluster-band:${color.band};--timeline-cluster-paper:${color.paper};--timeline-cluster-accent:${color.accent}`,
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
      const star = paper.starred ? svgElement("text", { x: CARD_WIDTH - 8, y: 15, class: "timeline-paper-star" }) : null;
      if (star) star.textContent = "★";
      const tooltip = svgElement("title");
      tooltip.textContent = `${paper.title || "Untitled"}\n${(paper.authors || []).join(", ")}\n${paper.year || "Year unknown"}${paper.venue ? `\n${paper.venue}` : ""}`;
      group.append(rect, year, title, meta);
      if (star) group.append(star);
      group.append(tooltip);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          selectPaperThroughApp(root, paper.id);
        }
      });
      paperLayer.append(group);
    }

    rebuildStickyOverlay();
    if (shouldReset) resetTimelineView();
    else applyTimelineTransform();
  }

  function syncTimelineSelectionClasses(selectedId = null) {
    if (!active) return;
    const neighbors = new Set();
    for (const edge of viewport.querySelectorAll(".timeline-citation-edge[data-source-paper-id][data-target-paper-id]")) {
      const source = edge.dataset.sourcePaperId;
      const target = edge.dataset.targetPaperId;
      const selected = Boolean(selectedId && (source === selectedId || target === selectedId));
      edge.classList.toggle("selected", selected);
      if (!selected) continue;
      neighbors.add(source === selectedId ? target : source);
    }
    for (const paper of viewport.querySelectorAll(".timeline-paper[data-paper-id]")) {
      paper.classList.toggle("selected", Boolean(selectedId && paper.dataset.paperId === selectedId));
      paper.classList.toggle("citation-neighbor", neighbors.has(paper.dataset.paperId));
    }
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
    removeStickyOverlay();
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
  root.addEventListener?.("paper-map-graph-config-changed", queueRender);
  root.addEventListener?.("paper-map-timeline-paper-activate", (event) => {
    syncTimelineSelectionClasses(event.detail?.paperId || null);
  });
  root.addEventListener?.("paper-map-timeline-background-activate", () => {
    syncTimelineSelectionClasses(null);
  });

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
