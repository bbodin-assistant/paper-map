import { normalizeDoi } from "../import-export.js";
import { loadSemanticScholarApiKey } from "../paper-provider-config.js";

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
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

export const providerId = "semantic-scholar";
export const providerLabel = "Semantic Scholar";
export const capabilities = Object.freeze({ search: true, resolve: true, enrich: true, references: true, citations: true });

async function request(path, params = {}, { signal } = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const headers = { Accept: "application/json" };
  const key = loadSemanticScholarApiKey();
  if (key) headers["x-api-key"] = key;

  const response = await fetch(url, { headers, signal });
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
  const arxivId = String(value?.externalIds?.ArXiv || "").trim();
  if (arxivId) return `arxiv:${arxivId.toLowerCase()}`;
  return `s2:unknown:${crypto.randomUUID()}`;
}

export function normalizePaper(value) {
  const doi = normalizeDoi(value?.externalIds?.DOI);
  const arxivId = value?.externalIds?.ArXiv || "";
  const topicNames = Array.from(new Set((value?.fieldsOfStudy || []).map(String).filter(Boolean)));
  return {
    id: stableId(value),
    semanticScholarId: value?.paperId || "",
    openAlexId: "",
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
    source: providerId,
    metadataSources: [providerId],
    providerPrimary: providerId,
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

export async function searchPapers(query, limit = 5, options = {}) {
  const text = String(query || "").trim();
  if (!text) return [];
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const result = await request("/paper/search", { query: text, limit: boundedLimit, fields: PAPER_FIELDS }, options);
  return (result?.data || [])
    .filter((paper) => paper?.paperId && paper?.title)
    .map(normalizePaper);
}

export async function resolvePaper(query, options = {}) {
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
    const paper = await request(`/paper/${encodeURIComponent(identifier)}`, { fields: PAPER_FIELDS }, options);
    return normalizePaper(paper);
  }

  const matches = await searchPapers(text, 1, options);
  if (!matches.length) throw new Error("No matching paper found in Semantic Scholar.");
  return matches[0];
}

export async function enrichPaper(paper, options = {}) {
  const identifier = providerIdentifier(paper);
  if (identifier) {
    const result = await request(`/paper/${encodeURIComponent(identifier)}`, { fields: PAPER_FIELDS }, options);
    return normalizePaper(result);
  }
  return resolvePaper(paper?.title || "", options);
}

async function fetchRelationship(paper, direction, offset = 0, limit = 50, options = {}) {
  const identifier = providerIdentifier(paper);
  if (!identifier) throw new Error("This paper needs a DOI, arXiv ID, or Semantic Scholar ID before citation expansion.");

  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const payload = await request(`/paper/${encodeURIComponent(identifier)}/${direction}`, {
    offset: Math.max(0, Number(offset) || 0),
    limit: boundedLimit,
    fields: PAPER_FIELDS,
  }, options);

  const paperKey = direction === "references" ? "citedPaper" : "citingPaper";
  const papers = (payload?.data || [])
    .map((item) => item?.[paperKey])
    .filter((item) => item?.paperId && item?.title)
    .map(normalizePaper);

  return {
    papers,
    next: payload?.next ?? null,
    direction,
    provider: providerId,
  };
}

export function fetchReferences(paper, offset = 0, limit = 50, options = {}) {
  return fetchRelationship(paper, "references", offset, limit, options);
}

export function fetchCitations(paper, offset = 0, limit = 50, options = {}) {
  return fetchRelationship(paper, "citations", offset, limit, options);
}
