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
import {
  loadPaperProviderConfig,
  loadSemanticScholarApiKey,
  paperProviderLabel,
  savePaperProviderConfig,
  saveSemanticScholarApiKey,
} from "./paper-provider-config.js";
import { loadGraphConfig, normalizeGraphConfig, saveGraphConfig } from "./graph-config.js";

if (typeof document !== "undefined" && !document.querySelector('link[data-paper-map-config]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./ai-config.css";
  link.dataset.paperMapConfig = "true";
  document.head.append(link);
}

const $ = (selector, root = document) => root.querySelector(selector);
let ui = null;
let volatileApiKey = typeof sessionStorage !== "undefined" ? loadSessionApiKey() : "";
let volatileSemanticScholarKey = typeof sessionStorage !== "undefined" ? loadSemanticScholarApiKey() : "";
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

function aiProviderOptions() {
  return `
    <option value="openai">OpenAI</option>
    <option value="ollama">Ollama</option>
    <option value="openai-compatible">OpenAI-compatible</option>
  `;
}

function paperProviderOptions() {
  return `
    <option value="semantic-scholar">Semantic Scholar</option>
    <option value="openalex">OpenAlex</option>
    <option value="crossref">Crossref</option>
    <option value="auto">Automatic merge</option>
  `;
}

function aiControlsSnapshot(controls) {
  return {
    provider: controls.provider.value,
    baseUrl: controls.baseUrl.value,
    model: controls.model.value,
  };
}

function writeAiControls(controls, config = loadAiConfig(), { preserveKey = true } = {}) {
  const normalized = normalizeAiConfig(config);
  controls.provider.value = normalized.provider;
  controls.baseUrl.value = normalized.baseUrl;
  controls.model.value = normalized.model;
  if (!preserveKey) controls.key.value = volatileApiKey || loadSessionApiKey();
  controls.remember.checked = Boolean(loadSessionApiKey());
  controls.keyHint.textContent = providerNeedsApiKey(normalized) ? "required" : "optional";
  controls.key.placeholder = normalized.provider === "ollama" ? "not required" : "Bearer token";
  controls.note.textContent = providerNote(normalized);
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
  const config = normalizeAiConfig(aiControlsSnapshot(controls));
  const key = String(controls.key.value || "").trim();
  if (providerNeedsApiKey(config) && !key) {
    clearModelOptions(controls);
    controls.modelStatus.textContent = "Enter an API key to load models.";
    return [];
  }

  modelDiscoveryControllers.get(controls)?.abort();
  const controller = new AbortController();
  modelDiscoveryControllers.set(controls, controller);
  controls.modelRefresh.disabled = true;
  controls.modelStatus.textContent = "Loading models…";

  try {
    const models = await discoverAiModels({ config, apiKey: key, signal: controller.signal });
    if (modelDiscoveryControllers.get(controls) !== controller) return [];
    writeModelOptions(controls, models);
    controls.modelStatus.textContent = `${models.length} model${models.length === 1 ? "" : "s"} available.`;
    return models;
  } catch (error) {
    if (error?.name === "AbortError") return [];
    clearModelOptions(controls);
    controls.modelStatus.textContent = error.message || String(error);
    return [];
  } finally {
    if (modelDiscoveryControllers.get(controls) === controller) {
      modelDiscoveryControllers.delete(controls);
      controls.modelRefresh.disabled = false;
    }
  }
}

function applyAiProviderPreset(controls) {
  const preset = providerPreset(controls.provider.value);
  clearModelOptions(controls);
  writeAiControls(controls, { provider: preset.id, baseUrl: preset.baseUrl, model: preset.model });
}

function createUi() {
  if (ui || typeof document === "undefined") return ui;
  const tools = $(".header-tools");
  if (!tools) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "config-button";
  button.className = "quiet-button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "config-panel");
  button.textContent = "Config";
  const about = $("#about-button", tools);
  if (about) about.before(button);
  else tools.append(button);

  const panel = document.createElement("section");
  panel.id = "config-panel";
  panel.className = "config-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Paper Map configuration");
  panel.innerHTML = `
    <header class="config-header">
      <div>
        <span class="drawer-kicker">Local preferences</span>
        <h2>Configuration</h2>
      </div>
      <button type="button" class="icon-button" id="config-close" aria-label="Close configuration">×</button>
    </header>

    <section class="config-section" aria-labelledby="paper-provider-config-heading">
      <div class="config-section-heading">
        <div>
          <span class="drawer-kicker">Online metadata</span>
          <h3 id="paper-provider-config-heading">Paper information</h3>
        </div>
      </div>
      <div class="config-grid">
        <label>Method
          <select id="paper-provider-config-provider">${paperProviderOptions()}</select>
        </label>
        <label>Semantic Scholar API key <span class="field-hint">optional</span>
          <input id="paper-provider-config-key" type="password" autocomplete="off" spellcheck="false" />
        </label>
        <label class="checkbox-row">
          <input id="paper-provider-config-remember-key" type="checkbox" /> Keep Semantic Scholar key for this browser tab
        </label>
      </div>
      <p class="muted config-note">Automatic merge queries Semantic Scholar, OpenAlex, and Crossref and combines only records that identify the same work. Crossref supplies metadata but not graph expansion.</p>
    </section>

    <section class="config-section" aria-labelledby="graph-config-heading">
      <div class="config-section-heading">
        <div>
          <span class="drawer-kicker">Map behavior</span>
          <h3 id="graph-config-heading">Graph visualizer</h3>
        </div>
      </div>
      <div class="config-grid config-grid-two">
        <label>Layout effort
          <input id="graph-config-layout-effort" type="number" min="0.5" max="6" step="0.25" />
          <span class="field-hint">Multiplier for force-layout iterations. Default: 2×.</span>
        </label>
        <label>Layout spacing
          <input id="graph-config-layout-spacing" type="number" min="0.5" max="3" step="0.1" />
          <span class="field-hint">Logical area multiplier for larger maps. Default: 1×.</span>
        </label>
      </div>
      <p class="muted config-note">Changes apply when the citation topology is laid out again, such as after adding/removing visible papers or reloading the page.</p>
    </section>

    <section class="config-section" aria-labelledby="ai-config-heading">
      <div class="config-section-heading">
        <div>
          <span class="drawer-kicker">Optional extraction</span>
          <h3 id="ai-config-heading">AI</h3>
        </div>
      </div>
      <div class="config-grid">
        <label>Provider
          <select id="ai-config-provider">${aiProviderOptions()}</select>
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
          <input id="ai-config-remember-key" type="checkbox" /> Keep AI API key for this browser tab
        </label>
      </div>
      <p id="ai-config-note" class="muted config-note"></p>
    </section>

    <div class="config-actions">
      <button type="button" id="config-save">Save configuration</button>
      <span id="config-status" class="muted" role="status" aria-live="polite"></span>
    </div>
  `;
  document.body.append(panel);

  const aiControls = {
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

  const paperControls = {
    provider: $("#paper-provider-config-provider", panel),
    key: $("#paper-provider-config-key", panel),
    remember: $("#paper-provider-config-remember-key", panel),
  };

  const graphControls = {
    effort: $("#graph-config-layout-effort", panel),
    spacing: $("#graph-config-layout-spacing", panel),
  };

  function render({ preserveKeys = true } = {}) {
    const ai = writeAiControls(aiControls, loadAiConfig(), { preserveKey: preserveKeys });
    const paper = loadPaperProviderConfig();
    const graph = loadGraphConfig();
    paperControls.provider.value = paper.provider;
    if (!preserveKeys) paperControls.key.value = volatileSemanticScholarKey || loadSemanticScholarApiKey();
    paperControls.remember.checked = Boolean(loadSemanticScholarApiKey());
    graphControls.effort.value = String(graph.layoutEffort);
    graphControls.spacing.value = String(graph.layoutSpacing);
    button.title = `Paper info: ${paperProviderLabel(paper.provider)} · AI: ${providerLabel(ai.provider)}`;
    button.setAttribute("aria-label", `Configuration. Paper information: ${paperProviderLabel(paper.provider)}. AI: ${providerLabel(ai.provider)}.`);
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function open() {
    render({ preserveKeys: false });
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
  }

  function persist() {
    const ai = saveAiConfig(aiControlsSnapshot(aiControls));
    volatileApiKey = String(aiControls.key.value || "").trim();
    saveSessionApiKey(volatileApiKey, aiControls.remember.checked);

    const paper = savePaperProviderConfig({ provider: paperControls.provider.value });
    volatileSemanticScholarKey = String(paperControls.key.value || "").trim();
    saveSemanticScholarApiKey(volatileSemanticScholarKey, paperControls.remember.checked);

    const graph = saveGraphConfig(normalizeGraphConfig({
      layoutEffort: graphControls.effort.value,
      layoutSpacing: graphControls.spacing.value,
    }));

    document.dispatchEvent(new CustomEvent("paper-map-ai-config-changed", { detail: ai }));
    document.dispatchEvent(new CustomEvent("paper-map-paper-provider-config-changed", { detail: paper }));
    document.dispatchEvent(new CustomEvent("paper-map-graph-config-changed", { detail: graph }));
    render();
    $("#config-status", panel).textContent = "Configuration saved locally.";
    return { ai, paper, graph };
  }

  button.addEventListener("click", () => panel.hidden ? open() : close());
  $("#config-close", panel).addEventListener("click", close);
  $("#config-save", panel).addEventListener("click", persist);
  aiControls.provider.addEventListener("change", () => {
    applyAiProviderPreset(aiControls);
    refreshModelOptions(aiControls);
  });
  aiControls.modelRefresh.addEventListener("click", () => refreshModelOptions(aiControls));
  aiControls.baseUrl.addEventListener("change", () => refreshModelOptions(aiControls));
  aiControls.key.addEventListener("change", () => refreshModelOptions(aiControls));
  document.addEventListener("pointerdown", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close();
  });

  render({ preserveKeys: false });
  ui = {
    button,
    panel,
    open,
    close,
    render,
    persist,
    ...aiControls,
  };
  return ui;
}

export function initAiConfigUi() {
  return createUi();
}

export function openAiConfig() {
  createUi()?.open();
}

export function aiConfigSnapshot() {
  return {
    config: loadAiConfig(),
    apiKey: volatileApiKey || loadSessionApiKey(),
  };
}

if (typeof document !== "undefined") initAiConfigUi();
