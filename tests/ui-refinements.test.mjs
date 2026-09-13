import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pdfReviewHasMissingMetadata, pdfReviewMissingMetadata } from "../www/ui-layout.js";

const NO_MISSING_PDF_METADATA = {
  title: false,
  authors: false,
  year: false,
  type: false,
  venue: false,
  doi: false,
  arxivId: false,
  url: false,
  abstract: false,
  keywords: false,
};

test("PDF review metadata warning waits for extraction and validates every visible metadata field", () => {
  assert.deepEqual(
    pdfReviewMissingMetadata({ title: "", authors: "", fileName: "Example_Paper.pdf", localStatus: "queued" }),
    NO_MISSING_PDF_METADATA,
  );

  const complete = {
    title: "A Different Example Paper",
    authors: "Ada Example\nGrace Example",
    year: "2025",
    type: "article",
    venue: "ExampleConf",
    doi: "10.1234/example.2025.1",
    arxivId: "2501.12345v2",
    url: "https://example.test/paper",
    abstract: "A complete abstract.",
    keywords: "systems, scheduling",
    fileName: "Example_Paper.pdf",
    localStatus: "complete",
  };
  assert.deepEqual(pdfReviewMissingMetadata(complete), NO_MISSING_PDF_METADATA);
  assert.equal(pdfReviewHasMissingMetadata(complete), false);

  const incomplete = pdfReviewMissingMetadata({
    ...complete,
    title: "Example Paper",
    authors: "",
    year: "0",
    type: "",
    venue: "",
    doi: "not-a-doi",
    arxivId: "not-arxiv",
    url: "not-a-url",
    abstract: "",
    keywords: "",
  });
  assert.deepEqual(incomplete, {
    title: true,
    authors: true,
    year: true,
    type: true,
    venue: true,
    doi: true,
    arxivId: true,
    url: true,
    abstract: true,
    keywords: true,
  });
  assert.equal(pdfReviewHasMissingMetadata({ ...complete, venue: "" }), true);
});

test("PDF review uses a left tab rail and visible missing-metadata styling", async () => {
  const css = await readFile(new URL("../www/pdf-ai-import.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../www/ui-layout.js", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns: 190px minmax\(0, 1fr\)/);
  assert.match(css, /"tabs analysis"/);
  assert.match(css, /\.pdf-review-tabs[\s\S]*?flex-direction: column;/);
  assert.match(css, /\.missing-extracted-metadata[\s\S]*?border-color: #bd5d54;/);
  assert.match(css, /content: "Not extracted"/);
  assert.match(layout, /#pdf-review-year/);
  assert.match(layout, /#pdf-review-doi/);
  assert.match(layout, /#pdf-review-arxiv/);
  assert.match(layout, /#pdf-review-url/);
  assert.match(layout, /metadata-warning/);
  assert.match(layout, /color: #823c32/);
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
