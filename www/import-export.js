const PAPER_MAP_SCHEMA_VERSION = 1;

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function normalizeDoi(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export function normalizedTitle(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function paperIdentityKey(paper) {
  const doi = normalizeDoi(paper.doi);
  if (doi) return `doi:${doi}`;
  if (paper.semanticScholarId) return `s2:${paper.semanticScholarId}`;
  if (paper.arxivId) return `arxiv:${String(paper.arxivId).toLowerCase()}`;
  return `title:${normalizedTitle(paper.title)}:${paper.year || ""}`;
}

export function mergePaperRecords(existing, incoming) {
  const chooseArray = (left, right) => (right?.length ? right : left || []);
  const choose = (left, right) => (right !== undefined && right !== null && right !== "" ? right : left);
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    title: choose(existing.title, incoming.title),
    authors: chooseArray(existing.authors, incoming.authors),
    year: choose(existing.year, incoming.year),
    venue: choose(existing.venue, incoming.venue),
    type: choose(existing.type, incoming.type),
    doi: normalizeDoi(choose(existing.doi, incoming.doi)),
    semanticScholarId: choose(existing.semanticScholarId, incoming.semanticScholarId),
    arxivId: choose(existing.arxivId, incoming.arxivId),
    url: choose(existing.url, incoming.url),
    pdfUrl: choose(existing.pdfUrl, incoming.pdfUrl),
    abstract: choose(existing.abstract, incoming.abstract),
    keywords: Array.from(new Set([...(existing.keywords || []), ...(incoming.keywords || [])])),
    topics: Array.from(new Set([...(existing.topics || []), ...(incoming.topics || [])])),
    tags: Array.from(new Set([...(existing.tags || []), ...(incoming.tags || [])])),
    notes: existing.notes || incoming.notes || "",
    status: existing.status || incoming.status || "unread",
    relevance: Number(existing.relevance ?? incoming.relevance ?? 3),
    starred: Boolean(existing.starred ?? incoming.starred ?? false),
    citationCount: choose(existing.citationCount, incoming.citationCount),
    updatedAt: new Date().toISOString(),
  };
}

function unbrace(value) {
  const text = String(value || "").trim();
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function splitAuthors(value) {
  return String(value || "")
    .split(/\s+and\s+/i)
    .map((author) => author.trim())
    .filter(Boolean)
    .map((author) => {
      if (!author.includes(",")) return author;
      const [last, ...rest] = author.split(",").map((part) => part.trim());
      return `${rest.join(" ")} ${last}`.trim();
    });
}

function findMatchingBrace(text, start) {
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') quote = !quote;
    if (quote) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseFields(body) {
  const fields = {};
  let index = 0;

  while (index < body.length) {
    while (index < body.length && /[\s,]/.test(body[index])) index += 1;
    const keyStart = index;
    while (index < body.length && /[A-Za-z0-9_-]/.test(body[index])) index += 1;
    const key = body.slice(keyStart, index).trim().toLowerCase();
    while (index < body.length && /\s/.test(body[index])) index += 1;
    if (!key || body[index] !== "=") {
      while (index < body.length && body[index] !== ",") index += 1;
      continue;
    }
    index += 1;
    while (index < body.length && /\s/.test(body[index])) index += 1;

    let raw = "";
    if (body[index] === "{") {
      const end = findMatchingBrace(body, index);
      if (end < 0) break;
      raw = body.slice(index, end + 1);
      index = end + 1;
    } else if (body[index] === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < body.length) {
        const char = body[index];
        if (!escaped && char === '"') {
          index += 1;
          break;
        }
        escaped = !escaped && char === "\\";
        if (char !== "\\") escaped = false;
        index += 1;
      }
      raw = body.slice(start, index);
    } else {
      const start = index;
      while (index < body.length && body[index] !== ",") index += 1;
      raw = body.slice(start, index);
    }

    fields[key] = unbrace(raw).replace(/[{}]/g, "").trim();
    while (index < body.length && body[index] !== ",") index += 1;
    if (body[index] === ",") index += 1;
  }

  return fields;
}

export function parseBibTeX(text) {
  const papers = [];
  let cursor = 0;

  while (cursor < text.length) {
    const at = text.indexOf("@", cursor);
    if (at < 0) break;
    const open = text.indexOf("{", at);
    if (open < 0) break;
    const type = text.slice(at + 1, open).trim();
    const close = findMatchingBrace(text, open);
    if (close < 0) break;

    const content = text.slice(open + 1, close);
    const comma = content.indexOf(",");
    if (comma > 0) {
      const citationKey = content.slice(0, comma).trim();
      const fields = parseFields(content.slice(comma + 1));
      const year = Number.parseInt(fields.year, 10);
      const doi = normalizeDoi(fields.doi);
      const title = fields.title || citationKey;
      papers.push({
        id: doi ? `doi:${doi}` : `bib:${slug(citationKey || title)}:${Number.isFinite(year) ? year : "unknown"}`,
        citationKey,
        title,
        authors: splitAuthors(fields.author),
        year: Number.isFinite(year) ? year : null,
        venue: fields.journal || fields.booktitle || fields.publisher || "",
        type: type || "article",
        doi,
        url: fields.url || (doi ? `https://doi.org/${doi}` : ""),
        abstract: fields.abstract || "",
        keywords: String(fields.keywords || "").split(/[,;]/).map((item) => item.trim()).filter(Boolean),
        topics: [],
        tags: [],
        notes: fields.note || "",
        status: "unread",
        relevance: 3,
        starred: false,
        citationCount: null,
        source: "bibtex",
        importedAt: new Date().toISOString(),
      });
    }

    cursor = close + 1;
  }

  return papers;
}

function bibEscape(value) {
  return String(value || "").replace(/[{}]/g, "").trim();
}

export function paperToBibTeX(paper) {
  const firstAuthor = String(paper.authors?.[0] || "paper").split(/\s+/).at(-1) || "paper";
  const key = paper.citationKey || `${slug(firstAuthor)}${paper.year || ""}${slug(paper.title).slice(0, 20)}`;
  const fields = [
    ["title", paper.title],
    ["author", (paper.authors || []).join(" and ")],
    ["year", paper.year],
    [paper.type?.toLowerCase().includes("conference") ? "booktitle" : "journal", paper.venue],
    ["doi", paper.doi],
    ["url", paper.url],
    ["abstract", paper.abstract],
    ["keywords", [...(paper.keywords || []), ...(paper.tags || [])].join(", ")],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");

  const body = fields.map(([name, value]) => `  ${name} = {${bibEscape(value)}}`).join(",\n");
  return `@article{${key},\n${body}\n}`;
}

export function libraryToBibTeX(papers) {
  return papers.map(paperToBibTeX).join("\n\n");
}

export function serializeLibrary(library) {
  return JSON.stringify({
    schemaVersion: PAPER_MAP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    papers: library.papers || [],
    edges: library.edges || [],
    topics: library.topics || [],
    meta: library.meta || {},
  }, null, 2);
}

export function parsePaperMapJson(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("Paper Map backup must be a JSON object.");
  if (Number(value.schemaVersion || 0) !== PAPER_MAP_SCHEMA_VERSION) {
    throw new Error(`Unsupported Paper Map schema version: ${value.schemaVersion ?? "missing"}.`);
  }
  if (!Array.isArray(value.papers) || !Array.isArray(value.edges) || !Array.isArray(value.topics)) {
    throw new Error("Backup is missing papers, edges, or topics arrays.");
  }
  return value;
}

export function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
