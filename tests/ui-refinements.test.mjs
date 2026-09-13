import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pdfReviewMissingMetadata } from "../www/ui-layout.js";

test("PDF review metadata warning waits for local extraction and flags missing fields", () => {
  assert.deepEqual(
    pdfReviewMissingMetadata({ title: "Example Paper", authors: "", fileName: "Example_Paper.pdf", localStatus: "complete" }),
    { title: true, authors: true },
  );
  assert.deepEqual(
    pdfReviewMissingMetadata({ title: "", authors: "", fileName: "Example_Paper.pdf", localStatus: "queued" }),
    { title: false, authors: false },
  );
  assert.deepEqual(
    pdfReviewMissingMetadata({ title: "Example Paper", authors: "Ada Example", fileName: "Example_Paper.pdf", localStatus: "complete" }),
    { title: false, authors: false },
  );
});

test("PDF review uses a left tab rail and visible missing-metadata styling", async () => {
  const css = await readFile(new URL("../www/pdf-ai-import.css", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns: 190px minmax\(0, 1fr\)/);
  assert.match(css, /"tabs analysis"/);
  assert.match(css, /\.pdf-review-tabs[\s\S]*?flex-direction: column;/);
  assert.match(css, /\.missing-extracted-metadata[\s\S]*?border-color: #bd5d54;/);
  assert.match(css, /content: "Not extracted"/);
});

test("configuration sections are visually segmented without covering mobile controls", async () => {
  const css = await readFile(new URL("../www/ai-config.css", import.meta.url), "utf8");
  assert.match(css, /\.config-section[\s\S]*?border: 1px solid #cfd5d0;/);
  assert.match(css, /\.config-section[\s\S]*?background: #f7f8f5;/);
  assert.match(css, /box-shadow: inset 3px 0 0 #8a9790;/);
  assert.match(css, /\.ai-model-status[\s\S]*?height: 34px;/);
  assert.match(css, /\.ai-model-status[\s\S]*?overflow-y: auto;/);
  const mobile = css.slice(css.indexOf("@media (max-width: 680px)"));
  assert.match(mobile, /\.config-actions[\s\S]*?position: static;/);
  assert.match(mobile, /\.config-actions[\s\S]*?bottom: auto;/);
});
