import { normalizeDoi, normalizedTitle } from "./import-export.js";

function clean(value) {
  return String(value ?? "").trim();
}

function candidateKey(paper = {}, index = 0) {
  const openAlexId = clean(paper.openAlexId).toLowerCase();
  if (openAlexId) return `openalex:${openAlexId}`;
  const doi = normalizeDoi(paper.doi);
  if (doi) return `doi:${doi}`;
  const arxivId = clean(paper.arxivId).replace(/^arxiv:\s*/i, "").toLowerCase();
  if (arxivId) return `arxiv:${arxivId}`;
  return `title:${normalizedTitle(paper.title)}:${paper.year || ""}:${index}`;
}

export function rankOnlineCandidates(candidates = [], query = "") {
  const requestedTitle = normalizedTitle(query);
  const seen = new Set();
  const ranked = [];

  for (const [index, paper] of candidates.entries()) {
    if (!paper || typeof paper !== "object" || !clean(paper.title)) continue;
    const key = candidateKey(paper, index);
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({
      paper,
      providerRank: index,
      exactTitle: Boolean(requestedTitle && normalizedTitle(paper.title) === requestedTitle),
    });
  }

  ranked.sort((left, right) =>
    Number(right.exactTitle) - Number(left.exactTitle)
    || left.providerRank - right.providerRank);
  return ranked.map(({ paper }) => paper);
}

export function onlineCandidateSummary(paper = {}) {
  const authors = Array.isArray(paper.authors) ? paper.authors.map(clean).filter(Boolean) : [];
  const year = Number.isInteger(Number(paper.year)) && Number(paper.year) > 0 ? Number(paper.year) : null;
  return {
    title: clean(paper.title) || "Untitled candidate",
    authors,
    year,
    venue: clean(paper.venue),
    doi: normalizeDoi(paper.doi),
  };
}
