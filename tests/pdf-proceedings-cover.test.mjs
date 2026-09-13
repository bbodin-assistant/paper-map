import test from "node:test";
import assert from "node:assert/strict";

import { extractLocalPaperMetadata } from "../www/pdf-metadata.js";

test("extracts title and authors when a proceedings cover wraps an affiliation through the author block", () => {
  const metadata = extractLocalPaperMetadata(`--- Page 1 ---
Adaptive Container Partitioning
for Distributed Training
Ada Lovelace, Grace Hopper, Alan Turing, and Barbara Liskov, Technical
University of Example; Edsger Dijkstra, TU Delft
https://example.org/conference/paper
This paper is included in the Proceedings of the
2025 Example Systems Conference.
July 7-9, 2025
ISBN 978-1-2345-6789-0
`, { fallbackTitle: "conference-paper" });

  assert.equal(metadata.title, "Adaptive Container Partitioning for Distributed Training");
  assert.deepEqual(metadata.authors, [
    "Ada Lovelace",
    "Grace Hopper",
    "Alan Turing",
    "Barbara Liskov",
    "Edsger Dijkstra",
  ]);
  assert.equal(metadata.year, 2025);
  assert.equal(metadata.evidence.titleDetected, true);
  assert.equal(metadata.evidence.authorCount, 5);
});
