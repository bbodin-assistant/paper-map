# Paper Map

Paper Map is a local-first research bibliography explorer. It keeps the user's library in the browser, renders citation and thematic maps as the primary interface, and can expand the graph from public scholarly APIs on demand.

The application is designed for static hosting. There is no application backend and no bibliography data is uploaded to GitHub unless it is part of the bundled demo dataset.

## V1 goals

- Store papers, citation edges, annotations, tags, topics, and UI state locally in IndexedDB.
- Import and export a portable Paper Map JSON database.
- Import BibTeX and enrich papers from Semantic Scholar when identifiers are available.
- Import a research PDF with deterministic local citation extraction in Rust/WebAssembly.
- Resolve extracted DOI/arXiv identifiers to canonical metadata through Crossref and Semantic Scholar with reviewed match confidence.
- Keep AI-assisted metadata/topic extraction as an optional reviewed alternative.
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
Cargo.toml                  Rust/WASM citation extractor crate
src/
  lib.rs                    PDF layout, bibliography and identifier extraction
www/
  index.html                Static application shell
  style.css                 Main visual language and map layout
  app.js                    Application state and orchestration
  db.js                     IndexedDB persistence
  graph.js                  Citation and topic SVG rendering
  import-export.js          JSON / BibTeX import and export
  semantic-scholar.js       Scholarly-data provider adapter
  pdf-local.js              Rust/WASM browser adapter
  pdf-local.css             Local citation/resolution review styles
  reference-resolver.js     Crossref / Semantic Scholar exact-ID resolver
  reference-resolution-ui.js Resolution controls and confidence presentation
  pdf-ai.js                 OpenAI PDF metadata/topic extraction adapter
  pdf-ai-import.js          Shared reviewed PDF import workflow
  pdf-ai-import.css         PDF review UI styles
  pkg/                      Generated wasm-pack output; not committed
  demo-data.js              Bundled demo library
tests/
  pdf-ai.test.mjs                       PDF metadata normalization tests
  reference-resolver.test.mjs           DOI/arXiv resolver unit tests
  mobile_selenium_test.py               Mobile interaction/layout/OCR test
  pdf_review_selenium_test.py           AI review/save test with mocked API
  pdf_local_citation_selenium_test.py   Real Rust/WASM extraction + resolver review test
  requirements-ui.txt                   Selenium dependency
ROADMAP.md                   Product and implementation roadmap
AGENTS.md                    Project-specific implementation guide
```

No UI framework or Node runtime is required in production. The browser uses ES modules directly; Rust is compiled to WebAssembly with `wasm-pack`.

## Run locally

Install Rust, the `wasm32-unknown-unknown` target, and `wasm-pack`:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1 --locked
```

Then build the generated browser package and serve the repository root:

```bash
make run
```

Open `http://localhost:8080/www/`.

## Tests

Fast syntax/unit checks, including native Rust extraction and canonical resolver tests:

```bash
make test
```

Explicit Rust/WASM validation:

```bash
make test-rust
```

The mobile browser suite uses Selenium with Chrome mobile emulation at a 390 × 844 CSS-pixel viewport. It exercises the main UI, OCR visibility checks, the reviewed AI flow, and a real Rust/WASM local citation extraction against a generated two-page PDF fixture. The citation fixture then mocks only Crossref and Semantic Scholar responses so the browser test verifies the resolver UI and IndexedDB persistence deterministically without depending on public API availability.

Install `selenium` from `tests/requirements-ui.txt` and Tesseract, start the static server, then run:

```bash
make test-ui-mobile TEST_URL=http://127.0.0.1:8080/www/
```

CI compiles the Rust crate for `wasm32-unknown-unknown`, builds `www/pkg/`, runs the browser tests against that generated package, and uploads screenshots/OCR output as `mobile-ui-artifacts`.

## Local data

The live library is stored in IndexedDB under `paper-map-v1`. Browser data can be downloaded as a JSON backup and restored later. Clearing browser site data removes the local library, so regular exports are recommended for important collections.

The repository's demo records are source-controlled only to make the application immediately testable. Generated WebAssembly output, user PDFs, extracted references, notes, exports, and API keys are not committed.

## Local PDF citation extraction and resolution

The systematic PDF path begins entirely in the browser:

1. `pdfplumber` parses in-memory PDF bytes and performs layout-preserving text extraction.
2. Rust searches for explicit bibliography headings such as `References`, `Bibliography`, `Works Cited`, or `Literature Cited`.
3. If no heading is present, a conservative fallback looks for a cluster of citation-like lines only in the final 40% of the document.
4. The bibliography is segmented as numbered entries (`[12]`, `12.`) or author/year entries.
5. Each entry is normalized and inspected for DOI, modern/legacy arXiv identifiers, publication year, page range, and extraction confidence.
6. Structured results are returned through `wasm-bindgen` / `serde-wasm-bindgen` and shown in the existing PDF review dialog.
7. The user can accept or reject each extracted reference before saving.
8. **Resolve identifiers** is an explicit network action: DOI entries are looked up exactly in Crossref, with an exact Semantic Scholar DOI fallback; arXiv entries are looked up through Semantic Scholar using their canonical version-free identifier.
9. The review row shows provider, canonical title/authors/year/venue, and a match-confidence percentage before the user saves.

The Rust/WASM extraction itself never makes network requests. Resolution happens only after the user explicitly requests it. Exact Crossref DOI matches receive 99% confidence; exact Semantic Scholar DOI fallbacks receive 97%; arXiv matches receive 99% when the provider preserves the version or 98% when a versioned extracted identifier maps to the same canonical version-free arXiv record. These values describe identifier fidelity, not semantic similarity.

Accepted references are stored on the paper as reviewed extraction provenance together with any canonical resolution object. Identifier-less or unresolved entries remain raw reviewed references; Paper Map does not invent canonical papers. Citation graph edges are still created only after a later explicit canonical-paper import/edge step.

Scanned/image-only PDFs are reported as requiring OCR rather than being guessed from images in this first systematic extractor.

## Optional AI PDF analysis

The OpenAI Responses API adapter remains available for metadata and topic suggestions. The selected PDF is sent directly from the browser as an inline file input with `store: false`. The user supplies the API key; it is not committed or saved in IndexedDB. By default it is kept only in the password field, with an explicit option to retain it in `sessionStorage` for the current browser tab.

The AI result is treated as a proposal. Title, authors, year, venue, type, DOI, arXiv ID, URL, abstract, keywords, proposed topics, confidence values, and warnings are shown in the same review dialog. The paper and accepted topics are written to IndexedDB only after **Save reviewed paper** is pressed.

## External scholarly data

Paper Map uses Semantic Scholar Academic Graph for on-demand paper enrichment, citation expansion, arXiv resolution, and DOI fallback resolution. Crossref is used for exact DOI metadata lookup during extracted-reference review. Both adapters normalize provider responses before the canonical metadata reaches persisted review provenance.

The provider layer remains replaceable: OpenAlex, DataCite, Zotero, another AI provider, or additional reference-resolution adapters can be added without changing the core map renderer.

## Import paths

Current import paths are:

- Paper Map JSON backup / restore
- BibTeX
- DOI, arXiv ID, Semantic Scholar ID, or title through Semantic Scholar
- PDF through local Rust/WASM bibliography/citation extraction, with optional reviewed Crossref/Semantic Scholar identifier resolution
- PDF through optional reviewed AI-assisted metadata/topic extraction

The PDF itself is not stored in IndexedDB. Only user-reviewed paper data, accepted topics, and accepted extracted-reference provenance are saved locally.
