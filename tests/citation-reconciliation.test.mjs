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

const localTarget = {
  id: "target", title: "Reliable End-to-End Scheduling for Distributed Control Systems",
  authors: ["Amélie Martin", "Grace Hopper"], year: 2020,
};
const localReference = {
  reviewed: true, year: 2020,
  rawText: "AmelieMartin,GraceHopper.2020.ReliableEnd-to-EndSchedulingforDistributedControlSystems.JournalofComputing.",
};
function localEdges(reference, targets = [localTarget]) {
  return inferResolvedReferenceCitationEdges([{ id: "source", extractedReferences: [reference] }, ...targets]);
}

test("reviewed local DOI and versioned arXiv references link without online resolution", () => {
  const edges = localEdges({ reviewed: true, doi: "https://doi.org/10.1234/TARGET" }, [{ ...localTarget, doi: "10.1234/target" }]);
  assert.equal(edges[0]?.id, "source->target");
  assert.equal(edges[0]?.referenceResolution.provider, "local-library");
  assert.equal(edges[0]?.referenceResolution.matchedBy, "local-doi");
  assert.equal(localEdges({ reviewed: true, arxivId: "2401.01234v2" }, [{ ...localTarget, arxivId: "arXiv:2401.01234" }]).length, 1);
  assert.equal(localEdges({ reviewed: false, doi: "10.1234/target" }, [{ ...localTarget, doi: "10.1234/target" }]).length, 0);
  assert.equal(localEdges({ doi: "10.1234/target" }, [{ ...localTarget, doi: "10.1234/target" }]).length, 0);
});

test("whole citation title, author, and year survive PDF spacing and accent differences", () => {
  const edges = localEdges(localReference);
  assert.equal(edges[0]?.target, "target");
  assert.equal(edges[0]?.referenceResolution.matchedBy, "local-title-author-year");
  assert.equal(localEdges({ ...localReference, rawText: localReference.rawText.replace("Scheduling", "Schedu-\nling") }).length, 1);
});

test("long unique title and author can link a library entry whose year was not extracted", () => {
  const missingYear = { ...localTarget, year: null };
  const edges = localEdges(localReference, [missingYear]);
  assert.equal(edges[0]?.referenceResolution.matchedBy, "local-title-author");
  assert.equal(missingYear.year, null, "Linking must not invent the target publication year");
  assert.equal(localEdges(localReference, [missingYear, { ...missingYear, id: "ambiguous" }]).length, 0);
});

test("local matching rejects missing review, wrong author/year, partial titles and identifier conflicts", () => {
  for (const reference of [
    { ...localReference, reviewed: undefined },
    { ...localReference, reviewed: false },
    { ...localReference, year: 2021 },
    { ...localReference, year: null, rawText: localReference.rawText.replace("2020", "2021") },
    { ...localReference, rawText: localReference.rawText.replace("AmelieMartin", "UnknownPerson") },
    { ...localReference, rawText: localReference.rawText.replace("DistributedControlSystems", "DistributedSystems") },
  ]) assert.deepEqual(localEdges(reference), []);
  assert.equal(localEdges({ ...localReference, doi: "10.1234/conflict" }, [{ ...localTarget, doi: "10.1234/target" }]).length, 0);
  assert.equal(localEdges({ reviewed: true, doi: "10.1234/x", arxivId: "2401.11111" }, [{ ...localTarget, doi: "10.1234/x", arxivId: "2401.22222" }]).length, 0);
});

test("duplicate identities, multiple title matches and resolved ambiguity never pick the first target", () => {
  const twins = [{ ...localTarget, doi: "10.1234/target" }, { ...localTarget, id: "other", doi: "10.1234/target" }];
  assert.deepEqual(localEdges({ reviewed: true, doi: "10.1234/target" }, twins), []);
  assert.deepEqual(localEdges(resolvedReference({ doi: "10.1234/target" }), twins), []);
  assert.deepEqual(localEdges(localReference, twins), []);
  const second = { ...localTarget, id: "second", title: "Efficient Verification of Asynchronous Communication Between Embedded Devices" };
  const merged = { ...localReference, rawText: localReference.rawText + " Martin. " + second.title + ". 2020." };
  assert.deepEqual(localEdges(merged, [localTarget, second]), []);
});

test("complete DOI in printed text repairs a line-broken identifier without accepting prefixes", () => {
  const target = { ...localTarget, doi: "10.1234/long.identifier.2020.42" };
  const reference = { reviewed: true, doi: "10.1234/long", rawText: "A paper. https ://doi.org/10.1234/long. identifier.2020.42" };
  assert.equal(localEdges(reference, [target])[0]?.referenceResolution.matchedBy, "local-doi-text");
  assert.deepEqual(localEdges({ ...reference, rawText: reference.rawText + "5" }, [target]), []);
  assert.deepEqual(localEdges({ ...reference, doi: "10.1234/different" }, [target]), []);
});

test("local citations are independent of insertion order and reloads do not duplicate edges", () => {
  const source = { id: "source", extractedReferences: [localReference] };
  assert.deepEqual(inferResolvedReferenceCitationEdges([source]), []);
  const forward = inferResolvedReferenceCitationEdges([source, localTarget]);
  assert.equal(forward.length, 1);
  assert.deepEqual(inferResolvedReferenceCitationEdges([localTarget, source]), forward);
  assert.deepEqual(inferResolvedReferenceCitationEdges([source, localTarget], forward), []);
  assert.deepEqual(inferResolvedReferenceCitationEdges([{ ...localTarget, extractedReferences: [localReference] }]), []);
});
