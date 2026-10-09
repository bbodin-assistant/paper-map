import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../www/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../www/app.js", import.meta.url), "utf8");
const publicationUi = await readFile(new URL("../www/publication-ui.js", import.meta.url), "utf8");

test("full database ZIP upload is shown next to download", () => {
  const download = html.indexOf('id="export-json">Download Full DB.zip</button>');
  const upload = html.indexOf('id="upload-full-db">Upload Full DB.zip</button>');
  assert.ok(download >= 0 && upload > download, "upload control should immediately follow download in the markup");
  const pairStart = html.lastIndexOf('<div class="full-db-actions">', download);
  assert.ok(pairStart >= 0 && html.indexOf("</div>", upload) > upload, "both controls should share the paired layout");
});

test("upload picker is restricted to ZIP and uses the full archive restore path", () => {
  assert.match(
    app,
    /els\.uploadFullDb\.addEventListener\("click", \(\) => \{\s*els\.importFile\.accept = "\.zip,application\/zip";\s*els\.importFile\.click\(\);\s*\}\);/,
  );
  assert.match(app, /if \(lowerName\.endsWith\("\.zip"\)\) \{\s*const archive = await parseLibraryArchive/);
  assert.match(app, /Restore this full database archive by replacing the current local library and stored PDFs\?/);
});

test("Config relocation preserves the dedicated upload button", () => {
  assert.match(publicationUi, /root\.querySelector\("#import-button"\)\?\.remove\(\);/);
  assert.match(publicationUi, /section\.append\(actions\);/);
  assert.doesNotMatch(publicationUi, /root\.querySelector\("#upload-full-db"\)\?\.remove\(\);/);
});
