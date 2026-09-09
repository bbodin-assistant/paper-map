import {
  AI_PROVIDER_PRESETS,
  loadAiConfig,
  loadSessionApiKey,
  normalizeAiConfig,
  providerLabel,
  providerNeedsApiKey,
  providerPreset,
  saveAiConfig,
  saveSessionApiKey,
} from "./ai-config.js";

const $ = (selector, root = document) => root.querySelector(selector);
let ui = null;

function providerNote(config) {
  if (config.provider === "openai") {
    return "Direct PDF analysis through the Responses API. The API key is required and is never stored in localStorage.";
  }
  if (config.provider === "ollama") {
    return "Paper Map extracts PDF text locally with Rust/WASM, then calls Ollama's OpenAI-compatible chat endpoint. Ollama ignores API keys. Browser access may require OLLAMA_ORIGINS to allow this site's origin.";
  }
  return "Paper Map extracts PDF text locally with Rust/WASM, then calls {base URL}/chat/completions with OpenAI-compatible structured output. The server must allow browser CORS requests.";
}

function createUi() {
  if (ui || typeof document === "undefined") return ui;
  const tools = $(".header-tools");
  if (!tools) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "ai-config-button";
  button.className = "quiet-button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "ai-config-panel");
  button.textContent = "AI";
  const about = $("#about-button", tools);
  if (about) about.before(button);
  else tools.append(button);

  const panel = document.createElement("section");
  panel.id = "ai-config-panel";
  panel.className = "ai-config-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI server configuration");
  panel.innerHTML = `
    <header class="ai-config-header">
      <div>
        <span class="drawer-kicker">AI proxy</span>
        <h2>AI server</h2>
      </div>
      <button type="button" class="icon-button" id="ai-config-close" aria-label="Close AI configuration">×</button>
    </header>
    <div class="ai-config-grid">
      <label>Provider
        <select id="ai-config-provider">
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama</option>
          <option value="openai-compatible">OpenAI-compatible</option>
        </select>
      </label>
      <label>Base URL
        <input id="ai-config-base-url" type="url" spellcheck="false" autocomplete="off" />
      </label>
      <label>Model
        <input id="ai-config-model" type="text" spellcheck="false" autocomplete="off" />
      </label>
      <label>API key <span id="ai-config-key-hint" class="field-hint"></span>
        <input id="ai-config-key" type="password" autocomplete="off" spellcheck="false" />
      </label>
      <label class="checkbox-row">
        <input id="ai-config-remember-key" type="checkbox" /> Keep API key for this browser tab
      </label>
    </div>
    <p id="ai-config-note" class="muted ai-config-note"></p>
    <div class="ai-config-actions">
      <button type="button" id="ai-config-save">Save AI configuration</button>
      <span id="ai-config-status" class="muted" role="status" aria-live="polite"></span>
    </div>
  `;
  document.body.append(panel);

  ui = {
    button,
    panel,
    provider: $("#ai-config-provider", panel),
    baseUrl: $("#ai-config-base-url", panel),
    model: $("#ai-config-model", panel),
    key: $("#ai-config-key", panel),
    remember: $("#ai-config-remember-key", panel),
    keyHint: $("#ai-config-key-hint", panel),
    note: $("#ai-config-note", panel),
    status: $("#ai-config-status", panel),
  };

  function render(config = loadAiConfig(), { preserveKey = true } = {}) {
    const normalized = normalizeAiConfig(config);
    ui.provider.value = normalized.provider;
    ui.baseUrl.value = normalized.baseUrl;
    ui.model.value = normalized.model;
    if (!preserveKey) ui.key.value = loadSessionApiKey();
    ui.remember.checked = Boolean(loadSessionApiKey());
    ui.keyHint.textContent = providerNeedsApiKey(normalized) ? "required" : "optional";
    ui.key.placeholder = normalized.provider === "ollama" ? "not required" : "Bearer token";
    ui.note.textContent = providerNote(normalized);
    ui.button.textContent = `AI: ${providerLabel(normalized.provider)}`;
    return normalized;
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function open() {
    render(loadAiConfig(), { preserveKey: false });
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
  }

  button.addEventListener("click", () => panel.hidden ? open() : close());
  $("#ai-config-close", panel).addEventListener("click", close);

  ui.provider.addEventListener("change", () => {
    const preset = providerPreset(ui.provider.value);
    ui.baseUrl.value = preset.baseUrl;
    ui.model.value = preset.model;
    render({ provider: preset.id, baseUrl: preset.baseUrl, model: preset.model });
  });

  $("#ai-config-save", panel).addEventListener("click", () => {
    const config = saveAiConfig({
      provider: ui.provider.value,
      baseUrl: ui.baseUrl.value,
      model: ui.model.value,
    });
    saveSessionApiKey(ui.key.value, ui.remember.checked);
    render(config);
    ui.status.textContent = `${providerLabel(config.provider)} selected.`;
    document.dispatchEvent(new CustomEvent("paper-map-ai-config-changed", { detail: config }));
  });

  document.addEventListener("pointerdown", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close();
  });

  render(loadAiConfig(), { preserveKey: false });
  ui.open = open;
  ui.close = close;
  ui.render = render;
  return ui;
}

export function initAiConfigUi() {
  return createUi();
}

export function openAiConfig() {
  const configUi = createUi();
  configUi?.open();
}

export function aiConfigSnapshot() {
  return {
    config: loadAiConfig(),
    apiKey: loadSessionApiKey(),
  };
}

export function bindPdfAiConfigSummary(root) {
  const details = $(".pdf-ai-provider-settings", root);
  if (!details) return;
  details.innerHTML = `
    <summary>AI server settings</summary>
    <div class="pdf-ai-provider-summary">
      <div>
        <strong data-ai-provider-summary></strong>
        <span data-ai-endpoint-summary class="muted"></span>
      </div>
      <button type="button" class="quiet-button" data-open-ai-config>Configure AI server</button>
    </div>
  `;
  const refresh = () => {
    const config = loadAiConfig();
    $("[data-ai-provider-summary]", details).textContent = `${providerLabel(config.provider)} · ${config.model || "model required"}`;
    $("[data-ai-endpoint-summary]", details).textContent = config.baseUrl;
  };
  $("[data-open-ai-config]", details).addEventListener("click", openAiConfig);
  document.addEventListener("paper-map-ai-config-changed", refresh);
  refresh();
}

if (typeof document !== "undefined") initAiConfigUi();
