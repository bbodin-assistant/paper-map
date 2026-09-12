import test from "node:test";
import assert from "node:assert/strict";

import { mergeReviewMetadataSources } from "../www/pdf-review-merge.js";
import { providerPapersToReferences } from "../www/provider-references.js";

test("online provider references are included with local extracted references", () => {
  const onlineReferences = providerPapersToReferences([
    { title: "Provider-only reference", year: 2021, doi: "10.1000/provider-only" },
    { title: "Canonical local reference", year: 2020, doi: "10.1000/shared" },
  ], "semantic-scholar");

  const merged = mergeReviewMetadataSources({
    online: { title: "Main paper", references: onlineReferences },
    local: {
      title: "Main paper local",
      references: [{
        rawText: "Printed citation with page evidence",
        title: "Canonical local reference",
        year: 2020,
        doi: "10.1000/shared",
        pageStart: 7,
      }],
    },
  });

  assert.equal(merged.references.length, 2);
  const shared = merged.references.find((reference) => reference.doi === "10.1000/shared");
  assert.equal(shared.rawText, "Printed citation with page evidence");
  assert.equal(shared.pageStart, 7);
  assert.ok(merged.references.some((reference) => reference.doi === "10.1000/provider-only"));
});
