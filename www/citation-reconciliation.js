import { normalizeDoi, normalizedTitle } from "./import-export.js";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeArxivId(value) {
  return clean(value).replace(/^arxiv:\s*/i, "").toLowerCase();
}

function normalizedYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year > 0 ? year : null;
}

function compactCanonicalReference(canonical = {}) {
  const value = canonical || {};
  const compact = {
    doi: normalizeDoi(value.doi),
    semanticScholarId: clean(value.semanticScholarId),
    arxivId: normalizeArxivId(value.arxivId),
    title: clean(value.title),
    year: normalizedYear(value.year),
  };
  if (!compact.doi && !compact.semanticScholarId && !compact.arxivId && !(normalizedTitle(compact.title) && compact.year)) {
    return null;
  }
  return compact;
}

export function canonicalReferenceIdentity(reference = {}) {
  const persisted = compactCanonicalReference(reference.canonicalReference || {});
  if (persisted) return persisted;
  if (reference.resolution?.status !== "matched") return null;
  return compactCanonicalReference(reference.resolution?.canonical || {});
}

function sameCanonicalReference(left, right) {
  if (!left || !right) return false;
  return left.doi === right.doi
    && left.semanticScholarId === right.semanticScholarId
    && left.arxivId === right.arxivId
    && left.title === right.title
    && left.year === right.year;
}

function normalizeReference(reference = {}) {
  const canonical = canonicalReferenceIdentity(reference);
  if (!canonical || sameCanonicalReference(reference.canonicalReference, canonical)) return reference;
  return { ...reference, canonicalReference: canonical };
}

export function normalizePaperReferenceIdentities(paper = {}) {
  if (!Array.isArray(paper.extractedReferences) || !paper.extractedReferences.length) return paper;
  let changed = false;
  const extractedReferences = paper.extractedReferences.map((reference) => {
    const normalized = normalizeReference(reference);
    if (normalized !== reference) changed = true;
    return normalized;
  });
  return changed ? { ...paper, extractedReferences } : paper;
}

function referenceProvenanceKey(reference = {}) {
  const canonical = canonicalReferenceIdentity(reference);
  const doi = normalizeDoi(reference.doi || canonical?.doi);
  if (doi) return `doi:${doi}`;
  const arxivId = normalizeArxivId(reference.arxivId || canonical?.arxivId);
  if (arxivId) return `arxiv:${arxivId}`;
  const rawText = clean(reference.rawText).replace(/\s+/g, " ").toLowerCase();
  if (rawText) return `raw:${rawText}`;
  if (canonical?.semanticScholarId) return `s2:${canonical.semanticScholarId.toLowerCase()}`;
  const title = normalizedTitle(canonical?.title);
  return title && canonical?.year ? `title:${title}:${canonical.year}` : "";
}

function mergeReviewedFlag(left, right) {
  if (left === true || right === true) return true;
  if (left === false && right === false) return false;
  return right ?? left;
}

export function mergeExtractedReferenceProvenance(existing = [], incoming = []) {
  const records = new Map();
  let anonymousIndex = 0;
  for (const rawReference of [...(existing || []), ...(incoming || [])]) {
    const reference = normalizeReference(rawReference || {});
    const key = referenceProvenanceKey(reference) || `anonymous:${anonymousIndex++}`;
    const prior = records.get(key);
    if (!prior) {
      records.set(key, reference);
      continue;
    }
    const reviewed = mergeReviewedFlag(prior.reviewed, reference.reviewed);
    records.set(key, {
      ...prior,
      ...reference,
      ...(prior.resolution && !reference.resolution ? { resolution: prior.resolution } : {}),
      ...(prior.canonicalReference && !reference.canonicalReference ? { canonicalReference: prior.canonicalReference } : {}),
      ...(reviewed === undefined ? {} : { reviewed }),
    });
  }
  return Array.from(records.values());
}

function papersRepresentSameWork(left = {}, right = {}) {
  const leftDoi = normalizeDoi(left.doi);
  const rightDoi = normalizeDoi(right.doi);
  if (leftDoi && rightDoi) return leftDoi === rightDoi;

  const leftS2 = clean(left.semanticScholarId).toLowerCase();
  const rightS2 = clean(right.semanticScholarId).toLowerCase();
  if (leftS2 && rightS2) return leftS2 === rightS2;

  const leftArxiv = normalizeArxivId(left.arxivId);
  const rightArxiv = normalizeArxivId(right.arxivId);
  if (leftArxiv && rightArxiv) return leftArxiv === rightArxiv;

  const leftTitle = normalizedTitle(left.title);
  const rightTitle = normalizedTitle(right.title);
  const leftYear = normalizedYear(left.year);
  const rightYear = normalizedYear(right.year);
  return Boolean(leftTitle && rightTitle && leftYear && rightYear && leftTitle === rightTitle && leftYear === rightYear);
}

export function inferResolvedReferenceCitationEdges(papers = [], existingEdges = []) {
  const libraryPapers = (papers || []).filter((paper) => paper?.id);
  const existingIds = new Set((existingEdges || []).map((edge) => edge?.id).filter(Boolean));
  const inferred = [];

  for (const source of libraryPapers) {
    for (const reference of source.extractedReferences || []) {
      if (reference?.reviewed === false) continue;
      const canonical = canonicalReferenceIdentity(reference);
      if (!canonical) continue;
      const target = libraryPapers.find((paper) => paper.id !== source.id && papersRepresentSameWork(paper, canonical));
      if (!target) continue;
      const id = `${source.id}->${target.id}`;
      if (existingIds.has(id)) continue;
      existingIds.add(id);
      inferred.push({
        id,
        source: source.id,
        target: target.id,
        kind: "citation",
        provenance: "reviewed-reference",
        referenceResolution: {
          provider: clean(reference.resolution?.provider),
          matchedBy: clean(reference.resolution?.matchedBy),
          resolvedAt: clean(reference.resolution?.resolvedAt),
        },
      });
    }
  }

  return inferred;
}
