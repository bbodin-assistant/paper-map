import { normalizeDoi, normalizedTitle } from "./import-export.js";
import { mergeReferenceRecords } from "./provider-references.js?v=0.4.5";
import { loadPaperProviderConfig, paperProviderLabel } from "./paper-provider-config.js";
import * as semanticScholar from "./providers/semantic-scholar.js";
import * as openAlex from "./providers/openalex.js";
import * as crossref from "./providers/crossref.js";

const PROVIDERS = Object.freeze({
  "semantic-scholar": semanticScholar,
  openalex: openAlex,
  crossref,
});
const AUTO_PROVIDER_ORDER = Object.freeze(["semantic-scholar", "openalex", "crossref"]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizedArxiv(value) {
  return clean(value).replace(/^arxiv:\s*/i, "").toLowerCase();
}

function titleYearKey(paper) {
  const title = normalizedTitle(paper?.title);
  const year = Number(paper?.year);
  return title && Number.isInteger(year) && year > 0 ? `${title}:${year}` : "";
}

export function papersRepresentSameWork(left, right) {
  const leftDoi = normalizeDoi(left?.doi);
  const rightDoi = normalizeDoi(right?.doi);
  if (leftDoi && rightDoi) return leftDoi === rightDoi;

  const leftS2 = clean(left?.semanticScholarId).toLowerCase();
  const rightS2 = clean(right?.semanticScholarId).toLowerCase();
  if (leftS2 && rightS2) return leftS2 === rightS2;

  const leftArxiv = normalizedArxiv(left?.arxivId);
  const rightArxiv = normalizedArxiv(right?.arxivId);
  if (leftArxiv && rightArxiv) return leftArxiv === rightArxiv;

  const leftTitleYear = titleYearKey(left);
  const rightTitleYear = titleYearKey(right);
  return Boolean(leftTitleYear && rightTitleYear && leftTitleYear === rightTitleYear);
}

function preferText(current, incoming) {
  const left = clean(current);
  const right = clean(incoming);
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function preferAuthors(current, incoming) {
  const left = Array.isArray(current) ? current.filter(Boolean) : [];
  const right = Array.isArray(incoming) ? incoming.filter(Boolean) : [];
  return right.length > left.length ? right : left;
}

export function mergeProviderPaperRecords(records = []) {
  const usable = records.filter((paper) => paper && typeof paper === "object");
  if (!usable.length) return null;
  let merged = { ...usable[0] };
  for (const paper of usable.slice(1)) {
    if (!papersRepresentSameWork(merged, paper)) continue;
    merged = {
      ...merged,
      semanticScholarId: merged.semanticScholarId || paper.semanticScholarId || "",
      openAlexId: merged.openAlexId || paper.openAlexId || "",
      doi: normalizeDoi(merged.doi || paper.doi),
      arxivId: merged.arxivId || paper.arxivId || "",
      title: preferText(merged.title, paper.title),
      authors: preferAuthors(merged.authors, paper.authors),
      year: merged.year || paper.year || null,
      venue: preferText(merged.venue, paper.venue),
      type: merged.type || paper.type || "",
      url: merged.url || paper.url || "",
      pdfUrl: merged.pdfUrl || paper.pdfUrl || "",
      abstract: preferText(merged.abstract, paper.abstract),
      publisher: merged.publisher || paper.publisher || "",
      citationCount: Number.isFinite(Number(merged.citationCount))
        ? Number(merged.citationCount)
        : Number.isFinite(Number(paper.citationCount)) ? Number(paper.citationCount) : null,
      keywords: Array.from(new Set([...(merged.keywords || []), ...(paper.keywords || [])].filter(Boolean))),
      topics: Array.from(new Set([...(merged.topics || []), ...(paper.topics || [])].filter(Boolean))),
      topicNames: Array.from(new Set([...(merged.topicNames || []), ...(paper.topicNames || [])].filter(Boolean))),
      references: mergeReferenceRecords(merged.references || [], paper.references || []),
      metadataSources: Array.from(new Set([
        ...(merged.metadataSources || [merged.providerPrimary || merged.source].filter(Boolean)),
        ...(paper.metadataSources || [paper.providerPrimary || paper.source].filter(Boolean)),
      ])),
    };
  }
  merged.providerPrimary = usable[0].providerPrimary || usable[0].source || "";
  merged.source = merged.providerPrimary || merged.source || "provider";
  merged.enrichedAt = new Date().toISOString();
  return merged;
}

function configuredProvider() {
  return loadPaperProviderConfig().provider;
}

function providerFor(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unsupported paper metadata provider: ${id}.`);
  return provider;
}

async function autoCollect(method, args) {
  const settled = await Promise.allSettled(AUTO_PROVIDER_ORDER.map(async (id) => {
    const provider = providerFor(id);
    if (typeof provider[method] !== "function" || provider.capabilities?.[method.replace(/^fetch/, "").toLowerCase()] === false) {
      throw new Error(`${provider.providerLabel} does not support this operation.`);
    }
    const value = await provider[method](...args);
    return { id, value };
  }));
  const successes = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!successes.length) {
    const failures = settled
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || String(result.reason))
      .filter(Boolean);
    throw new Error(`No paper metadata provider succeeded${failures.length ? `: ${failures.join(" ")}` : "."}`);
  }
  return successes;
}

function attachResolutionProvenance(paper, selectedProvider, query) {
  if (!paper) return paper;
  const providers = paper.metadataSources?.length ? paper.metadataSources : [paper.providerPrimary || paper.source].filter(Boolean);
  return {
    ...paper,
    providerPrimary: paper.providerPrimary || providers[0] || selectedProvider,
    metadataSources: Array.from(new Set(providers)),
    providerQuery: clean(query),
  };
}

export async function searchPapers(query, limit = 5, options = {}) {
  const selected = configuredProvider();
  if (selected !== "auto") return providerFor(selected).searchPapers(query, limit, options);

  const successes = await autoCollect("searchPapers", [query, limit, options]);
  const merged = [];
  for (const { value } of successes) {
    for (const paper of value || []) {
      const existingIndex = merged.findIndex((candidate) => papersRepresentSameWork(candidate, paper));
      if (existingIndex >= 0) merged[existingIndex] = mergeProviderPaperRecords([merged[existingIndex], paper]);
      else merged.push(paper);
    }
  }
  return merged.slice(0, Math.max(1, Number(limit) || 5));
}

export async function resolvePaper(query, options = {}) {
  const selected = configuredProvider();
  if (selected !== "auto") {
    const paper = await providerFor(selected).resolvePaper(query, options);
    return attachResolutionProvenance(paper, selected, query);
  }

  const successes = await autoCollect("resolvePaper", [query, options]);
  const primary = successes[0].value;
  const matches = successes.map((result) => result.value).filter((paper) => papersRepresentSameWork(primary, paper));
  const merged = mergeProviderPaperRecords(matches) || primary;
  merged.providerPrimary = primary.providerPrimary || primary.source || successes[0].id;
  merged.metadataSources = Array.from(new Set(matches.flatMap((paper) => paper.metadataSources || [paper.providerPrimary || paper.source].filter(Boolean))));
  return attachResolutionProvenance(merged, "auto", query);
}

export async function enrichPaper(paper, options = {}) {
  const selected = configuredProvider();
  if (selected !== "auto") {
    const enriched = await providerFor(selected).enrichPaper(paper, options);
    return attachResolutionProvenance(enriched, selected, paper?.doi || paper?.arxivId || paper?.title || "");
  }

  const successes = await autoCollect("enrichPaper", [paper, options]);
  const matching = successes.map((result) => result.value).filter((candidate) => papersRepresentSameWork(paper, candidate));
  if (!matching.length) throw new Error("Automatic providers returned metadata for different papers.");
  const merged = mergeProviderPaperRecords(matching);
  merged.providerPrimary = matching[0].providerPrimary || matching[0].source || successes[0].id;
  return attachResolutionProvenance(merged, "auto", paper?.doi || paper?.arxivId || paper?.title || "");
}

async function relationship(method, paper, offset, limit, options) {
  const selected = configuredProvider();
  if (selected !== "auto") {
    const provider = providerFor(selected);
    if (typeof provider[method] !== "function") {
      throw new Error(`${paperProviderLabel(selected)} does not support citation expansion; choose Semantic Scholar, OpenAlex, or Automatic merge.`);
    }
    return provider[method](paper, offset, limit, options);
  }

  const order = [semanticScholar, openAlex];
  const failures = [];
  for (const provider of order) {
    try {
      return await provider[method](paper, offset, limit, options);
    } catch (error) {
      failures.push(`${provider.providerLabel}: ${error?.message || error}`);
    }
  }
  throw new Error(`No citation provider succeeded: ${failures.join(" ")}`);
}

export function fetchReferences(paper, offset = 0, limit = 50, options = {}) {
  return relationship("fetchReferences", paper, offset, limit, options);
}

export function fetchCitations(paper, offset = 0, limit = 50, options = {}) {
  return relationship("fetchCitations", paper, offset, limit, options);
}
