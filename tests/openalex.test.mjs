import test from "node:test";
import assert from "node:assert/strict";

import { resolvePaper } from "../www/providers/openalex.js";

test("OpenAlex title resolution prefers the exact normalized title over the first relevance result", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = null;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(String(input));
    return new Response(JSON.stringify({
      results: [
        {
          id: "https://openalex.org/W111",
          title: "Container Partitioning for Distributed Systems",
          publication_year: 2024,
          authorships: [{ author: { display_name: "Wrong Author" } }],
          locations: [],
        },
        {
          id: "https://openalex.org/W222",
          title: "On-Demand Container Partitioning for Distributed ML",
          publication_year: 2025,
          authorships: [{ author: { display_name: "Right Author" } }],
          locations: [],
        },
      ],
      meta: { count: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const paper = await resolvePaper("On-Demand Container Partitioning for Distributed ML");
    assert.equal(paper.openAlexId, "W222");
    assert.equal(paper.title, "On-Demand Container Partitioning for Distributed ML");
    assert.equal(requestedUrl.searchParams.get("search"), "On-Demand Container Partitioning for Distributed ML");
    assert.equal(requestedUrl.searchParams.get("per-page"), "20");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
