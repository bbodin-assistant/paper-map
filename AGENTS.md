# Agent Guide

## Project map

- This is a browser-only static application. There is no application server and no framework build step in V1.
- Edit browser files in `www/`.
- `www/app.js` owns top-level application state and orchestration.
- `www/db.js` owns IndexedDB schema, migrations and persistence.
- `www/graph.js` owns citation/topic graph rendering, pan/zoom and selection callbacks.
- `www/import-export.js` owns portable JSON and BibTeX parsing/serialization.
- `www/semantic-scholar.js` is an external-provider adapter; provider response shapes must be normalized before they reach the rest of the app.
- `www/demo-data.js` is the only bibliography data intended to be committed to the repository.
- `www/style.css` owns the visual system and responsive layout.

## Data ownership rules

- The user's live bibliography belongs in IndexedDB, never in repository files.
- Do not add user-provided papers, notes, PDFs, exports or API keys to source control.
- Full database export must be schema-versioned and sufficient to restore papers, citation edges, topics and annotations.
- UI preferences may use localStorage, but canonical research data may not.
- Destructive database replacement must require an explicit user action in the UI.

## Paper identity and duplicate rules

Use identifiers in this priority order when merging provider/import records:

1. DOI after lowercase/URL-prefix normalization.
2. Semantic Scholar paper ID.
3. arXiv identifier.
4. normalized title + publication year as a conservative fallback.

Never merge two papers solely because author lists overlap.

## Citation semantics

- Citation edges are directed: `source` cites `target`.
- Expanding references for paper A adds edges `A -> reference`.
- Expanding citations for paper A adds edges `citingPaper -> A`.
- Expansion is user-triggered and bounded. Never recursively crawl the graph without another explicit action.
- Preserve provenance on imported/provider citation edges.

## Topic semantics

- `topics` are research themes and may come from manual curation, provider metadata, taxonomy mapping or future AI suggestions.
- `tags` are personal labels and are not automatically treated as canonical themes unless the UI explicitly promotes them.
- The topic map aggregates papers into thematic blocks and derives connections from citation edges crossing topic boundaries.
- Future semantic/AI topic connections should be stored with a source rather than silently replacing citation-derived relationships.

## Provider rules

- Keep network-specific code inside provider modules.
- Assume rate limits and transient failures.
- Prefer pagination/batching and bounded fields.
- Never store a private provider key in source code. If a future provider needs a key, it must be entered by the user and stored only locally.
- Normalize external IDs, authors, dates, URLs and citation counts before persistence.
- Provider failures must not roll back or corrupt the existing local library.

## UI rules

- The map is the dominant surface. Do not turn the default screen into a table-first bibliography manager.
- Keep the visual language close to Train Route Explorer: compact sticky controls, restrained colors, paper-like surfaces, dense but legible information, and purpose-specific drawers.
- Citation and Topic are peer map modes.
- Selecting a paper opens one detail drawer; do not create multiple modal layers for routine paper actions.
- Search/filter interactions should update the map immediately without a manual Apply button unless a future expensive operation requires it.
- Preserve keyboard-operable controls and useful aria labels.

## Performance rules

- V1 graph layout is intentionally lightweight JavaScript.
- Keep external expansion bounded and avoid loading thousands of nodes accidentally.
- When graph size starts affecting interaction, first move indexing/layout into a Web Worker.
- Add Rust/WebAssembly only after profiling identifies a stable computational bottleneck; do not introduce it for architectural symmetry alone.

## Validation sequence

At minimum after browser code changes:

```bash
node --check www/app.js
node --check www/db.js
node --check www/graph.js
node --check www/import-export.js
node --check www/semantic-scholar.js
```

Also run `git diff --check` and a browser smoke test when the environment permits it.
