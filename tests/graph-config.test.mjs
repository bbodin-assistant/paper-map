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
  assert.equal(config.topicLayoutTechnique, "generality");
  assert.equal(config.authorLayoutTechnique, "coauthors");
  assert.equal(config.authorLinkMode, "coauthors");
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

test("aggregate layout techniques are validated independently", () => {
  const configured = normalizeGraphConfig({
    topicLayoutTechnique: "gravity",
    authorLayoutTechnique: "hierarchy",
    authorLinkMode: "citations",
  });
  assert.equal(configured.topicLayoutTechnique, "gravity");
  assert.equal(configured.authorLayoutTechnique, "hierarchy");
  assert.equal(configured.authorLinkMode, "citations");

  const fallback = normalizeGraphConfig({
    topicLayoutTechnique: "orbit",
    authorLayoutTechnique: "random",
    authorLinkMode: "mentions",
  });
  assert.equal(fallback.topicLayoutTechnique, "generality");
  assert.equal(fallback.authorLayoutTechnique, "coauthors");
  assert.equal(fallback.authorLinkMode, "coauthors");
});
