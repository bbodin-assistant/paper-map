# Mixed event-time-triggered report reference papers

These PDFs are references in
[`mixed-event-time-triggered.bib`](../../reports/mixed-event-time-triggered/mixed-event-time-triggered.bib).
Filenames use bibliography citation keys. Downloaded PDFs were checked for the PDF file signature.

## Collected in this report folder

```text
Barzegaran2022 Berisa2022 Casini2019 Finzi2024 Finzi2026 Gala2023 Geilen2019
Giannopoulou2018 Gleizer2020 Guenzel2023 Heemels2013a Heemels2013b Hertneck2020
Mallet2008 Meroni2023 NguyenVan2020 Obi2024 Pop2003b Selivanov2016 Skelin2017
Wang2020 Wang2021 Yamazaki2022 Yano2023b Zhao2022ETSN
```

The full bibliography has 78 entries. A matching PDF is in the archive for 31 entries: these 25
report-folder PDFs plus six matches stored with another report. One direct retrieval failure remains;
four additional DOI-indexed PDF candidates did not produce a verified download.

See the [complete six-report reference inventory](../REFERENCE_STATUS.csv) for each citation key,
source link, PDF path, retrieval status, candidate PDF URL, and suggested path for manual additions.
In particular, `Pop2003c` is the strongest manual follow-up: DIVA lists the thesis PDF, but repeated
downloads timed out. `Mallet2008` was recovered from HAL after its original host's TLS certificate
expired.

Run `python scripts/export_paper_map.py` from the repository root to build the combined Paper Map
archive at `output/report-bibliographies-paper-map-with-citations.zip`. The exporter also writes a
Paper Map format-version-1 JSON sidecar beside every local PDF. It reads publisher-deposited reference
lists from Crossref by DOI, or verifies a title search against title, first author, and year. Sidecars
retain each deposited reference record; graph edges are created when a cited DOI or exact title match
identifies an entry in the combined report library. Crossref data is incomplete for some works. If it
has no reference list for a PDF, the exporter tries Paper Map's Rust PDF parser when Cargo is installed,
then uses PyMuPDF to preserve local reference strings and marks heuristic matches as partial.
