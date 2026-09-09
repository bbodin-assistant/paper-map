import { normalizeDoi } from "./import-export.js";
import { resolvePaper, searchPapers } from "./semantic-scholar.js";

const CROSSREF_BASE_URL = "https://api.crossref.org";
const SEARCH_CANDIDATE_LIMIT = 5;
const AUTO_MATCH_MIN_CONFIDENCE = 0.9;
const AUTO_MATCH_MIN_MARGIN = 0.1;
const CANDIDATE_MIN_CONFIDENCE = 0.72;
const TOKEN_STOPWORDS = new Set([
  "a", "an", "and", "by", "et", "for", "from", "in", "of", "on", "or", "the", "to", "with", "without",
  "journal", "proceedings", "conference", "volume", "vol", "issue", "number", "pages", "page", "pp",
]);

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeArxivId(value) {
  return clean(value).replace(/^arxiv:\s*/i, "");
}

export function arxivBaseId(value) {
  return normalizeArxivId(value).replace(/v\d+$/i, "");
}

function firstDateYear(work) {
  for (const key of ["published-print", "published-online", "published", "issued", "created"]) {
    const parts = work?.[key]?.["date-parts"]?.[0];
    const year = Number(parts?.[0]);
    if (Number.isInteger(year) && year > 0) return year;
  }
  return null;
}

function crossrefAuthors(work) {
  return (work?.author || [])
    .map((author) => clean(author?.name || [author?.given, author?.family].filter(Boolean).join(" ")))
    .filter(Boolean);
}

export function normalizeCrossrefWork(work) {
  const doi = normalizeDoi(work?.DOI);
  const title = clean(work?.title?.[0]);
  const venue = clean(work?.["container-title"]?.[0]);
  return {
    id: doi ? `doi:${doi}` : "",
    semanticScholarId: "",
    doi,
    arxivId: "",
    title: title || "Untitled paper",
    authors: crossrefAuthors(work),
    year: firstDateYear(work),
    venue,
    type: clean(work?.type),
    url: clean(work?.URL) || (doi ? `https://doi.org/${doi}` : ""),
    publisher: clean(work?.publisher),
    citationCount: Number.isFinite(Number(work?.["is-referenced-by-count"]))
      ? Number(work["is-referenced-by-count"])
      : null,
  };
}

async function crossrefRequest(doi, { signal } = {}) {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new Error("A DOI is required for Crossref resolution.");
  const response = await fetch(`${CROSSREF_BASE_URL}/works/${encodeURIComponent(normalized)}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = clean(body?.message || body?.status);
    } catch {
      detail = clean(await response.text().catch(() => ""));
    }
    const error = new Error(`Crossref request failed (${response.status})${detail ? `: ${detail}` : ""}.`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  return payload?.message || payload;
}

export async function resolveDoiWithCrossref(doi, options = {}) {
  const requested = normalizeDoi(doi);
  const canonical = normalizeCrossrefWork(await crossrefRequest(requested, options));
  if (!canonical.doi || canonical.doi !== requested) {
    throw new Error("Crossref returned metadata for a different DOI.");
  }
  return {
    status: "matched",
    provider: "crossref",
    matchedBy: "doi",
    queriedIdentifier: requested,
    confidence: 0.99,
    canonical,
    resolvedAt: new Date().toISOString(),
  };
}

function canonicalFromSemanticScholar(paper) {
  return {
    id: paper?.id || "",
    semanticScholarId: paper?.semanticScholarId || "",
    doi: normalizeDoi(paper?.doi),
    arxivId: normalizeArxivId(paper?.arxivId),
    title: clean(paper?.title) || "Untitled paper",
    authors: Array.isArray(paper?.authors) ? paper.authors.map(clean).filter(Boolean) : [],
    year: Number.isInteger(Number(paper?.year)) && Number(paper.year) > 0 ? Number(paper.year) : null,
    venue: clean(paper?.venue),
    type: clean(paper?.type),
    url: clean(paper?.url),
    publisher: "",
    citationCount: Number.isFinite(Number(paper?.citationCount)) ? Number(paper.citationCount) : null,
  };
}

export async function resolveWithSemanticScholar(identifier, matchedBy) {
  const requested = matchedBy === "doi" ? normalizeDoi(identifier) : normalizeArxivId(identifier);
  const lookup = matchedBy === "doi" ? requested : `arXiv:${arxivBaseId(requested)}`;
  const canonical = canonicalFromSemanticScholar(await resolvePaper(lookup));

  if (matchedBy === "doi") {
    if (!canonical.doi || canonical.doi !== requested) {
      throw new Error("Semantic Scholar returned metadata for a different DOI.");
    }
  } else if (!canonical.arxivId || arxivBaseId(canonical.arxivId).toLowerCase() !== arxivBaseId(requested).toLowerCase()) {
    throw new Error("Semantic Scholar returned metadata for a different arXiv identifier.");
  }

  const versionPreserved = matchedBy === "arxiv"
    && normalizeArxivId(canonical.arxivId).toLowerCase() === normalizeArxivId(requested).toLowerCase();
  return {
    status: "matched",
    provider: "semantic-scholar",
    matchedBy,
    queriedIdentifier: requested,
    confidence: matchedBy === "doi" ? 0.97 : versionPreserved ? 0.99 : 0.98,
    canonical,
    resolvedAt: new Date().toISOString(),
  };
}

function normalizedTokens(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

function meaningfulTokens(value) {
  return normalizedTokens(value).filter((token) => token.length >= 2 && !TOKEN_STOPWORDS.has(token));
}

function referenceYear(reference) {
  const year = Number(reference?.year);
  return Number.isInteger(year) && year > 0 ? year : null;
}

export function referenceSearchQuery(reference) {
  const rawText = clean(reference?.rawText);
  if (!rawText) return "";
  return rawText
    .replace(/^\s*(?:\[[^\]]+\]|\d+[.)])\s*/, "")
    .replace(/\b(?:18|19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function scoreReferenceCandidate(reference, paper) {
  const rawTokens = new Set(meaningfulTokens(reference?.rawText));
  const titleTokens = Array.from(new Set(meaningfulTokens(paper?.title)));
  if (!rawTokens.size || !titleTokens.length) return 0;

  const titleMatches = titleTokens.filter((token) => rawTokens.has(token)).length;
  const titleCoverage = titleMatches / titleTokens.length;
  const surnames = (paper?.authors || [])
    .map((author) => normalizedTokens(author).at(-1) || "")
    .filter((surname) => surname.length >= 3);
  const authorMatch = surnames.length ? surnames.some((surname) => rawTokens.has(surname)) : false;
  const expectedYear = referenceYear(reference);
  const candidateYear = Number.isInteger(Number(paper?.year)) && Number(paper.year) > 0 ? Number(paper.year) : null;

  if (expectedYear && candidateYear !== expectedYear) return 0;
  const minimumCoverage = titleTokens.length <= 2 ? 1 : 0.7;
  if (titleCoverage < minimumCoverage) return 0;
  if (surnames.length && !authorMatch && titleCoverage < 0.92) return 0;

  const yearScore = expectedYear ? 1 : 0.5;
  const authorScore = authorMatch ? 1 : surnames.length ? 0 : 0.5;
  return Math.max(0, Math.min(1, (titleCoverage * 0.7) + (authorScore * 0.2) + (yearScore * 0.1)));
}

function candidateRecord(reference, paper) {
  const canonical = canonicalFromSemanticScholar(paper);
  return {
    provider: "semantic-scholar",
    matchedBy: "title-author-year",
    confidence: scoreReferenceCandidate(reference, canonical),
    canonical,
  };
}

async function resolveIdentifierlessReference(reference) {
  const query = referenceSearchQuery(reference);
  if (!query) {
    return {
      status: "no-identifier",
      provider: "",
      matchedBy: "",
      queriedIdentifier: "",
      queriedText: "",
      confidence: 0,
      canonical: null,
      resolvedAt: new Date().toISOString(),
      attempts: [],
    };
  }

  try {
    const papers = await searchPapers(query, SEARCH_CANDIDATE_LIMIT);
    const candidates = papers
      .map((paper) => candidateRecord(reference, paper))
      .filter((candidate) => candidate.confidence >= CANDIDATE_MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence);
    const top = candidates[0];
    const runnerUp = candidates[1];
    const margin = top ? top.confidence - (runnerUp?.confidence || 0) : 0;

    if (top && top.confidence >= AUTO_MATCH_MIN_CONFIDENCE && (!runnerUp || margin >= AUTO_MATCH_MIN_MARGIN)) {
      return {
        status: "matched",
        provider: top.provider,
        matchedBy: top.matchedBy,
        queriedIdentifier: "",
        queriedText: query,
        confidence: top.confidence,
        canonical: top.canonical,
        resolvedAt: new Date().toISOString(),
        attempts: [{ provider: "semantic-scholar", status: "matched", candidatesConsidered: papers.length }],
      };
    }

    if (candidates.length) {
      return {
        status: "candidates",
        provider: "semantic-scholar",
        matchedBy: "title-author-year",
        queriedIdentifier: "",
        queriedText: query,
        confidence: top.confidence,
        canonical: null,
        candidates,
        resolvedAt: new Date().toISOString(),
        attempts: [{ provider: "semantic-scholar", status: "candidates", candidatesConsidered: papers.length }],
      };
    }

    return {
      status: "unresolved",
      provider: "",
      matchedBy: "title-author-year",
      queriedIdentifier: "",
      queriedText: query,
      confidence: 0,
      canonical: null,
      resolvedAt: new Date().toISOString(),
      attempts: [{ provider: "semantic-scholar", status: "no-match", candidatesConsidered: papers.length }],
    };
  } catch (error) {
    return {
      status: "unresolved",
      provider: "",
      matchedBy: "title-author-year",
      queriedIdentifier: "",
      queriedText: query,
      confidence: 0,
      canonical: null,
      resolvedAt: new Date().toISOString(),
      attempts: [{ provider: "semantic-scholar", status: "failed", message: clean(error?.message) }],
    };
  }
}

export function selectReferenceCandidate(resolution, candidateIndex) {
  const index = Number(candidateIndex);
  const candidate = resolution?.status === "candidates" && Number.isInteger(index)
    ? resolution.candidates?.[index]
    : null;
  if (!candidate?.canonical) throw new Error("Select a valid canonical reference candidate.");
  return {
    ...resolution,
    status: "matched",
    provider: candidate.provider,
    matchedBy: candidate.matchedBy,
    confidence: candidate.confidence,
    canonical: candidate.canonical,
    selectedBy: "user",
    selectedCandidateIndex: index,
    resolvedAt: new Date().toISOString(),
    attempts: [
      ...(resolution.attempts || []),
      { provider: candidate.provider, status: "selected", candidateIndex: index },
    ],
  };
}

export async function resolveExtractedReference(reference, options = {}) {
  const doi = normalizeDoi(reference?.doi);
  const arxivId = normalizeArxivId(reference?.arxivId);
  const attempts = [];

  if (doi) {
    try {
      const result = await resolveDoiWithCrossref(doi, options);
      return { ...result, attempts: [{ provider: "crossref", status: "matched" }] };
    } catch (error) {
      attempts.push({ provider: "crossref", status: "failed", message: clean(error?.message) });
      try {
        const result = await resolveWithSemanticScholar(doi, "doi");
        return { ...result, attempts: [...attempts, { provider: "semantic-scholar", status: "matched" }] };
      } catch (fallbackError) {
        attempts.push({ provider: "semantic-scholar", status: "failed", message: clean(fallbackError?.message) });
      }
    }
  } else if (arxivId) {
    try {
      const result = await resolveWithSemanticScholar(arxivId, "arxiv");
      return { ...result, attempts: [{ provider: "semantic-scholar", status: "matched" }] };
    } catch (error) {
      attempts.push({ provider: "semantic-scholar", status: "failed", message: clean(error?.message) });
    }
  } else {
    return resolveIdentifierlessReference(reference);
  }

  return {
    status: "unresolved",
    provider: "",
    matchedBy: doi ? "doi" : "arxiv",
    queriedIdentifier: doi || arxivId,
    confidence: 0,
    canonical: null,
    resolvedAt: new Date().toISOString(),
    attempts,
  };
}
