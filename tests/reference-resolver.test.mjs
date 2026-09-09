import test from "node:test";
import assert from "node:assert/strict";

import {
  arxivBaseId,
  normalizeArxivId,
  normalizeCrossrefWork,
  referenceSearchQuery,
  resolveExtractedReference,
  scoreReferenceCandidate,
  selectReferenceCandidate,
} from "../www/reference-resolver.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function semanticScholarPaper({
  paperId = "0123456789abcdef0123456789abcdef01234567",
  title = "A Plain Reference Without Persistent Identifier",
  author = "Linus Author",
  year = 2020,
} = {}) {
  return {
    paperId,
    title,
    year,
    venue: "Fixture Venue",
    publicationTypes: ["JournalArticle"],
    authors: [{ name: author }],
    externalIds: {},
    url: `https://www.semanticscholar.org/paper/${paperId}`,
    citationCount: 2,
    fieldsOfStudy: [],
  };
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

test("builds conservative search evidence from text-only references", () => {
  const reference = {
    rawText: "[3] Linus Author. A plain reference without persistent identifier. 2020.",
    year: 2020,
  };
  assert.equal(
    referenceSearchQuery(reference),
    "Linus Author. A plain reference without persistent identifier. .",
  );
  assert.equal(scoreReferenceCandidate(reference, {
    title: "A plain reference without persistent identifier",
    authors: ["Linus Author"],
    year: 2020,
  }), 1);
  assert.equal(scoreReferenceCandidate(reference, {
    title: "A plain reference without persistent identifier",
    authors: ["Linus Author"],
    year: 2021,
  }), 0);
});

test("auto-matches a single strong identifier-less metadata candidate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/graph/v1/paper/search");
    assert.equal(parsed.searchParams.get("limit"), "5");
    assert.match(parsed.searchParams.get("query"), /Linus Author/);
    return jsonResponse({ data: [semanticScholarPaper()] });
  };

  try {
    const result = await resolveExtractedReference({
      rawText: "[3] Linus Author. A plain reference without persistent identifier. 2020.",
      year: 2020,
    });
    assert.equal(result.status, "matched");
    assert.equal(result.provider, "semantic-scholar");
    assert.equal(result.matchedBy, "title-author-year");
    assert.equal(result.confidence, 1);
    assert.equal(result.canonical.title, "A Plain Reference Without Persistent Identifier");
    assert.equal(result.attempts[0].candidatesConsidered, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps ambiguous identifier-less matches in a reviewable candidate set", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    data: [
      semanticScholarPaper({
        paperId: "1111111111111111111111111111111111111111",
        title: "A Plain Reference Without Persistent Identifier",
      }),
      semanticScholarPaper({
        paperId: "2222222222222222222222222222222222222222",
        title: "Plain Reference Without Persistent Identifier",
      }),
    ],
  });

  try {
    const result = await resolveExtractedReference({
      rawText: "[3] Linus Author. A plain reference without persistent identifier. 2020.",
      year: 2020,
    });
    assert.equal(result.status, "candidates");
    assert.equal(result.canonical, null);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0].confidence, 1);

    const selected = selectReferenceCandidate(result, 1);
    assert.equal(selected.status, "matched");
    assert.equal(selected.selectedBy, "user");
    assert.equal(selected.selectedCandidateIndex, 1);
    assert.equal(selected.canonical.semanticScholarId, "2222222222222222222222222222222222222222");
    assert.equal(selected.attempts.at(-1).status, "selected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not fabricate identifier-less matches when provider candidates lack matching evidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    data: [semanticScholarPaper({
      title: "Completely Unrelated Work",
      author: "Different Person",
      year: 2020,
    })],
  });

  try {
    const result = await resolveExtractedReference({
      rawText: "Linus Author. A plain reference without persistent identifier. 2020.",
      year: 2020,
    });
    assert.equal(result.status, "unresolved");
    assert.equal(result.confidence, 0);
    assert.equal(result.canonical, null);
    assert.equal(result.attempts[0].status, "no-match");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
