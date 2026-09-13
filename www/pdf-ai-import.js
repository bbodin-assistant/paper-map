import { initPdfReviewController } from "./pdf-review-controller.js";

if (typeof document !== "undefined") {
  if (!document.querySelector('link[data-pdf-review-state]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./pdf-review-state.css";
    link.dataset.pdfReviewState = "true";
    document.head.append(link);
  }
  initPdfReviewController();
}
