import { normalizeDoi } from "./import-export.js";

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;
const ARXIV_RE = /\b(?:arxiv\s*:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.\-]+\/\d{7})(?:v\d+)?)\b/i;
const STOP_RE = /^(?:abstract\b|abstract[—-]|keywords?\b|index terms?\b|(?:1|i)\.?\s+introduction\b)/i;
const AFFILIATION_RE = /\b(?:university|universit[aäeé]|institute|institut|department|dept\.?|laboratory|laboratories|lab\.?|research|school of|faculty of|college|corporation|corp\.?|inc\.?|gmbh|google|microsoft|facebook|meta|openai|bosch|systems ab|email)\b/i;
const HEADER_RE = /^(?:journal\b|available online\b|www\.|https?:\/\/|doi\s*:|received\b|accepted\b|copyright\b|©|preprint\b|provided proper attribution\b|permission to reproduce\b|\d+(?:st|nd|rd|th) conference\b)/i;
const AUTHOR_MARKERS_RE = /[∗*†‡§¶¹²³⁴⁵⁶⁷⁸⁹⁰]+/g;
const NAME_PARTICLES = new Set(["da", "de", "del", "der", "di", "du", "la", "le", "van", "von"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function deglueCamelCase(value) {
  return String(value ?? "")
    .replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2")
    .replace(/([\p{Lu}])([\p{Lu}][\p{Ll}])/gu, "$1 $2");
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
  const page = deglueCamelCase(firstPageText(documentText));
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

function nameToken(value) {
  return /^[\p{Lu}][\p{L}'’\-]*$/u.test(value) || /^[\p{Lu}]$/u.test(value);
}

function looksLikeSingleName(value) {
  const cleaned = stripAuthorMarkers(value);
  if (!cleaned || cleaned.includes("@") || AFFILIATION_RE.test(cleaned) || DOI_RE.test(cleaned) || ARXIV_RE.test(cleaned)) return false;
  const tokens = nameTokens(cleaned);
  if (tokens.length < 2 || tokens.length > 5) return false;
  if (!nameToken(tokens[0]) || !nameToken(tokens.at(-1))) return false;
  return tokens.every((token, index) => nameToken(token)
    || (index > 0 && index < tokens.length - 1 && NAME_PARTICLES.has(token.toLowerCase())));
}

function looksLikeAuthorBlockLine(line, nextLine = "") {
  if (!line || line.includes("@") || AFFILIATION_RE.test(line) || DOI_RE.test(line) || ARXIV_RE.test(line)) return false;
  if (/[∗*†‡]/.test(line) && looksLikeSingleName(line.replace(/[,;].*$/, ""))) return true;
  const separated = line.split(/\s*(?:,|;|\band\b|·)\s*/i).map(stripAuthorMarkers).filter(Boolean);
  if (separated.length >= 2 && separated.every(looksLikeSingleName)) return true;
  const tokens = nameTokens(line);
  const nextLooksAffiliated = Boolean(nextLine && (AFFILIATION_RE.test(nextLine) || nextLine.includes("@")));
  return nextLooksAffiliated && tokens.length >= 2 && tokens.length <= 12
    && tokens.every((token) => nameToken(token) || NAME_PARTICLES.has(token.toLowerCase()));
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

function markedAuthors(pageText) {
  const source = deglueCamelCase(pageText);
  const pattern = /([\p{Lu}][\p{L}'’\-]*(?:[ \t]+(?:[\p{Lu}][\p{L}'’\-]*|da|de|del|der|di|du|la|le|van|von)){1,4})[ \t]*[∗*†‡]+/gu;
  const authors = [];
  let firstIndex = -1;
  for (const match of source.matchAll(pattern)) {
    let author = stripAuthorMarkers(match[1]);
    const tokens = nameTokens(author);
    if (tokens.length > 2 && tokens[0].length <= 3) {
      const suffix = tokens.slice(1).join(" ");
      if (looksLikeSingleName(suffix)) author = suffix;
    }
    if (!looksLikeSingleName(author)) continue;
    if (firstIndex < 0) firstIndex = match.index ?? -1;
    if (!authors.some((value) => value.toLowerCase() === author.toLowerCase())) authors.push(author);
  }
  return { authors, firstIndex, source };
}

function cleanTitlePrefix(prefix) {
  let value = deglueCamelCase(prefix).trim();
  const reversedArxivDate = value.search(/\b\d{4}\s+(?:naJ|beF|raM|rpA|yaM|nuJ|luJ|guA|peS|tcO|voN|ceD)\b/i);
  if (reversedArxivDate >= 0) value = value.slice(0, reversedArxivDate);
  value = value.replace(/\S*:vi\s*Xra.*$/i, "").trim();

  const rawLines = value.split(/\r?\n/).map(clean).filter(Boolean);
  if (rawLines.length === 1) {
    const sentenceParts = rawLines[0].split(/\.\s+/).map(clean).filter(Boolean);
    return clean(sentenceParts.at(-1) || "");
  }

  const lines = rawLines.filter((line) => !HEADER_RE.test(line) && !DOI_RE.test(line) && !/^arxiv\s*:/i.test(line));
  return clean(lines.join(" "));
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
  const pageText = firstPageText(documentText);
  const lines = frontMatterLines(documentText);
  const usable = lines.filter((line) => !HEADER_RE.test(line) && !DOI_RE.test(line) && !/^arxiv\s*:/i.test(line));
  const marked = markedAuthors(pageText);
  let authors = marked.authors;
  let title = marked.authors.length >= 2 && marked.firstIndex >= 0
    ? cleanTitlePrefix(marked.source.slice(0, marked.firstIndex))
    : "";

  let authorStart = -1;
  if (authors.length < 2) {
    for (let index = 0; index < usable.length; index += 1) {
      if (looksLikeAuthorBlockLine(usable[index], usable[index + 1] || "")) {
        authorStart = index;
        break;
      }
    }

    if (!title) {
      const titleLines = authorStart > 0 ? usable.slice(0, authorStart) : [];
      title = cleanTitlePrefix(titleLines.join("\n"));
    }

    authors = [];
    if (authorStart >= 0) {
      for (let index = authorStart; index < usable.length; index += 1) {
        const line = usable[index];
        if (AFFILIATION_RE.test(line) || line.includes("@") || DOI_RE.test(line) || ARXIV_RE.test(line)) continue;
        const extracted = splitAuthors(line);
        if (!extracted.length) {
          if (authors.length) break;
          continue;
        }
        for (const author of extracted) {
          const key = author.toLowerCase();
          if (!authors.some((value) => value.toLowerCase() === key)) authors.push(author);
        }
      }
    }
  }

  title ||= clean(fallbackTitle);
  const identifiers = sourceIdentifiers(lines);
  const warnings = [];
  if (title === clean(fallbackTitle)) warnings.push("Local front-matter extraction could not identify a reliable title; the filename was used as the review fallback.");
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
      titleDetected: title !== clean(fallbackTitle),
      authorCount: authors.length,
      doiDetected: Boolean(identifiers.doi),
      arxivDetected: Boolean(identifiers.arxivId),
    },
  };
}