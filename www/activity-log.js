const MAX_ENTRIES = 120;
const entries = [];
let installed = false;
let lastStatusError = "";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function requestSource(value) {
  let url;
  try {
    url = new URL(String(value || ""), typeof location !== "undefined" ? location.href : "https://paper-map.invalid/");
  } catch {
    return "Network";
  }
  if (url.hostname === "api.semanticscholar.org") return "Semantic Scholar";
  if (url.hostname === "api.crossref.org") return "Crossref";
  if (url.hostname === "api.openai.com") return "OpenAI";
  if (/\/(responses|chat\/completions|models)\/?$/i.test(url.pathname)) return "AI provider";
  return "Network";
}

export function sanitizedRequestTarget(value) {
  try {
    const url = new URL(String(value || ""), typeof location !== "undefined" ? location.href : "https://paper-map.invalid/");
    return `${url.origin}${url.pathname}`;
  } catch {
    return clean(value);
  }
}

function detailFromBody(text) {
  const value = clean(text);
  if (!value) return "";
  try {
    const body = JSON.parse(value);
    return clean(body?.error?.message || body?.message || body?.error || value).slice(0, 700);
  } catch {
    return value.slice(0, 700);
  }
}

function render() {
  if (typeof document === "undefined") return;
  const panel = document.querySelector("#activity-log");
  const list = document.querySelector("#activity-log-list");
  const summary = document.querySelector("#activity-log-summary");
  const count = document.querySelector("#activity-log-count");
  if (!panel || !list || !summary || !count) return;

  const latest = entries.at(-1);
  summary.textContent = latest ? `${latest.source}: ${latest.message}` : "No errors yet";
  count.textContent = entries.length ? String(entries.length) : "";
  count.hidden = entries.length === 0;
  list.replaceChildren(...entries.slice().reverse().map((entry) => {
    const item = document.createElement("li");
    item.className = `activity-log-entry ${entry.level}`;
    const head = document.createElement("div");
    const source = document.createElement("strong");
    source.textContent = entry.source;
    const time = document.createElement("time");
    time.dateTime = entry.at;
    time.textContent = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    head.append(source, time);
    const message = document.createElement("div");
    message.className = "activity-log-message";
    message.textContent = entry.message;
    item.append(head, message);
    if (entry.detail) {
      const detail = document.createElement("div");
      detail.className = "activity-log-detail";
      detail.textContent = entry.detail;
      item.append(detail);
    }
    return item;
  }));
}

export function logActivity({ level = "error", source = "Paper Map", message, detail = "" } = {}) {
  const normalized = clean(message);
  if (!normalized) return null;
  const entry = {
    at: new Date().toISOString(),
    level: level === "info" ? "info" : level === "warning" ? "warning" : "error",
    source: clean(source) || "Paper Map",
    message: normalized,
    detail: clean(detail),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  render();
  return entry;
}

export function activityEntries() {
  return entries.map((entry) => ({ ...entry }));
}

export function clearActivityLog() {
  entries.length = 0;
  lastStatusError = "";
  render();
}

function installStyles() {
  if (document.querySelector("style[data-paper-map-activity-log]")) return;
  const style = document.createElement("style");
  style.dataset.paperMapActivityLog = "true";
  style.textContent = `
    .activity-log { position: fixed; z-index: 24; left: 20px; bottom: 42px; width: min(430px, calc(100vw - 40px)); font-size: 10px; pointer-events: none; }
    .activity-log-toggle, .activity-log-panel { pointer-events: auto; border: 1px solid rgba(176,184,187,.92); background: rgba(255,254,249,.96); box-shadow: 0 8px 28px rgba(24,32,42,.14); }
    .activity-log-toggle { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 7px; align-items: center; width: 100%; min-height: 31px; padding: 5px 8px; text-align: left; font-size: 9px; }
    .activity-log-toggle > strong { text-transform: uppercase; letter-spacing: .08em; }
    #activity-log-summary { overflow: hidden; color: #68737c; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    #activity-log-count { min-width: 18px; padding: 1px 5px; border-radius: 99px; background: #a13b35; color: #fff; text-align: center; }
    .activity-log-panel { max-height: min(330px, 45vh); margin-bottom: 5px; overflow: hidden; }
    .activity-log-panel[hidden] { display: none; }
    .activity-log-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 8px; border-bottom: 1px solid #d8ddda; }
    .activity-log-header button { padding: 4px 6px; font-size: 9px; }
    #activity-log-list { max-height: min(285px, 38vh); margin: 0; padding: 0; overflow: auto; list-style: none; }
    .activity-log-entry { display: grid; gap: 3px; padding: 7px 8px; border-bottom: 1px solid #e4e7e4; }
    .activity-log-entry > div:first-child { display: flex; justify-content: space-between; gap: 8px; }
    .activity-log-entry time { color: #969da1; font-size: 8px; }
    .activity-log-entry.error strong { color: #9f2d2d; }
    .activity-log-entry.warning strong { color: #8a621c; }
    .activity-log-message { color: #37444e; line-height: 1.35; }
    .activity-log-detail { color: #778189; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8px; line-height: 1.35; overflow-wrap: anywhere; }
    @media (max-width: 720px) { .activity-log { left: 7px; bottom: 35px; width: min(390px, calc(100vw - 14px)); } }
  `;
  document.head.append(style);
}

function installPanel() {
  if (document.querySelector("#activity-log")) return;
  const panel = document.createElement("aside");
  panel.id = "activity-log";
  panel.className = "activity-log";
  panel.setAttribute("aria-label", "Paper Map activity log");
  panel.innerHTML = `
    <div class="activity-log-panel" id="activity-log-panel" hidden>
      <div class="activity-log-header"><strong>Activity log</strong><button type="button" class="quiet-button" id="activity-log-clear">Clear</button></div>
      <ol id="activity-log-list"></ol>
    </div>
    <button type="button" class="activity-log-toggle" id="activity-log-toggle" aria-expanded="false" aria-controls="activity-log-panel">
      <strong>Log</strong><span id="activity-log-summary">No errors yet</span><span id="activity-log-count" hidden></span>
    </button>
  `;
  document.body.append(panel);
  const toggle = panel.querySelector("#activity-log-toggle");
  const body = panel.querySelector("#activity-log-panel");
  toggle.addEventListener("click", () => {
    body.hidden = !body.hidden;
    toggle.setAttribute("aria-expanded", String(!body.hidden));
  });
  panel.querySelector("#activity-log-clear").addEventListener("click", clearActivityLog);
  render();
}

function installFetchLogging() {
  if (globalThis.__paperMapFetchLoggingInstalled || typeof globalThis.fetch !== "function") return;
  globalThis.__paperMapFetchLoggingInstalled = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || input);
    const source = requestSource(rawUrl);
    const target = sanitizedRequestTarget(rawUrl);
    const method = clean(init?.method || (typeof input === "object" ? input?.method : "") || "GET").toUpperCase();
    try {
      const response = await originalFetch(input, init);
      if (!response.ok) {
        let detail = "";
        try { detail = detailFromBody(await response.clone().text()); } catch { /* Best-effort diagnostic only. */ }
        logActivity({
          source,
          message: `${method} ${target} returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
          detail,
        });
      }
      return response;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      const originalMessage = clean(error?.message || error) || "request failed";
      const message = `${source} network request failed (${method} ${target}): ${originalMessage}`;
      logActivity({ source, message });
      const wrapped = new Error(message, { cause: error });
      wrapped.name = error?.name || "Error";
      throw wrapped;
    }
  };
}

function installRuntimeLogging() {
  globalThis.addEventListener?.("error", (event) => {
    logActivity({ source: "Browser", message: event?.message || "Unhandled browser error", detail: event?.error?.stack || "" });
  });
  globalThis.addEventListener?.("unhandledrejection", (event) => {
    const reason = event?.reason;
    logActivity({ source: "Browser", message: reason?.message || reason || "Unhandled promise rejection", detail: reason?.stack || "" });
  });

  const observer = new MutationObserver(() => {
    const status = document.querySelector("#library-status.status.error");
    const message = clean(document.querySelector("#library-status-text")?.textContent);
    if (status && message && message !== lastStatusError) {
      lastStatusError = message;
      logActivity({ source: "Paper Map", message });
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
}

export function installActivityLog() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  installStyles();
  installPanel();
  installFetchLogging();
  installRuntimeLogging();
}

if (typeof document !== "undefined") installActivityLog();