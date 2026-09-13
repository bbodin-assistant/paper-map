import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  desktopLayoutMediaQuery,
  emptyLibraryDesktopMessage,
} from "../www/ui-layout.js";

test("desktop layout stays scoped above the existing tablet breakpoint", () => {
  assert.equal(desktopLayoutMediaQuery(), "(min-width: 1001px)");
});

test("desktop empty-library status uses the requested action copy", () => {
  assert.equal(
    emptyLibraryDesktopMessage(),
    "Local library is empty. Load the demo, import BibTeX, add PDFs, or add a paper.",
  );
});

test("desktop layout keeps the requested controls and floating map affordances", async () => {
  const source = await readFile(new URL("../www/ui-layout.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../www/desktop-layout.css", import.meta.url), "utf8");

  assert.match(source, /headerOverview\.append\(mapSummary, filterMenu\)/);
  assert.match(source, /toolbarLeft\.append\(paperListButton, mapMode\)/);
  assert.match(source, /toolbarActions\.insertBefore\(addPaperForm, addFileButton\)/);
  assert.match(source, /paperListButton\.textContent = "Show papers"/);
  assert.match(source, /addPaperQuery\.placeholder = "Name of a paper to add"/);
  assert.match(source, /addPaperSubmit\.textContent = "Add"/);
  assert.match(source, /addFileButton\.textContent = "Add paper"/);
  assert.match(source, /mapStage\.insertBefore\(resetView, mapStage\.firstChild\)/);
  assert.match(css, /\.map-stage > \.map-reset-button[\s\S]*?top: 12px;[\s\S]*?right: 12px;/);
  assert.match(css, /\.map-help[\s\S]*?right: 12px;[\s\S]*?left: auto;/);
});
