#!/usr/bin/env python3
import json
import os
import unicodedata
import urllib.request
from pathlib import Path

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import ARTIFACT_DIR, TEST_URL, WAIT_SECONDS, assert_true, create_driver, save_screenshot
from pdf_review_selenium_test import center_element

CORPUS_PATH = Path(__file__).with_name("real-pdf-corpus.json")
DOWNLOAD_DIR = ARTIFACT_DIR / "real-pdfs"


def normalized(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    return " ".join("".join(ch for ch in text if not unicodedata.combining(ch)).lower().split())


def download_pdf(entry):
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    path = (DOWNLOAD_DIR / f"{entry['id']}.pdf").resolve()
    request = urllib.request.Request(
        entry["url"],
        headers={"User-Agent": "PaperMapRealPdfSmoke/1.0 (+https://github.com/bbodin-assistant/paper-map)"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read()
    assert_true(data.startswith(b"%PDF"), f"{entry['id']} did not download as a PDF")
    path.write_bytes(data)
    return path


def wait_for_local_result(driver, wait):
    def resolved(d):
        status = d.find_element(By.ID, "pdf-ai-analysis-status").get_attribute("textContent") or ""
        if "Local extraction complete" in status:
            return "complete"
        global_status = d.find_element(By.ID, "library-status")
        if "error" in (global_status.get_attribute("class") or ""):
            return f"error:{status or d.find_element(By.ID, 'library-status-text').text}"
        return False

    result = wait.until(resolved)
    if result.startswith("error:"):
        raise AssertionError(result.split(":", 1)[1])


def run_fixture(driver, wait, entry):
    pdf_path = download_pdf(entry)
    file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
    file_input.send_keys(str(pdf_path))
    dialog = wait.until(
        lambda d: d.find_element(By.ID, "pdf-ai-dialog")
        if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None
        else False
    )
    local_button = wait.until(EC.element_to_be_clickable((By.ID, "pdf-local-extract")))
    center_element(driver, local_button)
    local_button.click()
    wait_for_local_result(driver, wait)
    wait.until(EC.visibility_of_element_located((By.ID, "pdf-ai-review")))

    title = driver.find_element(By.ID, "pdf-review-title").get_attribute("value")
    author_text = driver.find_element(By.ID, "pdf-review-authors").get_attribute("value")
    authors = [line.strip() for line in author_text.splitlines() if line.strip()]
    doi = driver.find_element(By.ID, "pdf-review-doi").get_attribute("value").strip().lower()
    references = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")

    assert_true(normalized(title) == normalized(entry["title"]), f"{entry['id']} title mismatch: {title!r}")
    actual_authors = {normalized(author) for author in authors}
    for expected in entry.get("authors", []):
        assert_true(normalized(expected) in actual_authors, f"{entry['id']} missing author {expected!r}; got {authors!r}")
    if "doi" in entry:
        assert_true(doi == entry.get("doi", "").lower(), f"{entry['id']} unexpected source DOI {doi!r}")
    assert_true(
        len(references) >= int(entry.get("minimumReferences", 1)),
        f"{entry['id']} extracted only {len(references)} references",
    )

    print(json.dumps({
        "id": entry["id"],
        "title": title,
        "authors": authors,
        "doi": doi,
        "references": len(references),
    }, ensure_ascii=False))
    save_screenshot(driver, f"real-pdf-{entry['id']}.png", dialog)
    discard = driver.find_element(By.ID, "pdf-ai-discard")
    center_element(driver, discard)
    discard.click()
    wait.until(lambda d: d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is None)


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    selected = {value.strip() for value in os.environ.get("REAL_PDF_IDS", "").split(",") if value.strip()}
    if selected:
        corpus = [entry for entry in corpus if entry["id"] in selected]
    assert_true(corpus, "No real PDF fixtures selected")

    driver = create_driver()
    wait = WebDriverWait(driver, max(WAIT_SECONDS, 30))
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )
        for entry in corpus:
            run_fixture(driver, wait, entry)
        print(f"Real PDF smoke corpus passed for {len(corpus)} paper(s).")
    except Exception:
        try:
            save_screenshot(driver, "real-pdf-smoke-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during real PDF smoke test: {error}")
        raise
