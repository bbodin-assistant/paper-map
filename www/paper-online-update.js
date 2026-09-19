import { loadLibrary, putPapers } from "./db.js";
import { mergePaperRecords } from "./import-export.js";
import { fetchReferencesWithProvider } from "./paper-provider.js?v=0.4.11";
import { mergeReferenceRecords, providerPapersToReferences } from "./provider-references.js?v=0.4.5";
import { startPaperCandidateSearch } from "./paper-candidate-search.js?v=0.4.11";
import { renderPaperCandidatePicker } from "./paper-candidate-ui.js?v=0.4.11";
import { paperProviderLabel } from "./paper-provider-config.js?v=0.4.11";

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
        <span class="muted">Search the configured providers by title, then choose the exact work before metadata is merged.</span>
      </div>
    </div>
    <div class="paper-online-update-controls">
      <label class="full-width">Lookup title
        <input id="paper-online-update-title" type="search" autocomplete="off" />
      </label>
      <button type="button" id="paper-online-update-run">Update online</button>
    </div>
    <small id="paper-online-update-status" class="muted" role="status" aria-live="polite"></small>
    <div id="paper-online-update-candidates" class="add-paper-candidates paper-online-update-candidates" hidden aria-live="polite"></div>
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
    .paper-online-update-candidates { margin-top: 9px; max-height: 360px; }
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
  const candidates = root.querySelector("#paper-online-update-candidates");
  if (!input || !button || !status || !candidates) return false;

  let lastPaperId = "";
  let busy = false;
  let searchSession = null;
  let searchQuery = "";

  function clearCandidates() {
    candidates.replaceChildren();
    candidates.hidden = true;
  }

  function cancelSearch({ clear = true } = {}) {
    searchSession?.cancel();
    searchSession = null;
    searchQuery = "";
    if (clear) clearCandidates();
    button.disabled = busy;
  }

  async function syncSelection() {
    const paperId = selectedPaperId(root);
    if (!paperId || detail.hidden) {
      cancelSearch();
      section.hidden = true;
      lastPaperId = "";
      return;
    }
    section.hidden = false;
    if (paperId === lastPaperId || busy) return;
    cancelSearch();
    lastPaperId = paperId;
    const library = await loadLibrary();
    const paper = library.papers.find((candidate) => candidate.id === paperId);
    input.value = paper?.title || "";
    status.textContent = "";
  }

  async function applyCandidate(online, providerId, selectedCandidateRank, query) {
    const paperId = selectedPaperId(root);
    if (!paperId || !online || busy) return;
    busy = true;
    cancelSearch();
    button.disabled = true;
    input.disabled = true;
    status.textContent = `Loading selected ${paperProviderLabel(providerId)} paper…`;
    try {
      const library = await loadLibrary();
      const existing = library.papers.find((paper) => paper.id === paperId);
      if (!existing) throw new Error("The selected paper is no longer in the local library.");

      const provider = online.providerPrimary || online.source || providerId;
      let providerReferences = mergeReferenceRecords(online.references || []);
      let referenceWarning = "";
      if (providerId !== "crossref") {
        try {
          const result = await fetchReferencesWithProvider(providerId, online, 0, 100);
          providerReferences = mergeReferenceRecords(
            providerReferences,
            providerPapersToReferences(result.papers || [], result.provider || providerId),
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
          query,
          selectedBy: "user",
          selectedCandidateRank,
          referenceCount: providerReferences.length,
          totalStoredReferenceRecords: updatedReferences.length,
          extractedAt: new Date().toISOString(),
        },
      };
      await putPapers([updated]);

      const message = providerReferences.length
        ? `Updated from ${paperProviderLabel(providerId)} and added ${providerReferences.length} provider reference${providerReferences.length === 1 ? "" : "s"}.`
        : referenceWarning
          ? `Metadata updated from ${paperProviderLabel(providerId)}. Provider references were unavailable: ${referenceWarning}`
          : `Metadata updated from ${paperProviderLabel(providerId)}.`;
      status.textContent = message;
      input.value = updated.title || query;
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
  }

  function startSearch() {
    const paperId = selectedPaperId(root);
    const proposedTitle = clean(input.value);
    if (!paperId || !proposedTitle || busy) return;
    cancelSearch();
    searchQuery = proposedTitle;
    status.textContent = `Searching configured providers for “${proposedTitle}”…`;
    button.disabled = true;
    const session = startPaperCandidateSearch(proposedTitle, {
      onUpdate(snapshot) {
        if (searchSession !== session && searchSession !== null) return;
        renderPaperCandidatePicker(candidates, {
          ...snapshot,
          onSelect: (paper, providerId, rank) => applyCandidate(paper, providerId, rank, proposedTitle),
        });
        const { totals } = snapshot;
        if (totals.finished < totals.providers) {
          status.textContent = `Searching ${totals.providers} providers… ${totals.candidates} candidate${totals.candidates === 1 ? "" : "s"} available so far.`;
        } else if (totals.candidates) {
          status.textContent = `Found ${totals.candidates} candidate${totals.candidates === 1 ? "" : "s"}. Choose the exact paper to update.`;
        } else {
          status.textContent = "No matching papers were returned by the enabled providers.";
        }
      },
    });
    searchSession = session;
    session.promise.finally(() => {
      if (searchSession === session) {
        searchSession = null;
        button.disabled = busy;
      }
    });
  }

  button.addEventListener("click", startSearch);
  input.addEventListener("input", () => {
    if (searchSession && clean(input.value) !== searchQuery) {
      cancelSearch();
      status.textContent = "";
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
