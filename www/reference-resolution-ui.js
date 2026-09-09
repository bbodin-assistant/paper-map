import { resolveExtractedReference } from "./reference-resolver.js";

const $ = (selector, root = document) => root.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value) {
  return String(value ?? "").trim();
}

function canonicalSummary(canonical = {}) {
  const authors = Array.isArray(canonical.authors) ? canonical.authors.filter(Boolean) : [];
  const detail = [
    authors.length ? authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : "") : "",
    canonical.year || "",
    canonical.venue || canonical.publisher || "",
  ].filter(Boolean).join(" · ");
  return { title: clean(canonical.title), detail };
}

function resolutionLabel(resolution) {
  if (!resolution) return "Ready to resolve";
  if (resolution.status === "matched") {
    const provider = resolution.provider === "crossref" ? "Crossref" : "Semantic Scholar";
    return `${provider} · ${Math.round((Number(resolution.confidence) || 0) * 100)}% match`;
  }
  if (resolution.status === "no-identifier") return "No DOI/arXiv identifier";
  if (resolution.status === "unresolved") return "No canonical match";
  return "Resolution unavailable";
}

function renderResolution(row) {
  const body = $(".pdf-reference-body", row);
  if (!body) return;
  let panel = $(".pdf-reference-resolution", row);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "pdf-reference-resolution";
    body.append(panel);
  }

  const reference = row.__paperMapReference || {};
  const resolution = reference.resolution || null;
  const hasIdentifier = Boolean(reference.doi || reference.arxivId);
  const summary = canonicalSummary(resolution?.canonical);
  const confidence = Math.round((Number(resolution?.confidence) || 0) * 100);
  row.dataset.resolutionStatus = resolution?.status || (hasIdentifier ? "ready" : "no-identifier");
  row.dataset.resolutionConfidence = String(confidence);

  if (!resolution) {
    panel.innerHTML = hasIdentifier
      ? `<span class="reference-resolution-badge ready">${escapeHtml(resolutionLabel(null))}</span>`
      : `<span class="reference-resolution-badge muted">No DOI/arXiv identifier</span>`;
    return;
  }

  if (resolution.status === "matched") {
    panel.innerHTML = `
      <div class="reference-resolution-match">
        <span class="reference-resolution-badge matched">${escapeHtml(resolutionLabel(resolution))}</span>
        <strong>${escapeHtml(summary.title || "Canonical metadata match")}</strong>
        ${summary.detail ? `<span>${escapeHtml(summary.detail)}</span>` : ""}
      </div>
    `;
    return;
  }

  const lastAttempt = resolution.attempts?.[resolution.attempts.length - 1];
  panel.innerHTML = `
    <div class="reference-resolution-match unresolved">
      <span class="reference-resolution-badge unresolved">${escapeHtml(resolutionLabel(resolution))}</span>
      ${lastAttempt?.message ? `<span>${escapeHtml(lastAttempt.message)}</span>` : ""}
    </div>
  `;
}

function referenceRows(dialog) {
  return Array.from(dialog.querySelectorAll("#pdf-reference-list .pdf-reference-row"));
}

function updateSummary(dialog) {
  const rows = referenceRows(dialog);
  const matched = rows.filter((row) => row.__paperMapReference?.resolution?.status === "matched").length;
  const unresolved = rows.filter((row) => row.__paperMapReference?.resolution?.status === "unresolved").length;
  const identifiable = rows.filter((row) => row.__paperMapReference?.doi || row.__paperMapReference?.arxivId).length;
  const status = $("#pdf-reference-resolution-status", dialog);
  if (!status) return;
  if (!rows.length) status.textContent = "";
  else if (matched || unresolved) status.textContent = `${matched} matched · ${unresolved} unresolved · ${identifiable} identifiable`;
  else status.textContent = `${identifiable} of ${rows.length} references have DOI/arXiv identifiers`;
}

function decorateRows(dialog) {
  for (const row of referenceRows(dialog)) renderResolution(row);
  updateSummary(dialog);
}

function install(dialog) {
  if (dialog.dataset.referenceResolverInstalled === "true") return;
  dialog.dataset.referenceResolverInstalled = "true";

  const actions = $(".pdf-reference-bulk-actions", dialog);
  if (!actions) return;

  const resolveButton = document.createElement("button");
  resolveButton.type = "button";
  resolveButton.id = "pdf-reference-resolve";
  resolveButton.className = "quiet-button";
  resolveButton.textContent = "Resolve identifiers";
  actions.prepend(resolveButton);

  const status = document.createElement("span");
  status.id = "pdf-reference-resolution-status";
  status.className = "muted pdf-reference-resolution-status";
  actions.after(status);

  const note = $(".pdf-reference-note", dialog);
  if (note) {
    note.textContent = "Resolve DOI/arXiv identifiers through Crossref and Semantic Scholar, review match confidence, then choose which references to persist. Canonical graph edges are still created only after an explicit later import step.";
  }

  const list = $("#pdf-reference-list", dialog);
  const observer = new MutationObserver(() => decorateRows(dialog));
  if (list) observer.observe(list, { childList: true });
  decorateRows(dialog);

  resolveButton.addEventListener("click", async () => {
    if (resolveButton.disabled) return;
    const rows = referenceRows(dialog);
    const targets = rows.filter((row) => row.__paperMapReference?.doi || row.__paperMapReference?.arxivId);
    if (!targets.length) {
      status.textContent = "No DOI or arXiv identifiers are available to resolve.";
      return;
    }

    resolveButton.disabled = true;
    const originalText = resolveButton.textContent;
    let matched = 0;
    let unresolved = 0;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const row = targets[index];
        resolveButton.textContent = `Resolving ${index + 1}/${targets.length}…`;
        row.dataset.resolutionStatus = "resolving";
        const panel = $(".pdf-reference-resolution", row);
        if (panel) panel.innerHTML = `<span class="reference-resolution-badge resolving">Resolving…</span>`;
        const resolution = await resolveExtractedReference(row.__paperMapReference || {});
        row.__paperMapReference = {
          ...(row.__paperMapReference || {}),
          resolution,
        };
        if (resolution.status === "matched") matched += 1;
        else unresolved += 1;
        renderResolution(row);
      }
      status.textContent = `${matched} canonical matches · ${unresolved} unresolved. Review confidence before saving.`;
    } finally {
      resolveButton.disabled = false;
      resolveButton.textContent = originalText;
      updateSummary(dialog);
    }
  });
}

function start() {
  const existing = $("#pdf-ai-dialog");
  if (existing) {
    install(existing);
    return;
  }
  const observer = new MutationObserver(() => {
    const dialog = $("#pdf-ai-dialog");
    if (!dialog) return;
    observer.disconnect();
    install(dialog);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== "undefined") start();
