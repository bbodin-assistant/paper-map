import { initPaperAttachments } from "./paper-attachments.js?v=0.4.21";
import { initTimelinePdfIcons } from "./timeline-pdf-icons.js?v=0.1.0";

if (typeof document !== "undefined") {
  initPaperAttachments(document);
  initTimelinePdfIcons(document);
}
