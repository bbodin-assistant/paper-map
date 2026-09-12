import "./ui-layout.js";

const ACCEPTED_PUBLICATION_FILES = ".pdf,.json,.bib,application/pdf,application/json,application/x-bibtex,text/x-bibtex";

function lowerName(file) {
  return String(file?.name || "").trim().toLowerCase();
}

function lowerType(file) {
  return String(file?.type || "").trim().toLowerCase();
}

export function publicationFileKind(file) {
  const name = lowerName(file);
  const type = lowerType(file);
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (name.endsWith(".json") || type === "application/json") return "json";
  if (name.endsWith(".bib") || type === "application/x-bibtex" || type === "text/x-bibtex") return "bib";
  return "unsupported";
}

export function classifyPublicationFiles(files = []) {
  const result = { pdfFiles: [], portableFiles: [], unsupportedFiles: [] };
  for (const file of files) {
    const kind = publicationFileKind(file);
    if (kind === "pdf") result.pdfFiles.push(file);
    else if (kind === "json" || kind === "bib") result.portableFiles.push(file);
    else result.unsupportedFiles.push(file);
  }
  return result;
}

function setGlobalStatus(root, message, tone = "ready") {
  const status = root.querySelector("#library-status");
  const text = root.querySelector("#library-status-text");
  if (status) status.className = `status ${tone}`;
  if (text) text.textContent = message;
}

function configureAddPublicationMenu(root) {
  const menu = root.querySelector("#library-menu");
  if (!menu) return false;

  const summary = menu.querySelector("summary");
  if (summary) summary.textContent = "Add paper";

  const panel = menu.querySelector(".library-panel");
  panel?.querySelector(".drawer-heading")?.remove();
  const form = panel?.querySelector("#add-paper-form");
  const query = form?.querySelector("#add-paper-query");
  const submit = form?.querySelector('button[type="submit"]');
  if (query) query.setAttribute("aria-label", "Publication DOI, arXiv ID, provider ID, or title");
  if (submit) submit.textContent = "Find & add";
  form?.querySelector('label[for="add-paper-query"]')?.remove();
  form?.querySelector("small")?.remove();

  return true;
}

function moveLibraryActionsToConfig(root) {
  const actions = root.querySelector(".library-actions");
  const config = root.querySelector("#ai-config-panel");
  const configActions = config?.querySelector(".config-actions");
  if (!actions || !config || !configActions) return false;

  root.querySelector("#import-button")?.remove();
  if (!config.querySelector("#library-data-config-heading")) {
    const section = root.createElement("section");
    section.className = "config-section";
    section.setAttribute("aria-labelledby", "library-data-config-heading");
    section.innerHTML = `
      <div class="config-section-heading">
        <div>
          <span class="drawer-kicker">Local database</span>
          <h3 id="library-data-config-heading">Library data</h3>
        </div>
      </div>
    `;
    actions.classList.add("config-library-actions");
    section.append(actions);
    config.insertBefore(section, configActions);
  }
  return true;
}

function forwardPortableFile(root, file) {
  const legacyInput = root.querySelector("#import-file");
  if (!legacyInput) {
    setGlobalStatus(root, "Portable import control is unavailable.", "error");
    return false;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  legacyInput.files = transfer.files;
  legacyInput.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function configureUnifiedFilePicker(root) {
  const button = root.querySelector("#add-pdf-button");
  const input = root.querySelector("#pdf-ai-file");
  if (!button || !input || input.dataset.publicationPicker === "true") return Boolean(button && input);

  button.textContent = "Add files";
  button.setAttribute("aria-label", "Add publication files");
  input.accept = ACCEPTED_PUBLICATION_FILES;
  input.dataset.publicationPicker = "true";

  input.addEventListener("change", (event) => {
    const files = Array.from(input.files || []);
    const { pdfFiles, portableFiles, unsupportedFiles } = classifyPublicationFiles(files);
    if (!portableFiles.length) return;

    event.stopImmediatePropagation();
    input.value = "";

    if (pdfFiles.length || unsupportedFiles.length || portableFiles.length !== 1) {
      setGlobalStatus(root, "Select either one JSON/BibTeX file or one or more PDF files.", "error");
      return;
    }

    forwardPortableFile(root, portableFiles[0]);
  }, true);

  return true;
}

function waitForSaveAvailability(saveButton, dialog) {
  if (!saveButton.disabled) return Promise.resolve(true);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!dialog.open) {
        observer.disconnect();
        resolve(false);
      } else if (!saveButton.disabled) {
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(saveButton, { attributes: true, attributeFilter: ["disabled"] });
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
  });
}

function triggerSingleSave(saveButton, tabs, dialog) {
  const initialCount = tabs.children.length;
  return new Promise((resolve) => {
    let sawDisabled = saveButton.disabled;
    const observer = new MutationObserver(() => {
      if (tabs.children.length < initialCount || !dialog.open) {
        observer.disconnect();
        resolve(true);
        return;
      }
      if (saveButton.disabled) sawDisabled = true;
      if (sawDisabled && !saveButton.disabled && tabs.children.length === initialCount) {
        observer.disconnect();
        resolve(false);
      }
    });
    observer.observe(tabs, { childList: true });
    observer.observe(saveButton, { attributes: true, attributeFilter: ["disabled"] });
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    saveButton.click();
  });
}

function configureSaveAll(root) {
  const dialog = root.querySelector("#pdf-ai-dialog");
  const tabs = dialog?.querySelector("#pdf-review-tabs");
  const saveButton = dialog?.querySelector("#pdf-ai-save");
  const actions = saveButton?.parentElement;
  if (!dialog || !tabs || !saveButton || !actions) return false;
  if (dialog.querySelector("#pdf-ai-save-all")) return true;

  const saveAllButton = root.createElement("button");
  saveAllButton.type = "button";
  saveAllButton.id = "pdf-ai-save-all";
  saveAllButton.className = "quiet-button";
  saveAllButton.textContent = "Save all";
  saveAllButton.hidden = true;
  saveButton.after(saveAllButton);

  let batchRunning = false;
  function refresh() {
    const multiple = tabs.children.length > 1;
    saveAllButton.hidden = !multiple;
    saveAllButton.disabled = batchRunning || !multiple || saveButton.disabled;
  }

  const observer = new MutationObserver(refresh);
  observer.observe(tabs, { childList: true });
  observer.observe(saveButton, { attributes: true, attributeFilter: ["disabled"] });
  observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });

  saveAllButton.addEventListener("click", async () => {
    if (batchRunning || tabs.children.length < 2) return;
    batchRunning = true;
    refresh();
    try {
      while (dialog.open && tabs.children.length) {
        if (!await waitForSaveAvailability(saveButton, dialog)) break;
        const saved = await triggerSingleSave(saveButton, tabs, dialog);
        if (!saved) break;
      }
    } finally {
      batchRunning = false;
      refresh();
    }
  });

  refresh();
  return true;
}

export function initPublicationUi(root = document) {
  if (!root?.querySelector || !root?.createElement) return false;
  const menuReady = configureAddPublicationMenu(root);
  const configReady = moveLibraryActionsToConfig(root);
  const pickerReady = configureUnifiedFilePicker(root);
  const saveAllReady = configureSaveAll(root);
  return menuReady && configReady && pickerReady && saveAllReady;
}

function initWhenReady() {
  if (typeof document === "undefined") return;
  if (initPublicationUi(document)) return;

  const observer = new MutationObserver(() => {
    if (!initPublicationUi(document)) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

initWhenReady();
