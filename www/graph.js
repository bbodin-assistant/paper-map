import { isResearchRelation, relationLabel } from "./research-relations.js";
import { applyLocalRepulsion, fitTransform, layoutDimensions, layoutIterationBudget } from "./graph-layout.js";
import { paperEntrySource } from "./paper-source.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.2;
const ITEM_DRAG_THRESHOLD = 6;
const PAPER_NODE_STYLE = `
.paper-node.manual-added { --paper-node-fill: #dcecff; --paper-node-stroke: #517aa3; }
.paper-node.auto-added { --paper-node-fill: #e1f2e6; --paper-node-stroke: #5c8266; }
.paper-node.starred { --paper-node-fill: #ffe5a3; --paper-node-stroke: #ad7810; }
.paper-node-circle { fill: var(--paper-node-fill, #fffdf5); stroke: var(--paper-node-stroke, #58646e); }
`;

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  return element;
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value || "")) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function shortTitle(value, max = 34) {
  const text = String(value || "Untitled").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function paperNodeKind(paper) {
  if (paper?.starred) return "starred";
  const source = paperEntrySource(paper);
  if (source.endsWith("-expansion")) return "auto-added";
  if (source.endsWith("-resolve")) return "manual-added";
  return "other";
}

function paperNodeKindLabel(kind) {
  if (kind === "starred") return "Starred";
  if (kind === "manual-added") return "Manually added";
  if (kind === "auto-added") return "Automatically added";
  return "Imported or other source";
}

export function citationRadius(paper) {
  const count = Number(paper?.citationCount);
  if (!Number.isFinite(count) || count <= 0) return 8;
  return Math.max(8, Math.min(15, 8 + Math.log10(count + 1) * 1.75));
}

export function directedSegment(source, target, targetPadding = 6) {
  const dx = Number(target.x) - Number(source.x);
  const dy = Number(target.y) - Number(source.y);
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const sourceRadius = Math.max(0, Number(source.radius) || 0);
  const targetRadius = Math.max(0, Number(target.radius) || 0) + targetPadding;
  return {
    x1: Number(source.x) + ux * sourceRadius,
    y1: Number(source.y) + uy * sourceRadius,
    x2: Number(target.x) - ux * targetRadius,
    y2: Number(target.y) - uy * targetRadius,
  };
}

export function pinchZoomTransform(startTransform, startMidpoint, startDistance, currentMidpoint, currentDistance) {
  const startK = Math.max(0.001, Number(startTransform?.k) || 1);
  const ratio = Math.max(0.001, Number(currentDistance) || 0) / Math.max(0.001, Number(startDistance) || 0);
  const nextK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startK * ratio));
  const worldX = (Number(startMidpoint.x) - Number(startTransform.x || 0)) / startK;
  const worldY = (Number(startMidpoint.y) - Number(startTransform.y || 0)) / startK;
  return {
    k: nextK,
    x: Number(currentMidpoint.x) - worldX * nextK,
    y: Number(currentMidpoint.y) - worldY * nextK,
  };
}

export function buildTopicGraph(papers, edges, topics) {
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const blocks = new Map();

  for (const paper of papers) {
    const paperTopics = (paper.topics || []).filter(Boolean);
    for (const topicId of paperTopics) {
      if (!blocks.has(topicId)) {
        blocks.set(topicId, {
          id: topicId,
          name: topicById.get(topicId)?.name || topicId,
          source: topicById.get(topicId)?.source || "derived",
          paperIds: [],
          starred: 0,
        });
      }
      const block = blocks.get(topicId);
      block.paperIds.push(paper.id);
      if (paper.starred) block.starred += 1;
    }
  }

  const connections = new Map();
  for (const edge of edges) {
    const sourcePaper = paperById.get(edge.source);
    const targetPaper = paperById.get(edge.target);
    if (!sourcePaper || !targetPaper) continue;
    const sourceTopics = (sourcePaper.topics || []).filter(Boolean);
    const targetTopics = (targetPaper.topics || []).filter(Boolean);
    if (!sourceTopics.length || !targetTopics.length) continue;
    for (const source of sourceTopics) {
      for (const target of targetTopics) {
        if (source === target) continue;
        const key = `${source}->${target}`;
        const current = connections.get(key) || { source, target, weight: 0 };
        current.weight += 1;
        connections.set(key, current);
      }
    }
  }

  return { blocks: Array.from(blocks.values()), connections: Array.from(connections.values()) };
}

function authorKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildAuthorGraph(papers, edges = [], linkMode = "coauthors") {
  const blocks = new Map();
  const authorsByPaper = new Map();

  for (const paper of papers) {
    const authors = [];
    const seen = new Set();
    for (const rawName of paper.authors || []) {
      const name = String(rawName || "").replace(/\s+/g, " ").trim();
      const key = authorKey(name);
      if (!name || !key || seen.has(key)) continue;
      seen.add(key);
      const id = `author:${key}`;
      authors.push(id);
      if (!blocks.has(id)) {
        blocks.set(id, { id, name, source: "author", paperIds: [], starred: 0, coauthorCount: 0 });
      }
      const block = blocks.get(id);
      block.paperIds.push(paper.id);
      if (paper.starred) block.starred += 1;
    }
    authorsByPaper.set(paper.id, authors);
  }

  const coauthors = new Map(Array.from(blocks.keys(), (id) => [id, new Set()]));
  for (const paper of papers) {
    const authors = authorsByPaper.get(paper.id) || [];
    for (let left = 0; left < authors.length; left += 1) {
      for (let right = left + 1; right < authors.length; right += 1) {
        coauthors.get(authors[left])?.add(authors[right]);
        coauthors.get(authors[right])?.add(authors[left]);
      }
    }
  }
  for (const block of blocks.values()) block.coauthorCount = coauthors.get(block.id)?.size || 0;

  const connections = new Map();
  if (linkMode === "citations") {
    for (const edge of edges) {
      if (isResearchRelation(edge)) continue;
      const sourceAuthors = authorsByPaper.get(edge.source) || [];
      const targetAuthors = authorsByPaper.get(edge.target) || [];
      if (!sourceAuthors.length || !targetAuthors.length) continue;
      for (const source of sourceAuthors) {
        for (const target of targetAuthors) {
          if (source === target) continue;
          const key = `${source}->${target}`;
          const current = connections.get(key) || { source, target, weight: 0, paperIds: [] };
          current.weight += 1;
          current.paperIds.push(edge.source);
          connections.set(key, current);
        }
      }
    }
  } else {
    for (const paper of papers) {
      const authors = authorsByPaper.get(paper.id) || [];
      for (let left = 0; left < authors.length; left += 1) {
        for (let right = left + 1; right < authors.length; right += 1) {
          const first = authors[left];
          const second = authors[right];
          const [source, target] = first < second ? [first, second] : [second, first];
          const key = `${source}<->${target}`;
          const current = connections.get(key) || { source, target, weight: 0, paperIds: [] };
          current.weight += 1;
          current.paperIds.push(paper.id);
          connections.set(key, current);
        }
      }
    }
  }

  return { blocks: Array.from(blocks.values()), connections: Array.from(connections.values()) };
}

export function hierarchicalBlockLayout(blocks = [], connections = [], viewportWidth = 1200, viewportHeight = 720) {
  if (!blocks.length) {
    return { width: Math.max(800, Number(viewportWidth) || 1200), height: Math.max(520, Number(viewportHeight) || 720), blocks: [] };
  }

  const sorted = [...blocks].sort((left, right) =>
    right.paperIds.length - left.paperIds.length || left.name.localeCompare(right.name));
  const ids = new Set(sorted.map((block) => block.id));
  const outgoing = new Map(sorted.map((block) => [block.id, new Set()]));
  const incoming = new Map(sorted.map((block) => [block.id, new Set()]));
  for (const connection of connections) {
    if (!ids.has(connection.source) || !ids.has(connection.target) || connection.source === connection.target) continue;
    outgoing.get(connection.source).add(connection.target);
    incoming.get(connection.target).add(connection.source);
  }

  const levels = new Map();
  const remainingIndegree = new Map(sorted.map((block) => [block.id, incoming.get(block.id).size]));
  const queue = sorted.filter((block) => remainingIndegree.get(block.id) === 0).map((block) => block.id);
  for (const id of queue) levels.set(id, 0);

  while (queue.length) {
    const source = queue.shift();
    const sourceLevel = levels.get(source) || 0;
    for (const target of outgoing.get(source) || []) {
      levels.set(target, Math.max(levels.get(target) || 0, sourceLevel + 1));
      remainingIndegree.set(target, Math.max(0, (remainingIndegree.get(target) || 0) - 1));
      if (remainingIndegree.get(target) === 0) queue.push(target);
    }
  }

  for (const block of sorted) {
    if (levels.has(block.id)) continue;
    const predecessorLevels = Array.from(incoming.get(block.id) || [])
      .map((id) => levels.get(id))
      .filter(Number.isFinite);
    levels.set(block.id, predecessorLevels.length ? Math.max(...predecessorLevels) + 1 : 0);
    const cycleQueue = [block.id];
    while (cycleQueue.length) {
      const source = cycleQueue.shift();
      const sourceLevel = levels.get(source) || 0;
      for (const target of outgoing.get(source) || []) {
        if (levels.has(target)) continue;
        levels.set(target, sourceLevel + 1);
        cycleQueue.push(target);
      }
    }
  }

  const rowsPerColumn = Math.max(4, Math.min(8, Math.floor((Math.max(520, Number(viewportHeight) || 720) - 100) / 92)));
  const byLevel = new Map();
  for (const block of sorted) {
    const level = levels.get(block.id) || 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(block);
  }

  const ordered = Array.from(byLevel.keys())
    .sort((a, b) => a - b)
    .flatMap((level) => byLevel.get(level).map((block) => ({ block, level })));
  const positioned = ordered.map(({ block, level }, index) => {
    const visualColumn = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    return {
      ...block,
      hierarchyLevel: level,
      x: 34 + visualColumn * 245,
      y: 54 + row * 110,
      width: 210,
      height: Math.max(68, Math.min(96, 64 + block.paperIds.length * 5)),
    };
  });
  const visualColumns = Math.ceil(positioned.length / rowsPerColumn);
  const maxRows = Math.min(rowsPerColumn, positioned.length);

  return {
    width: Math.max(Number(viewportWidth) || 1200, 68 + Math.max(1, visualColumns) * 245),
    height: Math.max(Number(viewportHeight) || 720, 94 + Math.max(1, maxRows) * 110),
    blocks: positioned,
  };
}

export function rankedBlockLayout(blocks = [], metric = () => 0, viewportWidth = 1200, viewportHeight = 720) {
  if (!blocks.length) {
    return { width: Math.max(800, Number(viewportWidth) || 1200), height: Math.max(520, Number(viewportHeight) || 720), blocks: [] };
  }

  const values = Array.from(new Set(blocks.map((block) => Number(metric(block)) || 0))).sort((a, b) => b - a);
  const columnByValue = new Map(values.map((value, index) => [value, index]));
  const byColumn = new Map(values.map((_, index) => [index, []]));
  for (const block of blocks) {
    const value = Number(metric(block)) || 0;
    byColumn.get(columnByValue.get(value)).push(block);
  }
  for (const column of byColumn.values()) {
    column.sort((left, right) =>
      right.paperIds.length - left.paperIds.length || left.name.localeCompare(right.name));
  }

  const positioned = [];
  let maxRows = 0;
  for (let column = 0; column < values.length; column += 1) {
    const columnBlocks = byColumn.get(column) || [];
    maxRows = Math.max(maxRows, columnBlocks.length);
    columnBlocks.forEach((block, row) => {
      positioned.push({
        ...block,
        rankValue: values[column],
        x: 34 + column * 245,
        y: 54 + row * 110,
        width: 210,
        height: Math.max(68, Math.min(96, 64 + block.paperIds.length * 5)),
      });
    });
  }

  return {
    width: Math.max(Number(viewportWidth) || 1200, 68 + Math.max(1, values.length) * 245),
    height: Math.max(Number(viewportHeight) || 720, 94 + Math.max(1, maxRows) * 110),
    blocks: positioned,
  };
}

export function gravityIterationBudget(nodeCount) {
  return Math.min(900, Math.max(220, Math.round(layoutIterationBudget(nodeCount) * 2.5)));
}

export function gravityBlockLayout(blocks = [], connections = [], viewportWidth = 1200, viewportHeight = 720) {
  if (!blocks.length) {
    return { width: Math.max(800, Number(viewportWidth) || 1200), height: Math.max(520, Number(viewportHeight) || 720), blocks: [] };
  }

  const logical = layoutDimensions(viewportWidth, viewportHeight, blocks.length);
  const width = logical.width;
  const height = logical.height;
  const sorted = [...blocks].sort((left, right) => left.id.localeCompare(right.id));
  const nodes = sorted.map((block, index) => {
    const random = hash(block.id);
    const angle = ((random % 360) / 180) * Math.PI;
    const ring = 80 + ((random >>> 9) % Math.max(100, Math.floor(Math.min(width, height) * 0.36)));
    const blockHeight = Math.max(68, Math.min(96, 64 + block.paperIds.length * 5));
    return {
      ...block,
      index,
      width: 210,
      height: blockHeight,
      radius: Math.hypot(105, blockHeight / 2),
      x: width / 2 + Math.cos(angle) * ring,
      y: height / 2 + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      fixed: false,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visibleConnections = connections.filter((connection) => nodeById.has(connection.source) && nodeById.has(connection.target));
  const iterations = gravityIterationBudget(nodes.length);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = Math.max(0.08, 1 - iteration / iterations);
    for (const node of nodes) {
      node.vx *= 0.76;
      node.vy *= 0.76;
      node.vx += (width / 2 - node.x) * 0.0007 * cooling;
      node.vy += (height / 2 - node.y) * 0.0007 * cooling;
    }

    applyLocalRepulsion(nodes, cooling, { cellSize: 320, padding: 34 });

    for (const connection of visibleConnections) {
      const source = nodeById.get(connection.source);
      const target = nodeById.get(connection.target);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = 245;
      const strength = Math.min(2.5, 0.65 + Math.log2((Number(connection.weight) || 1) + 1));
      const pull = (distance - desired) * 0.0018 * strength * cooling;
      source.vx += (dx / distance) * pull;
      source.vy += (dy / distance) * pull;
      target.vx -= (dx / distance) * pull;
      target.vy -= (dy / distance) * pull;
    }

    for (const node of nodes) {
      node.x = Math.max(24, Math.min(width - node.width - 24, node.x + node.vx));
      node.y = Math.max(30, Math.min(height - node.height - 30, node.y + node.vy));
    }
  }

  return { width, height, blocks: nodes };
}

export function aggregateBlockLayout(kind, technique, blocks = [], connections = [], viewportWidth = 1200, viewportHeight = 720) {
  if (technique === "gravity") return gravityBlockLayout(blocks, connections, viewportWidth, viewportHeight);
  if (technique === "hierarchy") return hierarchicalBlockLayout(blocks, connections, viewportWidth, viewportHeight);
  if (kind === "author") {
    return rankedBlockLayout(blocks, (block) => block.coauthorCount, viewportWidth, viewportHeight);
  }
  return rankedBlockLayout(blocks, (block) => block.paperIds.length, viewportWidth, viewportHeight);
}

function blockSegment(source, target, padding = 5) {
  const sourceCx = source.x + source.width / 2;
  const sourceCy = source.y + source.height / 2;
  const targetCx = target.x + target.width / 2;
  const targetCy = target.y + target.height / 2;
  const dx = targetCx - sourceCx;
  const dy = targetCy - sourceCy;

  function boundary(block, cx, cy, towardX, towardY, extra) {
    const bx = towardX - cx;
    const by = towardY - cy;
    const halfW = Math.max(1, block.width / 2 + extra);
    const halfH = Math.max(1, block.height / 2 + extra);
    const scale = 1 / Math.max(Math.abs(bx) / halfW, Math.abs(by) / halfH, 0.001);
    return { x: cx + bx * scale, y: cy + by * scale };
  }

  const start = boundary(source, sourceCx, sourceCy, targetCx, targetCy, 0);
  const end = boundary(target, targetCx, targetCy, sourceCx, sourceCy, padding);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x1: sourceCx, y1: sourceCy, x2: targetCx, y2: targetCy };
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

export function createGraph({ svg, onSelectPaper, onSelectTopic, onSelectAuthor }) {
  const root = svgElement("g", { class: "graph-viewport" });
  svg.append(root);

  const defs = svgElement("defs");
  const paperNodeStyle = svgElement("style");
  paperNodeStyle.textContent = PAPER_NODE_STYLE;
  const citationMarker = svgElement("marker", {
    id: "citation-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto",
    markerUnits: "userSpaceOnUse",
  });
  citationMarker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "citation-arrow" }));
  const relationMarker = svgElement("marker", {
    id: "research-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto",
    markerUnits: "userSpaceOnUse",
  });
  relationMarker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "research-arrow" }));
  defs.append(paperNodeStyle, citationMarker, relationMarker);
  svg.prepend(defs);

  let transform = { x: 0, y: 0, k: 1 };
  let animationFrame = null;
  let renderToken = 0;
  let lastCitationTopology = "";
  let lastAggregateTopology = "";
  let currentWorld = null;
  const citationLayout = new Map();
  const pinnedPapers = new Set();
  const topicLayout = new Map();
  const pinnedTopics = new Set();
  let currentPaperNodes = new Map();
  let currentTopicBlocks = new Map();
  let currentAggregateKind = null;
  let currentDraw = null;
  let currentReheat = null;
  let activePointers = new Map();
  let panGesture = null;
  let pinchGesture = null;
  let itemDrag = null;
  let suppressNextClick = false;

  function applyTransform() {
    root.setAttribute("transform", `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
    svg.dataset.graphX = String(transform.x);
    svg.dataset.graphY = String(transform.y);
    svg.dataset.graphZoom = String(transform.k);
  }

  function stopAnimation() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function clear() {
    stopAnimation();
    root.replaceChildren();
    currentPaperNodes = new Map();
    currentTopicBlocks = new Map();
    currentDraw = null;
    currentReheat = null;
  }

  function empty(message) {
    clear();
    currentWorld = null;
    const text = svgElement("text", { x: 28, y: 44, class: "graph-empty" });
    text.textContent = message;
    root.append(text);
  }

  function resetView() {
    if (currentWorld) {
      transform = fitTransform(
        currentWorld.viewportWidth,
        currentWorld.viewportHeight,
        currentWorld.width,
        currentWorld.height,
        { minZoom: MIN_ZOOM, maxZoom: 1 },
      );
    } else {
      transform = { x: 0, y: 0, k: 1 };
    }
    applyTransform();
  }

  function consumeSuppressedClick(event) {
    if (!suppressNextClick) return false;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function renderCitationMap(papers, edges, selectedId) {
    currentAggregateKind = null;
    if (!papers.length) {
      empty("No papers match the current filters.");
      lastCitationTopology = "";
      return;
    }

    clear();
    lastAggregateTopology = "";
    const token = ++renderToken;
    const viewportWidth = Math.max(800, svg.clientWidth || 1200);
    const viewportHeight = Math.max(520, svg.clientHeight || 720);
    const logical = layoutDimensions(viewportWidth, viewportHeight, papers.length);
    const width = logical.width;
    const height = logical.height;
    currentWorld = { width, height, viewportWidth, viewportHeight };
    const years = papers.map((paper) => Number(paper.year)).filter(Number.isFinite);
    const minYear = years.length ? Math.min(...years) : 2000;
    const maxYear = years.length ? Math.max(...years) : minYear + 1;
    const yearSpan = Math.max(1, maxYear - minYear);
    const topology = [...papers].map((paper) => paper.id).sort().join("|");
    const firstCitationRender = !lastCitationTopology;
    const topologyChanged = topology !== lastCitationTopology;
    lastCitationTopology = topology;

    if (firstCitationRender && logical.scale > 1) {
      transform = fitTransform(viewportWidth, viewportHeight, width, height, { minZoom: MIN_ZOOM, maxZoom: 1 });
      applyTransform();
    }

    const nodes = papers.map((paper, index) => {
      const cached = citationLayout.get(paper.id);
      const year = Number(paper.year);
      const yearRatio = Number.isFinite(year) ? (year - minYear) / yearSpan : 0.5;
      const random = hash(paper.id);
      return {
        paper,
        x: cached?.x ?? 100 + yearRatio * (width - 220) + ((random % 41) - 20),
        y: cached?.y ?? 70 + ((random >>> 8) % Math.max(200, height - 140)),
        vx: 0,
        vy: 0,
        radius: citationRadius(paper),
        index,
        fixed: pinnedPapers.has(paper.id),
      };
    });
    const nodeById = new Map(nodes.map((node) => [node.paper.id, node]));
    currentPaperNodes = nodeById;
    const visibleEdges = edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));

    const edgeLayer = svgElement("g", { class: "citation-edges" });
    const labelLayer = svgElement("g", { class: "research-edge-labels" });
    const nodeLayer = svgElement("g", { class: "citation-nodes" });
    root.append(edgeLayer, labelLayer, nodeLayer);

    const edgeElements = visibleEdges.map((edge) => {
      const selected = edge.source === selectedId || edge.target === selectedId;
      const research = isResearchRelation(edge);
      const line = svgElement("line", {
        class: `${research ? "research-edge" : "citation-edge"}${selected ? " selected" : ""}`,
        "marker-end": research ? "url(#research-arrow)" : "url(#citation-arrow)",
        "data-edge-id": edge.id,
      });
      const title = svgElement("title");
      title.textContent = research
        ? `${relationLabel(edge.relation)} · ${edge.source} → ${edge.target}`
        : `Cites · ${edge.source} → ${edge.target}`;
      line.append(title);
      edgeLayer.append(line);
      let label = null;
      if (research) {
        label = svgElement("text", { class: "research-edge-label" });
        label.textContent = relationLabel(edge.relation);
        labelLayer.append(label);
      }
      return { edge, line, label };
    });

    const nodeElements = nodes.map((node) => {
      const paper = node.paper;
      const selected = paper.id === selectedId;
      const nodeKind = paperNodeKind(paper);
      const nodeKindLabel = paperNodeKindLabel(nodeKind);
      const group = svgElement("g", {
        class: `paper-node ${nodeKind}${selected ? " selected" : ""}`,
        tabindex: "0",
        role: "button",
        "data-paper-id": paper.id,
        "data-node-kind": nodeKind,
        "aria-label": `${paper.title}, ${paper.year || "year unknown"}, ${nodeKindLabel}`,
      });
      const halo = svgElement("circle", { class: "paper-node-halo", r: node.radius + 5 });
      const circle = svgElement("circle", { class: "paper-node-circle", r: node.radius });
      const label = svgElement("text", {
        class: "paper-node-label",
        x: node.radius + 7,
        y: 4,
      });
      label.textContent = shortTitle(paper.title);
      const meta = svgElement("text", {
        class: "paper-node-meta",
        x: node.radius + 7,
        y: 17,
      });
      const citationMeta = Number.isFinite(Number(paper.citationCount)) ? `${paper.citationCount} cites` : "";
      meta.textContent = [paper.authors?.[0], paper.year, citationMeta].filter(Boolean).join(" · ");
      const title = svgElement("title");
      title.textContent = `${paper.title}\n${(paper.authors || []).join(", ")}\n${paper.venue || ""} ${paper.year || ""}${citationMeta ? `\n${citationMeta}` : ""}\n${nodeKindLabel}`.trim();
      group.append(halo, circle, label, meta, title);
      group.addEventListener("click", (event) => {
        if (consumeSuppressedClick(event)) return;
        event.stopPropagation();
        onSelectPaper?.(paper.id);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectPaper?.(paper.id);
        }
      });
      nodeLayer.append(group);
      return { node, group };
    });

    function draw() {
      for (const { edge, line, label } of edgeElements) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        const segment = directedSegment(source, target, isResearchRelation(edge) ? 7 : 6);
        line.setAttribute("x1", segment.x1);
        line.setAttribute("y1", segment.y1);
        line.setAttribute("x2", segment.x2);
        line.setAttribute("y2", segment.y2);
        if (label) {
          label.setAttribute("x", (segment.x1 + segment.x2) / 2);
          label.setAttribute("y", (segment.y1 + segment.y2) / 2 - 4);
        }
      }
      for (const { node, group } of nodeElements) {
        group.setAttribute("transform", `translate(${node.x} ${node.y})`);
        citationLayout.set(node.paper.id, { x: node.x, y: node.y });
      }
    }
    currentDraw = draw;

    let iteration = 0;
    let settledFrames = 0;
    let heat = 1;
    const maxIterations = layoutIterationBudget(papers.length);
    const minimumIterations = Math.min(110, Math.floor(maxIterations * 0.55));
    function simulate() {
      if (token !== renderToken) return;
      iteration += 1;
      const cooling = Math.max(0.055, heat * (1 - iteration / maxIterations));

      for (const node of nodes) {
        if (node.fixed) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx *= 0.8;
        node.vy *= 0.8;
        const year = Number(node.paper.year);
        if (Number.isFinite(year)) {
          const targetX = 100 + ((year - minYear) / yearSpan) * (width - 220);
          node.vx += (targetX - node.x) * 0.0022;
        }
        node.vy += (height / 2 - node.y) * 0.0003;
      }

      applyLocalRepulsion(nodes, cooling);

      for (const edge of visibleEdges) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const desired = isResearchRelation(edge) ? 185 : 155;
        const pull = (distance - desired) * 0.0017 * cooling;
        if (!source.fixed) {
          source.vx += (dx / distance) * pull;
          source.vy += (dy / distance) * pull;
        }
        if (!target.fixed) {
          target.vx -= (dx / distance) * pull;
          target.vy -= (dy / distance) * pull;
        }
      }

      let speedTotal = 0;
      let movingCount = 0;
      for (const node of nodes) {
        if (node.fixed) continue;
        node.x = Math.max(40, Math.min(width - 80, node.x + node.vx));
        node.y = Math.max(35, Math.min(height - 45, node.y + node.vy));
        speedTotal += Math.hypot(node.vx, node.vy);
        movingCount += 1;
      }

      draw();
      const averageSpeed = movingCount ? speedTotal / movingCount : 0;
      if (iteration >= minimumIterations && averageSpeed < 0.045) settledFrames += 1;
      else settledFrames = 0;
      if (iteration < maxIterations && settledFrames < 12) animationFrame = requestAnimationFrame(simulate);
      else animationFrame = null;
    }

    function startSimulation(nextHeat = 1) {
      stopAnimation();
      iteration = 0;
      settledFrames = 0;
      heat = Math.max(0.2, Math.min(1, Number(nextHeat) || 1));
      animationFrame = requestAnimationFrame(simulate);
    }

    currentReheat = () => startSimulation(0.45);
    draw();
    if (topologyChanged) startSimulation(1);
  }

  function renderAggregateMap({
    papers,
    blocks,
    connections,
    selectedBlockIds = [],
    kind = "topic",
    layoutTechnique = kind === "author" ? "coauthors" : "generality",
    emptyMessage,
    onSelectBlock,
  }) {
    currentAggregateKind = kind;
    if (!papers.length) {
      empty("No papers match the current filters.");
      lastAggregateTopology = "";
      return;
    }

    clear();
    lastCitationTopology = "";
    renderToken += 1;
    if (!blocks.length) {
      empty(emptyMessage);
      lastAggregateTopology = "";
      return;
    }

    const viewportWidth = Math.max(800, svg.clientWidth || 1200);
    const viewportHeight = Math.max(520, svg.clientHeight || 720);
    const connectionTopology = connections
      .map((connection) => `${connection.source}>${connection.target}:${connection.weight || 0}`)
      .sort()
      .join("|");
    const topology = `${kind}|${linkMode}|${layoutTechnique}|${blocks.map((block) => block.id).sort().join("|")}|${connectionTopology}`;
    const topologyChanged = topology !== lastAggregateTopology;
    const canReuseLayout = !topologyChanged
      && currentWorld
      && blocks.every((block) => topicLayout.has(block.id));
    const layout = canReuseLayout
      ? {
          width: currentWorld.width,
          height: currentWorld.height,
          blocks: blocks.map((block) => {
            const cached = topicLayout.get(block.id);
            return {
              ...block,
              x: cached.x,
              y: cached.y,
              width: 210,
              height: Math.max(68, Math.min(96, 64 + block.paperIds.length * 5)),
            };
          }),
        }
      : aggregateBlockLayout(kind, layoutTechnique, blocks, connections, viewportWidth, viewportHeight);
    const width = layout.width;
    const height = layout.height;
    currentWorld = { width, height, viewportWidth, viewportHeight };
    if (topologyChanged) {
      transform = fitTransform(viewportWidth, viewportHeight, width, height, { minZoom: MIN_ZOOM, maxZoom: 1, padding: 40 });
      applyTransform();
    }
    lastAggregateTopology = topology;

    const positioned = layout.blocks.map((block) => {
      const cached = topicLayout.get(block.id);
      const fixed = pinnedTopics.has(block.id);
      return {
        ...block,
        x: fixed && cached ? cached.x : block.x,
        y: fixed && cached ? cached.y : block.y,
        fixed,
      };
    });
    const blockById = new Map(positioned.map((block) => [block.id, block]));
    currentTopicBlocks = blockById;

    const edgeLayer = svgElement("g", { class: `${kind}-edges` });
    const blockLayer = svgElement("g", { class: `${kind}-blocks` });
    root.append(edgeLayer, blockLayer);

    const selectedIds = new Set(Array.isArray(selectedBlockIds) ? selectedBlockIds.filter(Boolean) : []);
    const connectedBlockIds = new Set();
    if (selectedIds.size) {
      for (const connection of connections) {
        if (selectedIds.has(connection.source)) connectedBlockIds.add(connection.target);
        if (selectedIds.has(connection.target)) connectedBlockIds.add(connection.source);
      }
      for (const selectedId of selectedIds) connectedBlockIds.delete(selectedId);
    }

    const edgeElements = [];
    for (const connection of connections) {
      const source = blockById.get(connection.source);
      const target = blockById.get(connection.target);
      if (!source || !target) continue;
      const directed = kind === "topic" || (kind === "author" && linkMode === "citations");
      const focusedConnection = directed
        ? selectedIds.has(connection.source)
        : selectedIds.has(connection.source) || selectedIds.has(connection.target);
      const line = svgElement("line", {
        class: `topic-edge ${kind}-edge${focusedConnection ? " focus-source" : ""}`,
        ...(directed ? { "marker-end": "url(#citation-arrow)" } : {}),
        "stroke-width": Math.max(1, Math.min(7, 1 + Math.log2(connection.weight + 1))),
        "data-source-block-id": connection.source,
        "data-target-block-id": connection.target,
        "data-link-weight": connection.weight,
        "data-link-mode": linkMode,
      });
      const title = svgElement("title");
      title.textContent = kind === "author" && linkMode === "coauthors"
        ? `${source.name} ↔ ${target.name}: co-authored ${connection.weight} paper${connection.weight === 1 ? "" : "s"}`
        : kind === "author"
          ? `${source.name} → ${target.name}: author papers cite ${connection.weight} paper${connection.weight === 1 ? "" : "s"} by this author`
          : `${source.name} → ${target.name}: ${connection.weight} cross-topic link${connection.weight === 1 ? "" : "s"}`;
      line.append(title);
      edgeLayer.append(line);
      edgeElements.push({ connection, line });
    }

    const blockElements = [];
    for (const block of positioned) {
      const selected = selectedIds.has(block.id);
      const connected = connectedBlockIds.has(block.id);
      const group = svgElement("g", {
        class: `topic-block ${kind}-block${connected ? " connected" : ""}${selected ? " selected" : ""}`,
        tabindex: "0",
        role: "button",
        "data-block-id": block.id,
        "data-layout-technique": layoutTechnique,
        "data-paper-count": block.paperIds.length,
        ...(kind === "author" ? { "data-coauthor-count": block.coauthorCount || 0 } : {}),
        ...(kind === "topic" ? { "data-topic-id": block.id } : { "data-author-id": block.id }),
        "aria-label": `${block.name}, ${block.paperIds.length} papers`,
      });
      const rect = svgElement("rect", {
        width: block.width,
        height: block.height,
        rx: 8,
      });
      const name = svgElement("text", { class: "topic-block-name", x: 15, y: 27 });
      name.textContent = shortTitle(block.name, 30);
      const count = svgElement("text", { class: "topic-block-count", x: 15, y: 49 });
      count.textContent = `${block.paperIds.length} paper${block.paperIds.length === 1 ? "" : "s"}`;
      const source = svgElement("text", { class: "topic-block-source", x: 15, y: block.height - 12 });
      const sourceLabel = kind === "author"
        ? `${block.coauthorCount || 0} co-author${block.coauthorCount === 1 ? "" : "s"}`
        : block.source;
      source.textContent = block.starred ? `${sourceLabel} · ★ ${block.starred}` : sourceLabel;
      const title = svgElement("title");
      title.textContent = `${block.name}\n${block.paperIds.length} papers${kind === "author" ? `\n${block.coauthorCount || 0} distinct co-authors` : ""}${block.starred ? `\n${block.starred} starred` : ""}`;
      group.append(rect, name, count, source, title);
      group.addEventListener("click", (event) => {
        if (consumeSuppressedClick(event)) return;
        event.stopPropagation();
        onSelectBlock?.(block, { additive: Boolean(event.ctrlKey || event.metaKey) });
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectBlock?.(block, { additive: Boolean(event.ctrlKey || event.metaKey) });
        }
      });
      blockLayer.append(group);
      blockElements.push({ block, group });
    }

    function draw() {
      for (const { connection, line } of edgeElements) {
        const source = blockById.get(connection.source);
        const target = blockById.get(connection.target);
        const segment = blockSegment(source, target);
        line.setAttribute("x1", segment.x1);
        line.setAttribute("y1", segment.y1);
        line.setAttribute("x2", segment.x2);
        line.setAttribute("y2", segment.y2);
      }
      for (const { block, group } of blockElements) {
        group.setAttribute("transform", `translate(${block.x} ${block.y})`);
        topicLayout.set(block.id, { x: block.x, y: block.y });
      }
    }
    currentDraw = draw;
    draw();
  }

  function renderTopicMap(papers, edges, topics, selectedTopicIds = [], layoutTechnique = "generality") {
    const { blocks, connections } = buildTopicGraph(papers, edges, topics);
    renderAggregateMap({
      papers,
      blocks,
      connections,
      selectedBlockIds: selectedTopicIds,
      kind: "topic",
      layoutTechnique,
      emptyMessage: "No categorized papers match the current filters.",
      onSelectBlock: (block, options) => onSelectTopic?.(block.id, options),
    });
  }

  function renderAuthorMap(papers, edges, selectedAuthors = [], layoutTechnique = "coauthors", linkMode = "coauthors") {
    const { blocks, connections } = buildAuthorGraph(papers, edges, linkMode);
    const selectedKeys = new Set((selectedAuthors || []).map(authorKey).filter(Boolean));
    const selectedBlockIds = blocks
      .filter((block) => selectedKeys.has(authorKey(block.name)))
      .map((block) => block.id);
    renderAggregateMap({
      papers,
      blocks,
      connections,
      selectedBlockIds,
      kind: "author",
      layoutTechnique,
      linkMode,
      emptyMessage: "No author metadata matches the current filters.",
      onSelectBlock: (block, options) => onSelectAuthor?.(block.name, options),
    });
  }

  function render({
    mode = "citations",
    papers = [],
    edges = [],
    topics = [],
    selectedId = null,
    selectedTopicIds = [],
    selectedAuthors = [],
    topicLayoutTechnique = "generality",
    authorLayoutTechnique = "coauthors",
    authorLinkMode = "coauthors",
  }) {
    if (mode === "topics") renderTopicMap(papers, edges, topics, selectedTopicIds, topicLayoutTechnique);
    else if (mode === "authors") renderAuthorMap(papers, edges, selectedAuthors, authorLayoutTechnique, authorLinkMode);
    else renderCitationMap(papers, edges, selectedId);
  }

  function localPoint(event) {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function worldPoint(point) {
    return {
      x: (point.x - transform.x) / transform.k,
      y: (point.y - transform.y) / transform.k,
    };
  }

  function restorePendingItemDrag() {
    if (!itemDrag) return;
    itemDrag.item.fixed = itemDrag.wasFixed;
  }

  function pinActiveItemDrag() {
    if (!itemDrag?.dragging) return;
    if (itemDrag.type === "paper") pinnedPapers.add(itemDrag.id);
    else pinnedTopics.add(itemDrag.id);
  }

  function startPinch() {
    if (activePointers.size < 2) return;
    const [first, second] = Array.from(activePointers.values()).slice(0, 2);
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    pinchGesture = {
      startTransform: { ...transform },
      startMidpoint: midpoint,
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    };
    if (itemDrag?.dragging) pinActiveItemDrag();
    else restorePendingItemDrag();
    itemDrag = null;
    panGesture = null;
    suppressNextClick = true;
    svg.classList.add("dragging");
    svg.classList.remove("dragging-item");
  }

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const pointer = localPoint(event);
    const previous = transform.k;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previous * (event.deltaY > 0 ? 0.9 : 1.1)));
    const worldX = (pointer.x - transform.x) / previous;
    const worldY = (pointer.y - transform.y) / previous;
    transform.k = next;
    transform.x = pointer.x - worldX * next;
    transform.y = pointer.y - worldY * next;
    applyTransform();
  }, { passive: false });

  svg.addEventListener("pointerdown", (event) => {
    const point = localPoint(event);
    activePointers.set(event.pointerId, point);
    try { svg.setPointerCapture(event.pointerId); } catch { /* Synthetic/test pointers may not be capturable. */ }

    if (activePointers.size >= 2) {
      startPinch();
      event.preventDefault();
      return;
    }

    const paperGroup = event.target.closest?.(".paper-node");
    if (paperGroup) {
      const id = paperGroup.dataset.paperId;
      const item = currentPaperNodes.get(id);
      if (item) {
        const world = worldPoint(point);
        itemDrag = {
          type: "paper",
          id,
          item,
          pointerId: event.pointerId,
          offsetX: world.x - item.x,
          offsetY: world.y - item.y,
          start: point,
          dragging: false,
          wasFixed: item.fixed,
        };
        return;
      }
    }

    const topicGroup = event.target.closest?.(".topic-block");
    if (topicGroup) {
      const id = topicGroup.dataset.blockId || topicGroup.dataset.topicId;
      const item = currentTopicBlocks.get(id);
      if (item) {
        const world = worldPoint(point);
        itemDrag = {
          type: topicGroup.classList.contains("author-block") ? "author" : "topic",
          id,
          item,
          pointerId: event.pointerId,
          offsetX: world.x - item.x,
          offsetY: world.y - item.y,
          start: point,
          dragging: false,
          wasFixed: item.fixed,
        };
        return;
      }
    }

    panGesture = { pointerId: event.pointerId, start: point, originX: transform.x, originY: transform.y, moved: false };
    svg.classList.add("dragging");
  });

  svg.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    const point = localPoint(event);
    activePointers.set(event.pointerId, point);

    if (activePointers.size >= 2) {
      if (!pinchGesture) startPinch();
      const [first, second] = Array.from(activePointers.values()).slice(0, 2);
      const currentMidpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const currentDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      transform = pinchZoomTransform(
        pinchGesture.startTransform,
        pinchGesture.startMidpoint,
        pinchGesture.startDistance,
        currentMidpoint,
        currentDistance,
      );
      applyTransform();
      event.preventDefault();
      return;
    }

    if (itemDrag && itemDrag.pointerId === event.pointerId) {
      const dx = point.x - itemDrag.start.x;
      const dy = point.y - itemDrag.start.y;
      if (!itemDrag.dragging) {
        if (Math.hypot(dx, dy) <= ITEM_DRAG_THRESHOLD) return;
        itemDrag.dragging = true;
        itemDrag.item.fixed = true;
        svg.classList.add("dragging-item");
      }

      const world = worldPoint(point);
      itemDrag.item.x = world.x - itemDrag.offsetX;
      itemDrag.item.y = world.y - itemDrag.offsetY;
      if (itemDrag.type === "paper") {
        itemDrag.item.vx = 0;
        itemDrag.item.vy = 0;
        citationLayout.set(itemDrag.id, { x: itemDrag.item.x, y: itemDrag.item.y });
      } else {
        topicLayout.set(itemDrag.id, { x: itemDrag.item.x, y: itemDrag.item.y });
      }
      currentDraw?.();
      event.preventDefault();
      return;
    }

    if (panGesture && panGesture.pointerId === event.pointerId) {
      const dx = point.x - panGesture.start.x;
      const dy = point.y - panGesture.start.y;
      if (Math.hypot(dx, dy) > 3) panGesture.moved = true;
      transform.x = panGesture.originX + dx;
      transform.y = panGesture.originY + dy;
      applyTransform();
      event.preventDefault();
    }
  });

  function endPointer(event) {
    const hadPinch = Boolean(pinchGesture);
    let tappedItem = null;
    let tappedBackground = false;
    if (itemDrag && itemDrag.pointerId === event.pointerId) {
      if (itemDrag.dragging) {
        const draggedType = itemDrag.type;
        suppressNextClick = true;
        pinActiveItemDrag();
        if (draggedType === "paper") currentReheat?.();
        event.preventDefault();
      } else {
        restorePendingItemDrag();
        if (event.type === "pointerup") {
          suppressNextClick = true;
          tappedItem = {
            type: itemDrag.type,
            id: itemDrag.id,
            additive: Boolean(event.ctrlKey || event.metaKey),
          };
        }
      }
      itemDrag = null;
      svg.classList.remove("dragging-item");
    }
    if (panGesture && panGesture.pointerId === event.pointerId) {
      if (panGesture.moved) suppressNextClick = true;
      else if (event.type === "pointerup") {
        suppressNextClick = true;
        tappedBackground = true;
      }
      panGesture = null;
    }

    activePointers.delete(event.pointerId);
    if (hadPinch && activePointers.size < 2) {
      pinchGesture = null;
      suppressNextClick = true;
    }
    if (!activePointers.size) svg.classList.remove("dragging", "dragging-item");
    try {
      if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore capture state differences for cancelled/synthetic pointers.
    }

    if (tappedItem?.type === "paper") onSelectPaper?.(tappedItem.id);
    else if (tappedItem?.type === "topic") onSelectTopic?.(tappedItem.id, { additive: tappedItem.additive });
    else if (tappedItem?.type === "author") onSelectAuthor?.(currentTopicBlocks.get(tappedItem.id)?.name || null, { additive: tappedItem.additive });
    else if (tappedBackground) {
      if (currentAggregateKind === "topic") onSelectTopic?.(null);
      else if (currentAggregateKind === "author") onSelectAuthor?.(null);
      else onSelectPaper?.(null);
    }
  }

  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("click", (event) => {
    if (event.target.closest?.(".paper-node, .topic-block")) return;
    if (consumeSuppressedClick(event)) return;
    if (currentAggregateKind === "topic") onSelectTopic?.(null);
    else if (currentAggregateKind === "author") onSelectAuthor?.(null);
    else onSelectPaper?.(null);
  });

  applyTransform();
  return { render, resetView, stopAnimation };
}
