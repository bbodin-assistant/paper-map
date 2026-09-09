import test from "node:test";
import assert from "node:assert/strict";

import {
  createResearchRelationEdge,
  isCitationEdge,
  isResearchRelation,
  relationLabel,
  RESEARCH_RELATIONS,
  researchRelationEdgeId,
} from "../www/research-relations.js";
import { citationRadius, directedSegment, pinchZoomTransform } from "../www/graph.js";

test("canonical research relationships are directed and stable", () => {
  const ids = RESEARCH_RELATIONS.map((relation) => relation.id);
  assert.deepEqual(ids, [
    "builds_on",
    "improves_on",
    "extends",
    "outperforms",
    "invalidates",
    "contradicts",
    "supports",
    "replicates",
  ]);
  const edge = createResearchRelationEdge({
    source: "paper:new",
    target: "paper:old",
    relation: "improves_on",
    createdAt: "2026-09-09T00:00:00.000Z",
  });
  assert.equal(edge.id, "relation:improves_on:paper:new->paper:old");
  assert.equal(researchRelationEdgeId("paper:new", "paper:old", "improves_on"), edge.id);
  assert.equal(relationLabel("improves_on"), "Improves on");
  assert.equal(relationLabel("improves_on", { inverse: true }), "Improved by");
  assert.equal(isResearchRelation(edge), true);
  assert.equal(isCitationEdge(edge), false);
  assert.equal(isCitationEdge({ source: "a", target: "b" }), true);
});

test("citation radius grows gently with provider citation count", () => {
  const none = citationRadius({ citationCount: null });
  const small = citationRadius({ citationCount: 10 });
  const medium = citationRadius({ citationCount: 1000 });
  const large = citationRadius({ citationCount: 100000 });
  assert.equal(none, 8);
  assert.ok(small > none);
  assert.ok(medium > small);
  assert.ok(large >= medium);
  assert.ok(large <= 15);
});

test("directed edge geometry stops before target node center", () => {
  const segment = directedSegment(
    { x: 0, y: 0, radius: 10 },
    { x: 100, y: 0, radius: 20 },
    6,
  );
  assert.equal(segment.x1, 10);
  assert.equal(segment.y1, 0);
  assert.equal(segment.x2, 74);
  assert.equal(segment.y2, 0);
});

test("pinch zoom preserves the world point under the gesture midpoint", () => {
  const next = pinchZoomTransform(
    { x: 10, y: 20, k: 1 },
    { x: 100, y: 100 },
    100,
    { x: 110, y: 120 },
    200,
  );
  assert.equal(next.k, 2);
  assert.equal(next.x, -70);
  assert.equal(next.y, -40);
});
