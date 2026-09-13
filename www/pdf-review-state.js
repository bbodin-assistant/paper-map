function clean(value) {
  return String(value ?? "").trim();
}

function normalizedText(value) {
  return clean(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function pdfFileStem(name) {
  return clean(name)
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validPdfReviewYear(value) {
  const year = Number(clean(value));
  return Number.isInteger(year) && year > 0;
}

export function validPdfReviewDoi(value) {
  const normalized = clean(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  return Boolean(normalized && /^10\.\d{4,9}\/\S+$/i.test(normalized));
}

export function validPdfReviewArxiv(value) {
  const normalized = clean(value).replace(/^arxiv:\s*/i, "");
  return Boolean(normalized && /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i.test(normalized));
}

export function pdfReviewLookupState({
  title = "",
  authors = [],
  year = null,
  doi = "",
  arxivId = "",
  fileName = "",
  localStatus = "",
  onlineStatus = "",
} = {}) {
  const finalLocal = localStatus === "complete" || localStatus === "error";
  const titleText = clean(title);
  const titleIsFilenameFallback = Boolean(titleText)
    && normalizedText(titleText) === normalizedText(pdfFileStem(fileName));
  const titleAvailable = Boolean(titleText) && !titleIsFilenameFallback;
  const authorValues = Array.isArray(authors)
    ? authors.map(clean).filter(Boolean)
    : clean(authors).split(/\n+/).map(clean).filter(Boolean);
  const authorsAvailable = authorValues.length > 0;
  const yearAvailable = validPdfReviewYear(year);
  const doiText = clean(doi);
  const arxivText = clean(arxivId);
  const doiAvailable = validPdfReviewDoi(doiText);
  const arxivAvailable = validPdfReviewArxiv(arxivText);

  const fields = {
    title: finalLocal ? (titleAvailable ? "available" : "missing") : "neutral",
    authors: finalLocal ? (authorsAvailable ? "available" : "missing") : "neutral",
    year: finalLocal ? (yearAvailable ? "available" : "missing") : "neutral",
    doi: finalLocal
      ? (doiAvailable ? "available" : doiText ? "invalid" : "neutral")
      : "neutral",
    arxivId: finalLocal
      ? (arxivAvailable ? "available" : arxivText ? "invalid" : "neutral")
      : "neutral",
  };

  const searchable = titleAvailable || doiAvailable || arxivAvailable;
  let tab = "working";
  if (onlineStatus === "complete") tab = "resolved";
  else if (localStatus === "error") tab = "error";
  else if (localStatus === "complete") tab = searchable ? "searchable" : "error";

  return {
    fields,
    searchable,
    titleAvailable,
    authorsAvailable,
    yearAvailable,
    doiAvailable,
    arxivAvailable,
    tab,
  };
}
