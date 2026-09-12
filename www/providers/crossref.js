import { normalizeDoi, normalizedTitle } from "../import-export.js";

const BASE_URL = "https://api.crossref.org";

export const providerId = "crossref";
export const providerLabel = "Crossref";
export const capabilities = Object.freeze({ search: true, resolve: true, enrich: true, references: false, citations: false });

function clean(value) {
  return String(value ?? "").trim();
}

function firstDateYear(work) {
  for (const key of ["published-print", "published-online", "published", "issued", "created"]) {
    const parts = work?.[key]?.["date-parts"]?.[0];
    const year = Number(parts?.[0]);
    if (Number.isInteger(year) && year > 0) return year;
  }
  return null;
}

function authors(work) {
  return (work?.author || [])
    .map((author) => clean(author?.name || [author?.given, author?.family].filter(Boolean).join(" ")))
    .filter(Boolean);
}

function plainAbstract(value) {
  return clean(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeReference(reference = {}, index = 0) {
  const doi = normalizeDoi(reference?.DOI || reference?.doi);
  const title = clean(reference?.["article-title"] || reference?.["series-title"] || reference?.title);
  const yearValue = Number(reference?.year);
  const year = Number.isInteger(yearValue) && yearValue > 0 ? yearValue : null;
  const authorText = clean(reference?.author);
  const venue = clean(reference?.["journal-title"] || reference?.["series-title"]);
  const rawText = clean(reference?.unstructured) || [
    authorText,
    year ? `(${year})` : "",
    title,
    venue,
    doi ? `https://doi.org/${doi}` : "",
  ].filter(Boolean).join(". ").replace(/\.\s*\./g, ".");
  if (!rawText && !doi && !title) return null;
  return {
    index: index + 1,
    label: clean(reference?.key) || String(index + 1),
    rawText,
    title,
    authors: authorText ? [authorText] : [],
    year,
    venue,
    doi,
    arxivId: "",
    confidence: doi ? 0.98 : title ? 0.86 : 0.65,
    source: providerId,
    canonicalReference: { doi, title, year },
  };
}

export function normalizePaper(work) {
  const doi = normalizeDoi(work?.DOI);
  const title = clean(work?.title?.[0]);
  const year = firstDateYear(work);
  const topicNames = Array.from(new Set((work?.subject || []).map(clean).filter(Boolean)));
  const references = (work?.reference || []).map(normalizeReference).filter(Boolean);
  return {
    id: doi ? `doi:${doi}` : `title:${normalizedTitle(title)}:${year || ""}`,
    semanticScholarId: "",
    openAlexId: "",
    doi,
    arxivId: "",
    title: title || "Untitled paper",
    authors: authors(work),
    year,
    venue: clean(work?.["container-title"]?.[0]),
    type: clean(work?.type),
    url: clean(work?.URL) || (doi ? `https://doi.org/${doi}` : ""),
    pdfUrl: "",
    abstract: plainAbstract(work?.abstract),
    keywords: [],
    topics: [],
    topicNames,
    references,
    tags: [],
    notes: "",
    status: "unread",
    relevance: 3,
    starred: false,
    citationCount: Number.isFinite(Number(work?.["is-referenced-by-count"]))
      ? Number(work["is-referenced-by-count"])
      : null,
    publisher: clean(work?.publisher),
    source: providerId,
    metadataSources: [providerId],
    providerPrimary: providerId,
    enrichedAt: new Date().toISOString(),
  };
}

async function request(path, params = {}, { signal } = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = clean(body?.message || body?.status);
    } catch {
      detail = clean(await response.text().catch(() => ""));
    }
    throw new Error(`Crossref request failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  const payload = await response.json();
  return payload?.message || payload;
}

export async function searchPapers(query, limit = 5, options = {}) {
  const text = clean(query);
  if (!text) return [];
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const result = await request("/works", { "query.bibliographic": text, rows: boundedLimit }, options);
  return (result?.items || []).map(normalizePaper).filter((paper) => paper.title && paper.title !== "Untitled paper");
}

async function resolveDoi(doi, options = {}) {
  const requested = normalizeDoi(doi);
  const paper = normalizePaper(await request(`/works/${encodeURIComponent(requested)}`, {}, options));
  if (!paper.doi || paper.doi !== requested) throw new Error("Crossref returned metadata for a different DOI.");
  return paper;
}

export async function resolvePaper(query, options = {}) {
  const text = clean(query);
  if (!text) throw new Error("Enter a DOI or paper title.");
  const doi = normalizeDoi(text);
  if (/^10\.\d{4,9}\//.test(doi)) return resolveDoi(doi, options);
  const matches = await searchPapers(text, 1, options);
  if (!matches.length) throw new Error("No matching paper found in Crossref.");
  return matches[0];
}

export async function enrichPaper(paper, options = {}) {
  if (normalizeDoi(paper?.doi)) return resolveDoi(paper.doi, options);
  return resolvePaper(paper?.title || "", options);
}
