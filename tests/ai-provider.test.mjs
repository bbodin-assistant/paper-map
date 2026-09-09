import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_PROVIDER_PRESETS,
  normalizeAiConfig,
  providerNeedsApiKey,
  providerUsesDirectPdf,
} from "../www/ai-config.js";
import {
  aiRequestEndpoint,
  buildChatMetadataPayload,
  documentTextForAi,
  MAX_AI_DOCUMENT_CHARS,
} from "../www/ai-provider.js";

test("normalizes OpenAI, Ollama, and custom provider configuration", () => {
  const openai = normalizeAiConfig({ provider: "openai" });
  assert.equal(openai.baseUrl, AI_PROVIDER_PRESETS.openai.baseUrl);
  assert.equal(openai.model, AI_PROVIDER_PRESETS.openai.model);
  assert.equal(providerUsesDirectPdf(openai), true);
  assert.equal(providerNeedsApiKey(openai), true);

  const ollama = normalizeAiConfig({ provider: "ollama", baseUrl: "http://localhost:11434/v1/" });
  assert.equal(ollama.baseUrl, "http://localhost:11434/v1");
  assert.equal(providerUsesDirectPdf(ollama), false);
  assert.equal(providerNeedsApiKey(ollama), false);

  const compatible = normalizeAiConfig({
    provider: "openai-compatible",
    baseUrl: "https://llm.example.test/api/v1/",
    model: "research-model",
  });
  assert.equal(compatible.baseUrl, "https://llm.example.test/api/v1");
  assert.equal(compatible.model, "research-model");
});

test("routes providers to capability-appropriate endpoints", () => {
  assert.equal(
    aiRequestEndpoint({ provider: "openai" }),
    "https://api.openai.com/v1/responses",
  );
  assert.equal(
    aiRequestEndpoint({ provider: "ollama" }),
    "http://localhost:11434/v1/chat/completions",
  );
  assert.equal(
    aiRequestEndpoint({
      provider: "openai-compatible",
      baseUrl: "https://llm.example.test/v1/",
      model: "m",
    }),
    "https://llm.example.test/v1/chat/completions",
  );
});

test("builds an OpenAI-compatible structured chat request from local PDF text", () => {
  const payload = buildChatMetadataPayload({
    model: "qwen-test",
    documentText: "Title\nAbstract\nBody",
    fileName: "paper.pdf",
  });
  assert.equal(payload.model, "qwen-test");
  assert.equal(payload.temperature, 0);
  assert.equal(payload.response_format.type, "json_schema");
  assert.equal(payload.response_format.json_schema.name, "paper_metadata");
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.match(payload.messages[1].content, /BEGIN PDF TEXT/);
  assert.match(payload.messages[1].content, /Title\nAbstract\nBody/);
});

test("caps provider-neutral PDF text while preserving the beginning and end", () => {
  const source = `START-${"x".repeat(MAX_AI_DOCUMENT_CHARS + 50_000)}-END`;
  const result = documentTextForAi(source);
  assert.equal(result.truncated, true);
  assert.match(result.text, /^START-/);
  assert.match(result.text, /middle of document omitted/);
  assert.match(result.text, /-END$/);
  assert.ok(result.text.length <= MAX_AI_DOCUMENT_CHARS + 100);
});
