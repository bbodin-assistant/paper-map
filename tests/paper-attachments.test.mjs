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

test("page initializes local PDF attachments after the application modules", async () => {
  const [html, initializer] = await Promise.all([
    readFile(new URL("../www/index.html", import.meta.url), "utf8"),
    readFile(new URL("../www/paper-attachments-init.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /paper-attachments-init\.js\?v=\d+\.\d+\.\d+/);
  assert.match(initializer, /paper-attachments\.js\?v=\d+\.\d+\.\d+/);
  assert.match(initializer, /initPaperAttachments\(document\)/);
  assert.match(html, /Paper Map <span class="app-version">v\d+\.\d+\.\d+<\/span>/);
});
