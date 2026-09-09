import { normalizeDoi } from "./import-export.js";
import { resolvePaper } from "./semantic-scholar.js";

const CROSSREF_BASE_URL = "https://api.crossref.org";

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
    return {
      status: "no-identifier",
      provider: "",
      matchedBy: "",
      queriedIdentifier: "",
      confidence: 0,
      canonical: null,
      resolvedAt: new Date().toISOString(),
      attempts: [],
    };
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
