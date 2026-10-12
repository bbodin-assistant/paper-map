import { loadLibrary } from "./db.js";
import { storedPdfAttachmentForPaper } from "./paper-attachments.js?v=0.4.21";

const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_CLASS = "timeline-pdf-indicator";
const checkedNodes = new WeakMap();
let refreshQueued = false;

export function timelinePdfIconPosition(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width) || bounds.width <= 0 || !Number.isFinite(bounds.height)) return null;
  return { x: bounds.x + bounds.width - 17, y: bounds.y - 2 };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function createPdfIcon() {
  const group = svgElement("g", {
    class: ICON_CLASS,
    "aria-hidden": "true",
    "pointer-events": "none",
  });
  group.append(
    svgElement("rect", {
      x: 0, y: 0, width: 15, height: 18, rx: 2,
      fill: "#fffef9", stroke: "#53616d", "stroke-width": 1.2,
    }),
    svgElement("path", {
      d: "M4 4h5l3 3v7H4z M9 4v3h3",
      fill: "none", stroke: "#53616d", "stroke-width": 1,
      "stroke-linejoin": "round",
    }),
    svgElement("path", {
      d: "M2 11h11v5H2z",
      fill: "#b84757", stroke: "#fffef9", "stroke-width": 0.5,
    }),
  );
  const label = svgElement("text", {
    x: 7.5, y: 14.7, "text-anchor": "middle",
    fill: "#fff", "font-size": 4.4, "font-weight": 800,
  });
  label.textContent = "PDF";
  group.append(label);
  const title = svgElement("title");
  title.textContent = "PDF stored locally";
  group.append(title);
  return group;
}

function placeIcon(node) {
  if (!node.isConnected || node.querySelector("." + ICON_CLASS)) return;
  try {
    const position = timelinePdfIconPosition(node.getBBox());
    if (!position) return;
    const icon = createPdfIcon();
    icon.setAttribute("transform", "translate(" + position.x + " " + position.y + ")");
    node.append(icon);
  } catch {
    // The node may not have layout bounds until its SVG has been attached.
  }
}

async function refreshTimelinePdfIcons(root) {
  const nodes = Array.from(root.querySelectorAll(".timeline-paper[data-paper-id]"));
  if (!nodes.length) return;
  const library = await loadLibrary();
  const papers = new Map(library.papers.map((paper) => [paper.id, paper]));
  await Promise.all(nodes.map(async (node) => {
    const paperId = node.dataset.paperId;
    const paper = papers.get(paperId);
    if (!paper || !node.isConnected) return;
    const fingerprint = [paperId, paper.doi || "", paper.arxivId || "", paper.title || "", paper.year || ""].join(":");
    if (checkedNodes.get(node) === fingerprint) return;
    try {
      const attachment = await storedPdfAttachmentForPaper(paper);
      if (attachment && node.isConnected) {
        checkedNodes.set(node, fingerprint);
        placeIcon(node);
      }
    } catch {
      // An unavailable local PDF store should not affect timeline rendering.
    }
  }));
}

export function initTimelinePdfIcons(root = document) {
  if (!root?.querySelector || root.documentElement?.dataset.timelinePdfIconsReady === "true") return false;
  if (root.documentElement) root.documentElement.dataset.timelinePdfIconsReady = "true";
  const queueRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshTimelinePdfIcons(root).catch(() => {});
    });
  };
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length)) queueRefresh();
  });
  observer.observe(root.body || root, { childList: true, subtree: true });
  queueRefresh();
  return true;
}
