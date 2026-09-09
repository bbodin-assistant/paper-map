import { normalizeDoi } from "./import-export.js";

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const PAPER_FIELDS = [
  "title",
  "abstract",
  "year",
  "venue",
  "publicationTypes",
  "authors",
  "externalIds",
  "url",
  "openAccessPdf",
  "citationCount",
  "fieldsOfStudy",
].join(",");

function apiKey() {
  try {
    return localStorage.getItem("paper-map-semantic-scholar-key") || "";
  } catch {
    return "";
  }
}

async function request(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const headers = { Accept: "application/json" };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await globalThis.fetch(url, { headers, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Semantic Scholar request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.message || body?.error || "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    const suffix = detail ? ` ${detail}` : "";
    throw new Error(`Semantic Scholar request failed (${response.status}).${suffix}`);
  }
  return response.json();
}

function stableId(value) {
  const doi = normalizeDoi(value?.externalIds?.DOI);
  if (doi) return `doi:${doi}`;
  if (value?.paperId) return `s2:${value.paperId}`;
  return `s2:unknown:${crypto.randomUUID()}`;
}

export function normalizeSemanticScholarPaper(value) {
  const doi = normalizeDoi(value?.externalIds?.DOI);
  const arxivId = value?.externalIds?.ArXiv || "";
  const topicNames = Array.from(new Set((value?.fieldsOfStudy || []).map(String).filter(Boolean)));
  return {
    id: stableId(value),
    semanticScholarId: value?.paperId || "",
    doi,
    arxivId,
    title: value?.title || "Untitled paper",
    authors: (value?.authors || []).map((author) => author?.name).filter(Boolean),
    year: Number.isFinite(Number(value?.year)) ? Number(value.year) : null,
    venue: value?.venue || "",
    type: value?.publicationTypes?.[0] || "",
    url: value?.url || (doi ? `https://doi.org/${doi}` : ""),
    pdfUrl: value?.openAccessPdf?.url || "",
    abstract: value?.abstract || "",
    keywords: [],
    topics: [],
    topicNames,
    tags: [],
    notes: "",
    status: "unread",
    relevance: 3,
    starred: false,
    citationCount: Number.isFinite(Number(value?.citationCount)) ? Number(value.citationCount) : null,
    source: "semantic-scholar",
    enrichedAt: new Date().toISOString(),
  };
}

function providerIdentifier(paper) {
  const doi = normalizeDoi(paper?.doi);
  if (doi) return `DOI:${doi}`;
  if (paper?.semanticScholarId) return paper.semanticScholarId;
  if (paper?.arxivId) return `ARXIV:${paper.arxivId}`;
  return "";
}

export async function searchPapers(query, limit = 5) {
  const text = String(query || "").trim();
  if (!text) return [];
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const result = await request("/paper/search", { query: text, limit: boundedLimit, fields: PAPER_FIELDS });
  return (result?.data || [])
    .filter((paper) => paper?.paperId && paper?.title)
    .map(normalizeSemanticScholarPaper);
}

export async function resolvePaper(query) {
  const text = String(query || "").trim();
  if (!text) throw new Error("Enter a DOI, Semantic Scholar ID, arXiv ID, or title.");

  const doi = normalizeDoi(text);
  const looksLikeDoi = /^10\.\d{4,9}\//.test(doi);
  const looksLikeS2 = /^[0-9a-f]{40}$/i.test(text);
  const looksLikeArxiv = /^(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(text);

  if (looksLikeDoi || looksLikeS2 || looksLikeArxiv) {
    const identifier = looksLikeDoi
      ? `DOI:${doi}`
      : looksLikeArxiv
        ? `ARXIV:${text.replace(/^arxiv:/i, "")}`
        : text;
    const paper = await request(`/paper/${encodeURIComponent(identifier)}`, { fields: PAPER_FIELDS });
    return normalizeSemanticScholarPaper(paper);
  }

  const matches = await searchPapers(text, 1);
  if (!matches.length) throw new Error("No matching paper found in Semantic Scholar.");
  return matches[0];
}

export async function enrichPaper(paper) {
  const identifier = providerIdentifier(paper);
  if (identifier) {
    const result = await request(`/paper/${encodeURIComponent(identifier)}`, { fields: PAPER_FIELDS });
    return normalizeSemanticScholarPaper(result);
  }
  return resolvePaper(paper?.title || "");
}

async function fetchRelationship(paper, direction, offset = 0, limit = 50) {
  const identifier = providerIdentifier(paper);
  if (!identifier) throw new Error("This paper needs a DOI, arXiv ID, or Semantic Scholar ID before citation expansion.");

  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const payload = await request(`/paper/${encodeURIComponent(identifier)}/${direction}`, {
    offset: Math.max(0, Number(offset) || 0),
    limit: boundedLimit,
    fields: PAPER_FIELDS,
  });
  const papers = (payload?.data || [])
    .map((entry) => direction === "references" ? entry?.citedPaper : entry?.citingPaper)
    .filter((entry) => entry?.paperId)
    .map(normalizeSemanticScholarPaper);
  return { papers, next: payload?.next ?? null };
}

export function fetchReferences(paper, offset = 0, limit = 50) {
  return fetchRelationship(paper, "references", offset, limit);
}

export function fetchCitations(paper, offset = 0, limit = 50) {
  return fetchRelationship(paper, "citations", offset, limit);
}