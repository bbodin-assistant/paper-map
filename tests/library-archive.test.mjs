import test from "node:test";
import assert from "node:assert/strict";

import {
  assignArchiveKeys,
  createLibraryArchive,
  libraryToArchiveBibTeX,
  parseLibraryArchive,
} from "../www/library-archive.js";

const PDF_A = new Blob([new TextEncoder().encode("%PDF-1.4\narchive-a\n%%EOF\n")], { type: "application/pdf" });
const PDF_B = new Blob([new TextEncoder().encode("%PDF-1.4\narchive-b\n%%EOF\n")], { type: "application/pdf" });

function sampleLibrary() {
  return {
    schemaVersion: 1,
    papers: [
      {
        id: "doi:10.1000/alpha",
        citationKey: "Doe 2024 / Alpha",
        title: "Alpha {Paper}",
        authors: ["Jane Doe", "Alex Smith"],
        year: 2024,
        venue: "Example Journal",
        doi: "10.1000/alpha",
        topics: ["topic:systems"],
        tags: ["important"],
        notes: "Keep this exact note.",
        status: "reading",
        relevance: 5,
        starred: true,
        libraryEntry: { method: "reviewed-local-pdf", fileName: "alpha-original.pdf" },
        extractedReferences: [{ raw: "Reference One", accepted: true }],
      },
      {
        id: "paper:beta",
        citationKey: "Doe 2024 / Alpha",
        title: "Beta",
        authors: ["Jane Doe"],
        year: 2024,
        topics: [],
        tags: [],
        notes: "",
        status: "unread",
        relevance: 2,
        starred: false,
      },
    ],
    edges: [
      { id: "cite:a-b", source: "doi:10.1000/alpha", target: "paper:beta", kind: "citation", sourceType: "manual" },
      { id: "relation:b-a", source: "paper:beta", target: "doi:10.1000/alpha", kind: "research-relation", relation: "extends" },
    ],
    topics: [{ id: "topic:systems", name: "Systems", color: "#123456" }],
    meta: { importedFixture: true, nested: { value: 7 } },
  };
}

test("archive keys are filename-safe and unique", () => {
  const keys = assignArchiveKeys(sampleLibrary().papers).map(({ key }) => key);
  assert.deepEqual(keys, ["Doe-2024-Alpha", "Doe-2024-Alpha-2"]);
});

test("full database ZIP round-trips metadata, keyed BibTeX, and PDFs", async () => {
  const library = sampleLibrary();
  const pdfEntries = [
    {
      paperId: "doi:10.1000/alpha",
      blob: PDF_A,
      metadata: {
        name: "alpha-original.pdf",
        sourceFileName: "alpha-original.pdf",
        lastModified: 1234,
        storedAt: "2026-09-27T12:00:00.000Z",
      },
    },
    {
      paperId: "paper:beta",
      blob: PDF_B,
      metadata: { name: "beta.pdf" },
    },
  ];

  const { bibtex } = libraryToArchiveBibTeX(library, pdfEntries);
  assert.match(bibtex, /% PaperMap-Archive-Version: 1/);
  assert.match(bibtex, /@article\{Doe-2024-Alpha,/);
  assert.match(bibtex, /@article\{Doe-2024-Alpha-2,/);

  const zip = await createLibraryArchive(library, pdfEntries);
  assert.equal(zip.type, "application/zip");

  const restored = await parseLibraryArchive(await zip.arrayBuffer());
  assert.deepEqual(restored.library, library);
  assert.deepEqual(restored.keyedPapers.map(({ key }) => key), ["Doe-2024-Alpha", "Doe-2024-Alpha-2"]);
  assert.deepEqual(restored.pdfs.map((item) => item.archiveName), ["Doe-2024-Alpha.pdf", "Doe-2024-Alpha-2.pdf"]);
  assert.equal(await restored.pdfs[0].blob.text(), await PDF_A.text());
  assert.equal(await restored.pdfs[1].blob.text(), await PDF_B.text());
  assert.equal(restored.pdfs[0].metadata.sourceFileName, "alpha-original.pdf");
});
