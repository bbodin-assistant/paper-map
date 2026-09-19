const TAP_MOVE_THRESHOLD = 8;

function timelineMap(root) {
  const map = root.querySelector("#paper-map");
  return map?.querySelector(".timeline-papers") ? map : null;
}

function selectTimelinePaper(root, paperId) {
  if (!paperId || !timelineMap(root)) return false;
  for (const paper of root.querySelectorAll("#paper-map .timeline-paper[data-paper-id]")) {
    paper.classList.toggle("selected", paper.dataset.paperId === paperId);
  }
  root.dispatchEvent(new CustomEvent("paper-map-timeline-paper-activate", {
    bubbles: true,
    detail: { paperId },
  }));
  return true;
}

function clearTimelineSelection(root) {
  if (!timelineMap(root)) return false;
  for (const paper of root.querySelectorAll("#paper-map .timeline-paper.selected")) {
    paper.classList.remove("selected");
  }
  root.dispatchEvent(new CustomEvent("paper-map-timeline-background-activate", { bubbles: true }));
  return true;
}

export function installTimelineTapSelection(root = document) {
  if (!root?.addEventListener || root.documentElement?.dataset.timelineTapSelection === "true") return false;
  if (root.documentElement) root.documentElement.dataset.timelineTapSelection = "true";

  let gesture = null;
  let suppressCompatibilityClick = false;

  root.addEventListener("click", (event) => {
    if (!suppressCompatibilityClick) return;
    const map = timelineMap(root);
    if (!map || !(event.target === map || map.contains(event.target))) return;
    suppressCompatibilityClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  root.addEventListener("pointerdown", (event) => {
    const map = timelineMap(root);
    if (!map || event.button > 0 || !(event.target === map || map.contains(event.target))) return;
    const paper = event.target?.closest?.(".timeline-paper[data-paper-id]");
    gesture = {
      pointerId: event.pointerId,
      paperId: paper?.dataset.paperId || "",
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  }, true);

  root.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > TAP_MOVE_THRESHOLD) {
      gesture.moved = true;
    }
  }, true);

  root.addEventListener("pointerup", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const completed = gesture;
    gesture = null;
    if (completed.moved) return;

    suppressCompatibilityClick = true;
    setTimeout(() => { suppressCompatibilityClick = false; }, 0);
    if (completed.paperId) selectTimelinePaper(root, completed.paperId);
    else clearTimelineSelection(root);
  }, true);

  root.addEventListener("pointercancel", (event) => {
    if (gesture?.pointerId === event.pointerId) gesture = null;
  }, true);

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const paper = event.target?.closest?.(".timeline-paper[data-paper-id]");
    if (!paper?.dataset.paperId || !timelineMap(root)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectTimelinePaper(root, paper.dataset.paperId);
  }, true);

  return true;
}

if (typeof document !== "undefined") installTimelineTapSelection(document);
