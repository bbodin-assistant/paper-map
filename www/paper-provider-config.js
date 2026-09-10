export const PAPER_PROVIDER_CONFIG_STORAGE_KEY = "paper-map-paper-provider-config-v1";
export const SEMANTIC_SCHOLAR_KEY_SESSION_KEY = "paper-map-semantic-scholar-key-tab-v1";

const LEGACY_SEMANTIC_SCHOLAR_KEY = "paper-map-semantic-scholar-key";

export const PAPER_PROVIDER_PRESETS = Object.freeze({
  "semantic-scholar": Object.freeze({ id: "semantic-scholar", label: "Semantic Scholar" }),
  openalex: Object.freeze({ id: "openalex", label: "OpenAlex" }),
  crossref: Object.freeze({ id: "crossref", label: "Crossref" }),
  auto: Object.freeze({ id: "auto", label: "Automatic merge" }),
});

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizePaperProviderConfig(value = {}) {
  const provider = PAPER_PROVIDER_PRESETS[value.provider] ? value.provider : "semantic-scholar";
  return { provider };
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
