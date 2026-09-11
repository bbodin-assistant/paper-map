import test from "node:test";
import assert from "node:assert/strict";

import { buildTimelineLayout, clusterPapers, timelineEdgePath } from "../www/timeline.js";

test("timeline clustering uses paper text rather than publication year", () => {
  const papers = [
    { id: "nlp-old", year: 1991, title: "Neural language translation", keywords: ["transformer", "language"], abstract: "attention representation translation tokens" },
    { id: "nlp-new", year: 2025, title: "Language translation with attention", keywords: ["transformer", "language"], abstract: "neural attention representation translation" },
    { id: "compiler-old", year: 1992, title: "Compiler loop optimization", keywords: ["compiler", "optimization"], abstract: "dataflow loops code generation analysis" },
    { id: "compiler-new", year: 2024, title: "Optimizing compiler dataflow", keywords: ["compiler", "optimization"], abstract: "loop analysis code generation dataflow" },
  ];

  const { assignmentByPaperId } = clusterPapers(papers, 2);
  assert.equal(assignmentByPaperId.get("nlp-old"), assignmentByPaperId.get("nlp-new"));
  assert.equal(assignmentByPaperId.get("compiler-old"), assignmentByPaperId.get("compiler-new"));
  assert.notEqual(assignmentByPaperId.get("nlp-old"), assignmentByPaperId.get("compiler-old"));
});

test("timeline compresses empty calendar gaps while preserving chronological order", () => {
  const papers = [
    { id: "a", year: 1990, title: "Alpha graph", keywords: ["graph"], abstract: "graph networks" },
    { id: "b", year: 1991, title: "Beta graph", keywords: ["graph"], abstract: "graph networks" },
    { id: "c", year: 2020, title: "Gamma graph", keywords: ["graph"], abstract: "graph networks" },
  ];

  const layout = buildTimelineLayout(papers, 800, 520, 1);
  const byId = new Map(layout.nodes.map((node) => [node.paper.id, node]));
  const firstGap = byId.get("b").x - byId.get("a").x;
  const secondGap = byId.get("c").x - byId.get("b").x;

  assert.deepEqual(layout.years, [1990, 1991, 2020]);
  assert.ok(byId.get("a").x < byId.get("b").x);
  assert.ok(byId.get("b").x < byId.get("c").x);
  assert.equal(firstGap, secondGap);
});

test("timeline creates at most five populated text bands", () => {
  const papers = Array.from({ length: 12 }, (_, index) => ({
    id: `paper-${index}`,
    year: 2000 + index,
    title: `Specialized topic ${index}`,
    keywords: [`keyword-${index}`],
    abstract: `distinctive concept-${index} evidence-${index}`,
  }));

  const { groups } = clusterPapers(papers, 5);
  assert.ok(groups.length > 0);
  assert.ok(groups.length <= 5);
  assert.equal(groups.reduce((sum, group) => sum + group.paperIds.length, 0), papers.length);
});

test("citation paths terminate as curved background links between paper cards", () => {
  const source = { x: 100, y: 50, width: 176, height: 54 };
  const target = { x: 510, y: 190, width: 176, height: 54 };
  const path = timelineEdgePath(source, target);
  assert.match(path, /^M /);
  assert.match(path, / C /);
  assert.ok(!path.includes("NaN"));
});
