import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { attachmentIdentity } from "../www/paper-attachments.js";

test("stored PDF identity prefers canonical publication identifiers", () => {
  assert.equal(
    attachmentIdentity({ doi: "https://doi.org/10.1000/ABC", title: "Ignored", year: 2024 }),
    "doi:10.1000/abc",
  );
  assert.equal(
    attachmentIdentity({ arxivId: "arXiv:2401.12345v2", title: "Ignored", year: 2024 }),
    "arxiv:2401.12345",
  );
});

test("stored PDF identity falls back to title/year then source filename", () => {
  assert.equal(
    attachmentIdentity({ title: "A Paper About Graphs", year: 2022 }),
    "title:a paper about graphs:2022",
  );
  assert.equal(
    attachmentIdentity({ sourceFileName: "MyPaper.PDF" }),
    "file:mypaper.pdf",
  );
});

test("page loads the local PDF attachment module", async () => {
  const html = await readFile(new URL("../www/index.html", import.meta.url), "utf8");
  assert.match(html, /paper-attachments\.js\?v=0\.4\.2/);
  assert.match(html, /Paper Map <span class="app-version">v0\.4\.2<\/span>/);
});
