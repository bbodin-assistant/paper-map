import { loadLibrary } from "./db.js";
import { normalizeDoi, normalizedTitle } from "./import-export.js";

const PDF_DB_NAME = "paper-map-pdf-files-v1";
const PDF_DB_VERSION = 1;
const PDF_STORE = "pdfs";
const pendingFiles = new Map();
let pdfDbPromise = null;
let activeAttachment = null;

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

function normalizedYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year > 0 ? year : null;
}

function paperIdentityParts(paper = {}) {
  return {
    doi: normalizeDoi(paper.doi),
    arxivId: normalizeArxivId(paper.arxivId),
    title: normalizedTitle(paper.title),
    year: normalizedYear(paper.year),
    sourceFileName: clean(paper.sourceFileName || paper.libraryEntry?.fileName),
  };
}

export function attachmentIdentity(paper = {}, file = null) {
  const identity = paperIdentityParts(paper);
  if (identity.doi) return `doi:${identity.doi}`;
  if (identity.arxivId) return `arxiv:${identity.arxivId}`;
  if (identity.title && identity.year) return `title:${identity.title}:${identity.year}`;
  if (identity.sourceFileName) return `file:${identity.sourceFileName.toLowerCase()}`;
  if (file?.name) return `file:${clean(file.name).toLowerCase()}:${Number(file.size) || 0}:${Number(file.lastModified) || 0}`;
  return "";
}

function openPdfDatabase() {
  if (pdfDbPromise) return pdfDbPromise;
  pdfDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PDF_STORE)) {
        const store = db.createObjectStore(PDF_STORE, { keyPath: "key" });
        store.createIndex("sourceFileName", "sourceFileName", { unique: false });
        store.createIndex("doi", "doi", { unique: false });
        store.createIndex("arxivId", "arxivId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      pdfDbPromise = null;
      reject(request.error);
    };
  });
  return pdfDbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("PDF storage transaction aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("PDF storage transaction failed."));
  });
}

async function putPdfAttachment(record) {
  const db = await openPdfDatabase();
  const transaction = db.transaction(PDF_STORE, "readwrite");
  transaction.objectStore(PDF_STORE).put(record);
  await transactionDone(transaction);
}

async function allPdfAttachments() {
  const db = await openPdfDatabase();
  const transaction = db.transaction(PDF_STORE, "readonly");
  return requestResult(transaction.objectStore(PDF_STORE).getAll());
}

function sameAttachmentPaper(record, paper) {
  const identity = paperIdentityParts(paper);
  if (identity.doi && record.doi) return identity.doi === record.doi;
  if (identity.arxivId && record.arxivId) return identity.arxivId === record.arxivId;
  if (identity.title && identity.year && record.title && record.year) {
    return identity.title === record.title && identity.year === record.year;
  }
  return Boolean(identity.sourceFileName && record.sourceFileName && identity.sourceFileName === record.sourceFileName);
}

async function attachmentForPaper(paper) {
  const records = await allPdfAttachments();
  const exactKey = attachmentIdentity(paper);
  return records.find((record) => record.key === exactKey)
    || records.find((record) => sameAttachmentPaper(record, paper))
    || null;
}

function reviewPaperSnapshot(root = document) {
  return {
    title: root.querySelector("#pdf-review-title")?.value || "",
    year: root.querySelector("#pdf-review-year")?.value || "",
    doi: root.querySelector("#pdf-review-doi")?.value || "",
    arxivId: root.querySelector("#pdf-review-arxiv")?.value || "",
    sourceFileName: root.querySelector("#pdf-ai-file-name")?.textContent || "",
  };
}

function rememberSelectedFiles(event) {
  const input = event.target?.closest?.("#pdf-ai-file");
  if (!input) return;
  for (const file of Array.from(input.files || [])) {
    const name = clean(file.name);
    if (!name) continue;
    const queue = pendingFiles.get(name) || [];
    queue.push(file);
    pendingFiles.set(name, queue);
  }
}

function pendingFileForName(name) {
  return (pendingFiles.get(clean(name)) || [])[0] || null;
}

function consumePendingFile(name, file) {
  const key = clean(name);
  const queue = pendingFiles.get(key) || [];
  const index = queue.indexOf(file);
  if (index >= 0) queue.splice(index, 1);
  if (queue.length) pendingFiles.set(key, queue);
  else pendingFiles.delete(key);
}

function setStorageError(root, message) {
  const status = root.querySelector("#pdf-ai-analysis-status");
  if (status) status.textContent = message;
  const globalStatus = root.querySelector("#library-status");
  const globalText = root.querySelector("#library-status-text");
  if (globalStatus) globalStatus.className = "status error";
  if (globalText) globalText.textContent = message;
}

async function persistActivePdfBeforeSave(root, button) {
  const snapshot = reviewPaperSnapshot(root);
  const file = pendingFileForName(snapshot.sourceFileName);
  if (!file) throw new Error(`The PDF bytes for ${snapshot.sourceFileName || "this paper"} are no longer available in the import session.`);
  if (!clean(snapshot.title)) throw new Error("Title is required before saving.");

  const identity = paperIdentityParts(snapshot);
  const key = attachmentIdentity(snapshot, file) || `file:${crypto.randomUUID()}`;
  const storedBlob = file.type === "application/pdf" ? file : new Blob([file], { type: "application/pdf" });
  await putPdfAttachment({
    key,
    blob: storedBlob,
    name: file.name,
    type: "application/pdf",
    size: Number(file.size) || 0,
    lastModified: Number(file.lastModified) || 0,
    storedAt: new Date().toISOString(),
    sourceFileName: file.name,
    doi: identity.doi,
    arxivId: identity.arxivId,
    title: identity.title,
    year: identity.year,
  });
  consumePendingFile(snapshot.sourceFileName, file);

  button.dataset.pdfAttachmentStored = "true";
  button.disabled = false;
  try {
    button.click();
  } finally {
    delete button.dataset.pdfAttachmentStored;
  }
}

function installSaveInterception(root = document) {
  root.addEventListener("change", rememberSelectedFiles, true);
  root.addEventListener("click", (event) => {
    const button = event.target?.closest?.("#pdf-ai-save");
    if (!button || button.dataset.pdfAttachmentStored === "true" || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    persistActivePdfBeforeSave(root, button).catch((error) => {
      setStorageError(root, error?.message || String(error));
      button.disabled = false;
    });
  }, true);
}

function ensureStoredPdfAction(root = document) {
  let section = root.querySelector("#stored-pdf-action");
  if (section) return section;
  const links = root.querySelector("#detail-links");
  if (!links) return null;
  section = root.createElement("div");
  section.id = "stored-pdf-action";
  section.className = "link-actions stored-pdf-action";
  section.hidden = true;
  const button = root.createElement("button");
  button.type = "button";
  button.id = "open-stored-pdf";
  button.textContent = "Open stored PDF ↗";
  button.addEventListener("click", () => {
    if (!activeAttachment?.blob) return;
    const url = URL.createObjectURL(activeAttachment.blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  section.append(button);
  links.after(section);
  return section;
}

function selectedPaperId(root = document) {
  return root.querySelector("#paper-list .paper-list-item.selected[data-paper-id]")?.dataset.paperId || "";
}

async function refreshStoredPdfAction(root = document) {
  const section = ensureStoredPdfAction(root);
  if (!section) return;
  const detail = root.querySelector("#paper-detail");
  const paperId = selectedPaperId(root);
  if (!paperId || detail?.hidden) {
    activeAttachment = null;
    section.hidden = true;
    return;
  }
  const library = await loadLibrary();
  const paper = library.papers.find((candidate) => candidate.id === paperId);
  activeAttachment = paper ? await attachmentForPaper(paper) : null;
  section.hidden = false;
  const button = section.querySelector("#open-stored-pdf");
  if (!button) return;
  button.disabled = !activeAttachment;
  if (activeAttachment) {
    const megabytes = activeAttachment.size ? ` · ${(activeAttachment.size / (1024 * 1024)).toFixed(1)} MB` : "";
    button.textContent = `Open stored PDF${megabytes} ↗`;
    button.title = activeAttachment.name || "Stored PDF";
  } else {
    button.textContent = "PDF not stored";
    button.title = "No PDF file is stored locally for this paper.";
  }
}

function selectPaperFromTimeline(root, paperId) {
  const button = Array.from(root.querySelectorAll("#paper-list .paper-list-item[data-paper-id]"))
    .find((candidate) => candidate.dataset.paperId === paperId);
  if (!button) return false;
  button.click();
  root.querySelector("#paper-detail")?.removeAttribute("hidden");
  return true;
}

function installTimelineDrawerBridge(root = document) {
  root.addEventListener("click", (event) => {
    const paper = event.target?.closest?.(".timeline-paper[data-paper-id]");
    if (!paper) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectPaperFromTimeline(root, paper.dataset.paperId);
  }, true);

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const paper = event.target?.closest?.(".timeline-paper[data-paper-id]");
    if (!paper) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectPaperFromTimeline(root, paper.dataset.paperId);
  }, true);
}

function updateImportExplanation(root = document) {
  const explainer = root.querySelector("#pdf-ai-analysis-step .pdf-ai-explainer");
  if (!explainer) return;
  explainer.innerHTML = "Every selected PDF is extracted locally with Rust/WebAssembly. On an individual tab you can additionally run <strong>AI extraction</strong> or <strong>Online extraction</strong> using the paper-information method selected in Config. Results are merged without overwriting fields you have edited manually. When you save a reviewed PDF, the original PDF file is also stored locally in this browser so it can be reopened from the paper details.";
}

function init(root = document) {
  if (!root?.querySelector) return false;
  installSaveInterception(root);
  installTimelineDrawerBridge(root);
  ensureStoredPdfAction(root);
  updateImportExplanation(root);

  let queued = false;
  const queueRefresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refreshStoredPdfAction(root).catch(() => {});
    });
  };
  const observer = new MutationObserver(queueRefresh);
  const paperList = root.querySelector("#paper-list");
  const detail = root.querySelector("#paper-detail");
  if (paperList) observer.observe(paperList, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  if (detail) observer.observe(detail, { attributes: true, attributeFilter: ["hidden"] });
  queueRefresh();
  return true;
}

if (typeof document !== "undefined") init(document);
