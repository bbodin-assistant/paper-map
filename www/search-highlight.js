function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedQuery(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function queryTokenPattern(query) {
  const tokens = Array.from(new Set(
    normalizedQuery(query)
      .match(/[\p{L}\p{N}][\p{L}\p{N}._:/+\-]*/gu) || [],
  ));
  if (!tokens.length) return null;
  tokens.sort((left, right) => right.length - left.length);
  return new RegExp(tokens.map(escapeRegExp).join("|"), "giu");
}

function phrasePattern(query) {
  const phrase = normalizedQuery(query);
  if (!phrase) return null;
  const flexibleWhitespace = escapeRegExp(phrase).replace(/\\ /g, "\\s+");
  return new RegExp(flexibleWhitespace, "giu");
}

function splitWithPattern(text, pattern) {
  const source = String(text ?? "");
  if (!source || !pattern) return [{ text: source, match: false }];

  const parts = [];
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const value = match[0] || "";
    if (!value) continue;
    if (start > cursor) parts.push({ text: source.slice(cursor, start), match: false });
    parts.push({ text: value, match: true });
    cursor = start + value.length;
  }
  if (!parts.length) return [{ text: source, match: false }];
  if (cursor < source.length) parts.push({ text: source.slice(cursor), match: false });
  return parts;
}

export function searchHighlightParts(text, query) {
  const source = String(text ?? "");
  const phraseParts = splitWithPattern(source, phrasePattern(query));
  if (phraseParts.some((part) => part.match)) return phraseParts;
  return splitWithPattern(source, queryTokenPattern(query));
}
