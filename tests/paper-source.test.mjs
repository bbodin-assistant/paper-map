import test from "node:test";
import assert from "node:assert/strict";

import { paperEntrySource, sourceLabel } from "../www/paper-source.js";

test("library entry provenance takes priority over provider source", () => {
  assert.equal(paperEntrySource({ source: "semantic-scholar", libraryEntry: { method: "bibtex-import" } }), "bibtex-import");
});

test("paper source remains a fallback for legacy/demo records", () => {
  assert.equal(paperEntrySource({ source: "demo" }), "demo");
  assert.equal(paperEntrySource({}), "unknown");
});

test("source labels are concise and user-facing", () => {
  assert.equal(sourceLabel("semantic-scholar-expansion"), "Semantic Scholar citation expansion");
  assert.equal(sourceLabel("local-pdf"), "Reviewed local PDF extraction");
});
