import test from "node:test";
import assert from "node:assert/strict";

import {
  enabledPaperSearchProviders,
  normalizePaperProviderConfig,
} from "../www/paper-provider-config.js";

test("legacy paper-provider settings migrate search providers without changing behavior", () => {
  const semantic = normalizePaperProviderConfig({ provider: "semantic-scholar" });
  assert.deepEqual(semantic.searchProviders, {
    "semantic-scholar": { enabled: true, limit: 8 },
    openalex: { enabled: false, limit: 8 },
    crossref: { enabled: false, limit: 8 },
  });

  const automatic = normalizePaperProviderConfig({ provider: "auto" });
  assert.equal(enabledPaperSearchProviders(automatic).length, 3);
});

test("paper search provider limits are independent, bounded, and keep one source enabled", () => {
  const config = normalizePaperProviderConfig({
    provider: "openalex",
    searchProviders: {
      "semantic-scholar": { enabled: false, limit: 0 },
      openalex: { enabled: false, limit: 42 },
      crossref: { enabled: false, limit: 5.6 },
    },
  });

  assert.deepEqual(config.searchProviders, {
    "semantic-scholar": { enabled: false, limit: 1 },
    openalex: { enabled: true, limit: 20 },
    crossref: { enabled: false, limit: 6 },
  });
  assert.deepEqual(enabledPaperSearchProviders(config), [
    { id: "openalex", label: "OpenAlex", limit: 20 },
  ]);
});
