export const GRAPH_CONFIG_STORAGE_KEY = "paper-map-graph-config-v1";

export const TIMELINE_CLUSTER_FIELD_OPTIONS = Object.freeze([
  Object.freeze({ id: "title", label: "Title" }),
  Object.freeze({ id: "keywords", label: "Keywords" }),
  Object.freeze({ id: "abstract", label: "Abstract" }),
  Object.freeze({ id: "authors", label: "Authors" }),
  Object.freeze({ id: "venue", label: "Venue" }),
]);

export const TOPIC_LAYOUT_OPTIONS = Object.freeze([
  Object.freeze({ id: "generality", label: "Generality · most-used topics left" }),
  Object.freeze({ id: "gravity", label: "Gravity · connected topics attract" }),
  Object.freeze({ id: "hierarchy", label: "Co-author network · deterministic columns" }),
]);

export const AUTHOR_LAYOUT_OPTIONS = Object.freeze([
  Object.freeze({ id: "coauthors", label: "Co-authors · most collaborators left" }),
  Object.freeze({ id: "gravity", label: "Gravity · connected authors attract" }),
  Object.freeze({ id: "hierarchy", label: "Citation hierarchy · directional columns" }),
]);

const TIMELINE_CLUSTER_FIELD_IDS = new Set(TIMELINE_CLUSTER_FIELD_OPTIONS.map((option) => option.id));
const TOPIC_LAYOUT_IDS = new Set(TOPIC_LAYOUT_OPTIONS.map((option) => option.id));
const AUTHOR_LAYOUT_IDS = new Set(AUTHOR_LAYOUT_OPTIONS.map((option) => option.id));
const DEFAULT_TIMELINE_CLUSTER_FIELDS = Object.freeze(["title", "keywords", "abstract"]);

export const DEFAULT_GRAPH_CONFIG = Object.freeze({
  layoutEffort: 2,
  layoutSpacing: 1,
  topicLayoutTechnique: "generality",
  authorLayoutTechnique: "coauthors",
  timelineClusterCount: 5,
  timelineClusterFields: DEFAULT_TIMELINE_CLUSTER_FIELDS,
});

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizedTimelineClusterFields(value) {
  if (!Array.isArray(value)) return [...DEFAULT_TIMELINE_CLUSTER_FIELDS];
  const fields = Array.from(new Set(value.map((field) => String(field || "").trim()).filter((field) => TIMELINE_CLUSTER_FIELD_IDS.has(field))));
  return fields.length ? fields : [...DEFAULT_TIMELINE_CLUSTER_FIELDS];
}

function normalizedChoice(value, allowed, fallback) {
  const candidate = String(value || "").trim();
  return allowed.has(candidate) ? candidate : fallback;
}

export function normalizeGraphConfig(value = {}) {
  return {
    layoutEffort: boundedNumber(value.layoutEffort, DEFAULT_GRAPH_CONFIG.layoutEffort, 0.5, 6),
    layoutSpacing: boundedNumber(value.layoutSpacing, DEFAULT_GRAPH_CONFIG.layoutSpacing, 0.5, 3),
    topicLayoutTechnique: normalizedChoice(value.topicLayoutTechnique, TOPIC_LAYOUT_IDS, DEFAULT_GRAPH_CONFIG.topicLayoutTechnique),
    authorLayoutTechnique: normalizedChoice(value.authorLayoutTechnique, AUTHOR_LAYOUT_IDS, DEFAULT_GRAPH_CONFIG.authorLayoutTechnique),
    timelineClusterCount: Math.round(boundedNumber(value.timelineClusterCount, DEFAULT_GRAPH_CONFIG.timelineClusterCount, 1, 12)),
    timelineClusterFields: normalizedTimelineClusterFields(value.timelineClusterFields),
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
