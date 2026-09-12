import { loadLibrary } from "./db.js";
import { normalizeDoi, normalizedTitle } from "./import-export.js";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeArxivId(value) {
  return clean(value)
    .replace(/^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "")
    .toLowerCase();
}

function canonicalReference(reference = {}) {
  if (reference.canonicalReference) return reference.canonicalReference;
  if (reference.resolution?.status === "matched") return reference.resolution.canonical || {};
  return {};
}

function matchingLibraryPaper(reference, papers, sourceId) {
  const canonical = canonicalReference(reference);
  const doi = normalizeDoi(reference.doi || canonical.doi);
  const arxivId = normalizeArxivId(reference.arxivId || canonical.arxivId);
  const semanticScholarId = clean(reference.semanticScholarId || canonical.semanticScholarId).toLowerCase();
  const title = normalizedTitle(reference.title || canonical.title);
  const year = Number(reference.year || canonical.year) || null;
  const rawText = clean(reference.rawText).replace(/\s+/g, " ").toLowerCase();

  const matches = papers.filter((paper) => {
    if (!paper?.id || paper.id === sourceId) return false;
    if (doi && normalizeDoi(paper.doi) === doi) return true;
    if (arxivId && normalizeArxivId(paper.arxivId) === arxivId) return true;
    if (semanticScholarId && clean(paper.semanticScholarId).toLowerCase() === semanticScholarId) return true;
    if (title && year && normalizedTitle(paper.title) === title && Number(paper.year) === year) return true;
    const paperDoi = normalizeDoi(paper.doi);
    return Boolean(paperDoi && rawText.includes(paperDoi.toLowerCase()));
  });

  return matches.length === 1 ? matches[0] : null;
}

function referenceMeta(reference = {}, index) {
  const values = [];
  if (reference.label) values.push(`[${reference.label}]`);
  else if (reference.index) values.push(`#${reference.index}`);
  else values.push(`#${index + 1}`);

  const pageStart = Number(reference.pageStart);
  const pageEnd = Number(reference.pageEnd);
  if (Number.isFinite(pageStart) && pageStart > 0) {
    values.push(Number.isFinite(pageEnd) && pageEnd > pageStart ? `pp. ${pageStart}–${pageEnd}` : `p. ${pageStart}`);
  }
  if (reference.year) values.push(String(reference.year));
  if (reference.doi) values.push(`DOI ${reference.doi}`);
  if (reference.arxivId) values.push(`arXiv ${reference.arxivId}`);
  const confidence = Number(reference.confidence);
  if (Number.isFinite(confidence) && confidence > 0) values.push(`${Math.round(confidence * 100)}% confidence`);
  return values.join(" · ");
}

function installStyles(root) {
  if (root.querySelector("#reference-detail-styles")) return;
  const style = root.createElement("style");
  style.id = "reference-detail-styles";
  style.textContent = `
    .stored-reference-summary { margin: -2px 0 10px; color: #68737c; font-size: 10px; line-height: 1.4; }
    .stored-reference-list { display: grid; gap: 8px; }
    .stored-reference-row { padding: 9px 10px; border: 1px solid #d9deda; border-radius: 4px; background: #fafaf6; }
    .stored-reference-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; margin-bottom: 5px; color: #778189; font-size: 9px; font-weight: 700; }
    .stored-reference-text { margin: 0; color: #35404a; font-size: 10px; line-height: 1.45; overflow-wrap: anywhere; }
    .stored-reference-link { margin-left: auto; border: 0; padding: 1px 0; background: transparent; color: #25364a; font-size: 9px; text-decoration: underline; }
    .stored-reference-link:hover { background: transparent; color: #111a22; }
    .stored-reference-empty { margin: 0; color: #7a848c; font-size: 10px; }
  `;
  root.head?.append(style);
}

function createSection(root) {
  let section = root.querySelector("#stored-pdf-references");
  if (section) return section;

  section = root.createElement("section");
  section.id = "stored-pdf-references";
  section.className = "detail-section stored-reference-section";
  section.hidden = true;
  section.innerHTML = `
    <div class="section-heading">
      <div>
        <h3>Extracted references</h3>
        <span class="muted">Reviewed extracted or provider references stored with this paper</span>
      </div>
    </div>
    <p id="stored-reference-summary" class="stored-reference-summary"></p>
    <div id="stored-reference-list" class="stored-reference-list"></div>
  `;

  const citationCount = root.querySelector("#detail-citation-count");
  const citationSection = citationCount?.closest?.(".detail-section");
  const detailBody = root.querySelector("#paper-detail-body");
  if (citationSection?.parentElement) citationSection.after(section);
  else detailBody?.append(section);
  return section;
}

function selectPaper(root, paperId) {
  const button = Array.from(root.querySelectorAll("#paper-list .paper-list-item[data-paper-id]"))
    .find((candidate) => candidate.dataset.paperId === paperId);
  button?.click();
}

export function initStoredReferenceDetail(root = document) {
  if (!root?.querySelector || !root?.createElement) return false;
  const detail = root.querySelector("#paper-detail");
  const paperList = root.querySelector("#paper-list");
  if (!detail || !paperList) return false;

  installStyles(root);
  const section = createSection(root);
  const summary = root.querySelector("#stored-reference-summary");
  const list = root.querySelector("#stored-reference-list");
  if (!section || !summary || !list) return false;

  let queued = false;
  let renderToken = 0;

  async function render() {
    queued = false;
    const token = ++renderToken;
    const selectedId = root.querySelector("#paper-list .paper-list-item.selected[data-paper-id]")?.dataset.paperId || "";
    if (detail.hidden || !selectedId) {
      section.hidden = true;
      return;
    }

    const library = await loadLibrary();
    if (token !== renderToken) return;
    const paper = library.papers.find((candidate) => candidate.id === selectedId);
    if (!paper) {
      section.hidden = true;
      return;
    }

    const references = Array.isArray(paper.extractedReferences) ? paper.extractedReferences : [];
    const isPdfPaper = paper.source === "reviewed-pdf" || Boolean(paper.pdfExtraction) || Boolean(paper.sourceFileName);
    if (!references.length && !isPdfPaper) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    summary.textContent = references.length
      ? `${references.length} reviewed reference${references.length === 1 ? "" : "s"} stored with this paper in the local library.`
      : "No reviewed references are stored for this paper.";

    if (!references.length) {
      const empty = root.createElement("p");
      empty.className = "stored-reference-empty";
      empty.textContent = "No accepted extracted or provider reference records are stored for this paper.";
      list.replaceChildren(empty);
      return;
    }

    const fragment = root.createDocumentFragment();
    references.forEach((reference, index) => {
      const row = root.createElement("article");
      row.className = "stored-reference-row";

      const meta = root.createElement("div");
      meta.className = "stored-reference-meta";
      const metaText = root.createElement("span");
      metaText.textContent = referenceMeta(reference, index);
      meta.append(metaText);

      const linkedPaper = matchingLibraryPaper(reference, library.papers, paper.id);
      if (linkedPaper) {
        const link = root.createElement("button");
        link.type = "button";
        link.className = "stored-reference-link";
        link.textContent = `Open linked paper: ${linkedPaper.title || "Untitled"}`;
        link.addEventListener("click", () => selectPaper(root, linkedPaper.id));
        meta.append(link);
      }

      const text = root.createElement("p");
      text.className = "stored-reference-text";
      text.textContent = clean(reference.rawText) || clean(reference.title) || "Stored reference without raw citation text.";
      row.append(meta, text);
      fragment.append(row);
    });
    list.replaceChildren(fragment);
  }

  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => render().catch(() => {
      queued = false;
      section.hidden = true;
    }));
  }

  const observer = new MutationObserver(queueRender);
  observer.observe(detail, { attributes: true, attributeFilter: ["hidden"] });
  observer.observe(paperList, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  queueRender();
  return true;
}

function initWhenReady() {
  if (typeof document === "undefined") return;
  if (initStoredReferenceDetail(document)) return;
  const observer = new MutationObserver(() => {
    if (!initStoredReferenceDetail(document)) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

initWhenReady();
