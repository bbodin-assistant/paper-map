import test from "node:test";
import assert from "node:assert/strict";
import { isPdfFile, normalizeAiMetadata, slugTopic } from "../www/pdf-ai.js";

test("normalizes AI metadata conservatively", () => {
  const result = normalizeAiMetadata({
    title: "  A   Research Paper  ",
    authors: ["Ada Lovelace", "Ada Lovelace", " Alan Turing "],
    year: 2025,
    venue: "  Example Conf ",
    publication_type: "conference paper",
    doi: "https://doi.org/10.1000/XYZ",
    arxiv_id: "arXiv:2501.01234",
    keywords: ["Graph learning", "graph learning", "  compilers "],
    topics: [
      { name: "Graph Neural Networks", description: "  Learning on graphs. ", confidence: 1.4 },
      { name: "graph neural networks", description: "duplicate", confidence: 0.1 },
      { name: "Compiler Optimization", description: "Compiler methods", confidence: -0.5 },
    ],
    warnings: ["Check venue", "Check venue"],
  });

  assert.equal(result.title, "A Research Paper");
  assert.deepEqual(result.authors, ["Ada Lovelace", "Alan Turing"]);
  assert.equal(result.doi, "10.1000/xyz");
  assert.equal(result.arxivId, "2501.01234");
  assert.deepEqual(result.keywords, ["Graph learning", "compilers"]);
  assert.equal(result.topics.length, 2);
  assert.equal(result.topics[0].confidence, 1);
  assert.equal(result.topics[1].confidence, 0);
  assert.deepEqual(result.warnings, ["Check venue"]);
});

test("creates stable topic slugs", () => {
  assert.equal(slugTopic("  Théorie des graphes / GNN  "), "theorie-des-graphes-gnn");
});

test("accepts PDFs when the browser omits MIME type", () => {
  assert.equal(isPdfFile({ type: "application/pdf", name: "paper.bin" }), true);
  assert.equal(isPdfFile({ type: "", name: "paper.PDF" }), true);
  assert.equal(isPdfFile({ type: "text/plain", name: "paper.txt" }), false);
});
