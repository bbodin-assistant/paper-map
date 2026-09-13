import test from "node:test";
import assert from "node:assert/strict";

import { resolvePaper } from "../www/providers/openalex.js";

const exactWork = {
  id: "https://openalex.org/W222",
  title: "On-Demand Container Partitioning for Distributed ML",
  publication_year: 2025,
  authorships: [{ author: { display_name: "Right Author" } }],
  locations: [],
};

const relevanceWork = {
  id: "https://openalex.org/W111",
  title: "Container Partitioning for Distributed Systems",
  publication_year: 2024,
  authorships: [{ author: { display_name: "Wrong Author" } }],
  locations: [],
};

test("OpenAlex title resolution uses an exact title-only phrase lookup before relevance search", async () => {
  const previousFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    if (url.searchParams.has("filter")) {
      return new Response(JSON.stringify({ results: [exactWork], meta: { count: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: [relevanceWork], meta: { count: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const paper = await resolvePaper("On-Demand Container Partitioning\nfor Distributed ML");
    assert.equal(paper.openAlexId, "W222");
    assert.equal(paper.title, "On-Demand Container Partitioning for Distributed ML");
    assert.equal(requestedUrls.length, 1, "an exact title match should not fall through to broad relevance search");
    assert.equal(
      requestedUrls[0].searchParams.get("filter"),
      'title.search:"On-Demand Container Partitioning for Distributed ML"',
    );
    assert.equal(requestedUrls[0].searchParams.get("per-page"), "20");
    assert.equal(requestedUrls[0].searchParams.get("search"), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("OpenAlex title resolution falls back to broad relevance search when the title-only lookup has no exact match", async () => {
  const previousFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    const results = url.searchParams.has("filter") ? [] : [relevanceWork];
    return new Response(JSON.stringify({ results, meta: { count: results.length } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const paper = await resolvePaper("Uncatalogued Container Partitioning Study");
    assert.equal(paper.openAlexId, "W111");
    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[0].searchParams.get("filter"), 'title.search:"Uncatalogued Container Partitioning Study"');
    assert.equal(requestedUrls[1].searchParams.get("search"), "Uncatalogued Container Partitioning Study");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
