# Paper Map Archive Format

This document is the normative specification for the Paper Map full-database ZIP backup format.

The current archive format version is **1**. The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as normative requirements.

## Archive layout

A Paper Map full-database archive MUST be a ZIP file with this root-level layout:

```text
library.bib
<citation-key>.pdf
<citation-key>.pdf
...
```

- `library.bib` MUST exist at the archive root.
- PDF entries are optional.
- PDF entries MUST also be at the archive root and MUST use the corresponding citation key as their filename.
- Writers currently emit ZIP entries using the ZIP `STORE` method.
- Readers SHOULD accept standard ZIP `STORE` and `DEFLATE` entries.
- Encrypted ZIP entries are not supported.

## `library.bib`

`library.bib` MUST be valid, human-readable BibTeX and MUST contain one BibTeX entry for each archived paper.

A full-database archive MUST also include Paper Map metadata comments of the form:

```text
% Paper Map full database archive
% PaperMap-Archive-Version: 1
% PaperMap-Metadata: <base64url-data>
% PaperMap-Metadata: <base64url-data>
...
```

The `PaperMap-Metadata` values MUST be concatenated in file order, decoded as Base64URL, decoded as UTF-8, and parsed as JSON.

Writers SHOULD split the encoded metadata into comment lines containing no more than 120 encoded characters.

For archive version 1, the decoded payload has this structure:

```json
{
  "archiveVersion": 1,
  "schemaVersion": 1,
  "exportedAt": "2026-09-28T00:00:00.000Z",
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

The metadata payload is the lossless Paper Map representation. It MUST contain the complete paper records and the database collections needed to restore the library, including directed edges, topics, annotations and notes stored on records, provenance, and database metadata.

PDF binary data MUST NOT be embedded in the metadata payload. It is stored only in the corresponding `.pdf` ZIP entry.

Each `papers[].key` MUST match the citation key of a visible BibTeX entry in `library.bib`.

## Citation keys and PDF filenames

Archive citation keys MUST be safe as root-level filenames.

Version 1 citation keys:

- MUST contain only ASCII letters, digits, `.`, `_`, and `-`.
- MUST NOT begin or end with `.` or `-`.
- MUST be at most 80 characters.
- MUST be unique within the archive using a case-insensitive comparison.

Writers SHOULD preserve an existing citation key when it already satisfies these rules. Otherwise they MUST derive a safe key. Invalid character runs are normalized to `-`, and collisions MUST be resolved deterministically with suffixes such as `-2`, `-3`, and so on.

A stored PDF for citation key `Smith-2026-Example` MUST be named:

```text
Smith-2026-Example.pdf
```

A PDF filename MUST correspond to a known paper citation key. Attachment metadata MAY preserve additional properties such as the original filename, modification time, or storage timestamp.

## Validation

A version-1 reader MUST reject an archive when any of the following applies:

- `library.bib` is missing.
- `PaperMap-Archive-Version` is missing or unsupported.
- `PaperMap-Metadata` is missing, cannot be decoded, or is not valid JSON.
- The decoded `archiveVersion` is unsupported or does not match version 1.
- Required database collections are missing or have invalid basic types.
- A paper has an invalid citation key.
- Citation keys are duplicated case-insensitively.
- A metadata paper key has no matching BibTeX entry.
- A PDF filename does not correspond to a known citation key.
- A purported PDF does not begin with a valid PDF signature.
- ZIP entry integrity checks, including size or CRC checks, fail.
- The archive uses encryption or an unsupported compression method.

Readers MUST NOT silently reinterpret an unsupported archive version.

## Versioning

`PaperMap-Archive-Version` and the decoded `archiveVersion` identify the archive format.

`schemaVersion` identifies the Paper Map database schema stored inside the archive and is independent of the archive format version.

A change that makes the archive structure or metadata encoding incompatible with version-1 readers MUST increment the archive version.

Compatible additions to the metadata payload MAY be made without incrementing the archive version. Readers SHOULD tolerate unknown additional metadata fields.

## Compatibility

A conforming full-database backup MUST contain enough local data to restore the archived Paper Map library without access to an external service.

The visible BibTeX entries make `library.bib` useful to ordinary BibTeX software. Such software is not expected to understand or preserve Paper Map metadata comments.

For a full-database restore, Paper Map readers MUST use the embedded metadata payload rather than reconstructing the database solely from visible BibTeX fields.

A BibTeX file without the Paper Map archive-version and metadata comments is an ordinary BibTeX import, not a Paper Map full-database backup.

## ZIP32 limits

Archive format version 1 uses **ZIP32**, not ZIP64.

ZIP32 represents entry sizes and archive offsets with 32-bit values. Individual entries, relevant offsets, and central-directory values therefore cannot exceed `0xffffffff` bytes, and the practical maximum complete archive size is approximately **4 GiB**.

ZIP64 archives are not supported by the current format.
