import test from "node:test";
import assert from "node:assert/strict";

import { normalizePaper } from "../www/providers/crossref.js";
import { mergeProviderPaperRecords } from "../www/paper-provider.js";

test("Crossref work references become extracted-reference records", () => {
  const paper = normalizePaper({
    DOI: "10.5555/main.work",
    title: ["Main Work"],
    issued: { "date-parts": [[2024]] },
    reference: [
      {
        key: "ref-1",
        DOI: "10.1000/REF.ONE",
        author: "Ada Example",
        year: "2020",
        "article-title": "Referenced Work",
        "journal-title": "Journal of References",
      },
      {
        key: "ref-2",
        unstructured: "B. Example. A reference preserved from Crossref.",
      },
    ],
  });

  assert.equal(paper.references.length, 2);
  assert.equal(paper.references[0].doi, "10.1000/ref.one");
  assert.equal(paper.references[0].title, "Referenced Work");
  assert.equal(paper.references[0].year, 2020);
  assert.equal(paper.references[0].source, "crossref");
  assert.equal(paper.references[1].rawText, "B. Example. A reference preserved from Crossref.");
});

test("automatic provider merge retains Crossref references", () => {
  const semanticScholar = {
    id: "doi:10.5555/main.work",
    doi: "10.5555/main.work",
    semanticScholarId: "s2-main",
    title: "Main Work",
    year: 2024,
    metadataSources: ["semantic-scholar"],
    providerPrimary: "semantic-scholar",
  };
  const crossref = normalizePaper({
    DOI: "10.5555/main.work",
    title: ["Main Work"],
    issued: { "date-parts": [[2024]] },
    reference: [{ DOI: "10.1000/ref.one", "article-title": "Referenced Work", year: "2020" }],
  });

  const merged = mergeProviderPaperRecords([semanticScholar, crossref]);
  assert.equal(merged.providerPrimary, "semantic-scholar");
  assert.equal(merged.references.length, 1);
  assert.equal(merged.references[0].doi, "10.1000/ref.one");
});
