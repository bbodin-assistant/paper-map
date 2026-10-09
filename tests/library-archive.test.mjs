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

const LEGACY_V1_ARCHIVE_BASE64 =
  "UEsDBBQAAAAAALopPV0Hl+1IcwIAAHMCAAALAAAAbGlicmFyeS5iaWIlIFBhcGVyIE1hcCBmdWxsIGRhdGFiYXNlIGFyY2hpdmUKJSBQYXBlck1hcC1BcmNoaXZlLVZlcnNpb246IDEKJSBQYXBlck1hcC1NZXRhZGF0YTogZXlKaGNtTm9hWFpsVm1WeWMybHZiaUk2TVN3aWMyTm9aVzFoVm1WeWMybHZiaUk2TVN3aVpYaHdiM0owWldSQmRDSTZJakl3TWpZdE1Ea3RNamRVTVRJNk1EQTZNREF1TURBd1dpSXNJbkJoY0dWeWN5STZXM3NpCiUgUGFwZXJNYXAtTWV0YWRhdGE6IGEyVjVJam9pVDJ4a0xUSXdNalF0VUdGd1pYSWlMQ0p3WVhCbGNpSTZleUpwWkNJNkluQmhjR1Z5T205c1pDSXNJbU5wZEdGMGFXOXVTMlY1SWpvaVQyeGtJREl3TWpRZ1VHRndaWElpTENKMGFYUnNaU0k2SWs5cwolIFBhcGVyTWFwLU1ldGFkYXRhOiBaQ0JRWVhCbGNpSXNJbUYxZEdodmNuTWlPbHNpUVdSaElFOXNaQ0pkTENKNVpXRnlJam95TURJMGZYMWRMQ0psWkdkbGN5STZXMTBzSW5SdmNHbGpjeUk2VzEwc0ltMWxkR0VpT25zaWJHVm5ZV041SWpwMGNuVmwKJSBQYXBlck1hcC1NZXRhZGF0YTogZlN3aVlYUjBZV05vYldWdWRITWlPbHRkZlEKCkBhcnRpY2xle09sZC0yMDI0LVBhcGVyLAogIHRpdGxlID0ge09sZCBQYXBlcn0sCiAgYXV0aG9yID0ge0FkYSBPbGR9LAogIHllYXIgPSB7MjAyNH0KfQpQSwECFAMUAAAAAAC6KT1dB5ftSHMCAABzAgAACwAAAAAAAAAAAAAAgAEAAAAAbGlicmFyeS5iaWJQSwUGAAAAAAEAAQA5AAAAnAIAAAAA";

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

test("version 3 stores lossless metadata and paper records as JSON", () => {
  const library = sampleLibrary();
  const { bibtex, metadataJson } = libraryToArchiveBibTeX(library, []);

  assert.doesNotMatch(bibtex, /PaperMap-Metadata|PaperMap-Archive-Version/);
  assert.match(bibtex, /@article\{Doe-2024-Alpha,/);
  assert.match(bibtex, /@article\{Doe-2024-Alpha-2,/);

  const metadata = JSON.parse(metadataJson);
  assert.equal(metadata.archiveVersion, 3);
  assert.equal(metadata.papers.length, 2);
  assert.deepEqual(metadata.edges, library.edges);
  assert.deepEqual(metadata.topics, library.topics);
  assert.deepEqual(metadata.meta, library.meta);
});

test("full database ZIP round-trips JSON metadata, individual paper files, and PDFs without BibTeX", async () => {
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

  const zip = await createLibraryArchive(library, pdfEntries);
  assert.equal(zip.type, "application/zip");

  const zipBytes = new Uint8Array(await zip.arrayBuffer());
  const zipText = new TextDecoder("latin1").decode(zipBytes);
  assert.doesNotMatch(zipText, /library\.bib/);
  assert.match(zipText, /metadata\.json/);
  assert.match(zipText, /papers\/Doe-2024-Alpha\.json/);
  assert.match(zipText, /papers\/Doe-2024-Alpha-2\.json/);
  assert.match(zipText, /Doe-2024-Alpha\.pdf/);

  const restored = await parseLibraryArchive(zipBytes.buffer);
  assert.deepEqual(restored.library, library);
  assert.deepEqual(restored.keyedPapers.map(({ key }) => key), ["Doe-2024-Alpha", "Doe-2024-Alpha-2"]);
  assert.deepEqual(restored.pdfs.map((item) => item.archiveName), ["Doe-2024-Alpha.pdf", "Doe-2024-Alpha-2.pdf"]);
  assert.equal(await restored.pdfs[0].blob.text(), await PDF_A.text());
  assert.equal(await restored.pdfs[1].blob.text(), await PDF_B.text());
  assert.equal(restored.pdfs[0].metadata.sourceFileName, "alpha-original.pdf");
});

test("version 1 archives with metadata comments remain importable", async () => {
  const bytes = Uint8Array.from(Buffer.from(LEGACY_V1_ARCHIVE_BASE64, "base64"));
  const restored = await parseLibraryArchive(bytes.buffer);

  assert.equal(restored.library.schemaVersion, 1);
  assert.equal(restored.library.papers.length, 1);
  assert.equal(restored.library.papers[0].id, "paper:old");
  assert.equal(restored.library.papers[0].title, "Old Paper");
  assert.deepEqual(restored.library.meta, { legacy: true });
  assert.deepEqual(restored.keyedPapers.map(({ key }) => key), ["Old-2024-Paper"]);
});
