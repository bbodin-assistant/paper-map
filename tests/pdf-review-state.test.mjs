import test from "node:test";
import assert from "node:assert/strict";

import {
  pdfReviewLookupState,
  pdfReviewOnlineQuery,
  validPdfReviewArxiv,
  validPdfReviewDoi,
} from "../www/pdf-review-state.js";

test("review lookup fields stay neutral until local extraction finishes", () => {
  const state = pdfReviewLookupState({
    title: "Queued title",
    authors: ["Ada Example"],
    year: 2025,
    localStatus: "running",
  });
  assert.equal(state.tab, "working");
  assert.deepEqual(state.fields, {
    title: "neutral",
    authors: "neutral",
    year: "neutral",
    doi: "neutral",
    arxivId: "neutral",
  });
});

test("title, authors, and year become yellow lookup evidence while optional absent identifiers stay neutral", () => {
  const state = pdfReviewLookupState({
    title: "A Searchable Paper",
    authors: ["Ada Example", "Grace Example"],
    year: 2025,
    fileName: "unhelpful-filename.pdf",
    localStatus: "complete",
  });
  assert.equal(state.tab, "searchable");
  assert.equal(state.searchable, true);
  assert.equal(state.fields.title, "available");
  assert.equal(state.fields.authors, "available");
  assert.equal(state.fields.year, "available");
  assert.equal(state.fields.doi, "neutral");
  assert.equal(state.fields.arxivId, "neutral");
});

test("filename fallback and missing core metadata are red immediately after extraction", () => {
  const state = pdfReviewLookupState({
    title: "Example Paper",
    authors: [],
    year: null,
    fileName: "Example_Paper.pdf",
    localStatus: "complete",
  });
  assert.equal(state.tab, "error");
  assert.equal(state.searchable, false);
  assert.equal(state.fields.title, "missing");
  assert.equal(state.fields.authors, "missing");
  assert.equal(state.fields.year, "missing");
});

test("valid DOI or arXiv identifiers independently make a review searchable", () => {
  const doiState = pdfReviewLookupState({
    title: "Example Paper",
    fileName: "Example_Paper.pdf",
    doi: "10.1234/example.1",
    localStatus: "complete",
  });
  assert.equal(doiState.tab, "searchable");
  assert.equal(doiState.fields.doi, "available");

  const arxivState = pdfReviewLookupState({
    title: "Example Paper",
    fileName: "Example_Paper.pdf",
    arxivId: "2007.14390v5",
    localStatus: "complete",
  });
  assert.equal(arxivState.tab, "searchable");
  assert.equal(arxivState.fields.arxivId, "available");
});

test("non-empty malformed identifiers are red but missing optional identifiers are not", () => {
  const state = pdfReviewLookupState({
    title: "A Searchable Paper",
    fileName: "paper.pdf",
    doi: "wrong-doi",
    arxivId: "wrong-arxiv",
    localStatus: "complete",
  });
  assert.equal(state.tab, "searchable");
  assert.equal(state.fields.doi, "invalid");
  assert.equal(state.fields.arxivId, "invalid");
  assert.equal(validPdfReviewDoi("10.5555/right"), true);
  assert.equal(validPdfReviewDoi("wrong"), false);
  assert.equal(validPdfReviewArxiv("2501.01234v2"), true);
  assert.equal(validPdfReviewArxiv("wrong"), false);
});

test("online queries use exactly the field whose button was pressed", () => {
  const draft = {
    title: "  FLOWER: A FRIENDLY\nFEDERATED LEARNING FRAMEWORK  ",
    doi: "https://doi.org/10.5555/Example.DOI",
    arxivId: "2007.14390v5",
  };
  assert.deepEqual(pdfReviewOnlineQuery(draft, "title"), {
    kind: "title",
    query: "FLOWER: A FRIENDLY FEDERATED LEARNING FRAMEWORK",
  });
  assert.deepEqual(pdfReviewOnlineQuery(draft, "doi"), {
    kind: "doi",
    query: "10.5555/example.doi",
  });
  assert.deepEqual(pdfReviewOnlineQuery(draft, "arxiv"), {
    kind: "arxiv",
    query: "arxiv:2007.14390v5",
  });
  assert.throws(() => pdfReviewOnlineQuery({ doi: "bad" }, "doi"), /valid DOI/);
  assert.throws(() => pdfReviewOnlineQuery({ arxivId: "bad" }, "arxiv"), /valid arXiv/);
});

test("a completed online lookup turns the tab green regardless of optional descriptive metadata", () => {
  const state = pdfReviewLookupState({
    title: "Resolved Paper",
    authors: ["Ada Example"],
    year: 2025,
    venue: "",
    url: "",
    abstract: "",
    keywords: [],
    fileName: "paper.pdf",
    localStatus: "complete",
    onlineStatus: "complete",
  });
  assert.equal(state.tab, "resolved");
  assert.equal(Object.hasOwn(state.fields, "venue"), false);
  assert.equal(Object.hasOwn(state.fields, "url"), false);
  assert.equal(Object.hasOwn(state.fields, "abstract"), false);
  assert.equal(Object.hasOwn(state.fields, "keywords"), false);
});
