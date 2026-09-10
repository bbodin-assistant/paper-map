import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalReferenceIdentity,
  inferResolvedReferenceCitationEdges,
  mergeExtractedReferenceProvenance,
  normalizePaperReferenceIdentities,
} from "../www/citation-reconciliation.js";

function resolvedReference(canonical, extra = {}) {
  return {
    rawText: extra.rawText || "Resolved bibliography entry",
    reviewed: extra.reviewed ?? true,
    doi: extra.doi || "",
    arxivId: extra.arxivId || "",
    resolution: {
      status: "matched",
      provider: extra.provider || "crossref",
      matchedBy: extra.matchedBy || "doi",
      resolvedAt: "2026-09-10T12:00:00.000Z",
      canonical,
    },
  };
}

test("matched reference resolution is normalized into durable canonicalReference provenance", () => {
  const paper = {
    id: "source",
    extractedReferences: [resolvedReference({
      doi: "https://doi.org/10.1000/Target",
      semanticScholarId: "S2-TARGET",
      arxivId: "arXiv:2401.01234",
      title: "Target Paper",
      year: 2024,
    })],
  };

  const normalized = normalizePaperReferenceIdentities(paper);
  assert.notEqual(normalized, paper);
  assert.deepEqual(normalized.extractedReferences[0].canonicalReference, {
    doi: "10.1000/target",
    semanticScholarId: "S2-TARGET",
    arxivId: "2401.01234",
    title: "Target Paper",
    year: 2024,
  });
  assert.deepEqual(canonicalReferenceIdentity(normalized.extractedReferences[0]), normalized.extractedReferences[0].canonicalReference);
});

test("reviewed canonical reference creates a directed source-to-target citation edge", () => {
  const source = {
    id: "paper:source",
    title: "Source",
    year: 2025,
    extractedReferences: [resolvedReference({ doi: "10.5555/target", title: "Target", year: 2024 })],
  };
  const target = { id: "paper:target", doi: "10.5555/target", title: "Target", year: 2024 };

  const edges = inferResolvedReferenceCitationEdges([source, target]);
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0], {
    id: "paper:source->paper:target",
    source: "paper:source",
    target: "paper:target",
    kind: "citation",
    provenance: "reviewed-reference",
    referenceResolution: {
      provider: "crossref",
      matchedBy: "doi",
      resolvedAt: "2026-09-10T12:00:00.000Z",
    },
  });
});

test("identity fallback follows DOI, Semantic Scholar, arXiv, then title and year", () => {
  const source = {
    id: "source",
    extractedReferences: [resolvedReference({
      doi: "10.1000/reference-doi",
      semanticScholarId: "S2-SHARED",
      title: "Same title",
      year: 2022,
    })],
  };

  const conflictingDoi = {
    id: "conflict",
    doi: "10.1000/different-doi",
    semanticScholarId: "S2-SHARED",
    title: "Same title",
    year: 2022,
  };
  assert.deepEqual(inferResolvedReferenceCitationEdges([source, conflictingDoi]), []);

  const missingDoiButSameS2 = {
    id: "s2-target",
    semanticScholarId: "S2-SHARED",
    title: "Different title is fine because S2 matches",
    year: 2021,
  };
  assert.equal(inferResolvedReferenceCitationEdges([source, missingDoiButSameS2])[0]?.target, "s2-target");

  const titleYearSource = {
    id: "title-source",
    extractedReferences: [resolvedReference({ title: "Normalized: Target Title!", year: 2020 }, { matchedBy: "title-author-year", provider: "semantic-scholar" })],
  };
  const titleYearTarget = { id: "title-target", title: "normalized target title", year: 2020 };
  assert.equal(inferResolvedReferenceCitationEdges([titleYearSource, titleYearTarget])[0]?.target, "title-target");
});

test("unresolved, rejected, self, and existing citation relationships are not inferred", () => {
  const target = { id: "target", doi: "10.1000/target", title: "Target", year: 2024 };
  const source = {
    id: "source",
    extractedReferences: [
      resolvedReference({ doi: "10.1000/target" }, { reviewed: false }),
      { reviewed: true, resolution: { status: "unresolved", canonical: { doi: "10.1000/target" } } },
    ],
  };
  assert.deepEqual(inferResolvedReferenceCitationEdges([source, target]), []);

  source.extractedReferences = [resolvedReference({ doi: "10.1000/target" })];
  const existing = [{ id: "source->target", source: "source", target: "target", kind: "citation", provenance: "semantic-scholar" }];
  assert.deepEqual(inferResolvedReferenceCitationEdges([source, target], existing), []);

  const self = {
    id: "self",
    doi: "10.1000/self",
    extractedReferences: [resolvedReference({ doi: "10.1000/self" })],
  };
  assert.deepEqual(inferResolvedReferenceCitationEdges([self]), []);
});

test("merging paper writes preserves an earlier resolved reference identity", () => {
  const existing = [resolvedReference(
    { doi: "10.1000/target", title: "Target", year: 2024 },
    { doi: "10.1000/target", rawText: "Target citation" },
  )];
  const incoming = [{ doi: "10.1000/target", rawText: "Target citation", reviewed: true }];

  const merged = mergeExtractedReferenceProvenance(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].resolution.status, "matched");
  assert.equal(merged[0].canonicalReference.doi, "10.1000/target");
});
