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

if (typeof document !== "undefined") initTopicFocusLayout();
