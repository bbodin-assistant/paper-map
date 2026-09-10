import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeProviderPaperRecords,
  papersRepresentSameWork,
  resolvePaper,
} from "../www/paper-provider.js";

function storageWith(value) {
  return {
    getItem(key) {
      if (key === "paper-map-paper-provider-config-v1") return JSON.stringify(value);
      return null;
    },
    setItem() {},
    removeItem() {},
  };
}

test("provider merge follows canonical identity before combining normalized records", () => {
  const s2 = {
    id: "doi:10.1000/work",
    doi: "10.1000/work",
    semanticScholarId: "s2-id",
    title: "Shared work",
    year: 2024,
    authors: ["First Author"],
    abstract: "",
    metadataSources: ["semantic-scholar"],
    providerPrimary: "semantic-scholar",
  };
  const openalex = {
    id: "doi:10.1000/work",
    doi: "10.1000/work",
    openAlexId: "W123",
    title: "Shared work",
    year: 2024,
    authors: ["First Author", "Second Author"],
    abstract: "A longer normalized abstract from OpenAlex.",
    metadataSources: ["openalex"],
    providerPrimary: "openalex",
  };
  const wrong = { ...openalex, doi: "10.1000/other", id: "doi:10.1000/other" };

  assert.equal(papersRepresentSameWork(s2, openalex), true);
  assert.equal(papersRepresentSameWork(s2, wrong), false);
  const merged = mergeProviderPaperRecords([s2, openalex, wrong]);
  assert.equal(merged.semanticScholarId, "s2-id");
  assert.equal(merged.openAlexId, "W123");
  assert.deepEqual(merged.authors, ["First Author", "Second Author"]);
  assert.equal(merged.abstract, "A longer normalized abstract from OpenAlex.");
  assert.deepEqual(merged.metadataSources, ["semantic-scholar", "openalex"]);
  assert.equal(merged.providerPrimary, "semantic-scholar");
});

test("automatic provider mode queries and merges Semantic Scholar, OpenAlex, and Crossref", async () => {
  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.localStorage = storageWith({ provider: "auto" });
  globalThis.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.toString());
    if (url.hostname === "api.semanticscholar.org") {
      return new Response(JSON.stringify({
        paperId: "s2-auto",
        title: "Automatic Provider Work",
        abstract: "Semantic abstract",
        year: 2024,
        venue: "S2 Venue",
        publicationTypes: ["JournalArticle"],
        authors: [{ name: "Ada Example" }],
        externalIds: { DOI: "10.5555/auto.provider" },
        url: "https://example.test/s2",
        citationCount: 7,
        fieldsOfStudy: ["Computer Science"],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.hostname === "api.openalex.org") {
      return new Response(JSON.stringify({
        results: [{
          id: "https://openalex.org/W123456",
          doi: "https://doi.org/10.5555/auto.provider",
          title: "Automatic Provider Work",
          publication_year: 2024,
          type: "article",
          cited_by_count: 9,
          authorships: [{ author: { display_name: "Ada Example" } }],
          primary_location: { source: { display_name: "OpenAlex Venue" }, landing_page_url: "https://example.test/openalex" },
          abstract_inverted_index: { OpenAlex: [0], abstract: [1] },
          topics: [{ display_name: "Metadata Systems" }],
        }],
        meta: { count: 1 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.hostname === "api.crossref.org") {
      return new Response(JSON.stringify({
        message: {
          DOI: "10.5555/auto.provider",
          title: ["Automatic Provider Work"],
          author: [{ given: "Ada", family: "Example" }],
          issued: { "date-parts": [[2024]] },
          "container-title": ["Crossref Venue"],
          type: "journal-article",
          URL: "https://doi.org/10.5555/auto.provider",
          subject: ["Metadata Systems"],
          "is-referenced-by-count": 11,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const paper = await resolvePaper("10.5555/auto.provider");
    assert.equal(paper.doi, "10.5555/auto.provider");
    assert.equal(paper.semanticScholarId, "s2-auto");
    assert.equal(paper.openAlexId, "W123456");
    assert.equal(paper.providerPrimary, "semantic-scholar");
    assert.deepEqual(paper.metadataSources, ["semantic-scholar", "openalex", "crossref"]);
    assert.ok(paper.topicNames.includes("Computer Science"));
    assert.ok(paper.topicNames.includes("Metadata Systems"));
    assert.equal(requests.length, 3);
  } finally {
    globalThis.localStorage = previousLocalStorage;
    globalThis.sessionStorage = previousSessionStorage;
    globalThis.fetch = previousFetch;
  }
});
