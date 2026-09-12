export function paperCitationSummary(paper = {}, citationEdges = [], researchLinkCount = 0) {
  const paperId = paper.id;
  const extracted = Array.isArray(paper.extractedReferences) ? paper.extractedReferences.length : 0;
  const referencePapersStored = (citationEdges || []).filter((edge) => edge?.source === paperId).length;
  const citingPapersStored = (citationEdges || []).filter((edge) => edge?.target === paperId).length;
  const providerTotal = Number(paper.citationCount);
  const hasProviderTotal = Number.isFinite(providerTotal) && providerTotal >= 0;
  const citing = hasProviderTotal
    ? `${citingPapersStored} / ${providerTotal} stored`
    : `${citingPapersStored} stored`;
  return `References: ${extracted} extracted · ${referencePapersStored} stored in graph · Citing papers: ${citing} · Research links: ${Number(researchLinkCount) || 0}`;
}
