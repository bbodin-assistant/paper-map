import {
  loadAiConfig,
  loadSessionApiKey,
  normalizeAiConfig,
  providerLabel,
  providerNeedsApiKey,
  providerPreset,
  saveAiConfig,
  saveSessionApiKey,
} from "./ai-config.js";
import { discoverAiModels } from "./ai-models.js";

if (typeof document !== "undefined" && !document.querySelector('link[data-paper-map-ai-config]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./ai-config.css";
  link.dataset.paperMapAiConfig = "true";
  document.head.append(link);
}

const $ = (selector, root = document) => root.querySelector(selector);
let ui = null;
let volatileApiKey = typeof sessionStorage !== "undefined" ? loadSessionApiKey() : "";
const modelDiscoveryControllers = new WeakMap();

function providerNote(config) {
  if (config.provider === "openai") {
    return "Direct PDF analysis through the Responses API. The API key is required and is never stored in localStorage.";
  }
  if (config.provider === "ollama") {
    return "Paper Map extracts PDF text locally with Rust/WASM, then calls Ollama's OpenAI-compatible chat endpoint. Ollama ignores API keys. Browser access may require OLLAMA_ORIGINS to allow this site's origin.";
  }
  return `Paper Map extracts PDF text locally with Rust/WASM, then calls ${config.baseUrl}/chat/completions with OpenAI-compatible structured output. The server must allow browser CORS requests.`;
}

function providerOptions() {
  return `
    <option value="openai">OpenAI</option>
    <option value="ollama">Ollama</option>
    <option value="openai-compatible">OpenAI-compatible</option>
  `;
}

function controlsSnapshot(controls) {
  return {
    provider: controls.provider.value,
    baseUrl: controls.baseUrl.value,
    model: controls.model.value,
  };
}

function writeControls(controls, config = loadAiConfig(), { preserveKey = true } = {}) {
  const normalized = normalizeAiConfig(config);
  controls.provider.value = normalized.provider;
  controls.baseUrl.value = normalized.baseUrl;
  controls.model.value = normalized.model;
  if (!preserveKey) controls.key.value = volatileApiKey || loadSessionApiKey();
  controls.remember.checked = Boolean(loadSessionApiKey());
  if (controls.keyHint) controls.keyHint.textContent = providerNeedsApiKey(normalized) ? "required" : "optional";
  controls.key.placeholder = normalized.provider === "ollama" ? "not required" : "Bearer token";
  if (controls.note) controls.note.textContent = providerNote(normalized);
  return normalized;
}

function clearModelOptions(controls) {
  controls.modelList?.replaceChildren();
  if (controls.modelStatus) controls.modelStatus.textContent = "";
}

function writeModelOptions(controls, models) {
  if (!controls.modelList) return;
  controls.modelList.replaceChildren(...models.map((model) => {
    const option = document.createElement("option");
    option.value = model;
    return option;
  }));
}

async function refreshModelOptions(controls) {
  const config = normalizeAiConfig(controlsSnapshot(controls));
  const key = String(controls.key.value || "").trim();
  if (providerNeedsApiKey(config) && !key) {
    clearModelOptions(controls);
    if (controls.modelStatus) controls.modelStatus.textContent = "Enter an API key to load models.";
    return [];
  }

  modelDiscoveryControllers.get(controls)?.abort();
  const controller = new AbortController();
  modelDiscoveryControllers.set(controls, controller);
  if (controls.modelRefresh) controls.modelRefresh.disabled = true;
  if (controls.modelStatus) controls.modelStatus.textContent = "Loading models…";

  try {
    const models = await discoverAiModels({ config, apiKey: key, signal: controller.signal });
    if (modelDiscoveryControllers.get(controls) !== controller) return [];
    writeModelOptions(controls, models);
    if (controls.modelStatus) controls.modelStatus.textContent = `${models.length} model${models.length === 1 ? "" : "s"} available.`;
    return models;
  } catch (error) {
    if (error?.name === "AbortError") return [];
    clearModelOptions(controls);
    if (controls.modelStatus) controls.modelStatus.textContent = error.message || String(error);
    return [];
  } finally {
    if (modelDiscoveryControllers.get(controls) === controller) {
      modelDiscoveryControllers.delete(controls);
      if (controls.modelRefresh) controls.modelRefresh.disabled = false;
    }
  }
}

function applyProviderPreset(controls) {
  const preset = providerPreset(controls.provider.value);
  clearModelOptions(controls);
  writeControls(controls, { provider: preset.id, baseUrl: preset.baseUrl, model: preset.model });
}

function persistControls(controls) {
  const config = saveAiConfig(controlsSnapshot(controls));
  volatileApiKey = String(controls.key.value || "").trim();
  saveSessionApiKey(volatileApiKey, controls.remember.checked);
  writeControls(controls, config);
  document.dispatchEvent(new CustomEvent("paper-map-ai-config-changed", { detail: config }));
  return config;
}

function bindModelDiscovery(controls) {
  controls.modelRefresh?.addEventListener("click", () => refreshModelOptions(controls));
  controls.baseUrl.addEventListener("change", () => refreshModelOptions(controls));
  controls.key.addEventListener("change", () => refreshModelOptions(controls));
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
        <select id="ai-config-provider">${providerOptions()}</select>
      </label>
      <label>Base URL
        <input id="ai-config-base-url" type="url" spellcheck="false" autocomplete="off" />
      </label>
      <label>Model
        <span class="ai-model-input-row">
          <input id="ai-config-model" type="text" list="ai-config-model-options" spellcheck="false" autocomplete="off" />
          <button type="button" id="ai-config-load-models" class="quiet-button">Load models</button>
        </span>
        <datalist id="ai-config-model-options"></datalist>
        <span id="ai-config-model-status" class="field-hint ai-model-status" role="status" aria-live="polite"></span>
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

  const controls = {
    provider: $("#ai-config-provider", panel),
    baseUrl: $("#ai-config-base-url", panel),
    model: $("#ai-config-model", panel),
    modelList: $("#ai-config-model-options", panel),
    modelRefresh: $("#ai-config-load-models", panel),
    modelStatus: $("#ai-config-model-status", panel),
    key: $("#ai-config-key", panel),
    remember: $("#ai-config-remember-key", panel),
    keyHint: $("#ai-config-key-hint", panel),
    note: $("#ai-config-note", panel),
  };

  ui = {
    button,
    panel,
    ...controls,
    status: $("#ai-config-status", panel),
  };

  function render(config = loadAiConfig(), { preserveKey = true } = {}) {
    const normalized = writeControls(controls, config, { preserveKey });
    const label = providerLabel(normalized.provider);
    button.innerHTML = `AI <span class="visually-hidden">${label}</span>`;
    button.setAttribute("aria-label", `AI server: ${label}`);
    button.title = `AI server: ${label} · ${normalized.model || "model required"}`;
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
    refreshModelOptions(controls);
  }

  button.addEventListener("click", () => panel.hidden ? open() : close());
  $("#ai-config-close", panel).addEventListener("click", close);
  controls.provider.addEventListener("change", () => {
    applyProviderPreset(controls);
    refreshModelOptions(controls);
  });
  bindModelDiscovery(controls);

  $("#ai-config-save", panel).addEventListener("click", () => {
    const config = persistControls(controls);
    render(config);
    ui.status.textContent = `${providerLabel(config.provider)} selected.`;
  });

  document.addEventListener("paper-map-ai-config-changed", (event) => render(event.detail || loadAiConfig()));
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
    apiKey: volatileApiKey || loadSessionApiKey(),
  };
}

export function bindPdfAiConfigSummary(root) {
  const details = $(".pdf-ai-provider-settings", root);
  if (!details) return;
  details.innerHTML = `
    <summary>AI server settings</summary>
    <div class="pdf-ai-inline-config">
      <div class="pdf-ai-provider-summary">
        <div>
          <strong data-ai-provider-summary></strong>
          <span data-ai-endpoint-summary class="muted"></span>
        </div>
      </div>
      <div class="pdf-ai-settings-grid">
        <label>Provider
          <select data-pdf-ai-provider>${providerOptions()}</select>
        </label>
        <label>Base URL
          <input data-pdf-ai-base-url type="url" spellcheck="false" autocomplete="off" />
        </label>
        <label>Model
          <span class="ai-model-input-row">
            <input data-pdf-ai-model type="text" list="pdf-ai-model-options" spellcheck="false" autocomplete="off" />
            <button type="button" data-pdf-ai-load-models class="quiet-button">Load models</button>
          </span>
          <datalist id="pdf-ai-model-options"></datalist>
          <span data-pdf-ai-model-status class="field-hint ai-model-status" role="status" aria-live="polite"></span>
        </label>
        <label>API key <span data-pdf-ai-key-hint class="field-hint"></span>
          <input data-pdf-ai-key type="password" autocomplete="off" spellcheck="false" />
        </label>
        <label class="checkbox-row pdf-ai-remember-key">
          <input data-pdf-ai-remember-key type="checkbox" /> Keep API key for this browser tab
        </label>
      </div>
      <p data-pdf-ai-note class="muted ai-config-note"></p>
      <div class="ai-config-actions">
        <button type="button" data-save-pdf-ai-config>Save AI configuration</button>
        <span data-pdf-ai-config-status class="muted" role="status" aria-live="polite"></span>
      </div>
    </div>
  `;

  const controls = {
    provider: $("[data-pdf-ai-provider]", details),
    baseUrl: $("[data-pdf-ai-base-url]", details),
    model: $("[data-pdf-ai-model]", details),
    modelList: $("#pdf-ai-model-options", details),
    modelRefresh: $("[data-pdf-ai-load-models]", details),
    modelStatus: $("[data-pdf-ai-model-status]", details),
    key: $("[data-pdf-ai-key]", details),
    remember: $("[data-pdf-ai-remember-key]", details),
    keyHint: $("[data-pdf-ai-key-hint]", details),
    note: $("[data-pdf-ai-note]", details),
  };

  const refresh = (config = loadAiConfig(), preserveKey = true) => {
    const normalized = writeControls(controls, config, { preserveKey });
    $("[data-ai-provider-summary]", details).textContent = `${providerLabel(normalized.provider)} · ${normalized.model || "model required"}`;
    $("[data-ai-endpoint-summary]", details).textContent = normalized.baseUrl;
  };

  controls.provider.addEventListener("change", () => {
    applyProviderPreset(controls);
    refresh(controlsSnapshot(controls));
    refreshModelOptions(controls);
  });
  bindModelDiscovery(controls);
  $("[data-save-pdf-ai-config]", details).addEventListener("click", () => {
    const config = persistControls(controls);
    refresh(config);
    $("[data-pdf-ai-config-status]", details).textContent = `${providerLabel(config.provider)} selected.`;
  });
  details.addEventListener("toggle", () => {
    if (details.open) refreshModelOptions(controls);
  });
  document.addEventListener("paper-map-ai-config-changed", (event) => refresh(event.detail || loadAiConfig()));
  refresh(loadAiConfig(), false);
}

if (typeof document !== "undefined") initAiConfigUi();
