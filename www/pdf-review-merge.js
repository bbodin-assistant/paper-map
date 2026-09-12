import { normalizeDoi } from "./import-export.js";
import { mergeReferenceRecords } from "./provider-references.js?v=0.4.5";

const BIBLIOGRAPHIC_FIELDS = Object.freeze([
  "title",
  "authors",
  "year",
  "type",
  "venue",
  "doi",
  "semanticScholarId",
  "openAlexId",
  "arxivId",
  "url",
  "abstract",
  "citationCount",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(values = []) {
  const result = [];
  const seen = new Set();
  for (const raw of values) {
    const value = clean(raw);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function validYear(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function validCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizedMetadata(value = {}) {
  return {
    title: clean(value.title),
    authors: uniqueStrings(value.authors || []),
    year: validYear(value.year),
    type: clean(value.type || value.publication_type),
    venue: clean(value.venue),
    doi: normalizeDoi(value.doi),
    semanticScholarId: clean(value.semanticScholarId),
    openAlexId: clean(value.openAlexId),
    arxivId: clean(value.arxivId || value.arxiv_id).replace(/^arxiv:\s*/i, ""),
    url: clean(value.url),
    abstract: clean(value.abstract),
    citationCount: validCount(value.citationCount),
    keywords: uniqueStrings(value.keywords || []),
    topicNames: uniqueStrings(value.topicNames || []),
    topics: Array.isArray(value.topics) ? value.topics.filter(Boolean) : [],
    warnings: uniqueStrings(value.warnings || []),
    references: Array.isArray(value.references) ? value.references : [],
    localExtraction: value.localExtraction || null,
    aiTransport: value.aiTransport || null,
    providerPrimary: clean(value.providerPrimary || value.source),
    metadataSources: uniqueStrings(value.metadataSources || []),
  };
}

function firstPresent(records, field) {
  for (const record of records) {
    const value = record?.[field];
    if (Array.isArray(value) ? value.length : value !== null && value !== undefined && value !== "") return value;
  }
  return Array.isArray(records.find((record) => Array.isArray(record?.[field]))?.[field]) ? [] : null;
}

function topicKey(topic) {
  return clean(topic?.name).toLowerCase();
}

function mergedTopics(sources) {
  const result = [];
  const seen = new Set();
  const add = (topic, source, confidence = 0) => {
    const name = clean(topic?.name || topic);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    result.push({
      name,
      description: clean(topic?.description),
      confidence: Math.max(0, Math.min(1, Number(topic?.confidence ?? confidence) || 0)),
      source: clean(topic?.source || source),
    });
  };

  for (const topic of sources.ai?.topics || []) add(topic, "ai");
  for (const topic of sources.online?.topics || []) add(topic, sources.online?.providerPrimary || "online", 0.9);
  for (const name of sources.online?.topicNames || []) add(name, sources.online?.providerPrimary || "online", 0.9);
  for (const topic of sources.local?.topics || []) add(topic, "local-pdf");
  return result;
}

export function mergeReviewMetadataSources(rawSources = {}) {
  const sources = {
    local: rawSources.local ? normalizedMetadata(rawSources.local) : null,
    ai: rawSources.ai ? normalizedMetadata(rawSources.ai) : null,
    online: rawSources.online ? normalizedMetadata(rawSources.online) : null,
  };
  const priority = [sources.online, sources.ai, sources.local].filter(Boolean);
  const merged = {};
  for (const field of BIBLIOGRAPHIC_FIELDS) merged[field] = firstPresent(priority, field);

  merged.title ||= "";
  merged.authors = Array.isArray(merged.authors) ? merged.authors : [];
  merged.year = validYear(merged.year);
  merged.type ||= "article";
  merged.venue ||= "";
  merged.doi = normalizeDoi(merged.doi);
  merged.semanticScholarId ||= "";
  merged.openAlexId ||= "";
  merged.arxivId ||= "";
  merged.url ||= "";
  merged.abstract ||= "";
  merged.citationCount = validCount(merged.citationCount);
  merged.keywords = uniqueStrings(priority.flatMap((record) => record.keywords || []));
  merged.topics = mergedTopics(sources);
  merged.references = mergeReferenceRecords(sources.online?.references || [], sources.ai?.references || [], sources.local?.references || []);
  merged.warnings = uniqueStrings([
    ...(sources.local?.warnings || []),
    ...(sources.ai?.warnings || []),
    ...(sources.online?.warnings || []),
  ]);
  merged.localExtraction = sources.local?.localExtraction || null;
  merged.aiTransport = sources.ai?.aiTransport || null;
  merged.providerPrimary = sources.online?.providerPrimary || "";
  merged.metadataSources = uniqueStrings([
    ...(sources.local ? ["local-pdf"] : []),
    ...(sources.ai ? ["ai"] : []),
    ...(sources.online?.metadataSources?.length
      ? sources.online.metadataSources
      : sources.online?.providerPrimary ? [sources.online.providerPrimary] : []),
  ]);
  return merged;
}

export function applyMergedMetadataToDraft(draft = {}, merged = {}, dirtyFields = new Set()) {
  const next = { ...draft };
  for (const field of BIBLIOGRAPHIC_FIELDS) {
    if (dirtyFields.has(field)) continue;
    const value = merged[field];
    if (value !== undefined) next[field] = Array.isArray(value) ? [...value] : value;
  }
  if (!dirtyFields.has("keywords")) next.keywords = [...(merged.keywords || [])];
  if (!dirtyFields.has("topics")) next.topics = (merged.topics || []).map((topic) => ({ ...topic }));
  next.references = (merged.references || []).map((reference) => ({ ...reference }));
  next.warnings = [...(merged.warnings || [])];
  next.localExtraction = merged.localExtraction || null;
  next.aiTransport = merged.aiTransport || null;
  next.providerPrimary = merged.providerPrimary || "";
  next.metadataSources = [...(merged.metadataSources || [])];
  return next;
}

export function reviewedPaperIdentity(metadata = {}, fallbackId = "") {
  const doi = normalizeDoi(metadata.doi);
  if (doi) return `doi:${doi}`;
  const semanticScholarId = clean(metadata.semanticScholarId);
  if (semanticScholarId) return `s2:${semanticScholarId}`;
  const arxivId = clean(metadata.arxivId).replace(/^arxiv:\s*/i, "");
  if (arxivId) return `arxiv:${arxivId.toLowerCase()}`;
  return fallbackId || "";
}
