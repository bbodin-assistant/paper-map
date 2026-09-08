#!/usr/bin/env python3
import os
import re
import shutil
import subprocess
import sys
from difflib import SequenceMatcher
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

TEST_URL = os.environ.get("TEST_URL", "http://127.0.0.1:8080/www/")
ARTIFACT_DIR = Path(os.environ.get("MOBILE_TEST_ARTIFACT_DIR", "artifacts/mobile-ui"))
WAIT_SECONDS = int(os.environ.get("MOBILE_TEST_WAIT_SECONDS", "20"))
MOBILE_WIDTH = 390
MOBILE_HEIGHT = 844
OCR_SIMILARITY_THRESHOLD = 0.90


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def normalize_ocr(value):
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def best_ocr_phrase_score(ocr_text, expected_phrase):
    normalized = normalize_ocr(ocr_text)
    target = normalize_ocr(expected_phrase)
    if not target:
        return 1.0
    if target in normalized:
        return 1.0

    words = normalized.split()
    target_words = target.split()
    best = 0.0
    for window_size in range(max(1, len(target_words) - 1), len(target_words) + 2):
        for start in range(0, max(0, len(words) - window_size + 1)):
            candidate = " ".join(words[start : start + window_size])
            best = max(best, SequenceMatcher(None, target, candidate).ratio())
    return best


def chrome_binary():
    configured = os.environ.get("CHROME_BINARY")
    if configured:
        return configured
    for candidate in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        path = shutil.which(candidate)
        if path:
            return path
    return None


def create_driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--hide-scrollbars")
    binary = chrome_binary()
    if binary:
        options.binary_location = binary
    options.add_experimental_option(
        "mobileEmulation",
        {
            "deviceMetrics": {
                "width": MOBILE_WIDTH,
                "height": MOBILE_HEIGHT,
                "pixelRatio": 3.0,
                "touch": True,
                "mobile": True,
            },
            "userAgent": (
                "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            ),
        },
    )
    return webdriver.Chrome(options=options)


def save_screenshot(driver, name, element=None):
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = ARTIFACT_DIR / name
    if element is None:
        driver.save_screenshot(str(path))
    else:
        element.screenshot(str(path))
    return path


def wait_displayed(driver, selector, timeout=WAIT_SECONDS):
    return WebDriverWait(driver, timeout).until(EC.visibility_of_element_located((By.CSS_SELECTOR, selector)))


def wait_click(driver, selector, timeout=WAIT_SECONDS):
    element = WebDriverWait(driver, timeout).until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
    element.click()
    return element


def assert_widget_text_visible(driver, selector, label):
    issues = driver.execute_script(
        r"""
        const selector = arguments[0];
        const root = document.querySelector(selector);
        if (!root) return [{text: "<missing root>", reason: "missing"}];
        const rootStyle = getComputedStyle(root);
        if (root.hidden || rootStyle.display === "none" || rootStyle.visibility === "hidden") {
          return [{text: "<hidden root>", reason: "hidden"}];
        }

        const rootRect = root.getBoundingClientRect();
        const left = Math.max(0, rootRect.left);
        const right = Math.min(window.innerWidth, rootRect.right);
        const top = Math.max(0, rootRect.top);
        const bottom = Math.min(window.innerHeight, rootRect.bottom);
        const scrollsVertically = root.scrollHeight > root.clientHeight + 2 || ["auto", "scroll"].includes(rootStyle.overflowY);
        const issues = [];

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          const parent = node.parentElement;
          if (!parent || parent.closest(".visually-hidden,[hidden],[aria-hidden='true']")) continue;
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;

          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
          for (const rect of rects) {
            if (rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right) continue;
            if (rect.left < left - 1 || rect.right > right + 1) {
              issues.push({text: text.slice(0, 90), reason: "horizontal clipping", rect: [rect.left, rect.right], limits: [left, right]});
            }
            if (!scrollsVertically && (rect.top < top - 1 || rect.bottom > bottom + 1)) {
              issues.push({text: text.slice(0, 90), reason: "vertical clipping", rect: [rect.top, rect.bottom], limits: [top, bottom]});
            }
          }
        }

        for (const control of root.querySelectorAll("button,summary,input,select,textarea,a")) {
          const style = getComputedStyle(control);
          if (control.hidden || style.display === "none" || style.visibility === "hidden") continue;
          const rect = control.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          if (rect.bottom <= top || rect.top >= bottom) continue;
          if (rect.left < left - 1 || rect.right > right + 1) {
            issues.push({text: control.textContent.trim().slice(0, 90) || control.getAttribute("aria-label") || control.id, reason: "control outside widget", rect: [rect.left, rect.right], limits: [left, right]});
          }
        }
        return issues.slice(0, 30);
        """,
        selector,
    )
    assert_true(not issues, f"{label} has clipped/off-screen visible text or controls: {issues}")


def assert_no_page_horizontal_overflow(driver):
    metrics = driver.execute_script(
        "return {innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth};"
    )
    assert_true(metrics["innerWidth"] <= MOBILE_WIDTH + 2, f"Mobile emulation width is wrong: {metrics}")
    assert_true(metrics["doc"] <= metrics["innerWidth"] + 2, f"Document overflows horizontally: {metrics}")
    assert_true(metrics["body"] <= metrics["innerWidth"] + 2, f"Body overflows horizontally: {metrics}")


def run_ocr(screenshot, expected_phrases):
    command = ["tesseract", str(screenshot), "stdout", "--psm", "6", "-l", "eng"]
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        raise AssertionError(f"Tesseract failed ({completed.returncode}): {completed.stderr}")

    text = completed.stdout
    (ARTIFACT_DIR / "ocr.txt").write_text(text, encoding="utf-8")
    scores = {phrase: best_ocr_phrase_score(text, phrase) for phrase in expected_phrases}
    (ARTIFACT_DIR / "ocr-checks.txt").write_text(
        "\n".join(f"{phrase}: {score:.3f}" for phrase, score in scores.items()) + "\n",
        encoding="utf-8",
    )
    missing = [phrase for phrase, score in scores.items() if score < OCR_SIMILARITY_THRESHOLD]
    assert_true(
        not missing,
        f"OCR did not recognize visible UI text {missing} at >= {OCR_SIMILARITY_THRESHOLD:.2f}. Scores: {scores}. OCR output: {text!r}",
    )


def create_pdf_fixture():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    fixture = ARTIFACT_DIR / "mobile-test-paper.pdf"
    fixture.write_bytes(b"%PDF-1.4\n% Paper Map Selenium fixture\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")
    return fixture.resolve()


def close_details_if_open(driver, selector):
    opened = driver.find_elements(By.CSS_SELECTOR, selector)
    if opened and opened[0].get_attribute("open") is not None:
        opened[0].find_element(By.CSS_SELECTOR, ":scope > summary").click()


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_driver()
    wait = WebDriverWait(driver, WAIT_SECONDS)
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Paper Map" in d.find_element(By.CSS_SELECTOR, ".brand strong").text)
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").text)

        assert_no_page_horizontal_overflow(driver)
        assert_widget_text_visible(driver, ".app-header", "mobile app header")
        assert_widget_text_visible(driver, ".atlas-toolbar", "mobile atlas toolbar")
        initial = save_screenshot(driver, "01-initial-mobile.png")
        print(f"Initial mobile screenshot: {initial}")

        # About popover.
        wait_click(driver, "#about-button")
        wait_displayed(driver, "#about-panel")
        assert_widget_text_visible(driver, "#about-panel", "About widget")
        assert_true("browser-local bibliography" in driver.find_element(By.ID, "about-panel").text, "About text should be visible")
        save_screenshot(driver, "02-about.png")
        wait_click(driver, "#about-button")
        wait.until(EC.invisibility_of_element_located((By.ID, "about-panel")))

        # Library drawer and demo data.
        wait_click(driver, "#library-menu > summary")
        library_panel = wait_displayed(driver, "#library-menu .library-panel")
        assert_widget_text_visible(driver, "#library-menu .library-panel", "Library widget")
        assert_true("Import PDF with AI" in library_panel.text, "AI PDF import action should be visible in Library")
        ocr_shot = save_screenshot(driver, "03-library-ocr.png", library_panel)
        run_ocr(ocr_shot, ["Library", "Load demo", "Import PDF with AI"])

        wait_click(driver, "#load-demo")
        wait.until(lambda d: int(d.find_element(By.ID, "visible-paper-count").text or "0") > 0)
        close_details_if_open(driver, "#library-menu")
        assert_no_page_horizontal_overflow(driver)

        # Filters widget: click a real filter, then clear it.
        wait_click(driver, "#filter-menu > summary")
        wait_displayed(driver, "#filter-menu .filter-panel")
        assert_widget_text_visible(driver, "#filter-menu .filter-panel", "Filters widget")
        starred = wait_displayed(driver, "#filter-starred")
        starred.click()
        wait.until(lambda d: not d.find_element(By.ID, "filter-count").get_attribute("hidden"))
        wait_click(driver, "#clear-filters")
        wait.until(lambda d: not d.find_element(By.ID, "filter-starred").is_selected())
        save_screenshot(driver, "04-filters.png")
        close_details_if_open(driver, "#filter-menu")

        # Toggle map modes and make sure the topic map renders clickable blocks.
        wait_click(driver, "#map-mode button[data-mode='topics']")
        wait.until(lambda d: "selected" in d.find_element(By.CSS_SELECTOR, "#map-mode button[data-mode='topics']").get_attribute("class"))
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".topic-block")) > 0)
        assert_widget_text_visible(driver, ".atlas-toolbar", "Topic-map toolbar")
        save_screenshot(driver, "05-topic-map.png")
        wait_click(driver, "#map-mode button[data-mode='citations']")
        wait.until(lambda d: "selected" in d.find_element(By.CSS_SELECTOR, "#map-mode button[data-mode='citations']").get_attribute("class"))

        # Bibliography drawer and paper detail widget.
        wait_click(driver, "#paper-list-button")
        wait_displayed(driver, "#paper-list-panel")
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-list-item")) > 0)
        assert_widget_text_visible(driver, "#paper-list-panel", "Bibliography widget")
        first_paper = driver.find_elements(By.CSS_SELECTOR, ".paper-list-item")[0]
        assert_true(first_paper.text.strip(), "First bibliography item should have visible text")
        first_paper.click()
        detail = wait_displayed(driver, "#paper-detail")
        assert_widget_text_visible(driver, "#paper-detail", "Paper detail widget")
        assert_true(driver.find_element(By.ID, "detail-title").text.strip(), "Paper detail title should be visible")
        star = wait_displayed(driver, "#detail-star")
        before_star = star.text
        star.click()
        wait.until(lambda d: d.find_element(By.ID, "detail-star").text != before_star)
        save_screenshot(driver, "06-paper-detail.png")
        wait_click(driver, "#close-detail")
        wait.until(EC.invisibility_of_element_located((By.ID, "paper-detail")))
        wait_click(driver, "#close-paper-list")
        wait.until(EC.invisibility_of_element_located((By.ID, "paper-list-panel")))

        # Exercise the PDF import widget without making an external AI request.
        wait_click(driver, "#library-menu > summary")
        wait_displayed(driver, "#library-menu .library-panel")
        fixture = create_pdf_fixture()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        file_input.send_keys(str(fixture))
        dialog = wait.until(lambda d: d.find_element(By.ID, "pdf-ai-dialog") if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None else False)
        assert_widget_text_visible(driver, "#pdf-ai-dialog", "PDF AI import widget")
        assert_true("PDF metadata & topics" in dialog.text, "PDF AI dialog heading should be visible")
        assert_true("Analyze PDF" in dialog.text, "PDF AI analyze action should be visible")
        save_screenshot(driver, "07-pdf-ai-dialog.png")
        wait_click(driver, "#pdf-ai-close")
        wait.until(lambda d: d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is None)

        assert_no_page_horizontal_overflow(driver)
        print("Mobile Selenium interaction, text-visibility, screenshot, and OCR checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during mobile Selenium test: {error}", file=sys.stderr)
        raise
