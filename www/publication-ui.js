const ACCEPTED_PUBLICATION_FILES = ".pdf,.json,.bib,application/pdf,application/json,application/x-bibtex,text/x-bibtex,text/plain";

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
  if (summary) summary.textContent = "Add publication";

  const panel = menu.querySelector(".library-panel");
  panel?.querySelector(".drawer-heading")?.remove();
  const form = panel?.querySelector("#add-paper-form");
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

  button.textContent = "Add";
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

export function initPublicationUi(root = document) {
  if (!root?.querySelector || !root?.createElement) return false;
  const menuReady = configureAddPublicationMenu(root);
  const configReady = moveLibraryActionsToConfig(root);
  const pickerReady = configureUnifiedFilePicker(root);
  return menuReady && configReady && pickerReady;
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
