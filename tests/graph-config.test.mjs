import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GRAPH_CONFIG,
  normalizeGraphConfig,
} from "../www/graph-config.js";

test("timeline clustering keeps the previous five-cluster text defaults", () => {
  const config = normalizeGraphConfig();
  assert.equal(config.timelineClusterCount, 5);
  assert.deepEqual(config.timelineClusterFields, ["title", "keywords", "abstract"]);
  assert.equal(DEFAULT_GRAPH_CONFIG.timelineClusterCount, 5);
});

test("timeline cluster count is integer-bounded and fields are validated", () => {
  const config = normalizeGraphConfig({
    timelineClusterCount: 40.6,
    timelineClusterFields: ["authors", "venue", "authors", "unknown"],
  });
  assert.equal(config.timelineClusterCount, 12);
  assert.deepEqual(config.timelineClusterFields, ["authors", "venue"]);

  const fallback = normalizeGraphConfig({
    timelineClusterCount: 0,
    timelineClusterFields: [],
  });
  assert.equal(fallback.timelineClusterCount, 1);
  assert.deepEqual(fallback.timelineClusterFields, ["title", "keywords", "abstract"]);
});
