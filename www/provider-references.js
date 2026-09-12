import { normalizeDoi, normalizedTitle } from "./import-export.js";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeArxivId(value) {
  return clean(value).replace(/^arxiv:\s*/i, "").replace(/v\d+$/i, "").toLowerCase();
}

export function providerReferenceKey(reference = {}) {
  const doi = normalizeDoi(reference.doi || reference.canonicalReference?.doi);
  if (doi) return `doi:${doi}`;
  const arxivId = normalizeArxivId(reference.arxivId || reference.canonicalReference?.arxivId);
  if (arxivId) return `arxiv:${arxivId}`;
  const semanticScholarId = clean(reference.semanticScholarId || reference.canonicalReference?.semanticScholarId).toLowerCase();
  if (semanticScholarId) return `s2:${semanticScholarId}`;
  const openAlexId = clean(reference.openAlexId || reference.canonicalReference?.openAlexId).toLowerCase();
  if (openAlexId) return `openalex:${openAlexId}`;
  const title = normalizedTitle(reference.title || reference.canonicalReference?.title);
  const year = Number(reference.year || reference.canonicalReference?.year) || "";
  if (title) return `title:${title}:${year}`;
  const rawText = clean(reference.rawText).replace(/\s+/g, " ").toLowerCase();
  return rawText ? `raw:${rawText}` : "";
}

export function providerPaperToReference(paper = {}, index = 0, provider = "online") {
  const authors = Array.isArray(paper.authors) ? paper.authors.filter(Boolean).map(String) : [];
  const title = clean(paper.title);
  const year = Number.isFinite(Number(paper.year)) ? Number(paper.year) : null;
  const venue = clean(paper.venue);
  const doi = normalizeDoi(paper.doi);
  const arxivId = clean(paper.arxivId).replace(/^arxiv:\s*/i, "");
  const canonicalReference = {
    doi,
    semanticScholarId: clean(paper.semanticScholarId),
    openAlexId: clean(paper.openAlexId),
    arxivId,
    title,
    year,
  };
  const rawText = [
    authors.join(", "),
    year ? `(${year})` : "",
    title,
    venue,
    doi ? `https://doi.org/${doi}` : "",
  ].filter(Boolean).join(". ").replace(/\.\s*\./g, ".");

  return {
    index: index + 1,
    label: String(index + 1),
    rawText,
    title,
    authors,
    year,
    venue,
    doi,
    arxivId,
    semanticScholarId: clean(paper.semanticScholarId),
    openAlexId: clean(paper.openAlexId),
    url: clean(paper.url),
    confidence: 1,
    source: clean(provider) || "online",
    canonicalReference,
  };
}

export function providerPapersToReferences(papers = [], provider = "online") {
  return (papers || []).filter(Boolean).map((paper, index) => providerPaperToReference(paper, index, provider));
}

export function mergeReferenceRecords(...referenceSets) {
  const records = new Map();
  let anonymous = 0;
  for (const reference of referenceSets.flat().filter(Boolean)) {
    const key = providerReferenceKey(reference) || `anonymous:${anonymous++}`;
    const previous = records.get(key);
    records.set(key, previous ? {
      ...previous,
      ...reference,
      ...(previous.resolution && !reference.resolution ? { resolution: previous.resolution } : {}),
      ...(previous.canonicalReference && !reference.canonicalReference ? { canonicalReference: previous.canonicalReference } : {}),
    } : { ...reference });
  }
  return Array.from(records.values());
}
