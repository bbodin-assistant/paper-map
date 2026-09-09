import test from "node:test";
import assert from "node:assert/strict";

import {
  aiModelsEndpoint,
  discoverAiModels,
  normalizeDiscoveredModels,
} from "../www/ai-models.js";

test("builds the provider model-list endpoint from the configured base URL", () => {
  assert.equal(
    aiModelsEndpoint({ provider: "openai", baseUrl: "https://api.openai.com/v1/" }),
    "https://api.openai.com/v1/models",
  );
  assert.equal(
    aiModelsEndpoint({ provider: "ollama", baseUrl: "http://localhost:11434/v1" }),
    "http://localhost:11434/v1/models",
  );
  assert.equal(
    aiModelsEndpoint({ provider: "openai-compatible", baseUrl: "https://llm.example.test/api/v1/" }),
    "https://llm.example.test/api/v1/models",
  );
});

test("normalizes standard and compatible model-list response shapes", () => {
  assert.deepEqual(
    normalizeDiscoveredModels({
      data: [
        { id: "qwen3:8b" },
        { id: "gpt-5.6-luna" },
        { id: "qwen3:8b" },
        { id: "" },
      ],
    }),
    ["gpt-5.6-luna", "qwen3:8b"],
  );
  assert.deepEqual(
    normalizeDiscoveredModels({ models: [{ name: "llama3.2" }, { model: "mistral" }] }),
    ["llama3.2", "mistral"],
  );
});

test("discovers models with an optional bearer key", async () => {
  let request = null;
  const models = await discoverAiModels({
    config: {
      provider: "openai-compatible",
      baseUrl: "https://llm.example.test/v1",
      model: "",
    },
    apiKey: "secret-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        object: "list",
        data: [{ id: "research-large" }, { id: "research-small" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.equal(request.url, "https://llm.example.test/v1/models");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.Authorization, "Bearer secret-key");
  assert.deepEqual(models, ["research-large", "research-small"]);
});

test("reports provider errors from model discovery", async () => {
  await assert.rejects(
    discoverAiModels({
      config: { provider: "ollama" },
      fetchImpl: async () => new Response(JSON.stringify({ message: "model service unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    }),
    /model service unavailable/,
  );
});
