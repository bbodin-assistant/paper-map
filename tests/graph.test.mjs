import test from "node:test";
import assert from "node:assert/strict";

import { aggregateBlockLayout, buildAuthorGraph, buildTopicGraph, gravityBlockLayout, gravityIterationBudget, hierarchicalBlockLayout, paperNodeKind } from "../www/graph.js";

test("topic graph omits papers without real topics", () => {
  const papers = [
    { id: "paper:uncategorized", title: "No topic", topics: [], starred: false },
    { id: "paper:a", title: "A", topics: ["topic:a"], starred: false },
    { id: "paper:b", title: "B", topics: ["topic:b"], starred: true },
  ];
  const edges = [
    { id: "uncategorized-to-a", source: "paper:uncategorized", target: "paper:a" },
    { id: "a-to-b", source: "paper:a", target: "paper:b" },
  ];
  const topics = [
    { id: "topic:a", name: "Topic A", source: "manual" },
    { id: "topic:b", name: "Topic B", source: "manual" },
  ];

  const graph = buildTopicGraph(papers, edges, topics);

  assert.deepEqual(graph.blocks.map((block) => block.id).sort(), ["topic:a", "topic:b"]);
  assert.ok(!graph.blocks.some((block) => block.name === "Uncategorized" || block.id === "topic:uncategorized"));
  assert.deepEqual(graph.connections, [{ source: "topic:a", target: "topic:b", weight: 1 }]);
});

test("paper node kind distinguishes starred, manual, and automatic additions", () => {
  assert.equal(paperNodeKind({
    starred: true,
    libraryEntry: { method: "semantic-scholar-expansion" },
  }), "starred");
  assert.equal(paperNodeKind({
    libraryEntry: { method: "semantic-scholar-resolve" },
  }), "manual-added");
  assert.equal(paperNodeKind({
    libraryEntry: { method: "openalex-expansion" },
  }), "auto-added");
  assert.equal(paperNodeKind({
    libraryEntry: { method: "bibtex-import" },
  }), "other");
});


test("author graph links only actual co-authors and weights shared papers", () => {
  const papers = [
    { id: "a", authors: ["Ada Lovelace", "Shared Author"], starred: true },
    { id: "b", authors: ["Grace Hopper", "Shared Author"], starred: false },
    { id: "c", authors: ["Ada Lovelace", "Shared Author"], starred: false },
  ];
  const graph = buildAuthorGraph(papers, [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ]);
  const ada = graph.blocks.find((block) => block.name === "Ada Lovelace");
  const grace = graph.blocks.find((block) => block.name === "Grace Hopper");
  const shared = graph.blocks.find((block) => block.name === "Shared Author");

  assert.deepEqual(ada.paperIds.sort(), ["a", "c"]);
  assert.deepEqual(grace.paperIds, ["b"]);
  assert.deepEqual(shared.paperIds.sort(), ["a", "b", "c"]);
  assert.equal(ada.coauthorCount, 1);
  assert.equal(grace.coauthorCount, 1);
  assert.equal(shared.coauthorCount, 2);

  const edgeBetween = (left, right) => graph.connections.find(
    (edge) => new Set([edge.source, edge.target]).has(left.id)
      && new Set([edge.source, edge.target]).has(right.id),
  );
  const adaShared = edgeBetween(ada, shared);
  const graceShared = edgeBetween(grace, shared);
  assert.equal(adaShared?.weight, 2);
  assert.deepEqual(adaShared?.paperIds.sort(), ["a", "c"]);
  assert.equal(graceShared?.weight, 1);
  assert.deepEqual(graceShared?.paperIds, ["b"]);
  assert.equal(edgeBetween(ada, grace), undefined, "paper citations must not create Author-map links");
  assert.equal(graph.connections.length, 2);
});

test("hierarchical block layout remains usable with 200 topics", () => {
  const blocks = Array.from({ length: 200 }, (_, index) => ({
    id: `topic:${index}`,
    name: `Topic ${index}`,
    paperIds: [`paper:${index % 40}`],
    starred: 0,
    source: "openalex",
  }));
  const connections = Array.from({ length: 199 }, (_, index) => ({
    source: `topic:${index}`,
    target: `topic:${index + 1}`,
    weight: 1,
  }));
  const layout = hierarchicalBlockLayout(blocks, connections, 1200, 720);
  assert.equal(layout.blocks.length, 200);
  assert.ok(new Set(layout.blocks.map((block) => block.x)).size > 20);
  assert.ok(layout.blocks.every((block) => Number.isFinite(block.x) && Number.isFinite(block.y)));
  const first = layout.blocks.find((block) => block.id === "topic:0");
  const last = layout.blocks.find((block) => block.id === "topic:199");
  assert.ok(first.x < last.x, "hierarchy should progress left to right instead of orbiting in a circle");
});

test("topic generality layout orders paper prevalence from left to right", () => {
  const blocks = [
    { id: "topic:general", name: "General", paperIds: ["a", "b", "c"], starred: 0, source: "manual" },
    { id: "topic:middle-a", name: "Middle A", paperIds: ["a", "b"], starred: 0, source: "manual" },
    { id: "topic:middle-b", name: "Middle B", paperIds: ["b", "c"], starred: 0, source: "manual" },
    { id: "topic:specific", name: "Specific", paperIds: ["c"], starred: 0, source: "manual" },
  ];
  const layout = aggregateBlockLayout("topic", "generality", blocks, [], 1200, 720);
  const byId = new Map(layout.blocks.map((block) => [block.id, block]));
  assert.ok(byId.get("topic:general").x < byId.get("topic:specific").x);
  assert.equal(byId.get("topic:middle-a").x, byId.get("topic:middle-b").x, "equally general topics should share a column");
});

test("author co-author layout puts the most collaborative authors on the left", () => {
  const blocks = [
    { id: "author:hub", name: "Hub", paperIds: ["a", "b"], coauthorCount: 5, starred: 0 },
    { id: "author:pair-a", name: "Pair A", paperIds: ["a"], coauthorCount: 1, starred: 0 },
    { id: "author:pair-b", name: "Pair B", paperIds: ["b"], coauthorCount: 1, starred: 0 },
    { id: "author:solo", name: "Solo", paperIds: ["c"], coauthorCount: 0, starred: 0 },
  ];
  const layout = aggregateBlockLayout("author", "coauthors", blocks, [], 1200, 720);
  const byId = new Map(layout.blocks.map((block) => [block.id, block]));
  assert.ok(byId.get("author:hub").x < byId.get("author:solo").x);
  assert.equal(byId.get("author:pair-a").x, byId.get("author:pair-b").x, "authors with equal co-author counts should share a column");
});

test("gravity block layout is deterministic and finite", () => {
  const blocks = Array.from({ length: 12 }, (_, index) => ({
    id: `topic:${index}`,
    name: `Topic ${index}`,
    paperIds: [`paper:${index}`],
    starred: 0,
  }));
  const connections = Array.from({ length: 11 }, (_, index) => ({
    source: `topic:${index}`,
    target: `topic:${index + 1}`,
    weight: 1,
  }));
  const first = gravityBlockLayout(blocks, connections, 1000, 640);
  const second = gravityBlockLayout(blocks, connections, 1000, 640);
  assert.deepEqual(
    first.blocks.map(({ id, x, y }) => ({ id, x, y })),
    second.blocks.map(({ id, x, y }) => ({ id, x, y })),
  );
  assert.ok(first.blocks.every((block) => Number.isFinite(block.x) && Number.isFinite(block.y)));
  assert.ok(new Set(first.blocks.map((block) => `${Math.round(block.x)}:${Math.round(block.y)}`)).size > 6);
});

test("gravity layout settles substantially longer than the old cap", () => {
  assert.ok(gravityIterationBudget(12) > 260);
  assert.ok(gravityIterationBudget(100) >= gravityIterationBudget(12));
  assert.ok(gravityIterationBudget(1000) <= 900);
});
