# Paper Map roadmap

## Product model

Paper Map is a private, local-first research atlas for one researcher. The map is the dominant surface; the bibliography list and paper editor support the map rather than replacing it.

The application has three related layers:

1. **Paper library** — canonical metadata, personal annotations, tags, status, relevance, links, and provider identifiers.
2. **Citation graph** — directed paper-to-paper relationships, with on-demand expansion in either direction.
3. **Thematic graph** — topic blocks connected when papers/citations bridge themes. Themes may come from provider metadata, predefined taxonomies, manual curation, or later AI suggestions.

## V1 information model

### Paper

Each paper can contain:

- local stable ID
- external IDs: DOI, Semantic Scholar ID, arXiv ID, OpenAlex ID when available
- title
- authors
- year / publication date
- venue
- publication type
- URL / DOI URL / PDF URL
- abstract
- keywords
- topics
- manual tags
- citation count snapshot
- personal notes
- reading state: unread / reading / read / key
- relevance score
- starred flag
- import provenance and last-enriched timestamp

### Citation edge

A directed edge stores `citingPaperId -> citedPaperId`, provenance, and whether the edge is confirmed by an external provider or manually entered.

### Topic

A topic has a stable ID, name, optional parent/taxonomy path, source (`manual`, `provider`, `ai`, `taxonomy`), optional description, and optional aliases.

Topic connections are derived initially from cross-topic citation edges. Later versions may add semantic similarity and manually asserted topic-to-topic relationships.

## V1 user experience

### Primary screen

- Sticky application header with library status, search, map mode, import/export, demo data, and About.
- Compact filter bar/drawer for year, authors, venue, type, tags/topics, and starred papers.
- Large central SVG map occupying most of the viewport.
- Citation / Topic segmented mode switch.
- Right-side paper detail drawer opened by selecting a paper node.
- Optional bibliography drawer/list for scanning the current filtered set.

### Citation map

- Paper nodes sized modestly by citation count and visually marked when starred.
- Directed citation links.
- Selection highlights immediate references/citations.
- Pan and zoom.
- Search/filter changes dim or hide non-matching nodes.
- Selected paper offers `Expand references` and `Expand citations` actions.
- Expansion is bounded per request and can be repeated to go farther.

### Topic map

- One block per theme rather than one node per paper.
- Block size reflects number of papers in the filtered library.
- Connections reflect cross-topic citation traffic.
- Clicking a block filters/highlights its papers.
- Topic blocks expose source/provenance so manual, provider, taxonomy and future AI themes can coexist.

### Paper drawer

Actions:

- star / unstar
- edit notes
- edit tags
- edit primary topic
- edit reading state and relevance
- copy formatted citation
- copy BibTeX
- open DOI / source / PDF when available
- expand references
- expand citing papers
- remove paper from local library

## Import and enrichment

### V1

1. Paper Map JSON backup/restore.
2. BibTeX import.
3. DOI/title enrichment through a provider adapter.
4. Semantic Scholar on-demand references/citations.
5. Bundled demo dataset.

### V1.1

- arXiv identifier/URL import.
- drag/drop DOI and bibliographic text.
- better duplicate resolution across DOI, provider ID, title/year.
- batch enrichment queue with explicit rate limiting.

### V1.2 — PDF and AI-assisted ingestion

- local PDF text/metadata extraction.
- detect title/authors/DOI/arXiv from first pages and embedded metadata.
- optional user-configured AI adapter for metadata cleanup, abstract summarisation, taxonomy suggestions, tags and thematic links.
- all AI suggestions enter a review queue before becoming canonical local data.

## Data ownership and portability

- IndexedDB is the canonical live database.
- No personal bibliography is committed to GitHub.
- One-click full JSON backup contains papers, citations, topics, annotations and settings needed to reconstruct the atlas.
- Import uses schema versioning and migrations.
- A demo dataset lives in source control and is loaded explicitly.

## Provider strategy

The core application depends only on a small provider interface:

```text
resolvePaper(query)
enrichPaper(paper)
fetchReferences(paper, cursor, limit)
fetchCitations(paper, cursor, limit)
```

Initial adapter: Semantic Scholar Academic Graph.

Future adapters: OpenAlex, Crossref, arXiv, Zotero, local files and optional AI services.

Provider results are normalized before entering IndexedDB. This prevents external API schemas from leaking into the UI and makes provenance explicit.

## Performance strategy

### V1

- Plain browser ES modules.
- IndexedDB for persistent structured data.
- SVG for graph rendering.
- Lightweight force simulation written in JavaScript for the initial graph sizes.
- Bounded expansion requests.

### Scale trigger

Move graph indexing/layout work into a Web Worker when the local graph grows large enough to affect interaction. Introduce Rust/WebAssembly only after profiling shows a concrete bottleneck; keep the UI/provider/storage contracts unchanged.

## Delivery phases

### Phase 1 — working atlas shell

- data schema and IndexedDB
- demo dataset
- import/export
- citation map
- topic map
- paper drawer
- basic filters

### Phase 2 — scholarly expansion

- provider adapter
- resolve/enrich by DOI or provider ID
- references/citations expansion
- duplicate merging
- progress/error status

### Phase 3 — research workflow

- stronger bibliography list
- comparison selection
- filtered BibTeX export
- saved filter/view presets
- richer taxonomy editor
- batch enrichment

### Phase 4 — assisted ingestion

- PDF parser
- AI adapter contract
- metadata/tag/topic suggestion review queue
- thematic-link suggestions

## V1 acceptance criteria

- Reloading the page restores the same local library and annotations.
- Exporting then importing a database reconstructs papers, citations and topics.
- Demo mode produces a usable citation and topic map without network access.
- Selecting any paper opens a detail drawer and permits local annotation edits.
- Search plus year/author/venue/type/topic/star filters alter the visible map.
- Citation expansion never happens recursively without an explicit user action.
- A provider failure leaves the existing local library intact and reports the error.
- No private research data is required at build or deployment time.
