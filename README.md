# Paper Map

Paper Map is a local-first research bibliography explorer. It keeps the user's library in the browser, renders citation and thematic maps as the primary interface, and can expand the graph from public scholarly APIs on demand.

The application is designed for static hosting. There is no application backend and no bibliography data is uploaded to GitHub unless it is part of the bundled demo dataset.

## V1 goals

- Store papers, citation edges, annotations, tags, topics, and UI state locally in IndexedDB.
- Import and export a portable Paper Map JSON database.
- Import BibTeX and enrich papers from Semantic Scholar when identifiers are available.
- Import a research PDF with AI-assisted metadata and topic extraction, with an explicit review step before saving.
- Load a small bundled demo dataset without mixing it into a user's saved library unless requested.
- Explore two map modes:
  - **Citation map** — paper nodes linked by citation/reference relationships.
  - **Topic map** — thematic blocks linked by cross-topic citation relationships.
- Search and filter by text, year, author, venue, type, topic/tag, and starred state.
- Inspect and edit a paper in a detail drawer: metadata, tags, topic, notes, reading state, relevance, links, BibTeX, and expansion controls.
- Expand references or citing papers on demand rather than downloading an unbounded graph automatically.

## Architecture

Paper Map deliberately follows the browser-first style of `train-route-explorer`:

```text
www/
  index.html              Static application shell
  style.css               Main visual language and map layout
  app.js                  Application state and orchestration
  db.js                   IndexedDB persistence
  graph.js                Citation and topic SVG rendering
  import-export.js        JSON / BibTeX import and export
  semantic-scholar.js     Scholarly-data provider adapter
  pdf-ai.js               OpenAI PDF metadata/topic extraction adapter
  pdf-ai-import.js        Reviewed PDF import workflow
  pdf-ai-import.css       PDF review UI styles
  demo-data.js            Bundled demo library
tests/
  pdf-ai.test.mjs         PDF metadata normalization tests
  mobile_selenium_test.py Mobile interaction, layout, screenshot and OCR test
  requirements-ui.txt     Selenium dependency for the mobile test
ROADMAP.md                 Product and implementation roadmap
AGENTS.md                  Project-specific implementation guide
```

No Node framework is required at runtime. The browser uses ES modules directly.

## Run locally

Serve the repository root with any static server and open `www/`.

For example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/www/`.

## Tests

Fast syntax/unit checks:

```bash
make test
```

The mobile browser test uses Selenium with Chrome mobile emulation at a 390 × 844 CSS-pixel viewport. It clicks the About, Library, Filters, map-mode, bibliography, paper-detail, and PDF-import widgets; checks visible text/control geometry for clipping or horizontal overflow; captures screenshots; and runs Tesseract OCR against the Library widget screenshot.

Install `selenium` from `tests/requirements-ui.txt` and Tesseract, start the static server, then run:

```bash
make test-ui-mobile TEST_URL=http://127.0.0.1:8080/www/
```

CI runs the same test after the fast checks and uploads screenshots, OCR output, and the server log as the `mobile-ui-artifacts` workflow artifact even when the UI test fails.

## Local data

The live library is stored in IndexedDB under `paper-map-v1`. Browser data can be downloaded as a JSON backup and restored later. Clearing browser site data removes the local library, so regular exports are recommended for important collections.

The repository's demo records are source-controlled only to make the application immediately testable.

## External scholarly data

V1 uses the Semantic Scholar Academic Graph API through an isolated provider module. Expansion is initiated by the user from a selected paper. Provider identifiers are retained so subsequent expansion can reuse the same scholarly record.

PDF import uses a separate OpenAI Responses API adapter. The selected PDF is sent directly from the browser as an inline file input with `store: false`. The user supplies the API key; it is not committed or saved in IndexedDB. By default it is kept only in the password field, with an explicit option to retain it in `sessionStorage` for the current browser tab.

The AI result is treated as a proposal. Title, authors, year, venue, type, DOI, arXiv ID, URL, abstract, keywords, proposed topics, confidence values, and warnings are shown in a review dialog. The paper and accepted topics are written to IndexedDB only after **Save reviewed paper** is pressed. Existing papers are merged using the same conservative identifier/title-year rules as other imports.

The provider layer remains replaceable: OpenAlex, Crossref, Zotero, another AI provider, or local PDF extraction can be added without changing the core database schema or map renderer.

## Import paths

Current import paths are:

- Paper Map JSON backup / restore
- BibTeX
- DOI, arXiv ID, Semantic Scholar ID, or title through Semantic Scholar
- PDF through reviewed AI-assisted extraction

The PDF workflow currently supports inline PDFs up to 25 MB. The PDF itself is not stored in IndexedDB; only reviewed bibliographic metadata and topic records are saved locally.
