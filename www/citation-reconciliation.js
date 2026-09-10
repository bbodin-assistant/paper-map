import { normalizeDoi, normalizedTitle } from "./import-export.js";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeArxivId(value) {
  return clean(value).replace(/^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)/i, "")
    .replace(/\.pdf$/i, "").replace(/v\d+$/i, "").toLowerCase();
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

function compactCitationText(value) {
  return clean(value).normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function titleEvidence(paper) {
  const title = clean(paper.title);
  const firstAuthor = clean(paper.authors?.[0]?.name || paper.authors?.[0]);
  return {
    paper,
    title: compactCitationText(title),
    wordCount: title.split(/\s+/).length,
    surname: compactCitationText(firstAuthor.split(/\s+/).at(-1)),
    year: normalizedYear(paper.year),
  };
}

function hasConflictingIdentifiers(reference, paper) {
  return ["doi", "semanticScholarId", "arxivId"].some(key => {
    const normalize = key === "doi" ? normalizeDoi : key === "arxivId" ? normalizeArxivId : value => clean(value).toLowerCase();
    const left = normalize(reference[key]);
    const right = normalize(paper[key]);
    return left && right && left !== right;
  });
}

function matchLocalReference(reference, targets) {
  // Saving the review is the explicit acceptance boundary. A raw extraction
  // that has not been reviewed must never manufacture graph relationships.
  if (reference.reviewed !== true) return null;
  for (const [key, normalize] of [
    ["doi", normalizeDoi], ["semanticScholarId", value => clean(value).toLowerCase()], ["arxivId", normalizeArxivId],
  ]) {
    const identity = normalize(reference[key]);
    if (!identity) continue;
    const matches = targets.filter(({ paper }) => normalize(paper[key]) === identity && !hasConflictingIdentifiers(reference, paper));
    if (matches.length > 1) return null;
    if (matches.length === 1) return { target: matches[0].paper, matchedBy: `local-${key}` };
  }

  // PDF line breaks sometimes truncate the parsed DOI. Match the complete DOI
  // of a known library paper in the printed text; never invent a missing suffix.
  const identifierText = clean(reference.rawText).replace(/\s+/g, "").toLowerCase();
  const parsedDoi = normalizeDoi(reference.doi);
  const printedDoiMatches = targets.filter(({ paper }) => {
    const doi = normalizeDoi(paper.doi);
    if (!doi || (parsedDoi && !doi.startsWith(parsedDoi))) return false;
    if (hasConflictingIdentifiers({ ...reference, doi }, paper)) return false;
    const start = identifierText.indexOf(doi);
    return start >= 0 && !/[a-z0-9]/.test(identifierText[start - 1] || "")
      && !/[a-z0-9/_-]/.test(identifierText[start + doi.length] || "");
  });
  if (printedDoiMatches.length > 1) return null;
  if (printedDoiMatches.length === 1) return { target: printedDoiMatches[0].paper, matchedBy: "local-doi-text" };

  // The complete, distinctive title must occur contiguously in the citation.
  // Only spacing, punctuation, accents and line-break hyphenation are ignored.
  // The first author's surname must precede it, and known years must agree.
  const raw = clean(reference.rawText);
  const compact = compactCitationText(raw);
  const years = new Set(raw.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) || []);
  const referenceYear = normalizedYear(reference.year);
  if (referenceYear) years.add(String(referenceYear));
  if (!years.size) return null;
  const matches = targets.filter(({ paper, title, wordCount, surname, year }) => {
    if (title.length < 40 || wordCount < 5 || surname.length < 3 || hasConflictingIdentifiers(reference, paper)) return false;
    if (year && (!years.has(String(year)) || (referenceYear && referenceYear !== year))) return false;
    const start = compact.indexOf(title);
    return start >= 0 && compact.slice(Math.max(0, start - 350), start).includes(surname);
  });
  if (matches.length !== 1) return null;
  return { target: matches[0].paper, matchedBy: matches[0].year ? "local-title-author-year" : "local-title-author" };
}

export function inferResolvedReferenceCitationEdges(papers = [], existingEdges = []) {
  const libraryPapers = (papers || []).filter((paper) => paper?.id);
  const evidence = libraryPapers.map(titleEvidence);
  const existingIds = new Set((existingEdges || []).map((edge) => edge?.id).filter(Boolean));
  const inferred = [];

  for (const source of libraryPapers) {
    for (const reference of source.extractedReferences || []) {
      if (reference?.reviewed === false) continue;
      const canonical = canonicalReferenceIdentity(reference);
      const targets = evidence.filter(({ paper }) => paper.id !== source.id);
      let target, localMatch;
      if (canonical) {
        const matches = targets.filter(({ paper }) => papersRepresentSameWork(paper, canonical));
        if (matches.length === 1) target = matches[0].paper;
      } else {
        localMatch = matchLocalReference(reference, targets);
        target = localMatch?.target;
      }
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
          provider: localMatch ? "local-library" : clean(reference.resolution?.provider),
          matchedBy: localMatch ? localMatch.matchedBy : clean(reference.resolution?.matchedBy),
          resolvedAt: localMatch ? "" : clean(reference.resolution?.resolvedAt),
        },
      });
    }
  }

  return inferred;
}
