const BIBLIOGRAPHY_HEADINGS = new Map([
  ["references", "References"],
  ["bibliography", "Bibliography"],
  ["works cited", "Works Cited"],
  ["literature cited", "Literature Cited"],
  ["references and notes", "References and Notes"],
]);

const POST_BIBLIOGRAPHY_HEADINGS = new Set([
  "appendix",
  "appendices",
  "supplementary material",
  "supplemental material",
  "acknowledgements",
  "acknowledgments",
]);

const YEAR_RE = /\b((?:19|20)\d{2})[a-z]?\b/i;
const DOI_RE = /\b10\.\d{4,9}\/[\-._;()/:A-Z0-9]+\b/i;
const ARXIV_NEW_RE = /(?:arxiv\s*:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)/i;
const ARXIV_OLD_RE = /(?:arxiv\s*:\s*)?([a-z][a-z0-9.\-]+\/\d{7}(?:v\d+)?)/i;
const NUMBERED_RE = /^\s*(?:\[(\d{1,4})\]|(\d{1,3})[.)])\s*(.*)$/;

function normalizeHeading(line) {
  return String(line || "")
    .trim()
    .replace(/^[:.\u2014-]+|[:.\u2014-]+$/g, "")
    .trim()
    .toLowerCase();
}

function headingName(line) {
  return BIBLIOGRAPHY_HEADINGS.get(normalizeHeading(line)) || "";
}

function isPostBibliographyHeading(line) {
  const raw = String(line || "").trimEnd();
  if (POST_BIBLIOGRAPHY_HEADINGS.has(normalizeHeading(raw))) return true;
  if (/^\s*appendix\b/i.test(raw)) return true;
  return /^\s*[A-Z]\s{2,}\p{Lu}/u.test(raw);
}

function parseDocumentPages(documentText) {
  const text = String(documentText || "");
  const marker = /^--- Page (\d+) ---\s*$/gm;
  const matches = [...text.matchAll(marker)];
  if (!matches.length) return [{ page: 1, text }];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    return {
      page: Number(match[1]) || index + 1,
      text: text.slice(start, end).replace(/^\s*\n/, "").trimEnd(),
    };
  });
}

function detectTwoColumnSplit(rawLines) {
  const rows = rawLines.map((line) => Array.from(String(line || "")));
  const nonEmpty = rows.filter((row) => row.some((char) => !/\s/u.test(char)));
  const maxWidth = nonEmpty.reduce((max, row) => Math.max(max, row.length), 0);
  if (maxWidth < 80 || nonEmpty.length < 8) return null;

  const ends = [];
  for (const row of nonEmpty) {
    let index = 0;
    while (index < row.length) {
      if (row[index] !== " ") {
        index += 1;
        continue;
      }
      const start = index;
      while (index < row.length && row[index] === " ") index += 1;
      const end = index;
      const runLength = end - start;
      if (
        runLength >= 6 &&
        start > 0 &&
        end < row.length &&
        row.slice(0, start).some((char) => char !== " ") &&
        row.slice(end).some((char) => char !== " ") &&
        end >= maxWidth * 0.35 &&
        end <= maxWidth * 0.7
      ) {
        ends.push(end);
      }
    }
  }
  if (!ends.length) return null;

  let bestCenter = null;
  let bestSupport = 0;
  for (const candidate of ends) {
    const support = ends.filter((value) => Math.abs(value - candidate) <= 3).length;
    if (support > bestSupport) {
      bestSupport = support;
      bestCenter = candidate;
    }
  }
  const required = Math.max(4, Math.ceil(nonEmpty.length * 0.15));
  if (bestCenter == null || bestSupport < required) return null;
  return Math.min(...ends.filter((value) => Math.abs(value - bestCenter) <= 3));
}

function readingOrderLines(text) {
  const rawLines = String(text || "").split(/\r?\n/);
  const split = detectTwoColumnSplit(rawLines);
  if (split == null) {
    return { lines: rawLines.map((line) => line.trimEnd()), twoColumn: false };
  }

  const left = [];
  const right = [];
  for (const rawLine of rawLines) {
    const chars = Array.from(rawLine);
    left.push(chars.slice(0, split).join("").trimEnd());
    right.push(chars.slice(split).join("").trimEnd());
  }
  return { lines: [...left, ...right], twoColumn: true };
}

function bibliographyRegion(documentText) {
  const pages = parseDocumentPages(documentText);
  let started = false;
  let sawTwoColumn = false;
  const lines = [];

  for (const page of pages) {
    const ordered = readingOrderLines(page.text);
    let firstLine = 0;
    if (!started) {
      const headingIndex = ordered.lines.findIndex((line) => headingName(line));
      if (headingIndex < 0) continue;
      started = true;
      firstLine = headingIndex + 1;
    }
    sawTwoColumn ||= ordered.twoColumn;

    for (const line of ordered.lines.slice(firstLine)) {
      if (isPostBibliographyHeading(line)) {
        return { lines, sawTwoColumn };
      }
      lines.push({ page: page.page, text: line });
    }
  }

  return { lines: started ? lines : [], sawTwoColumn };
}

function normalizeReferenceText(lines) {
  let result = "";
  for (const line of lines) {
    const fragment = String(line.text || "").trim().replace(/\s+/g, " ");
    if (!fragment) continue;
    if (result) {
      if (result.endsWith("-") && /^[a-z]/.test(fragment)) {
        result = result.slice(0, -1);
      } else {
        result += " ";
      }
    }
    result += fragment;
  }
  return result.trim();
}

function extractIdentifiers(rawText) {
  const doi = rawText.match(DOI_RE)?.[0]?.replace(/[.,;:]+$/, "").toLowerCase() || "";
  const arxivId = rawText.match(ARXIV_NEW_RE)?.[1] || rawText.match(ARXIV_OLD_RE)?.[1]?.toLowerCase() || "";
  const year = Number(rawText.match(YEAR_RE)?.[1]) || null;
  return { doi, arxivId, year };
}

function looksLikeAuthorStart(line) {
  if (!line || /^\s{2,}/.test(line)) return false;
  const text = line.trim();
  if (!/^\p{Lu}/u.test(text) || text.length > 220) return false;
  if (YEAR_RE.test(text)) return true;
  return text.includes(",") || /\sand\s/i.test(text);
}

function segmentNumbered(lines) {
  const drafts = [];
  let current = null;
  for (const source of lines) {
    const match = source.text.match(NUMBERED_RE);
    if (match) {
      if (current?.lines.length) drafts.push(current);
      current = {
        label: match[1] || match[2] || null,
        lines: [{ ...source, text: match[3] || "" }],
        numbered: true,
      };
    } else if (current) {
      current.lines.push(source);
    }
  }
  if (current?.lines.length) drafts.push(current);
  return drafts;
}

function segmentAuthorYear(lines) {
  const drafts = [];
  let current = null;
  const flush = () => {
    if (current?.lines.some((line) => line.text.trim())) drafts.push(current);
    current = null;
  };

  for (const source of lines) {
    if (!source.text.trim()) continue;
    const currentText = current ? normalizeReferenceText(current.lines) : "";
    if (current && YEAR_RE.test(currentText) && looksLikeAuthorStart(source.text)) flush();
    current ||= { label: null, lines: [], numbered: false };
    current.lines.push(source);
  }
  flush();
  return drafts;
}

function materialize(drafts) {
  return drafts
    .map((draft, index) => {
      const rawText = normalizeReferenceText(draft.lines);
      if (rawText.length < 8) return null;
      const { doi, arxivId, year } = extractIdentifiers(rawText);
      return {
        index: index + 1,
        label: draft.label,
        rawText,
        doi: doi || null,
        arxivId: arxivId || null,
        year,
        pageStart: draft.lines.find((line) => line.text.trim())?.page || draft.lines[0]?.page || 1,
        pageEnd: [...draft.lines].reverse().find((line) => line.text.trim())?.page || draft.lines.at(-1)?.page || 1,
        confidence: doi ? 0.99 : arxivId ? 0.97 : draft.numbered ? 0.82 : year ? 0.72 : 0.48,
      };
    })
    .filter(Boolean);
}

export function recoverTwoColumnReferences(documentText) {
  const region = bibliographyRegion(documentText);
  if (!region.lines.length) return [];
  const numberedCount = region.lines.filter((line) => NUMBERED_RE.test(line.text)).length;
  const authorStartCount = region.lines.filter((line) => looksLikeAuthorStart(line.text)).length;
  const drafts = numberedCount >= 2 && numberedCount > authorStartCount
    ? segmentNumbered(region.lines)
    : segmentAuthorYear(region.lines);
  return materialize(drafts);
}

export { detectTwoColumnSplit, readingOrderLines };
