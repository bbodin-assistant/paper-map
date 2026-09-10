import { normalizeDoi, normalizedTitle } from "../import-export.js";

const BASE_URL = "https://api.openalex.org";

export const providerId = "openalex";
export const providerLabel = "OpenAlex";
export const capabilities = Object.freeze({ search: true, resolve: true, enrich: true, references: true, citations: true });

function clean(value) {
  return String(value ?? "").trim();
}

function openAlexId(value) {
  const raw = clean(value);
  const match = raw.match(/(?:openalex\.org\/)?(W\d+)$/i);
  return match ? match[1].toUpperCase() : "";
}

function arxivIdFromWork(work) {
  for (const location of work?.locations || []) {
    const candidate = clean(location?.landing_page_url || location?.pdf_url);
    const match = candidate.match(/arxiv\.org\/(?:abs|pdf)\/([^?#/]+?)(?:\.pdf)?$/i);
    if (match) return match[1];
  }
  return "";
}

function abstractFromInvertedIndex(index) {
  if (!index || typeof index !== "object") return "";
  let maxPosition = -1;
  for (const positions of Object.values(index)) {
    for (const position of positions || []) maxPosition = Math.max(maxPosition, Number(position) || 0);
  }
  if (maxPosition < 0) return "";
  const words = new Array(maxPosition + 1).fill("");
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || []) {
      const indexValue = Number(position);
      if (Number.isInteger(indexValue) && indexValue >= 0 && indexValue < words.length) words[indexValue] = word;
    }
  }
  return words.filter(Boolean).join(" ");
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
      detail = clean(body?.error || body?.message);
    } catch {
      detail = clean(await response.text().catch(() => ""));
    }
    throw new Error(`OpenAlex request failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  return response.json();
}

export function normalizePaper(value) {
  const doi = normalizeDoi(value?.doi || value?.ids?.doi);
  const workId = openAlexId(value?.id || value?.ids?.openalex);
  const arxivId = arxivIdFromWork(value);
  const topicNames = Array.from(new Set([
    ...(value?.topics || []).map((topic) => clean(topic?.display_name)),
    ...(value?.concepts || []).filter((concept) => Number(concept?.score) >= 0.45).slice(0, 6).map((concept) => clean(concept?.display_name)),
  ].filter(Boolean)));
  const primaryLocation = value?.primary_location || value?.best_oa_location || {};
  const venue = clean(primaryLocation?.source?.display_name || value?.host_venue?.display_name);
  const id = doi
    ? `doi:${doi}`
    : arxivId
      ? `arxiv:${arxivId.toLowerCase()}`
      : workId
        ? `openalex:${workId}`
        : `title:${normalizedTitle(value?.title)}:${value?.publication_year || ""}`;
  return {
    id,
    semanticScholarId: "",
    openAlexId: workId,
    doi,
    arxivId,
    title: clean(value?.title || value?.display_name) || "Untitled paper",
    authors: (value?.authorships || []).map((authorship) => clean(authorship?.author?.display_name)).filter(Boolean),
    year: Number.isInteger(Number(value?.publication_year)) ? Number(value.publication_year) : null,
    venue,
    type: clean(value?.type_crossref || value?.type),
    url: clean(primaryLocation?.landing_page_url || value?.id) || (doi ? `https://doi.org/${doi}` : ""),
    pdfUrl: clean(value?.best_oa_location?.pdf_url || primaryLocation?.pdf_url),
    abstract: abstractFromInvertedIndex(value?.abstract_inverted_index),
    keywords: (value?.keywords || []).map((keyword) => clean(keyword?.display_name || keyword?.keyword)).filter(Boolean),
    topics: [],
    topicNames,
    tags: [],
    notes: "",
    status: "unread",
    relevance: 3,
    starred: false,
    citationCount: Number.isFinite(Number(value?.cited_by_count)) ? Number(value.cited_by_count) : null,
    source: providerId,
    metadataSources: [providerId],
    providerPrimary: providerId,
    enrichedAt: new Date().toISOString(),
  };
}

async function works(params, options = {}) {
  const payload = await request("/works", params, options);
  return { papers: (payload?.results || []).map(normalizePaper), meta: payload?.meta || {} };
}

export async function searchPapers(query, limit = 5, options = {}) {
  const text = clean(query);
  if (!text) return [];
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const result = await works({ search: text, "per-page": boundedLimit }, options);
  return result.papers.filter((paper) => paper.title && paper.title !== "Untitled paper");
}

async function resolveByDoi(doi, options = {}) {
  const normalized = normalizeDoi(doi);
  const result = await works({ filter: `doi:https://doi.org/${normalized}`, "per-page": 1 }, options);
  const paper = result.papers[0];
  if (!paper || paper.doi !== normalized) throw new Error("No matching DOI found in OpenAlex.");
  return paper;
}

export async function resolvePaper(query, options = {}) {
  const text = clean(query);
  if (!text) throw new Error("Enter a DOI, OpenAlex ID, arXiv ID, or title.");
  const doi = normalizeDoi(text);
  if (/^10\.\d{4,9}\//.test(doi)) return resolveByDoi(doi, options);

  const workId = openAlexId(text);
  if (workId) return normalizePaper(await request(`/works/${workId}`, {}, options));

  const matches = await searchPapers(text.replace(/^arxiv:/i, ""), 5, options);
  const requestedArxiv = text.replace(/^arxiv:/i, "");
  const exactArxiv = matches.find((paper) => paper.arxivId && paper.arxivId.toLowerCase() === requestedArxiv.toLowerCase());
  if (exactArxiv) return exactArxiv;
  if (!matches.length) throw new Error("No matching paper found in OpenAlex.");
  return matches[0];
}

export async function enrichPaper(paper, options = {}) {
  if (paper?.openAlexId) return normalizePaper(await request(`/works/${openAlexId(paper.openAlexId)}`, {}, options));
  if (normalizeDoi(paper?.doi)) return resolveByDoi(paper.doi, options);
  if (paper?.arxivId) return resolvePaper(`arxiv:${paper.arxivId}`, options);
  return resolvePaper(paper?.title || "", options);
}

async function canonicalWork(paper, options = {}) {
  if (paper?.openAlexId) return request(`/works/${openAlexId(paper.openAlexId)}`, {}, options);
  const enriched = await enrichPaper(paper, options);
  if (!enriched.openAlexId) throw new Error("OpenAlex could not identify this paper for citation expansion.");
  return request(`/works/${enriched.openAlexId}`, {}, options);
}

export async function fetchReferences(paper, offset = 0, limit = 50, options = {}) {
  const work = await canonicalWork(paper, options);
  const ids = Array.isArray(work?.referenced_works) ? work.referenced_works.map(openAlexId).filter(Boolean) : [];
  const start = Math.max(0, Number(offset) || 0);
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const pageIds = ids.slice(start, start + boundedLimit);
  if (!pageIds.length) return { papers: [], next: null, direction: "references", provider: providerId };
  const result = await works({ filter: `openalex_id:${pageIds.join("|")}`, "per-page": pageIds.length }, options);
  return {
    papers: result.papers,
    next: start + pageIds.length < ids.length ? start + pageIds.length : null,
    direction: "references",
    provider: providerId,
  };
}

export async function fetchCitations(paper, offset = 0, limit = 50, options = {}) {
  const work = await canonicalWork(paper, options);
  const workId = openAlexId(work?.id);
  if (!workId) throw new Error("OpenAlex could not identify this paper for citation expansion.");
  const start = Math.max(0, Number(offset) || 0);
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const page = Math.floor(start / boundedLimit) + 1;
  const result = await works({ filter: `cites:${workId}`, "per-page": boundedLimit, page }, options);
  const count = Number(result.meta?.count) || result.papers.length;
  return {
    papers: result.papers,
    next: start + result.papers.length < count ? start + result.papers.length : null,
    direction: "citations",
    provider: providerId,
  };
}
