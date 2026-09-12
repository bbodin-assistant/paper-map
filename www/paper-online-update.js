import { loadLibrary, putPapers } from "./db.js";
import { mergePaperRecords } from "./import-export.js";
import { fetchReferences, resolvePaper } from "./paper-provider.js?v=0.4.5";
import { mergeReferenceRecords, providerPapersToReferences } from "./provider-references.js?v=0.4.5";

function clean(value) {
  return String(value ?? "").trim();
}

function selectedPaperId(root = document) {
  return root.querySelector("#paper-list .paper-list-item.selected[data-paper-id]")?.dataset.paperId || "";
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function ensureSection(root = document) {
  let section = root.querySelector("#paper-online-update");
  if (section) return section;
  const abstract = root.querySelector("#detail-abstract")?.closest?.(".detail-section");
  if (!abstract) return null;
  section = root.createElement("section");
  section.id = "paper-online-update";
  section.className = "detail-section paper-online-update";
  section.innerHTML = `
    <div class="section-heading">
      <div>
        <h3>Online metadata update</h3>
        <span class="muted">Propose a title to look up this work again and merge fresher provider metadata.</span>
      </div>
    </div>
    <div class="paper-online-update-controls">
      <label class="full-width">Lookup title
        <input id="paper-online-update-title" type="search" autocomplete="off" />
      </label>
      <button type="button" id="paper-online-update-run">Update online</button>
    </div>
    <small id="paper-online-update-status" class="muted" role="status" aria-live="polite"></small>
  `;
  abstract.after(section);
  return section;
}

function installStyles(root = document) {
  if (root.querySelector("#paper-online-update-styles")) return;
  const style = root.createElement("style");
  style.id = "paper-online-update-styles";
  style.textContent = `
    .paper-online-update-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; align-items: end; }
    .paper-online-update-controls label { display: grid; gap: 5px; }
    #paper-online-update-status { display: block; margin-top: 7px; line-height: 1.4; }
    @media (max-width: 720px) { .paper-online-update-controls { grid-template-columns: 1fr; } }
  `;
  root.head?.append(style);
}

export function initPaperOnlineUpdate(root = document) {
  if (!root?.querySelector || !root?.createElement) return false;
  const detail = root.querySelector("#paper-detail");
  const paperList = root.querySelector("#paper-list");
  if (!detail || !paperList) return false;
  installStyles(root);
  const section = ensureSection(root);
  if (!section) return false;
  const input = root.querySelector("#paper-online-update-title");
  const button = root.querySelector("#paper-online-update-run");
  const status = root.querySelector("#paper-online-update-status");
  if (!input || !button || !status) return false;

  let lastPaperId = "";
  let busy = false;

  async function syncSelection() {
    const paperId = selectedPaperId(root);
    if (!paperId || detail.hidden) {
      section.hidden = true;
      lastPaperId = "";
      return;
    }
    section.hidden = false;
    if (paperId === lastPaperId || busy) return;
    lastPaperId = paperId;
    const library = await loadLibrary();
    const paper = library.papers.find((candidate) => candidate.id === paperId);
    input.value = paper?.title || "";
    status.textContent = "";
  }

  button.addEventListener("click", async () => {
    const paperId = selectedPaperId(root);
    const proposedTitle = clean(input.value);
    if (!paperId || !proposedTitle || busy) return;
    busy = true;
    button.disabled = true;
    input.disabled = true;
    status.textContent = `Looking up “${proposedTitle}”…`;
    try {
      const library = await loadLibrary();
      const existing = library.papers.find((paper) => paper.id === paperId);
      if (!existing) throw new Error("The selected paper is no longer in the local library.");

      const online = await resolvePaper(proposedTitle);
      const provider = online.providerPrimary || online.source || "online";
      let providerReferences = mergeReferenceRecords(online.references || []);
      let referenceWarning = "";
      if (provider !== "crossref") {
        try {
          const result = await fetchReferences(online, 0, 100);
          providerReferences = mergeReferenceRecords(
            providerReferences,
            providerPapersToReferences(result.papers || [], result.provider || provider),
          );
        } catch (error) {
          referenceWarning = error?.message || String(error);
        }
      }
      const updatedReferences = mergeReferenceRecords(
        existing.extractedReferences || [],
        providerReferences,
      ).map((reference) => ({ ...reference, reviewed: true }));

      const merged = mergePaperRecords(existing, online);
      const updated = {
        ...merged,
        id: existing.id,
        source: existing.source || merged.source,
        libraryEntry: existing.libraryEntry,
        extractedReferences: updatedReferences,
        metadataSources: uniqueStrings([
          ...(existing.metadataSources || []),
          ...(online.metadataSources || [provider]),
        ]),
        onlineExtraction: {
          provider,
          metadataSources: online.metadataSources || [provider],
          query: proposedTitle,
          referenceCount: providerReferences.length,
          totalStoredReferenceRecords: updatedReferences.length,
          extractedAt: new Date().toISOString(),
        },
      };
      await putPapers([updated]);

      const message = providerReferences.length
        ? `Updated from ${provider} and added ${providerReferences.length} provider reference${providerReferences.length === 1 ? "" : "s"}.`
        : referenceWarning
          ? `Metadata updated from ${provider}. Provider references were unavailable: ${referenceWarning}`
          : `Metadata updated from ${provider}.`;
      status.textContent = message;
      input.value = updated.title || proposedTitle;
      root.dispatchEvent(new CustomEvent("paper-map-library-updated", {
        bubbles: true,
        detail: { paperId: existing.id, message },
      }));
    } catch (error) {
      status.textContent = error?.message || String(error);
    } finally {
      busy = false;
      button.disabled = false;
      input.disabled = false;
    }
  });

  let queued = false;
  const queueSync = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncSelection().catch(() => {});
    });
  };
  const observer = new MutationObserver(queueSync);
  observer.observe(detail, { attributes: true, attributeFilter: ["hidden"] });
  observer.observe(paperList, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  queueSync();
  return true;
}

function initWhenReady() {
  if (typeof document === "undefined") return;
  if (initPaperOnlineUpdate(document)) return;
  const observer = new MutationObserver(() => {
    if (!initPaperOnlineUpdate(document)) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

initWhenReady();
