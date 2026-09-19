export const PAPER_PROVIDER_CONFIG_STORAGE_KEY = "paper-map-paper-provider-config-v1";
export const SEMANTIC_SCHOLAR_KEY_SESSION_KEY = "paper-map-semantic-scholar-key-tab-v1";

const LEGACY_SEMANTIC_SCHOLAR_KEY = "paper-map-semantic-scholar-key";
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;

export const PAPER_PROVIDER_PRESETS = Object.freeze({
  "semantic-scholar": Object.freeze({ id: "semantic-scholar", label: "Semantic Scholar" }),
  openalex: Object.freeze({ id: "openalex", label: "OpenAlex" }),
  crossref: Object.freeze({ id: "crossref", label: "Crossref" }),
  auto: Object.freeze({ id: "auto", label: "Automatic merge" }),
});

export const PAPER_SEARCH_PROVIDER_IDS = Object.freeze([
  "semantic-scholar",
  "openalex",
  "crossref",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeSearchLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SEARCH_LIMIT;
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.round(number)));
}

function legacySearchProviders(provider) {
  const enabledIds = provider === "auto" ? new Set(PAPER_SEARCH_PROVIDER_IDS) : new Set([provider]);
  return Object.fromEntries(PAPER_SEARCH_PROVIDER_IDS.map((id) => [
    id,
    { enabled: enabledIds.has(id), limit: DEFAULT_SEARCH_LIMIT },
  ]));
}

export function normalizePaperProviderConfig(value = {}) {
  const provider = PAPER_PROVIDER_PRESETS[value.provider] ? value.provider : "semantic-scholar";
  const fallback = legacySearchProviders(provider);
  const savedSearchProviders = value.searchProviders && typeof value.searchProviders === "object"
    ? value.searchProviders
    : null;
  const searchProviders = Object.fromEntries(PAPER_SEARCH_PROVIDER_IDS.map((id) => {
    const saved = savedSearchProviders?.[id];
    return [
      id,
      {
        enabled: saved && typeof saved === "object" ? saved.enabled !== false : fallback[id].enabled,
        limit: normalizeSearchLimit(saved?.limit ?? fallback[id].limit),
      },
    ];
  }));
  if (!PAPER_SEARCH_PROVIDER_IDS.some((id) => searchProviders[id].enabled)) {
    searchProviders[provider === "auto" ? "semantic-scholar" : provider].enabled = true;
  }
  return { provider, searchProviders };
}

export function loadPaperProviderConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(PAPER_PROVIDER_CONFIG_STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") return normalizePaperProviderConfig(saved);
  } catch {
    // Provider selection is a non-critical local UI preference.
  }
  return normalizePaperProviderConfig();
}

export function savePaperProviderConfig(value) {
  const normalized = normalizePaperProviderConfig(value);
  try {
    localStorage.setItem(PAPER_PROVIDER_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Calls still work with the default provider when preference storage is unavailable.
  }
  return normalized;
}

export function paperProviderLabel(provider) {
  return PAPER_PROVIDER_PRESETS[provider]?.label || PAPER_PROVIDER_PRESETS["semantic-scholar"].label;
}

export function enabledPaperSearchProviders(config = loadPaperProviderConfig()) {
  const normalized = normalizePaperProviderConfig(config);
  return PAPER_SEARCH_PROVIDER_IDS
    .filter((id) => normalized.searchProviders[id].enabled)
    .map((id) => ({
      id,
      label: paperProviderLabel(id),
      limit: normalized.searchProviders[id].limit,
    }));
}

export function loadSemanticScholarApiKey() {
  try {
    return sessionStorage.getItem(SEMANTIC_SCHOLAR_KEY_SESSION_KEY)
      || localStorage.getItem(LEGACY_SEMANTIC_SCHOLAR_KEY)
      || "";
  } catch {
    return "";
  }
}

export function saveSemanticScholarApiKey(value, rememberForTab = true) {
  const key = clean(value);
  try {
    if (rememberForTab && key) sessionStorage.setItem(SEMANTIC_SCHOLAR_KEY_SESSION_KEY, key);
    else sessionStorage.removeItem(SEMANTIC_SCHOLAR_KEY_SESSION_KEY);
  } catch {
    // Semantic Scholar also works without an API key, subject to public rate limits.
  }
  return key;
}
