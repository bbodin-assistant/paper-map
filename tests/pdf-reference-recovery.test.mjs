import test from "node:test";
import assert from "node:assert/strict";

import { detectTwoColumnSplit, recoverTwoColumnReferences } from "../www/pdf-reference-recovery.js";

function row(left, right) {
  return `${left.padEnd(58, " ")}${right}`;
}

test("detects a stable bibliography gutter", () => {
  const lines = [
    row("References", "Kevin Clark, Minh-Thang Luong, Christopher Manning,"),
    row("Alan Akbik, Duncan Blythe, and Roland Vollgraf.", "  and Quoc Le. 2018. Semi-supervised sequence modeling."),
    row("  2018. Contextual string embeddings for sequence", "Ronan Collobert and Jason Weston. 2008. A unified"),
    row("  labeling. In Proceedings of ACL.", "  architecture for natural language processing."),
    row("Rami Al-Rfou, Dokook Choe, Noah Constant, Mandy", "Alexis Conneau, Douwe Kiela, Holger Schwenk,"),
    row("  Guo, and Llion Jones. 2018. Character-level language", "  and Antoine Bordes. 2017. Supervised learning."),
    row("  modeling with deeper self-attention.", "Andrew M Dai and Quoc V Le. 2015. Semi-supervised"),
    row("Rie Kubota Ando and Tong Zhang. 2005. A framework", "  sequence learning. In NIPS."),
  ];
  assert.ok(detectTwoColumnSplit(lines) >= 56);
});

test("recovers two-column author-year references in reading order", () => {
  const page = [
    row("References", "Kevin Clark, Minh-Thang Luong, Christopher Manning,"),
    row("Alan Akbik, Duncan Blythe, and Roland Vollgraf.", "  and Quoc Le. 2018. Semi-supervised sequence modeling."),
    row("  2018. Contextual string embeddings for sequence", "Ronan Collobert and Jason Weston. 2008. A unified"),
    row("  labeling. In Proceedings of ACL.", "  architecture for natural language processing."),
    row("", ""),
    row("Rami Al-Rfou, Dokook Choe, Noah Constant, Mandy", "Alexis Conneau, Douwe Kiela, Holger Schwenk,"),
    row("  Guo, and Llion Jones. 2018. Character-level language", "  and Antoine Bordes. 2017. Supervised learning."),
    row("  modeling with deeper self-attention. arXiv:1808.04444.", "Andrew M Dai and Quoc V Le. 2015. Semi-supervised"),
    row("Rie Kubota Ando and Tong Zhang. 2005. A framework", "  sequence learning. In NIPS."),
    row("  for learning predictive structures from multiple tasks.", ""),
  ].join("\n");
  const documentText = `--- Page 10 ---\n${page}\n\n--- Page 11 ---\nA     Additional Details for BERT\nAppendix content.`;
  const refs = recoverTwoColumnReferences(documentText);
  assert.equal(refs.length, 7);
  assert.match(refs[0].rawText, /^Alan Akbik/);
  assert.match(refs[1].rawText, /^Rami Al-Rfou/);
  assert.equal(refs[1].arxivId, "1808.04444");
  assert.match(refs[3].rawText, /^Kevin Clark/);
  assert.match(refs.at(-1).rawText, /^Andrew M Dai/);
  assert.ok(refs.every((reference) => reference.pageStart === 10));
});
