import test from "node:test";
import assert from "node:assert/strict";

import { searchHighlightParts } from "../www/search-highlight.js";

test("highlights the contiguous search phrase case-insensitively when present", () => {
  const parts = searchHighlightParts(
    "A PROGRESSIVE multi provider candidate fixture study",
    "Progressive Multi Provider Candidate Fixture",
  );
  assert.deepEqual(parts, [
    { text: "A ", match: false },
    { text: "PROGRESSIVE multi provider candidate fixture", match: true },
    { text: " study", match: false },
  ]);
});

test("falls back to highlighting individual search terms when the full phrase is absent", () => {
  const parts = searchHighlightParts(
    "Progressive provider overview for candidate systems",
    "Progressive Multi Provider Candidate Fixture",
  );
  assert.deepEqual(parts.filter((part) => part.match).map((part) => part.text), [
    "Progressive",
    "provider",
    "candidate",
  ]);
  assert.equal(parts.map((part) => part.text).join(""), "Progressive provider overview for candidate systems");
});

test("treats punctuation in a contiguous query as literal text", () => {
  assert.deepEqual(searchHighlightParts("Modern C++ analysis", "C++"), [
    { text: "Modern ", match: false },
    { text: "C++", match: true },
    { text: " analysis", match: false },
  ]);
});
