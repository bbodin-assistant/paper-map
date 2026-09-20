import { initPdfReviewController } from "./pdf-review-controller.js?v=0.4.14";

if (typeof document !== "undefined") {
  if (!document.querySelector('link[data-pdf-review-state]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./pdf-review-state.css";
    link.dataset.pdfReviewState = "true";
    document.head.append(link);
  }
  initPdfReviewController();
  const explainer = document.querySelector(".pdf-ai-explainer");
  if (explainer) {
    explainer.textContent = "Every selected PDF is extracted locally with Rust/WebAssembly. Search online from Title, DOI, or arXiv ID using the button beside that field. Title searches show candidates from every enabled paper-search provider before anything is merged. You can also run optional AI extraction. Results are merged without overwriting fields you edited manually.";
  }
}
