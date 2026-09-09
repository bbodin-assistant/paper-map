export const RESEARCH_RELATIONS = Object.freeze([
  { id: "builds_on", label: "Builds on", inverseLabel: "Built on by" },
  { id: "improves_on", label: "Improves on", inverseLabel: "Improved by" },
  { id: "extends", label: "Extends", inverseLabel: "Extended by" },
  { id: "outperforms", label: "Outperforms", inverseLabel: "Outperformed by" },
  { id: "invalidates", label: "Invalidates", inverseLabel: "Invalidated by" },
  { id: "contradicts", label: "Contradicts", inverseLabel: "Contradicted by" },
  { id: "supports", label: "Supports", inverseLabel: "Supported by" },
  { id: "replicates", label: "Replicates", inverseLabel: "Replicated by" },
]);

const RELATION_BY_ID = new Map(RESEARCH_RELATIONS.map((relation) => [relation.id, relation]));

export function researchRelation(type) {
  return RELATION_BY_ID.get(String(type || "")) || null;
}

export function relationLabel(type, { inverse = false } = {}) {
  const relation = researchRelation(type);
  if (!relation) return String(type || "Research link").replaceAll("_", " ");
  return inverse ? relation.inverseLabel : relation.label;
}

export function isResearchRelation(edge) {
  return edge?.kind === "research-relation" && Boolean(researchRelation(edge.relation));
}

export function isCitationEdge(edge) {
  return Boolean(edge) && !isResearchRelation(edge);
}

export function researchRelationEdgeId(source, target, relation) {
  const canonical = researchRelation(relation);
  if (!canonical) throw new Error(`Unknown research relation: ${relation}`);
  if (!source || !target || source === target) throw new Error("A research relationship needs two different papers.");
  return `relation:${canonical.id}:${source}->${target}`;
}

export function createResearchRelationEdge({ source, target, relation, provenance = "manual", createdAt = new Date().toISOString() }) {
  const canonical = researchRelation(relation);
  if (!canonical) throw new Error(`Unknown research relation: ${relation}`);
  return {
    id: researchRelationEdgeId(source, target, canonical.id),
    source,
    target,
    kind: "research-relation",
    relation: canonical.id,
    provenance,
    createdAt,
  };
}
