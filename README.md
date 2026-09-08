# Paper Map

Paper Map is a local-first research bibliography explorer. It keeps the user's library in the browser, renders citation and thematic maps as the primary interface, and can expand the graph from public scholarly APIs on demand.

The application is designed for static hosting. There is no application backend and no bibliography data is uploaded to GitHub unless it is part of the bundled demo dataset.

## V1 goals

- Store papers, citation edges, annotations, tags, topics, and UI state locally in IndexedDB.
- Import and export a portable Paper Map JSON database.
- Import BibTeX and enrich papers from Semantic Scholar when identifiers are available.
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
  demo-data.js            Bundled demo library
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

## Local data

The live library is stored in IndexedDB under `paper-map-v1`. Browser data can be downloaded as a JSON backup and restored later. Clearing browser site data removes the local library, so regular exports are recommended for important collections.

The repository's demo records are source-controlled only to make the application immediately testable.

## External scholarly data

V1 uses the Semantic Scholar Academic Graph API through an isolated provider module. Expansion is initiated by the user from a selected paper. Provider identifiers are retained so subsequent expansion can reuse the same scholarly record.

The provider layer is intentionally replaceable: OpenAlex, Crossref, Zotero, local AI-assisted PDF extraction, or another source can be added without changing the core database schema or map renderer.

## Planned import paths

V1 supports Paper Map JSON and BibTeX. The data model is already structured for later PDF/AI ingestion, where a local or user-configured AI adapter can extract bibliographic metadata and propose tags/topics before the user accepts them.
