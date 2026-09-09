import { normalizeDoi } from "./import-export.js";

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;
const ARXIV_RE = /\b(?:arxiv\s*:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.\-]+\/\d{7})(?:v\d+)?)\b/i;
const STOP_RE = /^(?:abstract\b|abstract[—-]|keywords?\b|index terms?\b|(?:1|i)\.?\s+introduction\b)/i;
const AFFILIATION_RE = /\b(?:university|universit[aäeé]|institute|institut|department|dept\.?|laboratory|laboratories|lab\.?|research|school of|faculty of|college|corporation|corp\.?|inc\.?|gmbh|google|microsoft|facebook|meta|openai|bosch|systems ab|email)\b/i;
const HEADER_RE = /^(?:journal\b|available online\b|www\.|https?:\/\/|doi\s*:|received\b|accepted\b|copyright\b|©|preprint\b|provided proper attribution\b|permission to reproduce\b|\d+(?:st|nd|rd|th) conference\b)/i;
const AUTHOR_MARKERS_RE = /[∗*†‡§¶¹²³⁴⁵⁶⁷⁸⁹⁰]+/g;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function trimIdentifierPunctuation(value) {
  let result = clean(value).replace(/[.,;:]+$/g, "");
  while (result.endsWith(")")) {
    const opens = (result.match(/\(/g) || []).length;
    const closes = (result.match(/\)/g) || []).length;
    if (closes <= opens) break;
    result = result.slice(0, -1);
  }
  return result;
}

export function firstPageText(documentText) {
  const source = String(documentText || "");
  const pageMatch = source.match(/--- Page 1 ---\s*([\s\S]*?)(?=\n\s*--- Page \d+ ---|$)/i);
  return (pageMatch?.[1] || source).trim();
}

function frontMatterLines(documentText) {
  const page = firstPageText(documentText);
  const lines = page.split(/\r?\n/).map(clean).filter(Boolean);
  const result = [];
  for (const line of lines) {
    if (STOP_RE.test(line)) break;
    result.push(line);
  }
  return result;
}

function stripAuthorMarkers(value) {
  return clean(value)
    .replace(AUTHOR_MARKERS_RE, "")
    .replace(/\s*\([^)]*(?:equal contribution|corresponding author)[^)]*\)\s*/gi, " ")
    .replace(/^[,;·\s]+|[,;·\s]+$/g, "")
    .trim();
}

function nameTokens(value) {
  return stripAuthorMarkers(value)
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function looksLikeSingleName(value) {
  const cleaned = stripAuthorMarkers(value);
  if (!cleaned || cleaned.includes("@") || AFFILIATION_RE.test(cleaned) || DOI_RE.test(cleaned) || ARXIV_RE.test(cleaned)) return false;
  const tokens = nameTokens(cleaned);
  if (tokens.length < 2 || tokens.length > 5) return false;
  return tokens.every((token) => /^[\p{Lu}][\p{L}'’\-]+$/u.test(token) || /^[\p{Lu}]$/u.test(token) || /^[a-z][\p{L}'’\-]+$/u.test(token));
}

function looksLikeAuthorBlockLine(line, nextLine = "") {
  if (!line || line.includes("@") || AFFILIATION_RE.test(line) || DOI_RE.test(line) || ARXIV_RE.test(line)) return false;
  if (/[∗*†‡]/.test(line) && looksLikeSingleName(line.replace(/[,;].*$/, ""))) return true;
  const separated = line.split(/\s*(?:,|;|\band\b|·)\s*/i).map(stripAuthorMarkers).filter(Boolean);
  if (separated.length >= 2 && separated.every(looksLikeSingleName)) return true;
  const tokens = nameTokens(line);
  const nextLooksAffiliated = Boolean(nextLine && (AFFILIATION_RE.test(nextLine) || nextLine.includes("@")));
  return nextLooksAffiliated && tokens.length >= 2 && tokens.length <= 12
    && tokens.every((token) => /^[\p{Lu}][\p{L}'’\-]+$/u.test(token) || /^[\p{Lu}]$/u.test(token));
}

function splitAuthors(line) {
  const cleaned = stripAuthorMarkers(line);
  const explicit = cleaned.split(/\s*(?:,|;|\band\b|·)\s*/i).map(stripAuthorMarkers).filter(looksLikeSingleName);
  if (explicit.length >= 2) return explicit;
  if (looksLikeSingleName(cleaned)) return [cleaned];

  const tokens = nameTokens(cleaned);
  if (tokens.length >= 4 && tokens.length <= 12 && tokens.length % 2 === 0) {
    const paired = [];
    for (let index = 0; index < tokens.length; index += 2) paired.push(`${tokens[index]} ${tokens[index + 1]}`);
    if (paired.every(looksLikeSingleName)) return paired;
  }
  return [];
}

function sourceIdentifiers(lines) {
  const text = lines.join("\n");
  const doiMatch = text.match(DOI_RE);
  const arxivMatch = text.match(ARXIV_RE);
  return {
    doi: doiMatch ? normalizeDoi(trimIdentifierPunctuation(doiMatch[0])) : "",
    arxivId: arxivMatch ? trimIdentifierPunctuation(arxivMatch[1]) : "",
  };
}

function probableYear(lines) {
  for (const line of lines) {
    const match = line.match(/\b((?:19|20)\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function extractLocalPaperMetadata(documentText, { fallbackTitle = "" } = {}) {
  const lines = frontMatterLines(documentText);
  const usable = lines.filter((line) => !HEADER_RE.test(line) && !DOI_RE.test(line) && !/^arxiv\s*:/i.test(line));
  let authorStart = -1;
  for (let index = 0; index < usable.length; index += 1) {
    if (looksLikeAuthorBlockLine(usable[index], usable[index + 1] || "")) {
      authorStart = index;
      break;
    }
  }

  const titleLines = authorStart > 0 ? usable.slice(0, authorStart) : [];
  const title = clean(titleLines.join(" ")) || clean(fallbackTitle);
  const authors = [];
  if (authorStart >= 0) {
    for (let index = authorStart; index < usable.length; index += 1) {
      const line = usable[index];
      if (AFFILIATION_RE.test(line) || line.includes("@") || DOI_RE.test(line) || ARXIV_RE.test(line)) continue;
      const extracted = splitAuthors(line);
      if (!extracted.length) {
        if (authors.length && index > authorStart + 2) break;
        continue;
      }
      for (const author of extracted) {
        const key = author.toLowerCase();
        if (!authors.some((value) => value.toLowerCase() === key)) authors.push(author);
      }
    }
  }

  const identifiers = sourceIdentifiers(lines);
  const warnings = [];
  if (!titleLines.length) warnings.push("Local front-matter extraction could not identify a reliable title; the filename was used as the review fallback.");
  if (!authors.length) warnings.push("Local front-matter extraction could not identify authors reliably; review the author field manually.");

  return {
    title,
    authors,
    year: probableYear(lines),
    doi: identifiers.doi,
    arxivId: identifiers.arxivId,
    warnings,
    evidence: {
      page: 1,
      method: "deterministic-front-matter",
      titleDetected: Boolean(titleLines.length),
      authorCount: authors.length,
      doiDetected: Boolean(identifiers.doi),
      arxivDetected: Boolean(identifiers.arxivId),
    },
  };
}
