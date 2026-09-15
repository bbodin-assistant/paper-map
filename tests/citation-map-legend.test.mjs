import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("citation map shows a legend for starred, manual, and automatic papers", async () => {
  const html = await readFile(new URL("../www/index.html", import.meta.url), "utf8");
  assert.match(html, /citation-map-legend\.css/);
  assert.match(html, /class="citation-map-legend"/);
  assert.match(html, />Starred</);
  assert.match(html, />Manually added</);
  assert.match(html, />Automatically added</);
});

test("legend and citation nodes share color tokens and legend hides in topic mode", async () => {
  const css = await readFile(new URL("../www/citation-map-legend.css", import.meta.url), "utf8");

  assert.match(css, /--paper-node-starred-fill: #ffe5a3;/);
  assert.match(css, /--paper-node-manual-fill: #dcecff;/);
  assert.match(css, /--paper-node-auto-fill: #e1f2e6;/);

  assert.match(css, /#paper-map \.paper-node\.starred[\s\S]*?var\(--paper-node-starred-fill\)/);
  assert.match(css, /#paper-map \.paper-node\.manual-added[\s\S]*?var\(--paper-node-manual-fill\)/);
  assert.match(css, /#paper-map \.paper-node\.auto-added[\s\S]*?var\(--paper-node-auto-fill\)/);

  assert.match(css, /\.citation-map-legend-swatch\.starred[\s\S]*?var\(--paper-node-starred-fill\)/);
  assert.match(css, /\.citation-map-legend-swatch\.manual-added[\s\S]*?var\(--paper-node-manual-fill\)/);
  assert.match(css, /\.citation-map-legend-swatch\.auto-added[\s\S]*?var\(--paper-node-auto-fill\)/);

  assert.match(css, /data-mode="topics"\]\[aria-pressed="true"\][\s\S]*?\.citation-map-legend[\s\S]*?display: none;/);
});
