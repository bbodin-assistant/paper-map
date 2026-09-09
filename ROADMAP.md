# Paper Map roadmap

## Product model

Paper Map is a private, local-first research atlas for one researcher. The map is the dominant surface; the bibliography list and paper editor support the map rather than replacing it.

The application has four related layers:

1. **Paper library** — canonical metadata, personal annotations, reading state, relevance, links, provider identifiers, library-entry provenance, and reviewed extraction provenance.
2. **Citation graph** — directed `citing paper -> cited paper` relationships, with on-demand expansion in either direction.
3. **Research-relation graph** — explicit directed semantic relationships such as `improves_on`, `outperforms`, `invalidates`, or `supports`, kept distinct from citation evidence.
4. **Thematic graph** — topic blocks connected when paper links bridge themes. Themes may come from provider metadata, predefined taxonomies, manual curation, or optional AI suggestions.

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
- reading state: unread / reading / read
- relevance score
- starred flag
- `libraryEntry` provenance describing how/when/context in which the paper entered the local library
- provider/source provenance and last-enriched timestamp
- reviewed local-PDF extraction provenance, including accepted raw references and layout/bibliography evidence
- optional canonical resolution for each reviewed reference, including provider, identifier match type, confidence, canonical metadata and provider-attempt provenance

### Citation edge

A citation edge is directed: `citingPaperId -> citedPaperId`. It stores provenance and may be confirmed by an external provider or added manually.

A raw bibliography entry is not yet a citation edge. It becomes eligible for an edge only after identifier/provider resolution identifies a canonical target paper and that canonical paper is explicitly imported into the local library.

### Research-relation edge

A semantic research relationship is also directed but is a separate edge type from citation evidence. Current canonical types are:

- `builds_on`
- `improves_on`
- `extends`
- `outperforms`
- `invalidates`
- `contradicts`
- `supports`
- `replicates`

The same pair of papers may have both a citation edge and one or more semantic research relationships. Each semantic edge stores its relation type and provenance.

### Topic

A topic has a stable ID, name, optional parent/taxonomy path, source (`manual`, `provider`, `ai`, `taxonomy`), optional description, and optional aliases.

Topic connections aggregate directed paper links crossing topic boundaries. Later versions may add semantic similarity and manually asserted topic-to-topic relationships.

## V1 user experience

### Primary screen

- Sticky application header with library status, search, map mode, import/export, demo data, and About.
- Compact filter/library drawers that close when the user clicks or taps elsewhere.
- Large central SVG map occupying most of the viewport.
- Citation / Topic segmented mode switch.
- Right-side non-modal paper detail drawer opened by selecting a paper node.
- Optional bibliography drawer/list for scanning the current filtered set.

### Citation map

- Paper nodes sized modestly by citation-count snapshot and visually marked when starred.
- Directed citation links with arrowheads that terminate at node boundaries.
- Directed semantic research relationships rendered separately with labels.
- Selection highlights immediate linked papers without restarting/resetting the graph layout.
- Background drag pans the map.
- Mouse wheel/trackpad zoom on desktop.
- Two-finger pinch zoom on touch/mobile.
- Paper nodes may be dragged and pinned for the current application session.
- Search/filter changes alter the visible graph.
- Selected paper offers `Expand references` and `Expand citations` actions.
- Expansion is bounded per request and can be repeated to go farther.

### Topic map

- One block per theme rather than one node per paper.
- Block size reflects number of papers in the filtered library.
- Connections preserve direction from the underlying paper links.
- Topic blocks can be dragged for the current application session.
- Clicking a block filters/highlights its papers.
- Topic blocks expose source/provenance so manual, provider, taxonomy and AI themes can coexist.

### Paper drawer

Actions/information:

- star / unstar
- edit notes
- edit tags
- edit primary topic
- edit reading state: unread / reading / read
- edit relevance independently from reading state
- add/remove canonical directed research relationships
- inspect inbound/outbound semantic relationships with inverse wording
- inspect how the paper was added to the local library
- copy formatted citation
- copy BibTeX
- open DOI / source / PDF when available
- expand references
- expand citing papers
- remove paper from local library

## Import and enrichment

### Implemented V1/V1.1 paths

1. Paper Map JSON backup/restore.
2. BibTeX import.
3. DOI/title enrichment through a provider adapter.
4. Semantic Scholar on-demand references/citations.
5. Bundled demo dataset.
6. Reviewed AI-assisted PDF metadata/topic extraction.
7. Deterministic local Rust/WASM PDF citation extraction:
   - parse PDF text/layout from in-memory bytes
   - detect explicit bibliography headings
   - conservative late-document fallback when no heading is found
   - segment numbered and author/year references
   - extract DOI, modern/legacy arXiv IDs, year, confidence and page provenance
   - accept/reject each extracted reference before persistence
8. Reviewed exact-identifier reference resolution:
   - exact DOI lookup through Crossref
   - exact Semantic Scholar DOI fallback when Crossref has no record
   - exact arXiv lookup through Semantic Scholar using a canonical version-free identifier
   - canonical title/authors/year/venue/type/URL/provider IDs normalized into a stable reference-resolution object
   - provider, attempts and match-confidence shown in the existing review UI
   - resolution persists only for references that remain accepted when the paper is saved
9. Directed graph interaction/research workflow:
   - canonical semantic research-relation vocabulary
   - directed visible citation/research arrows
   - modest citation-count node sizing
   - stable node positions across paper selection/edit re-renders
   - direct node/topic dragging
   - mobile two-finger pinch zoom
   - reading-only state model (`unread`, `reading`, `read`)
   - paper library-entry provenance in the detail drawer
   - outside-click dismissal for Filters/Library panels

### Next citation-import milestone

- Resolve identifier-less references by conservative provider matching on parsed title/author/year.
- Show multiple/ambiguous candidates in a dedicated resolver review queue rather than selecting silently.
- Add an explicit action to import accepted canonical reference records into the local paper library.
- Create `source paper -> resolved reference` citation edges only when the canonical target paper exists locally and the user confirms the operation.
- Batch resolution with explicit rate limiting, cancellation and retry state.
- Preserve the exact raw bibliography text and resolver evidence when a canonical paper is imported.

### Later research-relation work

- provider/AI-assisted proposals for `improves_on`, `outperforms`, `invalidates`, etc., always reviewed before persistence
- evidence notes/quotes/sections for a semantic relation
- confidence/provenance for inferred relation proposals
- filtering/styling graph links by relation type
- relation-specific legend and comparison workflows

### Later PDF ingestion

- first-page/embedded metadata extraction for source-paper title/authors/DOI/arXiv
- better two-column and hanging-indent bibliography segmentation using word coordinates
- in-text citation markers mapped to bibliography entries
- OCR path for scanned/image-only PDFs
- optional user-configured AI adapter for metadata cleanup, abstract summarisation, taxonomy suggestions, tags and thematic links
- all AI suggestions remain reviewed before becoming canonical local data

## Data ownership and portability

- IndexedDB is the canonical live database.
- No personal bibliography, PDFs, extracted references, notes, semantic relations, provenance, or API keys are committed to GitHub.
- One-click full JSON backup contains papers, directed links, topics, annotations and settings needed to reconstruct the atlas.
- Import uses schema versioning and migrations.
- A demo dataset lives in source control and is loaded explicitly.
- Generated WASM output is a build artifact, not source-controlled data.
- Rust/WASM extraction is network-free; DOI/arXiv resolution is a separate explicit browser network action.

## Provider strategy

The core application depends only on small provider/resolver boundaries:

```text
resolvePaper(query)
enrichPaper(paper)
fetchReferences(paper, cursor, limit)
fetchCitations(paper, cursor, limit)
resolveExtractedReference(reference)
```

Initial paper adapter: Semantic Scholar Academic Graph.

Exact-reference resolver: Crossref for DOI first, Semantic Scholar for arXiv and DOI fallback.

Future adapters: OpenAlex, DataCite, Zotero, local files and optional AI services.

Provider results are normalized before entering IndexedDB. This prevents external API schemas from leaking into the UI and makes provenance explicit.

The Rust/WASM PDF extractor is not a provider: it performs no network access and returns local evidence that may later be passed to a resolver provider.

## Performance strategy

### Current

- Plain browser ES modules.
- IndexedDB for persistent structured data.
- SVG for graph rendering.
- Lightweight force simulation written in JavaScript for the initial graph sizes.
- Graph positions cached across same-topology re-renders so selection/edit actions do not restart layout.
- Pointer-event based pan, item drag and multi-touch pinch interaction.
- Bounded expansion requests.
- Rust/WebAssembly for deterministic PDF parsing, an isolated CPU-heavy local task with a stable input/output boundary.
- Identifier resolution runs sequentially in the review UI to avoid accidental request bursts against public scholarly APIs.

### Scale trigger

Move graph indexing/layout work into a Web Worker when the local graph grows large enough to affect interaction. Keep Rust/WASM focused on measured computation-heavy boundaries; do not migrate ordinary UI/provider/storage code for architectural symmetry.

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

- direct graph manipulation and mobile pinch zoom
- directed semantic paper relationships
- richer non-modal paper drawer and import provenance
- stronger bibliography list
- comparison selection
- filtered BibTeX export
- saved filter/view presets
- richer taxonomy editor
- batch enrichment

### Phase 4 — assisted/systematic ingestion

- reviewed AI adapter
- deterministic Rust/WASM bibliography/citation extractor
- extracted-reference review and persistence
- exact DOI/arXiv canonical reference resolver with match confidence
- canonical reference import and citation-edge creation
- identifier-less reference matching
- source-paper metadata extraction
- optional OCR and in-text citation mapping

## Acceptance criteria

- Reloading the page restores the same local library and annotations.
- Exporting then importing a database reconstructs papers, directed links and topics.
- Demo mode produces a usable citation and topic map without network access.
- Selecting a paper preserves the current graph layout and opens a non-modal detail drawer.
- Citation/research edges visibly communicate direction.
- Higher-citation papers are only modestly larger than lower-citation papers.
- Mobile users can pinch zoom and users can drag graph items to rearrange them.
- Filters and Library panels close when interaction moves elsewhere.
- Reading state contains no importance/key-paper category.
- A paper exposes available information about how it entered the local library.
- Local PDF extraction can complete without network access.
- Exact DOI/arXiv resolver results display provider and confidence before persistence, and unresolved references remain raw rather than becoming fabricated canonical papers.
