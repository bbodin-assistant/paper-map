# Paper Map

Paper Map is a local-first research bibliography explorer. It keeps the user's library in the browser, renders directed citation, semantic-research and thematic maps as the primary interface, and can expand the graph from public scholarly APIs on demand.

The application is designed for static hosting. There is no application backend and no bibliography data is uploaded to GitHub unless it is part of the bundled demo dataset.

## V1 goals

- Store papers, directed citation/research links, annotations, tags, topics, provenance, and UI state locally in IndexedDB.
- Import and export a portable Paper Map JSON database.
- Import BibTeX and enrich papers from Semantic Scholar when identifiers are available.
- Import a research PDF with deterministic local citation extraction in Rust/WebAssembly.
- Resolve extracted DOI/arXiv identifiers to canonical metadata through Crossref and Semantic Scholar with reviewed match confidence.
- Keep AI-assisted metadata/topic extraction as an optional reviewed alternative with a configurable OpenAI, Ollama, or OpenAI-compatible server.
- Record canonical semantic relationships between papers such as **Builds on**, **Improves on**, **Extends**, **Outperforms**, **Invalidates**, **Contradicts**, **Supports**, and **Replicates**.
- Preserve how a paper entered the local library: provider lookup/expansion, BibTeX, backup, reviewed PDF extraction, AI-assisted extraction, or the bundled demo.
- Load a small bundled demo dataset without mixing it into a user's saved library unless requested.
- Explore two map modes:
  - **Citation map** — paper nodes linked by directed citations and explicit semantic research relationships.
  - **Topic map** — thematic blocks linked by directed cross-topic traffic.
- Pan, wheel/pinch zoom, and manually drag graph items. Selecting a paper preserves the current graph layout.
- Search and filter by text, year, author, venue, type, topic/tag, and starred state.
- Inspect and edit a paper in a richer non-modal detail drawer: metadata, research relationships, library provenance, tags, topic, notes, reading state, relevance, links, BibTeX, and expansion controls.
- Keep reading state about reading only: **Unread**, **Reading**, or **Read**. Importance remains separate through stars/relevance.
- Expand references or citing papers on demand rather than downloading an unbounded graph automatically.

## Architecture

Paper Map deliberately follows the browser-first style of `train-route-explorer`:

```text
Cargo.toml                  Rust/WASM citation extractor crate
src/
  lib.rs                    PDF layout, full-text, bibliography and identifier extraction
www/
  index.html                Static application shell
  style.css                 Main visual language and map layout
  app.js                    Application state and orchestration
  db.js                     IndexedDB persistence
  graph.js                  Directed SVG graph rendering and direct manipulation
  research-relations.js     Canonical semantic paper-relation vocabulary
  import-export.js          JSON / BibTeX import and export
  semantic-scholar.js       Scholarly-data provider adapter
  ai-config.js              AI provider/base URL/model preference model
  ai-config-ui.js           Global and PDF-inline AI server configuration UI
  ai-provider.js            Capability-aware AI proxy/router
  ai-config.css             AI server configuration styles
  pdf-local.js              Rust/WASM browser adapter and local PDF text boundary
  pdf-local.css             Local citation/resolution review styles
  reference-resolver.js     Crossref / Semantic Scholar exact-ID resolver
  reference-resolution-ui.js Resolution controls and confidence presentation
  pdf-ai.js                 Direct OpenAI Responses/PDF adapter
  pdf-ai-import.js          Shared reviewed PDF import workflow
  pdf-ai-import.css         PDF review UI styles
  pkg/                      Generated wasm-pack output; not committed
  demo-data.js              Bundled demo library
tests/
  pdf-ai.test.mjs                       PDF metadata normalization tests
  ai-provider.test.mjs                  AI proxy/provider request tests
  reference-resolver.test.mjs           DOI/arXiv resolver unit tests
  research-relations.test.mjs           Research-link and graph-geometry tests
  mobile_selenium_test.py               Mobile interaction/layout/OCR test
  graph_relations_selenium_test.py      Pinch/drag/direction/relation/provenance test
  pdf_review_selenium_test.py           Configurable AI proxy review/save test
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

Fast syntax/unit checks, including native Rust extraction, AI proxy routing, resolver, research-relation, graph-geometry and pinch-transform tests:

```bash
make test
```

Explicit Rust/WASM validation:

```bash
make test-rust
```

The mobile browser suite uses Selenium with Chrome mobile emulation at a 390 × 844 CSS-pixel viewport. It exercises the main UI, OCR visibility checks, configurable reviewed AI flow, real Rust/WASM local citation extraction, exact Crossref/Semantic Scholar resolution, outside-click menu dismissal, stable graph selection, directed arrows, semantic relation creation, library provenance, node drag and two-finger pinch zoom.

Install `selenium` from `tests/requirements-ui.txt` and Tesseract, start the static server, then run:

```bash
make test-ui-mobile TEST_URL=http://127.0.0.1:8080/www/
```

CI compiles the Rust crate for `wasm32-unknown-unknown`, builds `www/pkg/`, runs the browser tests against that generated package, and uploads screenshots/OCR output as `mobile-ui-artifacts`.

## Local data

The live library is stored in IndexedDB under `paper-map-v1`. Browser data can be downloaded as a JSON backup and restored later. Clearing browser site data removes the local library, so regular exports are recommended for important collections.

The repository's demo records are source-controlled only to make the application immediately testable. Generated WebAssembly output, user PDFs, extracted references, notes, exports, and API keys are not committed.

### Paper provenance

Newly added papers retain a local `libraryEntry` record where possible. It records the method, time and relevant context used to bring the paper into the library, for example:

- direct Semantic Scholar DOI/arXiv/title lookup
- bounded Semantic Scholar references/citations expansion, including the parent paper
- BibTeX import and source filename
- Paper Map backup merge
- reviewed local Rust/WASM PDF extraction
- reviewed AI-assisted PDF extraction, including the selected provider/model/server transport
- bundled demo dataset

The paper detail drawer presents this information under **Added to library**. Older records without `libraryEntry` fall back to their existing `source`, `importedAt`, PDF-extraction and enrichment fields.

## Directed graph and research relationships

Citation links and semantic research relationships are intentionally different edge types.

A citation remains directed as `citing paper -> cited paper`. Research relationships are also directed but carry a canonical semantic type, so the same pair of papers may have a citation and, independently, a relationship such as `new paper -> old paper : improves_on`.

Current canonical research relationship types are:

- Builds on
- Improves on
- Extends
- Outperforms
- Invalidates
- Contradicts
- Supports
- Replicates

The paper drawer lets the user add or remove these explicit relationships. The graph draws citations with solid arrows and semantic research links with labeled dashed arrows. Inbound relationships use their inverse wording in the paper view (for example, **Outperformed by**).

Paper-node radius is a restrained logarithmic function of the provider citation-count snapshot, so highly cited papers are somewhat larger without dominating the map.

### Direct manipulation

- Drag the map background to pan.
- Use a mouse wheel/trackpad to zoom on desktop.
- Use two fingers to pinch zoom on touch/mobile.
- Click/tap a paper node to open its information drawer.
- Drag a paper node beyond the movement threshold to reposition it without opening the drawer.
- Drag topic blocks to reposition them for the current application session.
- Paper positions are cached across same-topology re-renders, so selecting or editing a paper does not restart the force layout.

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

Paper Map has an AI proxy configuration menu in the header and the same controls inside the PDF import dialog. The current presets are:

- **OpenAI** — direct browser upload to the configured `/responses` API using a PDF `input_file` and structured JSON schema output.
- **Ollama** — the existing Rust/WASM parser first extracts PDF text locally, then Paper Map sends that text to the configured OpenAI-compatible `/chat/completions` endpoint (default `http://localhost:11434/v1`).
- **OpenAI-compatible** — same local-text transport as Ollama, but with an arbitrary base URL and model for self-hosted or third-party compatible servers.

Provider, base URL and model are UI preferences stored in localStorage. API keys are never stored there or in IndexedDB: an entered key remains only in page memory by default, with an explicit option to retain it in sessionStorage for the current browser tab. Ollama does not require a key. Custom/Ollama servers must permit browser CORS access; when Paper Map is hosted on another origin, local Ollama may need an appropriate `OLLAMA_ORIGINS` configuration.

For OpenAI direct-PDF mode, the selected PDF is sent to the configured AI server. For Ollama/OpenAI-compatible text mode, the PDF itself remains local but the Rust-extracted document text is sent to the configured server. Very long extracted documents are bounded before transmission: Paper Map preserves the beginning and end and records a warning when the middle was omitted. Scanned PDFs still require OCR before text-mode AI analysis.

The AI result is always treated as a proposal. Title, authors, year, venue, type, DOI, arXiv ID, URL, abstract, keywords, proposed topics, confidence values, and warnings are shown in the same review dialog. The paper and accepted topics are written to IndexedDB only after **Save reviewed paper** is pressed. Saved provenance records the selected AI provider, model, base URL and transport mode.

## External scholarly data

Paper Map uses Semantic Scholar Academic Graph for on-demand paper enrichment, citation expansion, arXiv resolution, and DOI fallback resolution. Crossref is used for exact DOI metadata lookup during extracted-reference review. Both adapters normalize provider responses before the canonical metadata reaches persisted review provenance.

The provider layer remains replaceable: OpenAlex, DataCite, Zotero, additional AI transports, or additional reference-resolution adapters can be added without changing the core map renderer.

## Import paths

Current import paths are:

- Paper Map JSON backup / restore
- BibTeX
- DOI, arXiv ID, Semantic Scholar ID, or title through Semantic Scholar
- PDF through local Rust/WASM bibliography/citation extraction, with optional reviewed Crossref/Semantic Scholar identifier resolution
- PDF through optional reviewed AI-assisted metadata/topic extraction using the configured AI provider

The PDF itself is not stored in IndexedDB. Only user-reviewed paper data, accepted topics, accepted extracted-reference provenance, semantic research links and local library provenance are saved locally.
