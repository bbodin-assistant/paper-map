import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("paper UI exposes clearer add actions and reviewed online update", async () => {
  const [html, publication] = await Promise.all([
    source("www/index.html"),
    source("www/publication-ui.js"),
  ]);
  assert.match(html, /app-version">v0\.4\.5/);
  assert.match(html, />Find & add<\/button>/);
  assert.match(html, /paper-online-update\\.js\\?v=0\\.4\\.11/);
  assert.match(publication, /summary\.textContent = "Add paper"/);
  assert.match(publication, /button\.textContent = "Add files"/);
});

test("PDF review exposes direct preview and lookup-readiness tab styling", async () => {
  const [ui, controller, baseCss, readinessCss] = await Promise.all([
    source("www/pdf-review-ui.js"),
    source("www/pdf-review-controller.js"),
    source("www/pdf-ai-import.css"),
    source("www/pdf-review-state.css"),
  ]);
  assert.match(ui, /id="pdf-ai-open-file"/);
  assert.match(controller, /window\.open\(url, "_blank"/);
  assert.match(controller, /dataset\.reviewStatus/);
  assert.match(readinessCss, /button\.searchable/);
  assert.match(readinessCss, /button\.resolved/);
  assert.match(readinessCss, /button\.error/);
  assert.match(baseCss, /\.pdf-review-tabs button/);
});

test("stored PDF action is disabled and relabeled when no binary exists", async () => {
  const script = await source("www/paper-attachments.js");
  assert.match(script, /button\.disabled = !activeAttachment/);
  assert.match(script, /button\.textContent = "PDF not stored"/);
});
