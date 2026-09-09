import test from "node:test";
import assert from "node:assert/strict";

import { requestSource, sanitizedRequestTarget } from "../www/activity-log.js";

test("classifies scholarly and AI provider endpoints", () => {
  assert.equal(requestSource("https://api.semanticscholar.org/graph/v1/paper/search?query=test"), "Semantic Scholar");
  assert.equal(requestSource("https://api.crossref.org/works/10.1234/test"), "Crossref");
  assert.equal(requestSource("https://api.openai.com/v1/responses"), "OpenAI");
  assert.equal(requestSource("https://llm.example.test/v1/chat/completions"), "AI provider");
});

test("sanitized request targets omit query strings", () => {
  assert.equal(
    sanitizedRequestTarget("https://api.semanticscholar.org/graph/v1/paper/search?query=private+title&limit=5"),
    "https://api.semanticscholar.org/graph/v1/paper/search",
  );
});
