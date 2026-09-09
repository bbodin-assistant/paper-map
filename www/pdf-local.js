const WASM_MODULE_URL = "./pkg/paper_map_wasm.js";
let wasmPromise = null;

if (typeof document !== "undefined" && !document.querySelector('link[data-paper-map-local-pdf]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./pdf-local.css";
  link.dataset.paperMapLocalPdf = "true";
  document.head.append(link);
}

function fileStem(name) {
  return String(name || "paper")
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = import(WASM_MODULE_URL).then(async (module) => {
      await module.default();
      return module;
    });
  }
  return wasmPromise;
}

async function extractPdfLocally(file) {
  if (!(file instanceof Blob)) throw new Error("Select a PDF file first.");
  const module = await loadWasm();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return module.extract_pdf_citations(bytes);
}

export async function extractPdfTextLocally(file) {
  const extraction = await extractPdfLocally(file);
  return {
    text: String(extraction?.documentText || ""),
    pageCount: Number(extraction?.layout?.pageCount) || 0,
    engine: extraction?.engine || "paper-map-rust-pdf",
  };
}

export async function extractPdfCitationsLocally(file) {
  const extraction = await extractPdfLocally(file);
  const references = Array.isArray(extraction?.references) ? extraction.references : [];
  const doiCount = references.filter((reference) => reference.doi).length;
  const arxivCount = references.filter((reference) => reference.arxivId).length;
  const layout = extraction?.layout || {};
  const heading = layout.bibliographyHeading || (layout.bibliographyInferred ? "inferred bibliography" : "bibliography");
  const summary = `${references.length} references · ${doiCount} DOI · ${arxivCount} arXiv`;
  const warnings = [...(extraction?.warnings || [])];
  if (references.length) {
    warnings.unshift(
      `Local Rust/WASM extraction found ${summary} from ${heading}${layout.bibliographyStartPage ? ` starting on page ${layout.bibliographyStartPage}` : ""}.`,
    );
  }
  return {
    title: fileStem(file.name),
    authors: [],
    year: null,
    venue: "",
    type: "article",
    doi: "",
    arxivId: "",
    url: "",
    abstract: "",
    keywords: [],
    topics: [],
    warnings,
    references,
    localExtraction: {
      schemaVersion: extraction?.schemaVersion || 1,
      engine: extraction?.engine || "paper-map-rust-pdf",
      layout,
      summary,
    },
  };
}
