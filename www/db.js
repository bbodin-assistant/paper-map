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

export async function loadLibrary() {
  const [papers, edges, topics, meta] = await Promise.all([
    getAll("papers"),
    getAll("edges"),
    getAll("topics"),
    getAll("meta"),
  ]);

  return {
    schemaVersion: 1,
    papers,
    edges,
    topics,
    meta: Object.fromEntries(meta.map((entry) => [entry.key, entry.value])),
  };
}

export function putPapers(papers) {
  return putMany("papers", papers);
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
  const db = await openDatabase();
  const transaction = db.transaction(STORES, "readwrite");

  for (const storeName of STORES) transaction.objectStore(storeName).clear();

  const paperStore = transaction.objectStore("papers");
  for (const paper of library.papers || []) paperStore.put(structuredClone(paper));

  const edgeStore = transaction.objectStore("edges");
  for (const edge of library.edges || []) edgeStore.put(structuredClone(edge));

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
