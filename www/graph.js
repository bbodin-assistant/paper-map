const SVG_NS = "http://www.w3.org/2000/svg";

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

function citationRadius(paper) {
  const count = Number(paper.citationCount);
  if (!Number.isFinite(count) || count <= 0) return paper.starred ? 10 : 8;
  return Math.max(7, Math.min(17, 7 + Math.log10(count + 1) * 2.3));
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
        const key = [source, target].sort().join("::");
        const current = connections.get(key) || { source, target, weight: 0 };
        current.weight += 1;
        connections.set(key, current);
      }
    }
  }

  return { blocks: Array.from(blocks.values()), connections: Array.from(connections.values()) };
}

export function createGraph({ svg, onSelectPaper, onSelectTopic }) {
  const root = svgElement("g", { class: "graph-viewport" });
  svg.append(root);

  const defs = svgElement("defs");
  const marker = svgElement("marker", {
    id: "citation-arrow",
    viewBox: "0 0 10 10",
    refX: 8,
    refY: 5,
    markerWidth: 5,
    markerHeight: 5,
    orient: "auto-start-reverse",
  });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "citation-arrow" }));
  defs.append(marker);
  svg.prepend(defs);

  let transform = { x: 0, y: 0, k: 1 };
  let dragging = null;
  let animationFrame = null;
  let renderToken = 0;

  function applyTransform() {
    root.setAttribute("transform", `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
  }

  function stopAnimation() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function clear() {
    stopAnimation();
    root.replaceChildren();
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

  function renderCitationMap(papers, edges, selectedId) {
    if (!papers.length) {
      empty("No papers match the current filters.");
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

    const nodes = papers.map((paper, index) => {
      const year = Number(paper.year);
      const yearRatio = Number.isFinite(year) ? (year - minYear) / yearSpan : 0.5;
      const random = hash(paper.id);
      return {
        paper,
        x: 100 + yearRatio * (width - 220) + ((random % 41) - 20),
        y: 70 + ((random >>> 8) % Math.max(200, height - 140)),
        vx: 0,
        vy: 0,
        radius: citationRadius(paper),
        index,
      };
    });
    const nodeById = new Map(nodes.map((node) => [node.paper.id, node]));
    const visibleEdges = edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));

    const edgeLayer = svgElement("g", { class: "citation-edges" });
    const nodeLayer = svgElement("g", { class: "citation-nodes" });
    root.append(edgeLayer, nodeLayer);

    const edgeElements = visibleEdges.map((edge) => {
      const selected = edge.source === selectedId || edge.target === selectedId;
      const line = svgElement("line", {
        class: `citation-edge${selected ? " selected" : ""}`,
        "marker-end": "url(#citation-arrow)",
      });
      edgeLayer.append(line);
      return { edge, line };
    });

    const nodeElements = nodes.map((node) => {
      const paper = node.paper;
      const selected = paper.id === selectedId;
      const group = svgElement("g", {
        class: `paper-node${selected ? " selected" : ""}${paper.starred ? " starred" : ""}`,
        tabindex: "0",
        role: "button",
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
      meta.textContent = [paper.authors?.[0], paper.year].filter(Boolean).join(" · ");
      const title = svgElement("title");
      title.textContent = `${paper.title}\n${(paper.authors || []).join(", ")}\n${paper.venue || ""} ${paper.year || ""}`.trim();
      group.append(halo, circle, label, meta, title);
      group.addEventListener("click", (event) => {
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
      for (const { edge, line } of edgeElements) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        line.setAttribute("x1", source.x);
        line.setAttribute("y1", source.y);
        line.setAttribute("x2", target.x);
        line.setAttribute("y2", target.y);
      }
      for (const { node, group } of nodeElements) {
        group.setAttribute("transform", `translate(${node.x} ${node.y})`);
      }
    }

    let iteration = 0;
    const maxIterations = papers.length > 250 ? 45 : papers.length > 100 ? 70 : 110;
    function simulate() {
      if (token !== renderToken) return;
      iteration += 1;
      const cooling = Math.max(0.04, 1 - iteration / maxIterations);

      for (const node of nodes) {
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
          left.vx -= (dx / distance) * push;
          left.vy -= (dy / distance) * push;
          right.vx += (dx / distance) * push;
          right.vy += (dy / distance) * push;
        }
      }

      for (const edge of visibleEdges) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const desired = 145;
        const pull = (distance - desired) * 0.0018 * cooling;
        source.vx += (dx / distance) * pull;
        source.vy += (dy / distance) * pull;
        target.vx -= (dx / distance) * pull;
        target.vy -= (dy / distance) * pull;
      }

      for (const node of nodes) {
        node.x = Math.max(40, Math.min(width - 80, node.x + node.vx));
        node.y = Math.max(35, Math.min(height - 45, node.y + node.vy));
      }

      draw();
      if (iteration < maxIterations) animationFrame = requestAnimationFrame(simulate);
      else animationFrame = null;
    }

    draw();
    animationFrame = requestAnimationFrame(simulate);
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
        return {
          ...block,
          x: centerX + Math.cos(angle) * orbitX - blockWidth / 2,
          y: centerY + Math.sin(angle) * orbitY - blockHeight / 2,
          width: blockWidth,
          height: blockHeight,
        };
      });
    const blockById = new Map(positioned.map((block) => [block.id, block]));

    const edgeLayer = svgElement("g", { class: "topic-edges" });
    const blockLayer = svgElement("g", { class: "topic-blocks" });
    root.append(edgeLayer, blockLayer);

    for (const connection of connections) {
      const source = blockById.get(connection.source);
      const target = blockById.get(connection.target);
      if (!source || !target) continue;
      const line = svgElement("line", {
        class: "topic-edge",
        x1: source.x + source.width / 2,
        y1: source.y + source.height / 2,
        x2: target.x + target.width / 2,
        y2: target.y + target.height / 2,
        "stroke-width": Math.max(1, Math.min(7, 1 + Math.log2(connection.weight + 1))),
      });
      const title = svgElement("title");
      title.textContent = `${source.name} ↔ ${target.name}: ${connection.weight} cross-topic citation${connection.weight === 1 ? "" : "s"}`;
      line.append(title);
      edgeLayer.append(line);
    }

    for (const block of positioned) {
      const selected = block.id === selectedTopicId;
      const group = svgElement("g", {
        class: `topic-block${selected ? " selected" : ""}`,
        transform: `translate(${block.x} ${block.y})`,
        tabindex: "0",
        role: "button",
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
    }
  }

  function render({ mode = "citations", papers = [], edges = [], topics = [], selectedId = null, selectedTopicId = null }) {
    if (mode === "topics") renderTopicMap(papers, edges, topics, selectedTopicId);
    else renderCitationMap(papers, edges, selectedId);
  }

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const previous = transform.k;
    const next = Math.max(0.35, Math.min(3.2, previous * (event.deltaY > 0 ? 0.9 : 1.1)));
    const worldX = (pointerX - transform.x) / previous;
    const worldY = (pointerY - transform.y) / previous;
    transform.k = next;
    transform.x = pointerX - worldX * next;
    transform.y = pointerY - worldY * next;
    applyTransform();
  }, { passive: false });

  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".paper-node, .topic-block")) return;
    dragging = { x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("dragging");
  });

  svg.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    transform.x = dragging.originX + event.clientX - dragging.x;
    transform.y = dragging.originY + event.clientY - dragging.y;
    applyTransform();
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = null;
    svg.classList.remove("dragging");
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }

  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("click", () => onSelectPaper?.(null));

  applyTransform();
  return { render, resetView, stopAnimation };
}
