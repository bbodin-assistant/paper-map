import test from "node:test";
import assert from "node:assert/strict";

import { paperCitationSummary } from "../www/citation-summary.js";

test("citation summary separates extracted references from stored graph links", () => {
  const paper = {
    id: "paper:main",
    citationCount: 253,
    extractedReferences: Array.from({ length: 49 }, (_, index) => ({ rawText: `ref ${index}` })),
  };
  const edges = [
    ...Array.from({ length: 31 }, (_, index) => ({ source: "paper:main", target: `ref:${index}`, kind: "citation" })),
    ...Array.from({ length: 100 }, (_, index) => ({ source: `citing:${index}`, target: "paper:main", kind: "citation" })),
  ];
  assert.equal(
    paperCitationSummary(paper, edges, 2),
    "References: 49 extracted · 31 stored in graph · Citing papers: 100 / 253 stored · Research links: 2",
  );
});

test("citation summary works without a provider citation total", () => {
  assert.equal(
    paperCitationSummary({ id: "paper:main", extractedReferences: [] }, [], 0),
    "References: 0 extracted · 0 stored in graph · Citing papers: 0 stored · Research links: 0",
  );
});
