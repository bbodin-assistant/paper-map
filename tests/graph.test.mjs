import test from "node:test";
import assert from "node:assert/strict";

import { buildAuthorGraph, buildTopicGraph, hierarchicalBlockLayout, paperNodeKind } from "../www/graph.js";

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


test("author graph aggregates papers and preserves citation direction", () => {
  const papers = [
    { id: "a", authors: ["Ada Lovelace", "Shared Author"], starred: true },
    { id: "b", authors: ["Grace Hopper", "Shared Author"], starred: false },
  ];
  const graph = buildAuthorGraph(papers, [{ source: "a", target: "b" }]);
  const ada = graph.blocks.find((block) => block.name === "Ada Lovelace");
  const grace = graph.blocks.find((block) => block.name === "Grace Hopper");
  const shared = graph.blocks.find((block) => block.name === "Shared Author");
  assert.deepEqual(ada.paperIds, ["a"]);
  assert.deepEqual(grace.paperIds, ["b"]);
  assert.deepEqual(shared.paperIds.sort(), ["a", "b"]);
  assert.ok(graph.connections.some((edge) => edge.source === ada.id && edge.target === grace.id));
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
