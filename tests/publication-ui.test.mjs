import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyPublicationFiles,
  publicationFileKind,
} from "../www/publication-ui.js";

test("publication picker recognizes PDF, JSON, and BibTeX inputs", () => {
  assert.equal(publicationFileKind({ name: "paper.pdf", type: "" }), "pdf");
  assert.equal(publicationFileKind({ name: "backup.JSON", type: "text/plain" }), "json");
  assert.equal(publicationFileKind({ name: "refs.bib", type: "" }), "bib");
  assert.equal(publicationFileKind({ name: "paper", type: "application/pdf" }), "pdf");
  assert.equal(publicationFileKind({ name: "notes.txt", type: "text/plain" }), "unsupported");
});

test("publication picker separates reviewed PDFs from portable imports", () => {
  const pdf = { name: "a.pdf" };
  const json = { name: "b.json" };
  const bib = { name: "c.bib" };
  const unsupported = { name: "d.txt" };
  const grouped = classifyPublicationFiles([pdf, json, bib, unsupported]);

  assert.deepEqual(grouped.pdfFiles, [pdf]);
  assert.deepEqual(grouped.portableFiles, [json, bib]);
  assert.deepEqual(grouped.unsupportedFiles, [unsupported]);
});

test("page loads publication controls after the reviewed PDF module", async () => {
  const html = await readFile(new URL("../www/index.html", import.meta.url), "utf8");
  const pdfIndex = html.indexOf('src="./pdf-ai-import.js"');
  const publicationIndex = html.indexOf('src="./publication-ui.js"');

  assert.ok(pdfIndex >= 0, "reviewed PDF module should be loaded");
  assert.ok(publicationIndex > pdfIndex, "publication UI should enhance controls created by the PDF module");
});
