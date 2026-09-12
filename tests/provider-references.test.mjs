import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeReferenceRecords,
  providerPaperToReference,
  providerPapersToReferences,
  providerReferenceKey,
} from "../www/provider-references.js";

test("provider papers become canonical extracted-reference records", () => {
  const reference = providerPaperToReference({
    title: "A Useful Paper",
    authors: ["Ada Example", "Blaise Sample"],
    year: 2024,
    venue: "Journal of Tests",
    doi: "https://doi.org/10.1000/ABC",
    semanticScholarId: "S2-ID",
  }, 0, "semantic-scholar");
  assert.equal(reference.doi, "10.1000/abc");
  assert.equal(reference.canonicalReference.title, "A Useful Paper");
  assert.equal(reference.canonicalReference.semanticScholarId, "S2-ID");
  assert.match(reference.rawText, /A Useful Paper/);
  assert.equal(reference.source, "semantic-scholar");
});

test("provider reference merging deduplicates the same work", () => {
  const local = { rawText: "old", doi: "10.1000/abc", confidence: 0.7 };
  const online = providerPapersToReferences([{ title: "Resolved", doi: "10.1000/ABC", year: 2024 }], "openalex")[0];
  assert.equal(providerReferenceKey(local), providerReferenceKey(online));
  const merged = mergeReferenceRecords([local], [online]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "Resolved");
});
