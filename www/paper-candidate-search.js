import { findPaperCandidatesWithProvider } from "./paper-provider.js?v=0.4.12";
import { enabledPaperSearchProviders, loadPaperProviderConfig } from "./paper-provider-config.js?v=0.4.11";
import { rankOnlineCandidates } from "./online-candidates.js?v=0.4.12";

function clean(value) {
  return String(value ?? "").trim();
}

export function paperCandidateSearchTotals(providerStates = []) {
  return {
    candidates: providerStates.reduce((sum, item) => sum + (item.candidates?.length || 0), 0),
    finished: providerStates.filter((item) => item.status !== "searching").length,
    providers: providerStates.length,
  };
}

export function startPaperCandidateSearch(query, {
  providers = enabledPaperSearchProviders(loadPaperProviderConfig()),
  search = findPaperCandidatesWithProvider,
  onUpdate = () => {},
} = {}) {
  const text = clean(query);
  if (!text) throw new Error("A paper title or identifier is required.");
  const normalizedProviders = providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    limit: provider.limit,
  }));
  const states = new Map(normalizedProviders.map((provider) => [
    provider.id,
    { ...provider, status: "searching", candidates: [], error: "" },
  ]));
  const controllers = new Map();
  let cancelled = false;

  const snapshot = () => {
    const providerStates = normalizedProviders.map((provider) => {
      const state = states.get(provider.id);
      return { ...state, candidates: [...(state?.candidates || [])] };
    });
    return {
      query: text,
      providerStates,
      totals: paperCandidateSearchTotals(providerStates),
      cancelled,
    };
  };

  const notify = () => {
    if (!cancelled) onUpdate(snapshot());
  };

  notify();
  const promise = Promise.all(normalizedProviders.map(async (provider) => {
    const controller = new AbortController();
    controllers.set(provider.id, controller);
    try {
      const raw = await search(provider.id, text, provider.limit, { signal: controller.signal });
      if (cancelled) return;
      const state = states.get(provider.id);
      if (!state) return;
      state.status = "complete";
      state.candidates = rankOnlineCandidates(raw || [], text);
      state.error = "";
    } catch (error) {
      if (cancelled || error?.name === "AbortError") return;
      const state = states.get(provider.id);
      if (!state) return;
      state.status = "error";
      state.candidates = [];
      state.error = error?.message || String(error);
    } finally {
      if (controllers.get(provider.id) === controller) controllers.delete(provider.id);
      notify();
    }
  })).then(() => snapshot());

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    },
    promise,
    snapshot,
  };
}
