import test from "node:test";
import assert from "node:assert/strict";
import { timelinePdfIconPosition } from "../www/timeline-pdf-icons.js";

test("places the PDF indicator at the top-right inside the timeline paper node", () => {
  assert.deepEqual(timelinePdfIconPosition({ x: 12, y: 20, width: 140, height: 64 }), { x: 135, y: 18 });
});

test("does not position an icon when node bounds are unavailable", () => {
  assert.equal(timelinePdfIconPosition({ x: 0, y: 0, width: 0, height: 40 }), null);
  assert.equal(timelinePdfIconPosition(null), null);
});
