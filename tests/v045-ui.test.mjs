import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("v0.4.5 exposes clearer add actions and paper online update", async () => {
  const [html, publication] = await Promise.all([
    source("www/index.html"),
    source("www/publication-ui.js"),
  ]);
  assert.match(html, /app-version">v0\.4\.5/);
  assert.match(html, />Find & add<\/button>/);
  assert.match(html, /paper-online-update\.js\?v=0\.4\.5/);
  assert.match(publication, /summary\.textContent = "Add paper"/);
  assert.match(publication, /button\.textContent = "Add files"/);
});

test("PDF review exposes direct preview and success/error tab styling", async () => {
  const [script, css] = await Promise.all([
    source("www/pdf-ai-import.js"),
    source("www/pdf-ai-import.css"),
  ]);
  assert.match(script, /id="pdf-ai-open-file"/);
  assert.match(script, /window\.open\(url, "_blank"/);
  assert.match(script, /data\.reviewStatus|dataset\.reviewStatus/);
  assert.match(css, /\.pdf-review-tabs button\.success/);
  assert.match(css, /\.pdf-review-tabs button\.error/);
});

test("stored PDF action is disabled and relabeled when no binary exists", async () => {
  const script = await source("www/paper-attachments.js");
  assert.match(script, /button\.disabled = !activeAttachment/);
  assert.match(script, /button\.textContent = "PDF not stored"/);
});
