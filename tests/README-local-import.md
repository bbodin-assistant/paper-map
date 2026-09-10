# Local PDF import quality benchmark

Run `make test-papers-local-import TEST_URL=http://127.0.0.1:8080/www/` with the
app already served at that URL. The browser selects all PDFs through **Add PDFs**
and measures the actual review fields and individual reference rows produced by
the generated WASM package. No extraction results are mocked.

Rubric **v2** deliberately replaces v1's first-author substring and nonempty
bibliography checks. Its percentages are **not comparable to v1's 97.1%**.
The v2 JSON report and screenshot use `test-papers-local-import-score-v2`
filenames under `artifacts/mobile-ui/`, preserving the old JSON report.

| Component | Weight | What earns credit |
| --- | ---: | --- |
| Title | 20 | A complete, explicitly allowed title after case, accent and punctuation normalization |
| Authors | 25 | 80% full-name precision/recall F1, 20% coverage of the printed author order |
| Year | 10 | Exact publication year |
| Source DOI | 10 | Exact DOI, ignoring case and DOI URL prefixes; omitted from the denominator when unspecified |
| References | 35 | 90% reference-text precision/recall F1, 10% matching page provenance coverage |

Each PDF is normalized to 100 points and receives equal weight. An extraction
error receives zero even if fallback fields resemble the expected metadata.
`TEST_PAPERS_MIN_SCORE=80` enables an optional regression gate; the report is
written before that gate is checked. The default remains a diagnostic benchmark.
`TEST_PAPERS_FILES=Becker2017.pdf,Martinez2020.pdf` selects a subset.

## Bounded flexibility

Use `titles` in the corpus entry to list justified alternatives, for example a
printed subtitle versus the main title alone. StreamBlocks/Stream Blocks is an
explicit spelling alternative. We do not allow arbitrary substring matches,
automatic subtitle removal, or fuzzy title similarity. Extra author names
appended to a title still fail.

`authors` is the complete ordered list, one contributor per entry. An individual
entry may contain an explicit list of equivalent spellings, such as a documented
initials variant. Missing names, duplicates, affiliations, invented names, lost
name boundaries, and reordered contributors lose credit. The proceedings cover
is marked `contributor_role: editors`; its credited editors are checked in the
existing contributor input rather than treating chapter authors as book authors.

## Independent reference expectations

The private file `test_papers/expected_local_import.json` contains all **752
reference occurrences** across the current 21 PDFs, including all nine
bibliographies in the proceedings volume. It lives beside the PDFs and is ignored
by Git. Copy it along with the corpus when moving the test to another machine.
`TEST_PAPERS_EXPECTATIONS=/path/to/expected_local_import.json` overrides its path.

The initial reference transcription comes from independent Poppler
`pdftotext -bbox-layout` output, with physical bibliography page ranges, printed
number sequences, column boundaries and final entries checked against that
output. It is not a snapshot of the application's extraction. As with any
transcription, ambiguous glyphs may need further checking against the rendered
PDF; the comparison tolerates small text differences.

The schema is:

```json
{
  "schemaVersion": 1,
  "source": "How the independent transcription was prepared and reviewed",
  "papers": {
    "example.pdf": {
      "sha256": "SHA-256 of the exact PDF bytes",
      "references": [
        {
          "id": "1:1",
          "pageStart": 8,
          "pageEnd": 9,
          "text": "Complete printed citation, including authors, title and publication details."
        }
      ]
    }
  }
}
```

Page numbers are **physical PDF pages**, starting at 1. IDs identify section and
printed reference number (or ordinal for unnumbered bibliographies). Repeated
citations in different chapters remain separate occurrences. Hash mismatches,
missing expectations, empty lists, duplicate IDs, and invalid page ranges stop
the benchmark; it never silently generates a passing baseline.

To add or replace a PDF, transcribe its full contributor list and all reference
sections independently, review the entries and page ranges, then record the
new hash. Do not copy `actual` fields from the benchmark into the expectations.

## Reference matching and diagnostics

Reference text is compared using five-character shingles after Unicode, case,
punctuation and spacing normalization. This tolerates PDF line wrapping and
joined words while retaining substantive content. Candidate pairs require a
text F1 of at least 0.70. Best-first one-to-one matching means one merged row
cannot satisfy two expected references, and duplicates consume precision.

Precision measures how much returned text belongs to expected entries; recall
measures how much expected text was recovered. Unmatched entries count as zero.
Missing, extra, split, merged, truncated and prose-contaminated entries therefore
lose credit even when the row count looks correct. Reference order is ignored.
`references_complete` requires a one-to-one match for every occurrence, no extra
rows, at least 90% text precision **and** recall for every pair, and overlapping
page provenance. This is a tolerant completeness check, not proof of every
character or every structured DOI being correct.

The JSON includes missing reference IDs, unexpected row indices, per-pair text
precision/recall, page matches, actual reference text, and missing/extra authors.
Inspect these before modifying the extractor or the expectations.

Run the synthetic rubric regression tests with
`python3 -m unittest discover -s tests -p 'local_import_scoring_test.py'`.
They check both accepted layout variations and rejected omissions, duplicates,
wrong titles, merged citations, truncated text and author-list errors.
