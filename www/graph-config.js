export const GRAPH_CONFIG_STORAGE_KEY = "paper-map-graph-config-v1";

export const DEFAULT_GRAPH_CONFIG = Object.freeze({
  layoutEffort: 2,
  layoutSpacing: 1,
});

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizeGraphConfig(value = {}) {
  return {
    layoutEffort: boundedNumber(value.layoutEffort, DEFAULT_GRAPH_CONFIG.layoutEffort, 0.5, 6),
    layoutSpacing: boundedNumber(value.layoutSpacing, DEFAULT_GRAPH_CONFIG.layoutSpacing, 0.5, 3),
  };
}

export function loadGraphConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(GRAPH_CONFIG_STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") return normalizeGraphConfig(saved);
  } catch {
    // Graph preferences are non-critical and fall back to deterministic defaults.
  }
  return normalizeGraphConfig();
}

export function saveGraphConfig(value) {
  const normalized = normalizeGraphConfig(value);
  try {
    localStorage.setItem(GRAPH_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // A graph remains usable with defaults when localStorage is unavailable.
  }
  return normalized;
}
