export const AI_CONFIG_STORAGE_KEY = "paper-map-ai-config-v1";
export const AI_API_KEY_SESSION_KEY = "paper-map-ai-api-key-tab-v1";

const LEGACY_MODEL_KEY = "paper-map-pdf-ai-model-v1";
const LEGACY_KEY_SESSION_KEY = "paper-map-openai-key-tab";

export const AI_PROVIDER_PRESETS = Object.freeze({
  openai: Object.freeze({
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-luna",
    apiMode: "responses-pdf",
    apiKeyRequired: true,
  }),
  ollama: Object.freeze({
    id: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "gpt-oss:20b",
    apiMode: "chat-text",
    apiKeyRequired: false,
  }),
  "openai-compatible": Object.freeze({
    id: "openai-compatible",
    label: "OpenAI-compatible",
    baseUrl: "http://localhost:8000/v1",
    model: "",
    apiMode: "chat-text",
    apiKeyRequired: false,
  }),
});

function clean(value) {
  return String(value ?? "").trim();
}

export function providerPreset(provider) {
  return AI_PROVIDER_PRESETS[provider] || AI_PROVIDER_PRESETS.openai;
}

export function normalizeBaseUrl(value, fallback = AI_PROVIDER_PRESETS.openai.baseUrl) {
  const raw = clean(value) || fallback;
  return raw.replace(/\/+$/, "");
}

export function normalizeAiConfig(value = {}) {
  const provider = AI_PROVIDER_PRESETS[value.provider] ? value.provider : "openai";
  const preset = providerPreset(provider);
  return {
    provider,
    baseUrl: normalizeBaseUrl(value.baseUrl, preset.baseUrl),
    model: clean(value.model) || preset.model,
    apiMode: preset.apiMode,
    apiKeyRequired: preset.apiKeyRequired,
  };
}

function legacyModel() {
  try {
    return clean(localStorage.getItem(LEGACY_MODEL_KEY));
  } catch {
    return "";
  }
}

export function loadAiConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_CONFIG_STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") return normalizeAiConfig(saved);
  } catch {
    // Fall through to defaults / one-time legacy preference migration.
  }
  return normalizeAiConfig({ provider: "openai", model: legacyModel() });
}

export function saveAiConfig(value) {
  const normalized = normalizeAiConfig(value);
  try {
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify({
      provider: normalized.provider,
      baseUrl: normalized.baseUrl,
      model: normalized.model,
    }));
  } catch {
    // AI provider selection is a non-critical UI preference.
  }
  return normalized;
}

export function loadSessionApiKey() {
  try {
    return sessionStorage.getItem(AI_API_KEY_SESSION_KEY)
      || sessionStorage.getItem(LEGACY_KEY_SESSION_KEY)
      || "";
  } catch {
    return "";
  }
}

export function saveSessionApiKey(value, remember) {
  const key = clean(value);
  try {
    if (remember && key) sessionStorage.setItem(AI_API_KEY_SESSION_KEY, key);
    else sessionStorage.removeItem(AI_API_KEY_SESSION_KEY);
    sessionStorage.removeItem(LEGACY_KEY_SESSION_KEY);
  } catch {
    // Calls still work without session persistence.
  }
}

export function providerLabel(provider) {
  return providerPreset(provider).label;
}

export function providerUsesDirectPdf(config) {
  return normalizeAiConfig(config).apiMode === "responses-pdf";
}

export function providerNeedsApiKey(config) {
  return normalizeAiConfig(config).apiKeyRequired;
}
