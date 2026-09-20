import test from "node:test";
import assert from "node:assert/strict";

import { buildTimelineLayout, clampTimelineTransform, clusterPapers, timelineClusterColor, timelineEdgePath, timelineYearTickStep } from "../www/timeline.js";

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

test("timeline clustering can use authors as the clustering basis", () => {
  const papers = [
    { id: "ada-a", title: "Vector scheduling", authors: ["Ada Lovelace"], venue: "Venue One" },
    { id: "ada-b", title: "Probabilistic memory", authors: ["Ada Lovelace"], venue: "Venue Two" },
    { id: "grace-a", title: "Graph synthesis", authors: ["Grace Hopper"], venue: "Venue One" },
    { id: "grace-b", title: "Neural compilation", authors: ["Grace Hopper"], venue: "Venue Two" },
  ];

  const { assignmentByPaperId } = clusterPapers(papers, 2, { fields: ["authors"] });
  assert.equal(assignmentByPaperId.get("ada-a"), assignmentByPaperId.get("ada-b"));
  assert.equal(assignmentByPaperId.get("grace-a"), assignmentByPaperId.get("grace-b"));
  assert.notEqual(assignmentByPaperId.get("ada-a"), assignmentByPaperId.get("grace-a"));
});

test("timeline exposes a distinct color for every configurable cluster slot", () => {
  const colors = Array.from({ length: 12 }, (_, index) => timelineClusterColor(index).accent);
  assert.equal(new Set(colors).size, 12);
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

test("citation paths terminate as curved background links with arrow tangents aimed into target cards", () => {
  const source = { x: 100, y: 50, width: 176, height: 54 };
  const target = { x: 510, y: 190, width: 176, height: 54 };
  const path = timelineEdgePath(source, target);
  assert.match(path, /^M /);
  assert.match(path, / C /);
  assert.ok(!path.includes("NaN"));

  const values = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const [, , , , c2x, c2y, endX, endY] = values;
  const targetCx = target.x + target.width / 2;
  const targetCy = target.y + target.height / 2;
  const tangent = { x: endX - c2x, y: endY - c2y };
  const inward = { x: targetCx - endX, y: targetCy - endY };
  const cosine = (tangent.x * inward.x + tangent.y * inward.y)
    / (Math.hypot(tangent.x, tangent.y) * Math.hypot(inward.x, inward.y));
  assert.ok(cosine > 0.99, `arrow tangent should point toward the target card center, cosine=${cosine}`);
});

test("timeline transform clamp prevents blank space above or left of the world", () => {
  assert.deepEqual(
    clampTimelineTransform({ x: 180, y: 90, k: 1 }, 800, 600, 1400, 900),
    { x: 0, y: 0, k: 1 },
  );
  assert.deepEqual(
    clampTimelineTransform({ x: -900, y: -500, k: 1 }, 800, 600, 1400, 900),
    { x: -600, y: -300, k: 1 },
  );
  assert.deepEqual(
    clampTimelineTransform({ x: -50, y: -50, k: 0.5 }, 800, 600, 1200, 800),
    { x: 0, y: 0, k: 0.5 },
  );
});

test("timeline drag clamp allows only a small left-edge overscroll", () => {
  assert.deepEqual(
    clampTimelineTransform(
      { x: 180, y: 0, k: 1 },
      800,
      600,
      1400,
      900,
      { leftOverscroll: 48 },
    ),
    { x: 48, y: 0, k: 1 },
  );
});

test("timeline thins year ticks only when zoomed far out", () => {
  assert.equal(timelineYearTickStep(1), 1);
  assert.ok(timelineYearTickStep(0.35) > 1);
  assert.ok(timelineYearTickStep(0.35) >= timelineYearTickStep(0.7));
});
