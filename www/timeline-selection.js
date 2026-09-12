const TAP_MOVE_THRESHOLD = 8;
const FREEZE_TIMEOUT_MS = 1200;

function findPaperButton(root, paperId) {
  return Array.from(root.querySelectorAll("#paper-list .paper-list-item[data-paper-id]"))
    .find((candidate) => candidate.dataset.paperId === paperId) || null;
}

function selectedTimelinePaper(root, paperId) {
  return Array.from(root.querySelectorAll("#paper-map .timeline-paper[data-paper-id]"))
    .find((candidate) => candidate.dataset.paperId === paperId) || null;
}

function freezeTimeline(root, paperId) {
  const svg = root.querySelector("#paper-map");
  const stage = svg?.parentElement;
  if (!svg || !stage || !svg.querySelector(".timeline-papers")) return null;

  stage.querySelector(".timeline-selection-freeze")?.remove();
  const clone = svg.cloneNode(true);
  clone.removeAttribute("id");
  clone.classList.add("timeline-selection-freeze");
  clone.setAttribute("aria-hidden", "true");
  clone.style.position = "absolute";
  clone.style.inset = "0";
  clone.style.width = "100%";
  clone.style.height = "100%";
  clone.style.pointerEvents = "none";
  clone.style.zIndex = "3";

  const clonePaper = Array.from(clone.querySelectorAll(".timeline-paper[data-paper-id]"))
    .find((candidate) => candidate.dataset.paperId === paperId);
  clonePaper?.classList.add("selected");
  stage.append(clone);
  return clone;
}

function removeFreezeWhenStable(root, freeze, paperId) {
  if (!freeze) return;
  const started = performance.now();
  const check = () => {
    if (!freeze.isConnected) return;
    const paper = selectedTimelinePaper(root, paperId);
    const detail = root.querySelector("#paper-detail");
    if ((paper?.classList.contains("selected") && detail && !detail.hidden)
        || performance.now() - started >= FREEZE_TIMEOUT_MS) {
      freeze.remove();
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

function selectTimelinePaper(root, paperId) {
  if (!paperId) return false;
  const button = findPaperButton(root, paperId);
  if (!button) return false;
  const freeze = freezeTimeline(root, paperId);
  button.click();
  removeFreezeWhenStable(root, freeze, paperId);
  return !root.querySelector("#paper-detail")?.hidden;
}

export function installTimelineTapSelection(root = document) {
  if (!root?.addEventListener || root.documentElement?.dataset.timelineTapSelection === "true") return false;
  if (root.documentElement) root.documentElement.dataset.timelineTapSelection = "true";

  let gesture = null;
  let suppressCompatibilityClick = false;

  root.addEventListener("click", (event) => {
    if (!suppressCompatibilityClick) return;
    const map = root.querySelector("#paper-map");
    if (!map || !(event.target === map || map.contains(event.target))) return;
    suppressCompatibilityClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

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

    suppressCompatibilityClick = true;
    setTimeout(() => { suppressCompatibilityClick = false; }, 0);
    selectTimelinePaper(root, completed.paperId);
  }, true);

  root.addEventListener("pointercancel", (event) => {
    if (gesture?.pointerId === event.pointerId) gesture = null;
  }, true);

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const paper = event.target?.closest?.(".timeline-paper[data-paper-id]");
    if (!paper?.dataset.paperId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectTimelinePaper(root, paper.dataset.paperId);
  }, true);

  return true;
}

if (typeof document !== "undefined") installTimelineTapSelection(document);
