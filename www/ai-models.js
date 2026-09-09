import { normalizeAiConfig, providerLabel } from "./ai-config.js";

function clean(value) {
  return String(value ?? "").trim();
}

export function aiModelsEndpoint(config) {
  const normalized = normalizeAiConfig(config);
  return `${normalized.baseUrl}/models`;
}

export function normalizeDiscoveredModels(body) {
  const values = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : [];
  const seen = new Set();
  const models = [];
  for (const value of values) {
    const id = clean(typeof value === "string" ? value : value?.id || value?.name || value?.model);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
  }
  return models.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

export async function discoverAiModels({
  config,
  apiKey = "",
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for AI model discovery.");
  const normalized = normalizeAiConfig(config);
  const headers = { Accept: "application/json" };
  const key = clean(apiKey);
  if (key) headers.Authorization = `Bearer ${key}`;

  const response = await fetchImpl(aiModelsEndpoint(normalized), {
    method: "GET",
    headers,
    signal,
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error?.message
      || body?.message
      || `${providerLabel(normalized.provider)} model discovery failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const models = normalizeDiscoveredModels(body);
  if (!models.length) throw new Error(`${providerLabel(normalized.provider)} returned no models from ${aiModelsEndpoint(normalized)}.`);
  return models;
}
