import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMergedMetadataToDraft,
  mergeReviewMetadataSources,
  reviewedPaperIdentity,
} from "../www/pdf-review-merge.js";

test("review merge prefers canonical online bibliography and unions descriptive metadata", () => {
  const merged = mergeReviewMetadataSources({
    local: {
      title: "Local title",
      authors: ["Local Author"],
      year: 2022,
      doi: "10.1000/example",
      keywords: ["local"],
      references: [{ rawText: "Reference A", doi: "10.1000/ref" }],
      localExtraction: { engine: "paper-map-rust-pdf", summary: "1 reference" },
    },
    ai: {
      title: "AI title",
      authors: ["AI Author"],
      year: 2023,
      abstract: "AI abstract",
      keywords: ["ai", "shared"],
      topics: [{ name: "AI Topic", description: "from AI", confidence: 0.8 }],
    },
    online: {
      title: "Canonical online title",
      authors: ["Canonical Author"],
      year: 2024,
      venue: "Canonical Venue",
      doi: "10.1000/example",
      semanticScholarId: "s2-paper",
      abstract: "Canonical abstract",
      keywords: ["online", "shared"],
      topicNames: ["Online Topic", "AI Topic"],
      providerPrimary: "semantic-scholar",
      metadataSources: ["semantic-scholar", "crossref"],
    },
  });

  assert.equal(merged.title, "Canonical online title");
  assert.deepEqual(merged.authors, ["Canonical Author"]);
  assert.equal(merged.year, 2024);
  assert.equal(merged.venue, "Canonical Venue");
  assert.equal(merged.abstract, "Canonical abstract");
  assert.equal(merged.semanticScholarId, "s2-paper");
  assert.deepEqual(merged.keywords, ["online", "shared", "ai", "local"]);
  assert.deepEqual(merged.topics.map((topic) => topic.name), ["AI Topic", "Online Topic"]);
  assert.deepEqual(merged.references, [{ rawText: "Reference A", doi: "10.1000/ref" }]);
  assert.deepEqual(merged.metadataSources, ["local-pdf", "ai", "semantic-scholar", "crossref"]);
});

test("later extraction does not overwrite manually edited review fields", () => {
  const merged = mergeReviewMetadataSources({
    local: { title: "Local", authors: ["Local Author"], year: 2020 },
    online: { title: "Online", authors: ["Online Author"], year: 2024, venue: "Online Venue" },
  });
  const draft = {
    title: "My corrected title",
    authors: ["My corrected author"],
    year: 2021,
    venue: "",
    keywords: [],
    topics: [],
  };
  const next = applyMergedMetadataToDraft(draft, merged, new Set(["title", "authors", "year"]));

  assert.equal(next.title, "My corrected title");
  assert.deepEqual(next.authors, ["My corrected author"]);
  assert.equal(next.year, 2021);
  assert.equal(next.venue, "Online Venue");
});

test("reviewed PDF identity follows DOI, Semantic Scholar, arXiv, then fallback", () => {
  assert.equal(reviewedPaperIdentity({ doi: "https://doi.org/10.5555/Identity" }, "local:x"), "doi:10.5555/identity");
  assert.equal(reviewedPaperIdentity({ semanticScholarId: "abc", arxivId: "2401.01234" }, "local:x"), "s2:abc");
  assert.equal(reviewedPaperIdentity({ arxivId: "2401.01234" }, "local:x"), "arxiv:2401.01234");
  assert.equal(reviewedPaperIdentity({}, "local:x"), "local:x");
});
