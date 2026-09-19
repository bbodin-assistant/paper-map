import test from "node:test";
import assert from "node:assert/strict";

import { onlineCandidateSummary, rankOnlineCandidates } from "../www/online-candidates.js";

test("title candidates promote exact titles while preserving provider order", () => {
  const candidates = [
    { openAlexId: "W1", title: "Flower Federated Learning", authors: ["Wrong Author"], year: 2020, venue: "Wrong Venue" },
    { openAlexId: "W2", title: "FLOWER: A FRIENDLY FEDERATED LEARNING FRAMEWORK", authors: ["First Exact"], year: 2020, venue: "Exact Venue A" },
    { openAlexId: "W3", title: "Flower: A Friendly Federated Learning Framework", authors: ["Second Exact"], year: 2021, venue: "Exact Venue B" },
    { openAlexId: "W2", title: "FLOWER: A FRIENDLY FEDERATED LEARNING FRAMEWORK", authors: ["Duplicate"], year: 2020, venue: "Duplicate Venue" },
  ];

  const ranked = rankOnlineCandidates(candidates, "Flower: A Friendly Federated Learning Framework");
  assert.deepEqual(ranked.map((paper) => paper.openAlexId), ["W2", "W3", "W1"]);
});

test("candidate summaries expose all review fields used by the chooser", () => {
  assert.deepEqual(onlineCandidateSummary({
    title: "Flower: A Friendly Federated Learning Framework",
    authors: ["Daniel J. Beutel", "Taner Topal", "Akhil Mathur"],
    year: 2020,
    venue: "arXiv",
    doi: "https://doi.org/10.1234/flower",
  }), {
    title: "Flower: A Friendly Federated Learning Framework",
    authors: ["Daniel J. Beutel", "Taner Topal", "Akhil Mathur"],
    year: 2020,
    venue: "arXiv",
    doi: "10.1234/flower",
  });
});
