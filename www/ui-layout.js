function initTopicFocusLayout(root = document) {
  const topicBar = root.querySelector("#active-topic-filter");
  const paperPanel = root.querySelector("#paper-list-panel");
  if (!topicBar || !paperPanel) return false;

  function syncPaperPanelTop() {
    if (topicBar.hidden) {
      paperPanel.style.removeProperty("top");
      return;
    }
    const height = Math.max(0, topicBar.getBoundingClientRect().height);
    paperPanel.style.top = `calc(var(--toolbar-height) + ${height}px)`;
  }

  const mutationObserver = new MutationObserver(syncPaperPanelTop);
  mutationObserver.observe(topicBar, { attributes: true, attributeFilter: ["hidden"] });

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncPaperPanelTop) : null;
  resizeObserver?.observe(topicBar);
  window.addEventListener("resize", syncPaperPanelTop);
  syncPaperPanelTop();
  return true;
}

if (typeof document !== "undefined") initTopicFocusLayout();
