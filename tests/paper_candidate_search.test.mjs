import test from "node:test";
import assert from "node:assert/strict";

import {
  paperCandidateSearchTotals,
  startPaperCandidateSearch,
} from "../www/paper-candidate-search.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("candidate search reports providers progressively and preserves configured limits", async () => {
  const semantic = deferred();
  const openalex = deferred();
  const calls = [];
  const updates = [];
  const firstProviderUpdate = deferred();
  const providers = [
    { id: "semantic-scholar", label: "Semantic Scholar", limit: 2 },
    { id: "openalex", label: "OpenAlex", limit: 3 },
  ];

  const session = startPaperCandidateSearch("Shared Candidate Fixture", {
    providers,
    search: async (providerId, query, limit, options) => {
      calls.push({ providerId, query, limit, signal: options.signal });
      return providerId === "semantic-scholar" ? semantic.promise : openalex.promise;
    },
    onUpdate: (snapshot) => {
      updates.push(snapshot);
      if (snapshot.totals.finished === 1) firstProviderUpdate.resolve(snapshot);
    },
  });

  assert.deepEqual(
    calls.map(({ providerId, query, limit }) => ({ providerId, query, limit })),
    [
      { providerId: "semantic-scholar", query: "Shared Candidate Fixture", limit: 2 },
      { providerId: "openalex", query: "Shared Candidate Fixture", limit: 3 },
    ],
  );
  assert.deepEqual(updates[0].totals, { candidates: 0, finished: 0, providers: 2 });

  semantic.resolve([
    { id: "s2:broad", title: "Shared Candidate Fixture Background", year: 2023 },
    { id: "s2:exact", title: "SHARED CANDIDATE FIXTURE", year: 2024 },
  ]);
  const afterSemantic = await firstProviderUpdate.promise;
  assert.equal(afterSemantic.providerStates[0].status, "complete");
  assert.equal(afterSemantic.providerStates[1].status, "searching");
  assert.equal(afterSemantic.providerStates[0].candidates[0].id, "s2:exact");
  assert.deepEqual(afterSemantic.totals, { candidates: 2, finished: 1, providers: 2 });

  openalex.resolve([
    { id: "oa:one", title: "Shared Candidate Fixture", year: 2025 },
  ]);
  const final = await session.promise;
  assert.equal(final.providerStates[1].status, "complete");
  assert.deepEqual(final.totals, { candidates: 3, finished: 2, providers: 2 });
});

test("candidate search cancellation aborts outstanding provider requests", async () => {
  const providers = [
    { id: "semantic-scholar", label: "Semantic Scholar", limit: 1 },
    { id: "openalex", label: "OpenAlex", limit: 1 },
  ];
  const signals = [];

  const session = startPaperCandidateSearch("Cancel Fixture", {
    providers,
    search: (_providerId, _query, _limit, { signal }) => new Promise((_resolve, reject) => {
      signals.push(signal);
      signal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });

  assert.equal(signals.length, 2);
  session.cancel();
  const final = await session.promise;
  assert.equal(final.cancelled, true);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.deepEqual(paperCandidateSearchTotals(final.providerStates), {
    candidates: 0,
    finished: 0,
    providers: 2,
  });
});
