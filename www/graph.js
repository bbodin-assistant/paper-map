import { isResearchRelation, relationLabel } from "./research-relations.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.2;

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

function primaryTopic(paper) {
  return paper.topics?.[0] || "topic:uncategorized";
}

function buildTopicGraph(papers, edges, topics) {
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const blocks = new Map();

  for (const paper of papers) {
    const paperTopics = paper.topics?.length ? paper.topics : ["topic:uncategorized"];
    for (const topicId of paperTopics) {
      if (!blocks.has(topicId)) {
        blocks.set(topicId, {
          id: topicId,
          name: topicById.get(topicId)?.name || (topicId === "topic:uncategorized" ? "Uncategorized" : topicId),
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
    const sourceTopics = sourcePaper.topics?.length ? sourcePaper.topics : [primaryTopic(sourcePaper)];
    const targetTopics = targetPaper.topics?.length ? targetPaper.topics : [primaryTopic(targetPaper)];
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

export function createGraph({ svg, onSelectPaper, onSelectTopic }) {
  const root = svgElement("g", { class: "graph-viewport" });
  svg.append(root);

  const defs = svgElement("defs");
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
  defs.append(citationMarker, relationMarker);
  svg.prepend(defs);

  let transform = { x: 0, y: 0, k: 1 };
  let animationFrame = null;
  let renderToken = 0;
  let lastCitationTopology = "";
  const citationLayout = new Map();
  const pinnedPapers = new Set();
  const topicLayout = new Map();
  const pinnedTopics = new Set();
  let currentPaperNodes = new Map();
  let currentTopicBlocks = new Map();
  let currentDraw = null;
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
  }

  function empty(message) {
    clear();
    const text = svgElement("text", { x: 28, y: 44, class: "graph-empty" });
    text.textContent = message;
    root.append(text);
  }

  function resetView() {
    transform = { x: 0, y: 0, k: 1 };
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
    if (!papers.length) {
      empty("No papers match the current filters.");
      lastCitationTopology = "";
      return;
    }

    clear();
    const token = ++renderToken;
    const width = Math.max(800, svg.clientWidth || 1200);
    const height = Math.max(520, svg.clientHeight || 720);
    const years = papers.map((paper) => Number(paper.year)).filter(Number.isFinite);
    const minYear = years.length ? Math.min(...years) : 2000;
    const maxYear = years.length ? Math.max(...years) : minYear + 1;
    const yearSpan = Math.max(1, maxYear - minYear);
    const topology = [...papers].map((paper) => paper.id).sort().join("|");
    const topologyChanged = topology !== lastCitationTopology;
    lastCitationTopology = topology;

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
      const group = svgElement("g", {
        class: `paper-node${selected ? " selected" : ""}${paper.starred ? " starred" : ""}`,
        tabindex: "0",
        role: "button",
        "data-paper-id": paper.id,
        "aria-label": `${paper.title}, ${paper.year || "year unknown"}`,
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
      title.textContent = `${paper.title}\n${(paper.authors || []).join(", ")}\n${paper.venue || ""} ${paper.year || ""}${citationMeta ? `\n${citationMeta}` : ""}`.trim();
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
    const maxIterations = papers.length > 250 ? 45 : papers.length > 100 ? 70 : 110;
    function simulate() {
      if (token !== renderToken) return;
      iteration += 1;
      const cooling = Math.max(0.04, 1 - iteration / maxIterations);

      for (const node of nodes) {
        if (node.fixed) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx *= 0.78;
        node.vy *= 0.78;
        const year = Number(node.paper.year);
        if (Number.isFinite(year)) {
          const targetX = 100 + ((year - minYear) / yearSpan) * (width - 220);
          node.vx += (targetX - node.x) * 0.0025;
        }
        node.vy += (height / 2 - node.y) * 0.0004;
      }

      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        const left = nodes[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          const right = nodes[rightIndex];
          let dx = right.x - left.x;
          let dy = right.y - left.y;
          let distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < 1) {
            dx = 1;
            dy = 1;
            distanceSquared = 2;
          }
          if (distanceSquared > 24000) continue;
          const distance = Math.sqrt(distanceSquared);
          const minimum = left.radius + right.radius + 42;
          const strength = distance < minimum ? 1.8 : 90 / distanceSquared;
          const push = strength * cooling;
          if (!left.fixed) {
            left.vx -= (dx / distance) * push;
            left.vy -= (dy / distance) * push;
          }
          if (!right.fixed) {
            right.vx += (dx / distance) * push;
            right.vy += (dy / distance) * push;
          }
        }
      }

      for (const edge of visibleEdges) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const desired = isResearchRelation(edge) ? 175 : 145;
        const pull = (distance - desired) * 0.0018 * cooling;
        if (!source.fixed) {
          source.vx += (dx / distance) * pull;
          source.vy += (dy / distance) * pull;
        }
        if (!target.fixed) {
          target.vx -= (dx / distance) * pull;
          target.vy -= (dy / distance) * pull;
        }
      }

      for (const node of nodes) {
        if (node.fixed) continue;
        node.x = Math.max(40, Math.min(width - 80, node.x + node.vx));
        node.y = Math.max(35, Math.min(height - 45, node.y + node.vy));
      }

      draw();
      if (iteration < maxIterations) animationFrame = requestAnimationFrame(simulate);
      else animationFrame = null;
    }

    draw();
    if (topologyChanged) animationFrame = requestAnimationFrame(simulate);
  }

  function renderTopicMap(papers, edges, topics, selectedTopicId) {
    if (!papers.length) {
      empty("No papers match the current filters.");
      return;
    }

    clear();
    renderToken += 1;
    const { blocks, connections } = buildTopicGraph(papers, edges, topics);
    const width = Math.max(800, svg.clientWidth || 1200);
    const height = Math.max(520, svg.clientHeight || 720);
    const centerX = width / 2;
    const centerY = height / 2;
    const orbitX = Math.max(190, width * 0.32);
    const orbitY = Math.max(150, height * 0.31);

    const positioned = blocks
      .sort((left, right) => right.paperIds.length - left.paperIds.length || left.name.localeCompare(right.name))
      .map((block, index) => {
        const angle = blocks.length === 1 ? 0 : (index / blocks.length) * Math.PI * 2 - Math.PI / 2;
        const blockWidth = Math.max(150, Math.min(260, 128 + block.paperIds.length * 16));
        const blockHeight = Math.max(70, Math.min(130, 62 + block.paperIds.length * 8));
        const cached = topicLayout.get(block.id);
        return {
          ...block,
          x: cached?.x ?? centerX + Math.cos(angle) * orbitX - blockWidth / 2,
          y: cached?.y ?? centerY + Math.sin(angle) * orbitY - blockHeight / 2,
          width: blockWidth,
          height: blockHeight,
          fixed: pinnedTopics.has(block.id),
        };
      });
    const blockById = new Map(positioned.map((block) => [block.id, block]));
    currentTopicBlocks = blockById;

    const edgeLayer = svgElement("g", { class: "topic-edges" });
    const blockLayer = svgElement("g", { class: "topic-blocks" });
    root.append(edgeLayer, blockLayer);

    const edgeElements = [];
    for (const connection of connections) {
      const source = blockById.get(connection.source);
      const target = blockById.get(connection.target);
      if (!source || !target) continue;
      const line = svgElement("line", {
        class: "topic-edge",
        "marker-end": "url(#citation-arrow)",
        "stroke-width": Math.max(1, Math.min(7, 1 + Math.log2(connection.weight + 1))),
      });
      const title = svgElement("title");
      title.textContent = `${source.name} → ${target.name}: ${connection.weight} cross-topic link${connection.weight === 1 ? "" : "s"}`;
      line.append(title);
      edgeLayer.append(line);
      edgeElements.push({ connection, line });
    }

    const blockElements = [];
    for (const block of positioned) {
      const selected = block.id === selectedTopicId;
      const group = svgElement("g", {
        class: `topic-block${selected ? " selected" : ""}`,
        tabindex: "0",
        role: "button",
        "data-topic-id": block.id,
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
      source.textContent = block.starred ? `${block.source} · ★ ${block.starred}` : block.source;
      const title = svgElement("title");
      title.textContent = `${block.name}\n${block.paperIds.length} papers\nSource: ${block.source}`;
      group.append(rect, name, count, source, title);
      group.addEventListener("click", (event) => {
        if (consumeSuppressedClick(event)) return;
        event.stopPropagation();
        onSelectTopic?.(block.id);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectTopic?.(block.id);
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

  function render({ mode = "citations", papers = [], edges = [], topics = [], selectedId = null, selectedTopicId = null }) {
    if (mode === "topics") renderTopicMap(papers, edges, topics, selectedTopicId);
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

  function startPinch() {
    if (activePointers.size < 2) return;
    const [first, second] = Array.from(activePointers.values()).slice(0, 2);
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    pinchGesture = {
      startTransform: { ...transform },
      startMidpoint: midpoint,
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    };
    if (itemDrag && !itemDrag.moved) {
      if (itemDrag.type === "paper") {
        itemDrag.item.fixed = pinnedPapers.has(itemDrag.id);
      } else {
        itemDrag.item.fixed = pinnedTopics.has(itemDrag.id);
      }
    }
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
        item.fixed = true;
        itemDrag = { type: "paper", id, item, pointerId: event.pointerId, offsetX: world.x - item.x, offsetY: world.y - item.y, start: point, moved: false };
        svg.classList.add("dragging-item");
        event.preventDefault();
        return;
      }
    }

    const topicGroup = event.target.closest?.(".topic-block");
    if (topicGroup) {
      const id = topicGroup.dataset.topicId;
      const item = currentTopicBlocks.get(id);
      if (item) {
        const world = worldPoint(point);
        item.fixed = true;
        itemDrag = { type: "topic", id, item, pointerId: event.pointerId, offsetX: world.x - item.x, offsetY: world.y - item.y, start: point, moved: false };
        svg.classList.add("dragging-item");
        event.preventDefault();
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
      const world = worldPoint(point);
      const dx = point.x - itemDrag.start.x;
      const dy = point.y - itemDrag.start.y;
      if (Math.hypot(dx, dy) > 3) itemDrag.moved = true;
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
    if (itemDrag && itemDrag.pointerId === event.pointerId) {
      if (itemDrag.moved) {
        suppressNextClick = true;
        if (itemDrag.type === "paper") pinnedPapers.add(itemDrag.id);
        else pinnedTopics.add(itemDrag.id);
      } else if (itemDrag.type === "paper") {
        itemDrag.item.fixed = pinnedPapers.has(itemDrag.id);
      } else {
        itemDrag.item.fixed = pinnedTopics.has(itemDrag.id);
      }
      itemDrag = null;
      svg.classList.remove("dragging-item");
    }
    if (panGesture && panGesture.pointerId === event.pointerId) {
      if (panGesture.moved) suppressNextClick = true;
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
  }

  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("click", (event) => {
    if (event.target.closest?.(".paper-node, .topic-block")) return;
    if (consumeSuppressedClick(event)) return;
    onSelectPaper?.(null);
  });

  applyTransform();
  return { render, resetView, stopAnimation };
}
