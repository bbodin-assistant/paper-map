# Paper Map Archive Format

This document is the normative specification for the Paper Map full-database ZIP backup format.

The current archive format version is **2**. The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

## Archive layout

A version-2 Paper Map full-database archive MUST be a ZIP file with this root-level layout:

```text
library.bib
metadata.json
<citation-key>.pdf
<citation-key>.pdf
...
```

- `library.bib` MUST exist at the archive root.
- `metadata.json` MUST exist at the archive root.
- PDF entries are optional and MUST be stored at the archive root.
- Writers currently emit ZIP entries using the ZIP `STORE` method.
- Readers SHOULD accept standard ZIP `STORE` and `DEFLATE` entries.
- Encrypted ZIP entries are not supported.

## `library.bib`

`library.bib` MUST be valid, human-readable BibTeX and MUST contain one keyed BibTeX entry for each archived paper.

Version-2 writers MUST store Paper Map's lossless application metadata in `metadata.json`, not in BibTeX metadata comments. This keeps `library.bib` directly reusable by ordinary BibTeX software.

Each paper key in `metadata.json` MUST match a citation key in `library.bib`.

## `metadata.json`

`metadata.json` MUST be UTF-8 JSON. For archive version 2 it has this structure:

```json
{
  "archiveVersion": 2,
  "schemaVersion": 1,
  "exportedAt": "2026-09-29T00:00:00.000Z",
  "papers": [
    {
      "key": "Smith-2026-Example",
      "paper": {}
    }
  ],
  "edges": [],
  "topics": [],
  "meta": {},
  "attachments": [
    {
      "key": "Smith-2026-Example",
      "paperId": "paper-id",
      "metadata": {}
    }
  ]
}
```

The JSON payload is the lossless Paper Map representation. It MUST contain the complete paper records and database collections required to restore the library, including directed citation/research edges, topics, annotations and notes stored on records, provenance, and database metadata.

PDF binary data MUST NOT be embedded in `metadata.json`. PDF bytes are stored only in the corresponding `.pdf` ZIP entry.

The `attachments` array MAY preserve additional PDF metadata such as the original filename, modification time, or storage timestamp.

## Citation keys and PDF filenames

Archive citation keys MUST be safe as root-level filenames.

Version-2 citation keys:

- MUST contain only ASCII letters, digits, `.`, `_`, and `-`.
- MUST NOT begin or end with `.` or `-`.
- MUST be at most 80 characters.
- MUST be unique within the archive using a case-insensitive comparison.

Writers SHOULD preserve an existing citation key when it already satisfies these rules. Otherwise they MUST derive a safe key. Invalid character runs are normalized to `-`, and collisions MUST be resolved deterministically with suffixes such as `-2`, `-3`, and so on.

A stored PDF for citation key `Smith-2026-Example` MUST be named:

```text
Smith-2026-Example.pdf
```

A PDF filename MUST correspond to a paper citation key present in both `metadata.json` and `library.bib`.

## Validation

A version-2 reader MUST reject an archive when any of the following applies:

- `library.bib` is missing.
- `metadata.json` is missing, except when reading a supported legacy version-1 archive.
- `metadata.json` cannot be decoded as UTF-8 JSON.
- `archiveVersion` is missing or unsupported.
- Required database collections are missing or have invalid basic types.
- A paper has an invalid citation key.
- Citation keys are duplicated case-insensitively.
- A metadata paper key has no matching BibTeX entry.
- A PDF filename does not correspond to a known citation key.
- A purported PDF does not begin with a valid PDF signature.
- ZIP entry integrity checks, including size or CRC checks, fail.
- The archive uses encryption or an unsupported compression method.

If `metadata.json` is present, it is authoritative. Readers MUST NOT silently fall back to legacy BibTeX metadata when a present version-2 metadata file is malformed.

## Versioning

`archiveVersion` in `metadata.json` identifies the archive format.

`schemaVersion` identifies the Paper Map database schema stored inside the archive and is independent of the archive format version.

A change that makes the archive structure or metadata encoding incompatible with version-2 readers MUST increment the archive version.

Compatible additions to the JSON payload MAY be made without incrementing the archive version. Readers SHOULD tolerate unknown additional JSON properties.

## Compatibility

Version-2 writers MUST emit `library.bib` and `metadata.json`.

Paper Map readers SHOULD remain able to import version-1 archives. Version 1 stored:

```text
library.bib
<citation-key>.pdf
...
```

and embedded the lossless payload in `% PaperMap-Metadata:` comments inside `library.bib`, with `% PaperMap-Archive-Version: 1`.

A reader MAY treat those comments as the metadata source only when `metadata.json` is absent and the archive explicitly identifies itself as version 1.

A conforming full-database backup MUST contain enough local data to restore the archived Paper Map library without access to an external service.

## ZIP32 limits

Archive format version 2 uses **ZIP32**, not ZIP64.

ZIP32 represents entry sizes and archive offsets with 32-bit values. Individual entries, relevant offsets, and central-directory values therefore cannot exceed `0xffffffff` bytes, and the practical maximum complete archive size is approximately **4 GiB**.

ZIP64 archives are not supported by the current format.
