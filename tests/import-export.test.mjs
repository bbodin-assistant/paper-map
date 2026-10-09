import test from "node:test";
import assert from "node:assert/strict";
import { parsePaperRecordJson } from "../www/import-export.js";
test("parses a paper", () => assert.equal(parsePaperRecordJson(JSON.stringify({title:"Paper"})).title, "Paper"));

test("parses a wrapped individual paper", () => {
  const paper = { id: "doi:10.1000/test", title: "Wrapped paper", authors: [] };
  assert.deepEqual(parsePaperRecordJson(JSON.stringify({ schemaVersion: 1, paper })), paper);
});

test("rejects a library backup as an individual paper", () => {
  assert.throws(
    () => parsePaperRecordJson(JSON.stringify({ schemaVersion: 1, papers: [], edges: [], topics: [] })),
    /library collections/,
  );
});

test("rejects individual paper JSON without a title", () => {
  assert.throws(
    () => parsePaperRecordJson(JSON.stringify({ schemaVersion: 1, paper: { id: "paper:no-title" } })),
    /non-empty title/,
  );
});
