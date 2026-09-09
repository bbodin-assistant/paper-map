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
Abstract—Timing analysis of cause-effect chains in automotive embedded systems.

--- Page 2 ---
Body text.`;

test("extracts title and authors conservatively from the real ScienceDirect-paper front matter", () => {
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
