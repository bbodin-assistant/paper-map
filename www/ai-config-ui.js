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
  enabledPaperSearchProviders,
  loadPaperProviderConfig,
  loadSemanticScholarApiKey,
  PAPER_SEARCH_PROVIDER_IDS,
  paperProviderLabel,
  savePaperProviderConfig,
  saveSemanticScholarApiKey,
} from "./paper-provider-config.js?v=0.4.8";
import {
  AUTHOR_LAYOUT_OPTIONS,
  AUTHOR_LINK_OPTIONS,
  loadGraphConfig,
  normalizeGraphConfig,
  saveGraphConfig,
  TIMELINE_CLUSTER_FIELD_OPTIONS,
  TOPIC_LAYOUT_OPTIONS,
} from "./graph-config.js?v=0.4.12";

if (typeof document !== "undefined" && !document.querySelector('link[data-paper-map-config]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./ai-config.css?v=0.4.10";
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

function paperSearchProviderRows() {
  return PAPER_SEARCH_PROVIDER_IDS.map((id) => `
    <div class="paper-search-provider-row">
      <label class="paper-search-provider-toggle">
        <input type="checkbox" data-paper-search-enabled="${id}" />
        <span>${paperProviderLabel(id)}</span>
      </label>
      <label class="paper-search-provider-limit">
        <span>Results</span>
        <input type="number" min="1" max="20" step="1" inputmode="numeric" data-paper-search-limit="${id}" />
      </label>
    </div>
  `).join("");
}

function timelineClusterFieldRows() {
  return TIMELINE_CLUSTER_FIELD_OPTIONS.map(({ id, label }) => `
    <label class="timeline-cluster-field">
      <input type="checkbox" data-timeline-cluster-field="${id}" />
      <span>${label}</span>
    </label>
  `).join("");
}

function aggregateLayoutOptions(options) {
  return options.map(({ id, label }) => `<option value="${id}">${label}</option>`).join("");
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
  button.id = "ai-config-button";
  button.className = "quiet-button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "ai-config-panel");
  button.textContent = "Config";
  const about = $("#about-button", tools);
  if (about) about.before(button);
  else tools.append(button);

  const panel = document.createElement("section");
  panel.id = "ai-config-panel";
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
      <button type="button" class="icon-button" id="ai-config-close" aria-label="Close configuration">×</button>
    </header>

    <section class="config-section" aria-labelledby="paper-provider-config-heading">
      <div class="config-section-heading">
        <div>
          <span class="drawer-kicker">Online metadata</span>
          <h3 id="paper-provider-config-heading">Paper information</h3>
        </div>
      </div>
      <div class="config-grid">
        <label>Resolution / enrichment method
          <select id="paper-provider-config-provider">${paperProviderOptions()}</select>
        </label>
        <div class="paper-search-config" role="group" aria-labelledby="paper-search-config-heading">
          <div class="paper-search-config-heading">
            <strong id="paper-search-config-heading">Paper title search</strong>
            <small>Enable the providers to query in parallel and set the maximum proposals from each.</small>
          </div>
          ${paperSearchProviderRows()}
        </div>
        <label>Semantic Scholar API key <span class="field-hint">optional</span>
          <input id="paper-provider-config-key" type="password" autocomplete="off" spellcheck="false" />
        </label>
        <label class="checkbox-row">
          <input id="paper-provider-config-remember-key" type="checkbox" /> Keep Semantic Scholar key for this browser tab
        </label>
      </div>
      <p class="muted config-note">Resolution / enrichment controls exact identifier lookups and enrichment. Title searches in Add, Update online, PDF review, and BibTeX review query each enabled provider independently and show proposals as each provider responds. Crossref supplies metadata but not graph expansion.</p>
    </section>

    <section class="config-section" aria-labelledby="graph-config-heading">
      <div class="config-section-heading">
        <div>
          <span class="drawer-kicker">Map behavior</span>
          <h3 id="graph-config-heading">Map visualizer</h3>
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
        <label>Topic map layout
          <select id="graph-config-topic-layout">${aggregateLayoutOptions(TOPIC_LAYOUT_OPTIONS)}</select>
          <span class="field-hint">Generality puts topics used by the most papers on the left.</span>
        </label>
        <label>Author map links
          <select id="graph-config-author-links">${aggregateLayoutOptions(AUTHOR_LINK_OPTIONS)}</select>
          <span class="field-hint">Choose shared-paper co-authorship or directed citation relationships between authors.</span>
        </label>
        <label>Author map layout
          <select id="graph-config-author-layout">${aggregateLayoutOptions(AUTHOR_LAYOUT_OPTIONS)}</select>
          <span class="field-hint">Co-authors puts authors with the most distinct collaborators on the left; Gravity follows the selected Author links.</span>
        </label>
      </div>
      <div class="timeline-cluster-config" role="group" aria-labelledby="timeline-cluster-config-heading">
        <div class="timeline-cluster-config-heading">
          <strong id="timeline-cluster-config-heading">Timeline clustering</strong>
          <small>Control how papers are grouped into colored timeline bands.</small>
        </div>
        <label>Number of clusters
          <input id="graph-config-timeline-cluster-count" type="number" min="1" max="12" step="1" inputmode="numeric" />
          <span class="field-hint">Requested bands; fewer may be shown when the visible library is small.</span>
        </label>
        <fieldset class="timeline-cluster-fields">
          <legend>Cluster using</legend>
          <div class="timeline-cluster-field-grid">
            ${timelineClusterFieldRows()}
          </div>
        </fieldset>
      </div>
      <p class="muted config-note">Topic and Author layout/link settings apply immediately after saving. Author Gravity follows the selected link model; generality/co-author layouts use local metadata only. Timeline clustering changes apply on the next Timeline render.</p>
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
      <button type="button" id="ai-config-save">Save configuration</button>
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
    searchEnabled: new Map(PAPER_SEARCH_PROVIDER_IDS.map((id) => [id, panel.querySelector(`[data-paper-search-enabled="${id}"]`)])),
    searchLimit: new Map(PAPER_SEARCH_PROVIDER_IDS.map((id) => [id, panel.querySelector(`[data-paper-search-limit="${id}"]`)])),
  };

  const graphControls = {
    effort: $("#graph-config-layout-effort", panel),
    spacing: $("#graph-config-layout-spacing", panel),
    topicLayout: $("#graph-config-topic-layout", panel),
    authorLinks: $("#graph-config-author-links", panel),
    authorLayout: $("#graph-config-author-layout", panel),
    clusterCount: $("#graph-config-timeline-cluster-count", panel),
    clusterFields: new Map(TIMELINE_CLUSTER_FIELD_OPTIONS.map(({ id }) => [
      id,
      panel.querySelector(`[data-timeline-cluster-field="${id}"]`),
    ])),
  };

  function render({ preserveKeys = true } = {}) {
    const ai = writeAiControls(aiControls, loadAiConfig(), { preserveKey: preserveKeys });
    const paper = loadPaperProviderConfig();
    const graph = loadGraphConfig();
    paperControls.provider.value = paper.provider;
    for (const id of PAPER_SEARCH_PROVIDER_IDS) {
      paperControls.searchEnabled.get(id).checked = paper.searchProviders[id].enabled;
      paperControls.searchLimit.get(id).value = String(paper.searchProviders[id].limit);
    }
    if (!preserveKeys) paperControls.key.value = volatileSemanticScholarKey || loadSemanticScholarApiKey();
    paperControls.remember.checked = Boolean(loadSemanticScholarApiKey());
    graphControls.effort.value = String(graph.layoutEffort);
    graphControls.spacing.value = String(graph.layoutSpacing);
    graphControls.topicLayout.value = graph.topicLayoutTechnique;
    graphControls.authorLinks.value = graph.authorLinkMode;
    graphControls.authorLayout.value = graph.authorLayoutTechnique;
    graphControls.clusterCount.value = String(graph.timelineClusterCount);
    for (const { id } of TIMELINE_CLUSTER_FIELD_OPTIONS) {
      graphControls.clusterFields.get(id).checked = graph.timelineClusterFields.includes(id);
    }
    button.title = `Paper info: ${paperProviderLabel(paper.provider)} · AI: ${providerLabel(ai.provider)}`;
    button.setAttribute("aria-label", `Configuration. Paper information: ${paperProviderLabel(paper.provider)}. AI: ${providerLabel(ai.provider)}.`);
    const addPaperInput = $("#add-paper-query");
    const addPaperHelp = $("#add-paper-form small");
    const searchSummary = enabledPaperSearchProviders(paper)
      .map(({ id, limit }) => `${paperProviderLabel(id)} (up to ${limit})`)
      .join(", ");
    if (addPaperInput) addPaperInput.placeholder = "DOI, arXiv ID, provider ID, or title";
    if (addPaperHelp) addPaperHelp.textContent = `Add search: ${searchSummary}. Results appear as providers respond.`;
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

    const searchProviders = Object.fromEntries(PAPER_SEARCH_PROVIDER_IDS.map((id) => [
      id,
      {
        enabled: paperControls.searchEnabled.get(id).checked,
        limit: paperControls.searchLimit.get(id).value,
      },
    ]));
    const paper = savePaperProviderConfig({
      provider: paperControls.provider.value,
      searchProviders,
    });
    volatileSemanticScholarKey = String(paperControls.key.value || "").trim();
    saveSemanticScholarApiKey(volatileSemanticScholarKey, paperControls.remember.checked);

    const timelineClusterFields = TIMELINE_CLUSTER_FIELD_OPTIONS
      .map(({ id }) => id)
      .filter((id) => graphControls.clusterFields.get(id).checked);
    const graph = saveGraphConfig(normalizeGraphConfig({
      layoutEffort: graphControls.effort.value,
      layoutSpacing: graphControls.spacing.value,
      topicLayoutTechnique: graphControls.topicLayout.value,
      authorLinkMode: graphControls.authorLinks.value,
      authorLayoutTechnique: graphControls.authorLayout.value,
      timelineClusterCount: graphControls.clusterCount.value,
      timelineClusterFields,
    }));

    document.dispatchEvent(new CustomEvent("paper-map-ai-config-changed", { detail: ai }));
    document.dispatchEvent(new CustomEvent("paper-map-paper-provider-config-changed", { detail: paper }));
    document.dispatchEvent(new CustomEvent("paper-map-graph-config-changed", { detail: graph }));
    render();
    $("#config-status", panel).textContent = "Configuration saved locally.";
    return { ai, paper, graph };
  }

  button.addEventListener("click", () => panel.hidden ? open() : close());
  $("#ai-config-close", panel).addEventListener("click", close);
  $("#ai-config-save", panel).addEventListener("click", () => {
    persist();
    close();
  });
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
