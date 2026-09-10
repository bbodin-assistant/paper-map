import test from "node:test";
import assert from "node:assert/strict";

import { extractLocalPaperMetadata, firstPageText, repairTrailingTitleAuthor } from "../www/pdf-metadata.js";

test("handles numeric affiliations, multiline titles and publication footers", () => {
  const result = extractLocalPaperMetadata(`--- Page 1 ---
12.4
Reliable Communication for Distributed
Control Systems
Ada Lovelace1,2 · Grace Hopper2
Published online: 12 May 2022
Abstract
Body discusses older work from 1999.
https://doi.org/10.1234/source.22
Copyright2022ACM
--- Page 2 ---
References
10.1234/unrelated.99`);
  assert.equal(result.title, "Reliable Communication for Distributed Control Systems");
  assert.deepEqual(result.authors, ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(result.year, 2022);
  assert.equal(result.doi, "10.1234/source.22");
});

test("recovers small-cap header names from the ACM self-citation", () => {
  const result = extractLocalPaperMetadata(`--- Page 1 ---
Reliable Communication for Distributed Systems
42
ADALOVELACE,ExampleUniversity
GRACEHOPPER,ExampleInstitute
An abstract without a heading.
ACMReferenceformat:
AdaLovelace,andGraceHopper.2022.ReliableCommunicationforDistributedSystems.
ACM Trans. Example.
https://doi.org/10.1234/example`);
  assert.equal(result.title, "Reliable Communication for Distributed Systems");
  assert.deepEqual(result.authors, ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(result.year, 2022);
});

test("strips letter affiliations only when matching affiliations are present", () => {
  const result = extractLocalPaperMetadata(`--- Page 1 ---
An Analysis of Distributed Systems
Ada Lovelace⁎,a, Grace Hopperb
aExampleUniversity
bExampleInstitute
A B S T R A C T
Body text.`);
  assert.equal(result.title, "An Analysis of Distributed Systems");
  assert.deepEqual(result.authors, ["Ada Lovelace", "Grace Hopper"]);
});

test("recognizes author links and does not use a classification year as publication date", () => {
  const result = extractLocalPaperMetadata(`--- Page 1 ---
An Analysis of Distributed Systems
Ada Lovelace #
Department of Computer Science, Example University
Grace Hopper #
Example University
Abstract
2012 ACM Subject Classification
Digital Object Identifier 10.1234/LIPIcs.Example.2023.10
35th Example Conference (CONF2023).`);
  assert.deepEqual(result.authors, ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(result.year, 2023);
  assert.equal(result.doi, "10.1234/lipics.example.2023.10");
});

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

test("repairs a trailing first author after other authors were detected", () => {
  const repaired = repairTrailingTitleAuthor(
    "Deep Residual Learning for Image Recognition Kaiming He",
    ["Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
  );
  assert.equal(repaired.title, "Deep Residual Learning for Image Recognition");
  assert.deepEqual(repaired.authors, ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"]);
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

test("reads glued publisher identifiers and prefers publication over receipt dates", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
Received3August2020,accepted18August2021,dateofpublication5September2022.
DigitalObjectIdentifier10.1109/ACCESS.2022.1234567
A Study of Task Scheduling
Ada Lovelace, Grace Hopper
Example University
Abstract
`);
  assert.equal(metadata.title, "A Study of Task Scheduling");
  assert.equal(metadata.year, 2022);
  assert.equal(metadata.doi, "10.1109/access.2022.1234567");
});

test("repairs accent glyphs and correspondence markers across author lines", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
A Study of Task Scheduling
Am´elie Martin1(B), Grace Hopper2,
and Fran¸cois Dupont1
1 Example University
Abstract
`);
  assert.deepEqual(metadata.authors, ["Amélie Martin", "Grace Hopper", "François Dupont"]);
});

test("recovers small-cap header names from matching biographies only", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
A Study of Task Scheduling
ADALOVELACE1,GRACEHOPPER 2,ANDALANSMITH3
1 Example University
Abstract
--- Page 8 ---
ADA LOVELACE receivedthe doctoral degree.
GRACE HOPPER received her degree.
UNRELATED AUTHOR received a degree.
`);
  assert.equal(metadata.title, "A Study of Task Scheduling");
  assert.deepEqual(metadata.authors, ["ADA LOVELACE", "GRACE HOPPER", "ALANSMITH"]);
});

test("handles an edited proceedings cover before the first article", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
Ada Lovelace
Grace Hopper (Eds.)
12345
SCNL
Design and Analysis
of Computing Systems
12th International Workshop, EXAMPLE 2023
Proceedings
--- Page 2 ---
Unrelated Article Title
Alan Turing
`);
  assert.equal(metadata.title, "Design and Analysis of Computing Systems");
  assert.deepEqual(metadata.authors, ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(metadata.year, 2023);
});

test("reads a reversed arXiv stamp without inferring dates from citations", () => {
  const stamp = [..."arXiv:2301.12345v2 [cs.PL] 4 Feb 2023"].reverse().join("");
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
A Study of Task Scheduling
Ada Lovelace, Grace Hopper
Example University
Abstract
${stamp}
`);
  assert.equal(metadata.year, 2023);
  assert.equal(metadata.arxivId, "2301.12345v2");
});

test("preserves repeated product spelling and excludes affiliation locations", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
OpenCL for Task Scheduling
Ada Lovelace, Grace Hopper
Example University
Paris, France
Alan Turing
Other University
Abstract
We use OpenCL.
`);
  assert.equal(metadata.title, "OpenCL for Task Scheduling");
  assert.deepEqual(metadata.authors, ["Ada Lovelace", "Grace Hopper", "Alan Turing"]);
});

test("reattaches a detached title ligature only with corroborating word evidence", () => {
  const source = `--- Page 1 ---
ff
The e ect of Task Scheduling
Ada Lovelace, Grace Hopper
Example University
Abstract
`;
  assert.equal(extractLocalPaperMetadata(source + "We measure the effect of scheduling.").title, "The effect of Task Scheduling");
  assert.equal(extractLocalPaperMetadata(source).title, "The e ect of Task Scheduling");
});

test("ignores IEEE running headers and reads the journal publication year", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
IEEE TRANSACTIONS ON COMPUTING, VOL. 20, JANUARY 2023
A Study of Task Scheduling
Ada Lovelace, Member, IEEE
Example University
Abstract
Copyright 2022
`);
  assert.equal(metadata.title, "A Study of Task Scheduling");
  assert.deepEqual(metadata.authors, ["Ada Lovelace"]);
  assert.equal(metadata.year, 2023);
});

test("uses an ACM self-citation with a joint uppercase author header", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
A Framework for Task Scheduling
ADALOVELACEANDGRACEHOPPER, Example University
Abstract
ACM Reference format:
Ada Lovelace and Grace Hopper. 2023. A Framework for Task Scheduling.
`);
  assert.equal(metadata.title, "A Framework for Task Scheduling");
  assert.deepEqual(metadata.authors, ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(metadata.year, 2023);
});
