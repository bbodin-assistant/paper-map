import {
  inferResolvedReferenceCitationEdges,
  mergeExtractedReferenceProvenance,
  normalizePaperReferenceIdentities,
} from "./citation-reconciliation.js";

const DB_NAME = "paper-map-v1";
const DB_VERSION = 1;
const STORES = ["papers", "edges", "topics", "meta"];

let dbPromise = null;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("papers")) {
        const papers = db.createObjectStore("papers", { keyPath: "id" });
        papers.createIndex("doi", "doi", { unique: false });
        papers.createIndex("semanticScholarId", "semanticScholarId", { unique: false });
        papers.createIndex("year", "year", { unique: false });
        papers.createIndex("starred", "starred", { unique: false });
      }

      if (!db.objectStoreNames.contains("edges")) {
        const edges = db.createObjectStore("edges", { keyPath: "id" });
        edges.createIndex("source", "source", { unique: false });
        edges.createIndex("target", "target", { unique: false });
      }

      if (!db.objectStoreNames.contains("topics")) {
        db.createObjectStore("topics", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

async function getAll(storeName) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  return requestResult(transaction.objectStore(storeName).getAll());
}

async function putMany(storeName, values) {
  if (!values?.length) return;
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  for (const value of values) store.put(structuredClone(value));
  await transactionDone(transaction);
}

function putMissingEdges(edgeStore, edges) {
  for (const edge of edges || []) {
    const request = edgeStore.get(edge.id);
    request.onsuccess = () => {
      if (!request.result) edgeStore.put(structuredClone(edge));
    };
  }
}

function preparePaperWrites(existingPapers, incomingPapers) {
  const existingById = new Map((existingPapers || []).map((paper) => [paper.id, paper]));
  return (incomingPapers || []).map((paper) => {
    const existing = existingById.get(paper.id);
    const hadReferenceField = Array.isArray(existing?.extractedReferences) || Array.isArray(paper?.extractedReferences);
    const extractedReferences = mergeExtractedReferenceProvenance(
      existing?.extractedReferences || [],
      paper?.extractedReferences || [],
    );
    const merged = hadReferenceField ? { ...paper, extractedReferences } : paper;
    return normalizePaperReferenceIdentities(merged);
  });
}

export async function loadLibrary() {
  const [papers, edges, topics, meta] = await Promise.all([
    getAll("papers"),
    getAll("edges"),
    getAll("topics"),
    getAll("meta"),
  ]);

  const normalizedPapers = papers.map(normalizePaperReferenceIdentities);
  const changedPapers = normalizedPapers.filter((paper, index) => paper !== papers[index]);
  const inferredEdges = inferResolvedReferenceCitationEdges(normalizedPapers, edges);
  if (changedPapers.length || inferredEdges.length) {
    await Promise.all([
      putMany("papers", changedPapers),
      putMany("edges", inferredEdges),
    ]);
  }

  return {
    schemaVersion: 1,
    papers: normalizedPapers,
    edges: [...edges, ...inferredEdges],
    topics,
    meta: Object.fromEntries(meta.map((entry) => [entry.key, entry.value])),
  };
}

export async function putPapers(papers) {
  if (!papers?.length) return;
  const existingPapers = await getAll("papers");
  const prepared = preparePaperWrites(existingPapers, papers);
  const prospectiveById = new Map(existingPapers.map((paper) => [paper.id, paper]));
  for (const paper of prepared) prospectiveById.set(paper.id, paper);
  const inferredEdges = inferResolvedReferenceCitationEdges(Array.from(prospectiveById.values()));

  const db = await openDatabase();
  const transaction = db.transaction(["papers", "edges"], "readwrite");
  const paperStore = transaction.objectStore("papers");
  const edgeStore = transaction.objectStore("edges");
  for (const paper of prepared) paperStore.put(structuredClone(paper));
  putMissingEdges(edgeStore, inferredEdges);
  await transactionDone(transaction);
}

export function putEdges(edges) {
  return putMany("edges", edges);
}

export function putTopics(topics) {
  return putMany("topics", topics);
}

export async function putMeta(key, value) {
  return putMany("meta", [{ key, value }]);
}

export async function deleteEdge(edgeId) {
  if (!edgeId) return;
  const db = await openDatabase();
  const transaction = db.transaction("edges", "readwrite");
  transaction.objectStore("edges").delete(edgeId);
  await transactionDone(transaction);
}

export async function deletePaper(paperId) {
  const db = await openDatabase();
  const transaction = db.transaction(["papers", "edges"], "readwrite");
  const papers = transaction.objectStore("papers");
  const edges = transaction.objectStore("edges");

  papers.delete(paperId);
  const existingEdges = await requestResult(edges.getAll());
  for (const edge of existingEdges) {
    if (edge.source === paperId || edge.target === paperId) edges.delete(edge.id);
  }

  await transactionDone(transaction);
}

export async function clearLibrary() {
  const db = await openDatabase();
  const transaction = db.transaction(STORES, "readwrite");
  for (const storeName of STORES) transaction.objectStore(storeName).clear();
  await transactionDone(transaction);
}

export async function replaceLibrary(library) {
  const papers = (library.papers || []).map(normalizePaperReferenceIdentities);
  const explicitEdges = library.edges || [];
  const inferredEdges = inferResolvedReferenceCitationEdges(papers, explicitEdges);
  const edges = [...explicitEdges, ...inferredEdges];

  const db = await openDatabase();
  const transaction = db.transaction(STORES, "readwrite");

  for (const storeName of STORES) transaction.objectStore(storeName).clear();

  const paperStore = transaction.objectStore("papers");
  for (const paper of papers) paperStore.put(structuredClone(paper));

  const edgeStore = transaction.objectStore("edges");
  for (const edge of edges) edgeStore.put(structuredClone(edge));

  const topicStore = transaction.objectStore("topics");
  for (const topic of library.topics || []) topicStore.put(structuredClone(topic));

  const metaStore = transaction.objectStore("meta");
  for (const [key, value] of Object.entries(library.meta || {})) metaStore.put({ key, value });

  await transactionDone(transaction);
}

export async function databaseStats() {
  const db = await openDatabase();
  const transaction = db.transaction(["papers", "edges", "topics"], "readonly");
  const counts = await Promise.all([
    requestResult(transaction.objectStore("papers").count()),
    requestResult(transaction.objectStore("edges").count()),
    requestResult(transaction.objectStore("topics").count()),
  ]);
  return { papers: counts[0], edges: counts[1], topics: counts[2] };
}
