import test from "node:test";
import assert from "node:assert/strict";
import { parsePaperRecordJson } from "../www/import-export.js";
test("parses a paper", () => assert.equal(parsePaperRecordJson(JSON.stringify({title:"Paper"})).title, "Paper"));
