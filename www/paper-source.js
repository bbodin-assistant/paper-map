const SOURCE_LABELS = {
  demo: "Bundled demo dataset",
  "demo-dataset": "Bundled demo dataset",
  bibtex: "BibTeX import",
  "bibtex-import": "BibTeX import",
  "semantic-scholar": "Semantic Scholar",
  "semantic-scholar-resolve": "Semantic Scholar lookup",
  "semantic-scholar-enrichment": "Semantic Scholar enrichment",
  "semantic-scholar-expansion": "Semantic Scholar citation expansion",
  "ai-pdf": "Reviewed AI PDF extraction",
  "local-pdf": "Reviewed local PDF extraction",
  "backup-merge": "Paper Map backup merge",
};

export function paperEntrySource(paper = {}) {
  return String(paper?.libraryEntry?.method || paper?.source || "unknown").trim() || "unknown";
}

export function sourceLabel(value) {
  const key = String(value || "unknown").trim() || "unknown";
  return SOURCE_LABELS[key] || key.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function installSourceFilterControl(root = document) {
  if (!root?.querySelector || root.querySelector("#filter-source")) return root?.querySelector?.("#filter-source") || null;
  const grid = root.querySelector(".filter-grid");
  if (!grid) return null;
  const label = root.createElement("label");
  label.textContent = "Entry source";
  const select = root.createElement("select");
  select.id = "filter-source";
  select.append(new Option("Any entry source", ""));
  label.append(select);
  const starred = root.querySelector("#filter-starred")?.closest("label");
  if (starred) grid.insertBefore(label, starred);
  else grid.append(label);
  return select;
}
