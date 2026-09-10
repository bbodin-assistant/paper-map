import { normalizeDoi } from "./import-export.js";

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;
const ARXIV_RE = /\b(?:arxiv\s*:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.\-]+\/\d{7})(?:v\d+)?)\b/i;
const STOP_RE = /^(?:abstract\b|abstract[—-]|keywords?\b|index terms?\b|(?:1|i)\.?\s+introduction\b)/i;
const AFFILIATION_RE = /\b(?:university|universit[aäeé]|institute|institut|department|dept\.?|laboratory|laboratories|lab\.?|research|school of|faculty of|college|corporation|corp\.?|inc\.?|gmbh|google|microsoft|facebook|meta|openai|bosch|systems ab|email)\b/i;
const HEADER_RE = /^(?:journal\b|available online\b|www\.|https?:\/\/|doi\s*:|received\b|accepted\b|copyright\b|©|preprint\b|provided proper attribution\b|permission to reproduce\b|\d+(?:st|nd|rd|th) conference\b)/i;
const AUTHOR_MARKERS_RE = /[⁎∗*†‡§¶#¹²³⁴⁵⁶⁷⁸⁹⁰]+/g;
const NAME_PARTICLES = new Set(["da", "de", "del", "der", "di", "du", "la", "le", "van", "von"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function repairAccents(value) {
  return String(value ?? "").replace(/[´¨˚¸]([aeiouyıAEIOUYcC])/gu, (text, letter) =>
    ((letter === "ı" ? "i" : letter) + ({ "´": "\u0301", "¨": "\u0308", "˚": "\u030a", "¸": "\u0327" }[text[0]])).normalize("NFC"))
    .replace(/(\p{L})[´¨˚]/gu, (text, letter) =>
    (letter + ({ "´": "\u0301", "¨": "\u0308", "˚": "\u030a" }[text.at(-1)])).normalize("NFC"));
}

function isAffiliation(line) {
  return AFFILIATION_RE.test(line) || /\b(?:departmentof|schoolof|engineering|sciences|ETH\s*Zurich|EPFL|Ecole)/i.test(line);
}

function repairDetachedTitleLigatures(title, documentText) {
  const detached = firstPageText(documentText).match(/^(?:ff|fi|fl|ffi|ffl)$/gm) || [];
  for (const ligature of detached) {
    const candidates = [...title.matchAll(/(?=(\b(\p{L}+) (\p{L}+)\b))/gu)].filter(match => {
      const word = match[2] + ligature + match[3];
      return new RegExp(`\\b${word}\\b`, "u").test(documentText);
    });
    if (candidates.length === 1) {
      const match = candidates[0];
      title = title.slice(0, match.index) + match[2] + ligature + match[3] + title.slice(match.index + match[1].length);
    }
  }
  return title;
}

// Recover small-cap names only when the same letters are explicitly spaced in
// an author biography. Never guess word boundaries from a list of surnames.
function recoverHeaderNames(documentText) {
  const names = new Map();
  for (const match of documentText.matchAll(/^([\p{Lu}][\p{Lu} .'-]+?)\s+(?:received(?=\b|the)|is currently\b)/gmu)) {
    const name = clean(match[1]);
    if (looksLikeSingleName(name)) names.set(name.replace(/\W/g, ""), name);
  }
  const page = firstPageText(documentText);
  const recovered = page.replace(/\b(?:AND)?[A-Z]{5,}(?=\s*\d)/g, token => {
    const prefix = token.startsWith("AND") ? "and " : "";
    const key = prefix ? token.slice(3) : token;
    return names.has(key) ? prefix + names.get(key) : token;
  });
  return documentText.replace(page, () => recovered);
}

function publisherHeader(line) {
  return HEADER_RE.test(line) || /^IEEE\s*(?:ACCESS|TRANSACTIONS)/i.test(line)
    || /^(?:Received\d|Digital\s*Object\s*Identifier|date\s*of\s*current\s*version)/i.test(line)
    || /^\d{4}\s+\d+(?:st|nd|rd|th)\s+.*Conference/i.test(line);
}

function deglueCamelCase(value) {
  return String(value ?? "")
    .replace(/(\p{Ll})and(?=\p{Lu})/gu, "$1 and ")
    .replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2")
    .replace(/([\p{Lu}])([\p{Lu}][\p{Ll}])/gu, "$1 $2")
    .replace(/([\p{Lu}]\.)([\p{Lu}][\p{Ll}])/gu, "$1 $2");
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
  let page = deglueCamelCase(firstPageText(documentText));
  // Superscript letter affiliations can arrive as ordinary trailing letters.
  // Strip only markers demonstrated by a matching affiliation line.
  const markers = [...page.matchAll(/^([a-z])\s*(\p{Lu}[^\n]*)/gmu)]
    .filter((match) => AFFILIATION_RE.test(match[2]))
    .map((match) => match[1]);
  if (markers.length) {
    const suffix = new RegExp(`(\\p{Ll})[${markers.join("")}](?=[,\\n]|$)`, "gu");
    page = page.split("\n").map((line) => {
      if (!line.includes(",") || AFFILIATION_RE.test(line) || DOI_RE.test(line)) return line;
      return line.replace(suffix, "$1").replace(new RegExp(`,\\s*[${markers.join("")}](?=[,\\n])`, "g"), "");
    }).join("\n");
  }
  const lines = page.split(/\r?\n/).map(clean).filter(Boolean);
  const result = [];
  for (const line of lines) {
    if (STOP_RE.test(line) || /^A\s+B\s+S\s+T\s+R\s+A\s+C\s+T$/i.test(line)) break;
    result.push(line);
  }
  return result;
}

function stripAuthorMarkers(value) {
  return clean(value)
    .replace(/\(\s*(?:B)?\s*\)/g, "")
    .replace(/,?\s*(?:(?:Senior|Life|Fellow)\s+)?Member\s*,\s*IEEE/gi, "")
    .replace(AUTHOR_MARKERS_RE, "")
    .replace(/(?<=\p{L})\d+(?:,\d+)*/gu, "")
    .replace(/\s+\d+(?=\s*[,;]|\s*$)/g, "")
    .replace(/\s*\([^)]*(?:equal contribution|corresponding author)[^)]*\)\s*/gi, " ")
    .replace(/\b([\p{Lu}])\s*\.\s*(?=[\p{Lu}])/gu, "$1 ")
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
  if (!cleaned || cleaned.includes("@") || isAffiliation(cleaned) || DOI_RE.test(cleaned) || ARXIV_RE.test(cleaned)) return false;
  const tokens = nameTokens(cleaned);
  if (tokens.length < 2 || tokens.length > 5) return false;
  if (!nameToken(tokens[0]) || !nameToken(tokens.at(-1))) return false;
  return tokens.every((token, index) => nameToken(token)
    || (index > 0 && index < tokens.length - 1 && NAME_PARTICLES.has(token.toLowerCase())));
}

export function repairTrailingTitleAuthor(value, authorValues = []) {
  const title = clean(value);
  const authors = Array.isArray(authorValues) ? authorValues.map(stripAuthorMarkers).filter(Boolean) : [];
  if (authors.length < 2 || !authors.every(looksLikeSingleName)) return { title, authors };

  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 6) return { title, authors };
  for (let suffixLength = 2; suffixLength <= Math.min(4, words.length - 4); suffixLength += 1) {
    const candidate = words.slice(-suffixLength).join(" ");
    const prefix = words.slice(0, -suffixLength).join(" ");
    const candidateTokens = nameTokens(candidate);
    const surname = candidateTokens.at(-1) || "";
    if (!/^\p{Lu}\p{Ll}{1,2}$/u.test(surname)) continue;
    if (!looksLikeSingleName(candidate) || prefix.length < 18 || prefix.split(/\s+/).length < 4) continue;
    const candidateKey = candidate.toLowerCase();
    if (authors.some((author) => author.toLowerCase() === candidateKey)) continue;
    return { title: prefix, authors: [candidate, ...authors] };
  }
  return { title, authors };
}

function looksLikeAuthorBlockLine(line, nextLine = "") {
  const marked = /[⁎∗*†‡#]/.test(line);
  line = stripAuthorMarkers(line);
  if (!line || line.includes("@") || isAffiliation(line) || DOI_RE.test(line) || ARXIV_RE.test(line)) return false;
  if (marked && looksLikeSingleName(line.replace(/[,;].*$/, ""))) return true;
  const separated = line.split(/\s*(?:,|;|\band\b|·)\s*/i).map(stripAuthorMarkers).filter(Boolean);
  if (separated.length >= 2 && separated.every(looksLikeSingleName)) return true;
  const tokens = nameTokens(line);
  const nextLooksAffiliated = Boolean(nextLine && (AFFILIATION_RE.test(nextLine) || nextLine.includes("@")));
  return nextLooksAffiliated && tokens.length >= 2 && tokens.length <= 12
    && tokens.every((token) => nameToken(token) || NAME_PARTICLES.has(token.toLowerCase()));
}

function titleWithTrailingAuthor(pageText) {
  const lines = deglueCamelCase(pageText).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const normalized = clean(rawLine);
    if (!normalized) continue;
    if (STOP_RE.test(normalized)) break;
    if (HEADER_RE.test(normalized) || DOI_RE.test(normalized) || ARXIV_RE.test(normalized)) continue;

    const parts = rawLine.trim().split(/\s{3,}/).map(clean).filter(Boolean);
    if (parts.length === 2) {
      const [title, author] = parts;
      if (title.length >= 18 && title.split(/\s+/).length >= 4 && title.length <= 180 && looksLikeSingleName(author)) {
        return { title: cleanTitlePrefix(title), author: stripAuthorMarkers(author) };
      }
    }

    const following = lines.slice(index + 1).map(clean).filter(Boolean);
    const nextLine = following[0] || "";
    const followingLine = following[1] || "";
    if (!looksLikeAuthorBlockLine(nextLine, followingLine)) continue;
    // A continuation of a multiline title is not an inline first author.
    if (lines.slice(0, index).some((line) => clean(line) && !HEADER_RE.test(clean(line)))) continue;
    const words = normalized.split(/\s+/);
    if (words.length < 6) continue;
    for (let suffixLength = 2; suffixLength <= Math.min(4, words.length - 4); suffixLength += 1) {
      const author = words.slice(-suffixLength).join(" ");
      const title = words.slice(0, -suffixLength).join(" ");
      if (title.length < 18 || title.length > 180 || !looksLikeSingleName(author)) continue;
      return { title: cleanTitlePrefix(title), author: stripAuthorMarkers(author) };
    }
  }
  return null;
}

function splitAuthors(line) {
  const cleaned = stripAuthorMarkers(line).replace(/^and\s+/i, "");
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
  const pattern = /([\p{Lu}][\p{L}'’\-]*\.?(?:[ \t]+(?:[\p{Lu}][\p{L}'’\-]*\.?|da|de|del|der|di|du|la|le|van|von)){1,4})[ \t]*[∗*†‡]+/gu;
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
  const reversedArxivDate = value.search(/\b\d{4}\s+[a-z]{2}\s*[A-Z]\b/);
  if (reversedArxivDate >= 0) value = value.slice(0, reversedArxivDate);
  value = value.replace(/\S*:vi\s*Xra.*$/i, "").trim();

  const rawLines = value.split(/\r?\n/).map(clean).filter(Boolean);
  if (rawLines.length === 1) {
    const sentenceParts = rawLines[0].split(/\.\s*/).map(clean).filter(Boolean);
    return clean(sentenceParts.at(-1) || "");
  }

  const lines = rawLines.filter((line) => !publisherHeader(line) && !DOI_RE.test(line) && !/^arxiv\s*:/i.test(line)
    && !/^[⁎∗*†‡§¶#B]+$/.test(line)
    && !/^(?:Contents\s*lists\s*available|MARK$|ff$)/i.test(line)
    && !/^\d+(?:\.\d+)?$/.test(line)
    && !/^.+\(\d{4}\)\s+\d+[:\d–-]*$/.test(line));
  let title = clean(lines.join(" "));
  const sentenceParts = title.split(/\.\s*/).map(clean).filter(Boolean);
  if (title.length > 140 && sentenceParts.length > 1) {
    const tail = sentenceParts.at(-1) || "";
    if (tail.length >= 8 && tail.length <= 180) title = tail;
  }
  return title;
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
  documentText = recoverHeaderNames(repairAccents(documentText));
  const pageText = firstPageText(documentText);
  const lines = frontMatterLines(documentText);
  const usable = lines.filter((line) => !publisherHeader(line) && !DOI_RE.test(line) && !/^arxiv\s*:/i.test(line));
  const marked = markedAuthors(pageText);
  const inlineTitleAuthor = titleWithTrailingAuthor(pageText);
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
      if (inlineTitleAuthor) {
        title = inlineTitleAuthor.title;
      } else {
        const titleLines = authorStart > 0 ? usable.slice(0, authorStart) : [];
        title = cleanTitlePrefix(titleLines.join("\n"));
      }
    }

    authors = inlineTitleAuthor?.author ? [inlineTitleAuthor.author] : [];
    if (authorStart >= 0) {
      for (let index = authorStart; index < usable.length; index += 1) {
        const line = usable[index];
        if (isAffiliation(line) || line.includes("@") || DOI_RE.test(line) || ARXIV_RE.test(line)) continue;
        // Location lines following an affiliation are not two-part names.
        if (index > authorStart && isAffiliation(usable[index - 1]) && line.includes(",") && !looksLikeAuthorBlockLine(line)) continue;
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
  // Small-cap headers sometimes lose every word boundary. Keep unspaced names
  // verbatim, while biographies above recover the names they corroborate.
  const compactStart = usable.findIndex(line => /^(?:[A-Z\s\d,]|and)+$/.test(line) && /[A-Z]\s*\d/.test(line) && line.includes(","));
  if (compactStart > 0) {
    const header = [];
    for (const line of usable.slice(compactStart)) {
      if (!/^(?:[A-Z\s\d,]|and)+$/.test(line)) break;
      header.push(line);
    }
    const names = header.join(" ").split(",").map(name => stripAuthorMarkers(name).replace(/^(?:AND(?=[A-Z])|and\s+)/, ""));
    if (names.length >= 2 && names.every(name => /^[A-Z][A-Z\s]+$/.test(name))) {
      title = cleanTitlePrefix(usable.slice(0, compactStart).join("\n"));
      authors = names;
    }
  }
  // Edited proceedings often put the editors before the title on the cover.
  const editorEnd = lines.findIndex(line => /\(Eds?\.\)/.test(line));
  if (editorEnd >= 0 && editorEnd < 5) {
    const editors = lines.slice(0, editorEnd + 1).flatMap(line => splitAuthors(line.replace(/\(Eds?\.\)/g, "")));
    const coverTitle = [];
    for (const line of lines.slice(editorEnd + 1)) {
      if (/^\d+\w*\s+.*(?:Workshop|Conference)|^Proceedings\b|\b(?:19|20)\d{2}\b/.test(line)) break;
      if (/^\d+$|^[A-Z]{2,6}$/.test(line)) continue;
      coverTitle.push(line);
    }
    if (editors.length && coverTitle.length) {
      title = clean(coverTitle.join(" "));
      authors = editors;
    }
  }

  if (title && authors.length >= 2) {
    const repaired = repairTrailingTitleAuthor(title, authors);
    title = repaired.title;
    authors = repaired.authors;
  }
  // ACM's self-citation preserves mixed-case names even when the uppercase
  // header uses small caps with lost word spacing. Only read its author prefix.
  const citation = deglueCamelCase(pageText).match(/ACM\s*Reference\s*format\s*:\s*([\s\S]*?)\.\s*((?:19|20)\d{2})\./i);
  if (citation) {
    const citationAuthors = splitAuthors(clean(citation[1]));
    if (citationAuthors.length >= 2) {
      const headerLines = pageText.split(/\r?\n/).map(clean).filter(Boolean);
      const headerIndex = headerLines.findIndex((line) => {
        const letters = line.split(",")[0].replace(/[^\p{L}]/gu, "");
        return letters.length > 4 && citationAuthors.some((author) => {
          const name = author.replace(/[^\p{L}]/gu, "").toUpperCase();
          return letters.toUpperCase() === name || letters.toUpperCase().startsWith(name + "AND");
        });
      });
      if (headerIndex > 0) {
        title = cleanTitlePrefix(headerLines.slice(0, headerIndex).join("\n"));
        authors = citationAuthors;
      }
    }
  }
  // Preserve product names/acronyms printed in the title. Camel-case spacing
  // repair is useful for authors, but changes names such as OpenCL or FooBar.
  const originalTokens = pageText.match(/\b\p{L}+\b/gu) || [];
  for (const token of new Set(originalTokens)) {
    if (token.length <= 12 && /\p{Ll}\p{Lu}/u.test(token) && originalTokens.filter(word => word === token).length >= 2) {
      title = title.replaceAll(deglueCamelCase(token), token);
    }
  }
  title = repairDetachedTitleLigatures(title, documentText);
  title ||= clean(fallbackTitle);
  const identifiers = sourceIdentifiers(lines);
  const reverseStamp = [...pageText].reverse().join("").match(/arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)[\s\S]{0,50}?\b((?:19|20)\d{2})\b/);
  if (reverseStamp && !identifiers.arxivId) identifiers.arxivId = reverseStamp[1];
  // Publisher identifiers and publication dates often occur in first-page
  // footers, after the abstract. Do not search arbitrary body citations.
  const publicationLines = pageText.split(/\r?\n/).map(clean).filter((line) =>
    /^(?:https?:\/\/(?:dx\.)?doi\.org\/|DOI\s*[: ]|Digital\s*Object\s*Identifier|©\s*\d{4}|Copyright\s*\d{4}|Published online|Available online)/i.test(line));
  identifiers.doi = sourceIdentifiers(publicationLines.map(line => line.replace(/Digital\s*Object\s*Identifier/i, "DOI "))).doi || identifiers.doi;
  const conferenceYear = pageText.match(/\b\d+(?:st|nd|rd|th)\s*[^\n]*Conference[^\n]*\((?:[A-Z]+)\s*((?:19|20)\d{2})\)/);
  const copyrightYear = pageText.match(/(?:Copyright|©)\s*((?:19|20)\d{2})/i);
  const publisherYear = pageText.match(/(?:date\s*of\s*publication|publication\s*date|Springer\s*Nature\s*Switzerland\s*AG)[^\n]*?((?:19|20)\d{2})/i);
  const journalYear = pageText.match(/^IEEE[^\n]*?(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s*((?:19|20)\d{2})/im);
  const warnings = [];
  if (title === clean(fallbackTitle)) warnings.push("Local front-matter extraction could not identify a reliable title; the filename was used as the review fallback.");
  if (!authors.length) warnings.push("Local front-matter extraction could not identify authors reliably; review the author field manually.");
  if (authors.some(author => /^[A-Z]{5,}$/.test(author))) warnings.push("Some author names have missing word spaces in the PDF; review their spelling manually.");
  if (editorEnd >= 0 && editorEnd < 5) warnings.push("The cover credits editors; review whether these names belong in the author field.");

  return {
    title,
    authors,
    year: (citation ? Number(citation[2]) : null) || Number(journalYear?.[1]) || Number(publisherYear?.[1]) || (copyrightYear ? Number(copyrightYear[1]) : null) || probableYear(publicationLines) || (conferenceYear ? Number(conferenceYear[1]) : null) || Number(reverseStamp?.[2]) || probableYear(lines),
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
