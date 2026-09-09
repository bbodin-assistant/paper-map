import test from "node:test";
import assert from "node:assert/strict";

import { extractLocalPaperMetadata, firstPageText } from "../www/pdf-metadata.js";

const SCIENCEDIRECT_PUBLIC_COPY_FRONT_MATTER = `--- Page 1 ---
End-to-End Timing Analysis of Cause-Effect
Chains in Automotive Embedded Systems
Matthias Becker∗, Dakshina Dasari†, Saad Mubeen∗‡, Moris Behnam∗, Thomas Nolte∗
∗Mälardalen Real-Time Research Centre (MRTC), Mälardalen University, Västerås, Sweden
†Robert Bosch GmbH, Corporate Research, Renningen, Germany
‡Arcticus Systems AB, Järfälla, Sweden
{matthias.becker, saad.mubeen, moris.behnam, thomas.nolte}@mdh.se
Most of these automotive applications typically have strict timing constraints.
Abstract—Timing analysis of cause-effect chains in automotive embedded systems.

--- Page 2 ---
Body text.`;

test("extracts exactly the real ScienceDirect-paper title and authors without prose", () => {
  const metadata = extractLocalPaperMetadata(SCIENCEDIRECT_PUBLIC_COPY_FRONT_MATTER, { fallbackTitle: "4877" });
  assert.equal(metadata.title, "End-to-End Timing Analysis of Cause-Effect Chains in Automotive Embedded Systems");
  assert.deepEqual(metadata.authors, [
    "Matthias Becker",
    "Dakshina Dasari",
    "Saad Mubeen",
    "Moris Behnam",
    "Thomas Nolte",
  ]);
  assert.equal(metadata.doi, "", "The public PDF copy does not expose the source-paper DOI in front matter, so local extraction must not invent it");
  assert.equal(metadata.evidence.authorCount, 5);
});

test("recovers marked authors and title from deglued arXiv front matter", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
Provided proper attribution is provided, Google hereby grants permission to reproduce the tables and figures in this paper solely for use in journalistic or scholarly works. Attention Is All You Need 3202 guA 2 ]LC.sc[ 7v26730.6071:viXra AshishVaswani∗ GoogleBrain avaswani@google.com NoamShazeer∗ GoogleBrain noam@google.com NikiParmar∗ GoogleResearch nikip@google.com JakobUszkoreit∗ GoogleResearch usz@google.com LlionJones∗ GoogleResearch llion@google.com AidanNGomez∗ University of Toronto aidan@cs.toronto.edu LukaszKaiser∗ GoogleBrain lukaszkaiser@google.com IlliaPolosukhin∗ illia.polosukhin@gmail.com
Abstract
`, { fallbackTitle: "attention-is-all-you-need" });
  assert.equal(metadata.title, "Attention Is All You Need");
  assert.deepEqual(metadata.authors, [
    "Ashish Vaswani",
    "Noam Shazeer",
    "Niki Parmar",
    "Jakob Uszkoreit",
    "Llion Jones",
    "Aidan N Gomez",
    "Lukasz Kaiser",
    "Illia Polosukhin",
  ]);
});

test("separates an inline first author across layout spacer rows", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
Deep Residual Learning for Image Recognition Kaiming He


Xiangyu Zhang Shaoqing Ren Jian Sun

Microsoft Research
{kahe, v-xiangz, v-shren, jiansun}@microsoft.com
arXiv:1512.03385v1 [cs.CV] 10 Dec 2015
Abstract
`, { fallbackTitle: "resnet" });
  assert.equal(metadata.title, "Deep Residual Learning for Image Recognition");
  assert.deepEqual(metadata.authors, ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"]);
  assert.equal(metadata.arxivId, "1512.03385v1");
});

test("extracts a source DOI only when it is present in front matter", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
A Deterministic Systems Paper
Ada Lovelace, Grace Hopper
Example Research Institute
https://doi.org/10.1016/J.SYSARC.2017.09.004
Abstract
Body`, { fallbackTitle: "paper" });
  assert.equal(metadata.title, "A Deterministic Systems Paper");
  assert.deepEqual(metadata.authors, ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(metadata.doi, "10.1016/j.sysarc.2017.09.004");
});

test("does not mistake a bibliography DOI for the uploaded paper DOI", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
Source Paper Without DOI
Ada Lovelace, Grace Hopper
Example University
Abstract
Body

--- Page 8 ---
References
[1] Cited Work. doi:10.5555/CITED.123`, { fallbackTitle: "paper" });
  assert.equal(metadata.doi, "");
});

test("firstPageText ignores later pages", () => {
  assert.equal(firstPageText("--- Page 1 ---\nFirst\n\n--- Page 2 ---\nSecond"), "First");
});