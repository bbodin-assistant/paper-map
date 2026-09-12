const TAP_MOVE_THRESHOLD = 8;

function findPaperButton(root, paperId) {
  return Array.from(root.querySelectorAll("#paper-list .paper-list-item[data-paper-id]"))
    .find((candidate) => candidate.dataset.paperId === paperId) || null;
}

function selectTimelinePaper(root, paperId) {
  if (!paperId) return false;
  const button = findPaperButton(root, paperId);
  if (!button) return false;
  button.click();
  return !root.querySelector("#paper-detail")?.hidden;
}

export function installTimelineTapSelection(root = document) {
  if (!root?.addEventListener || root.documentElement?.dataset.timelineTapSelection === "true") return false;
  if (root.documentElement) root.documentElement.dataset.timelineTapSelection = "true";

  let gesture = null;

  root.addEventListener("pointerdown", (event) => {
    const paper = event.target?.closest?.(".timeline-paper[data-paper-id]");
    if (!paper?.dataset.paperId || event.button > 0) return;
    gesture = {
      pointerId: event.pointerId,
      paperId: paper.dataset.paperId,
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
    selectTimelinePaper(root, completed.paperId);
  }, true);

  root.addEventListener("pointercancel", (event) => {
    if (gesture?.pointerId === event.pointerId) gesture = null;
  }, true);

  return true;
}

if (typeof document !== "undefined") installTimelineTapSelection(document);
