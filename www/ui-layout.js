import "./timeline.js";

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

  const map = root.querySelector("#paper-map");
  if (!map || map.dataset.timelineDetailFallback === "true") return Boolean(map);
  map.dataset.timelineDetailFallback = "true";

  root.addEventListener("click", (event) => {
    const paper = event.target.closest?.(".timeline-paper[data-paper-id]");
    if (!paper?.dataset.paperId) return;

    const paperId = paper.dataset.paperId;
    requestAnimationFrame(() => {
      const detail = root.querySelector("#paper-detail");
      if (detail && !detail.hidden) return;
      const button = Array.from(root.querySelectorAll("#paper-list .paper-list-item[data-paper-id]"))
        .find((candidate) => candidate.dataset.paperId === paperId);
      button?.click();
    });
  }, true);

  return true;
}

function initTopicFocusLayout(root = document) {
  const toolbar = root.querySelector(".atlas-toolbar");
  const topicBar = root.querySelector("#active-topic-filter");
  const mapStage = root.querySelector(".map-stage");
  const paperPanel = root.querySelector("#paper-list-panel");
  if (!toolbar || !topicBar || !mapStage || !paperPanel) return false;

  function syncAtlasContentTop() {
    const height = Math.max(0, toolbar.getBoundingClientRect().height);
    const top = `${height}px`;
    mapStage.style.top = top;
    paperPanel.style.top = top;
  }

  const mutationObserver = new MutationObserver(syncAtlasContentTop);
  mutationObserver.observe(topicBar, { attributes: true, attributeFilter: ["hidden"] });

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncAtlasContentTop) : null;
  resizeObserver?.observe(toolbar);
  window.addEventListener("resize", syncAtlasContentTop);
  syncAtlasContentTop();
  return true;
}

if (typeof document !== "undefined") {
  installTimelineInteractionPolish(document);
  initTopicFocusLayout(document);
}
