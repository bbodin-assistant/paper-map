import test from "node:test";
import assert from "node:assert/strict";

import {
  arxivBaseId,
  normalizeArxivId,
  normalizeCrossrefWork,
  resolveExtractedReference,
} from "../www/reference-resolver.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("normalizes Crossref work metadata", () => {
  const paper = normalizeCrossrefWork({
    DOI: "10.5555/Example.1",
    title: ["Canonical Title"],
    author: [
      { given: "Ada", family: "Lovelace" },
      { name: "Grace Hopper" },
    ],
    "published-online": { "date-parts": [[2025, 3, 2]] },
    "container-title": ["Canonical Journal"],
    type: "journal-article",
    URL: "https://doi.org/10.5555/Example.1",
    publisher: "Example Press",
    "is-referenced-by-count": 42,
  });

  assert.equal(paper.doi, "10.5555/example.1");
  assert.equal(paper.title, "Canonical Title");
  assert.deepEqual(paper.authors, ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(paper.year, 2025);
  assert.equal(paper.venue, "Canonical Journal");
  assert.equal(paper.type, "journal-article");
  assert.equal(paper.citationCount, 42);
});

test("normalizes arXiv identifiers and strips versions for canonical lookup", () => {
  assert.equal(normalizeArxivId(" arXiv:2401.01234v2 "), "2401.01234v2");
  assert.equal(arxivBaseId("2401.01234v2"), "2401.01234");
});

test("resolves DOI through exact Crossref metadata with high confidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /api\.crossref\.org\/works\/10\.1234%2Ftest\.55$/);
    return jsonResponse({
      message: {
        DOI: "10.1234/TEST.55",
        title: ["Resolved DOI Paper"],
        author: [{ given: "Ada", family: "Author" }],
        issued: { "date-parts": [[2022]] },
        "container-title": ["Journal"],
        type: "journal-article",
        URL: "https://doi.org/10.1234/TEST.55",
      },
    });
  };

  try {
    const result = await resolveExtractedReference({ doi: "10.1234/test.55" });
    assert.equal(result.status, "matched");
    assert.equal(result.provider, "crossref");
    assert.equal(result.matchedBy, "doi");
    assert.equal(result.confidence, 0.99);
    assert.equal(result.canonical.title, "Resolved DOI Paper");
    assert.equal(result.canonical.doi, "10.1234/test.55");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolves arXiv identifier through Semantic Scholar and preserves canonical metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    assert.match(text, /api\.semanticscholar\.org\/graph\/v1\/paper\/ARXIV%3A2401\.01234/);
    return jsonResponse({
      paperId: "0123456789abcdef0123456789abcdef01234567",
      title: "Resolved arXiv Paper",
      abstract: "Fixture abstract",
      year: 2024,
      venue: "arXiv",
      publicationTypes: ["JournalArticle"],
      authors: [{ name: "Grace Author" }],
      externalIds: { ArXiv: "2401.01234" },
      url: "https://www.semanticscholar.org/paper/fixture",
      citationCount: 7,
      fieldsOfStudy: ["Computer Science"],
    });
  };

  try {
    const result = await resolveExtractedReference({ arxivId: "2401.01234v2" });
    assert.equal(result.status, "matched");
    assert.equal(result.provider, "semantic-scholar");
    assert.equal(result.matchedBy, "arxiv");
    assert.equal(result.confidence, 0.98);
    assert.equal(result.canonical.title, "Resolved arXiv Paper");
    assert.equal(result.canonical.arxivId, "2401.01234");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to Semantic Scholar when an exact DOI is not in Crossref", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("api.crossref.org")) return jsonResponse({ status: "resource-not-found" }, 404);
    assert.match(text, /api\.semanticscholar\.org/);
    return jsonResponse({
      paperId: "fedcba9876543210fedcba9876543210fedcba98",
      title: "Semantic Scholar DOI Fallback",
      year: 2023,
      venue: "Fallback Venue",
      publicationTypes: ["JournalArticle"],
      authors: [{ name: "Fallback Author" }],
      externalIds: { DOI: "10.48550/example.9" },
      url: "https://www.semanticscholar.org/paper/fallback",
      citationCount: 3,
      fieldsOfStudy: [],
    });
  };

  try {
    const result = await resolveExtractedReference({ doi: "10.48550/example.9" });
    assert.equal(result.status, "matched");
    assert.equal(result.provider, "semantic-scholar");
    assert.equal(result.confidence, 0.97);
    assert.equal(result.attempts[0].provider, "crossref");
    assert.equal(result.attempts[0].status, "failed");
    assert.equal(result.attempts[1].status, "matched");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not fabricate a match for references without persistent identifiers", async () => {
  const result = await resolveExtractedReference({ rawText: "A plain reference without DOI or arXiv." });
  assert.equal(result.status, "no-identifier");
  assert.equal(result.confidence, 0);
  assert.equal(result.canonical, null);
});
