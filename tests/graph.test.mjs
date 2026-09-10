import test from "node:test";
import assert from "node:assert/strict";

import { buildTopicGraph } from "../www/graph.js";

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
