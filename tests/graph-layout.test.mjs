import test from "node:test";
import assert from "node:assert/strict";

import { applyLocalRepulsion, fitTransform, layoutDimensions, layoutIterationBudget } from "../www/graph-layout.js";

test("large graphs receive more settling iterations instead of fewer", () => {
  assert.ok(layoutIterationBudget(500) > layoutIterationBudget(50));
  assert.ok(layoutIterationBudget(900) >= layoutIterationBudget(500));
});

test("layout effort multiplies the production iteration budget", () => {
  const economical = layoutIterationBudget(250, { layoutEffort: 1, layoutSpacing: 1 });
  const patient = layoutIterationBudget(250, { layoutEffort: 3, layoutSpacing: 1 });
  assert.equal(economical, 230);
  assert.equal(patient, 690);
  assert.ok(patient > economical);
});

test("default graph effort gives the force layout twice the previous settling budget", () => {
  assert.equal(layoutIterationBudget(40, { layoutEffort: 2, layoutSpacing: 1 }), 260);
  assert.equal(layoutIterationBudget(900, { layoutEffort: 2, layoutSpacing: 1 }), 680);
});

test("large graphs use a larger logical layout area", () => {
  const small = layoutDimensions(1200, 720, 40, { layoutEffort: 2, layoutSpacing: 1 });
  const large = layoutDimensions(1200, 720, 500, { layoutEffort: 2, layoutSpacing: 1 });
  assert.equal(small.width, 1200);
  assert.equal(small.height, 720);
  assert.ok(large.width > small.width);
  assert.ok(large.height > small.height);
});

test("layout spacing enlarges the logical graph without changing the viewport", () => {
  const compact = layoutDimensions(1200, 720, 500, { layoutEffort: 2, layoutSpacing: 0.75 });
  const spacious = layoutDimensions(1200, 720, 500, { layoutEffort: 2, layoutSpacing: 2 });
  assert.ok(spacious.width > compact.width);
  assert.ok(spacious.height > compact.height);
});

test("fit transform keeps a larger logical graph visible", () => {
  const transform = fitTransform(1200, 720, 2400, 1440);
  assert.ok(transform.k < 1);
  assert.ok(transform.k >= 0.35);
});

test("local repulsion separates nearby unfixed nodes", () => {
  const nodes = [
    { index: 0, x: 100, y: 100, vx: 0, vy: 0, radius: 8, fixed: false },
    { index: 1, x: 106, y: 100, vx: 0, vy: 0, radius: 8, fixed: false },
    { index: 2, x: 800, y: 800, vx: 0, vy: 0, radius: 8, fixed: false },
  ];
  applyLocalRepulsion(nodes, 1);
  assert.ok(nodes[0].vx < 0);
  assert.ok(nodes[1].vx > 0);
  assert.equal(nodes[2].vx, 0);
});
