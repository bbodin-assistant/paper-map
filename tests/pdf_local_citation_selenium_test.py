#!/usr/bin/env python3
from pathlib import Path

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import (
    ARTIFACT_DIR,
    TEST_URL,
    WAIT_SECONDS,
    assert_no_page_horizontal_overflow,
    assert_true,
    assert_widget_text_visible,
    create_driver,
    save_screenshot,
    wait_click,
    wait_displayed,
)
from pdf_review_selenium_test import center_element

SAVED_TITLE = "Rust WASM Citation Extraction Fixture"


def pdf_escape(value):
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def page_stream(lines):
    commands = ["BT", "/F1 11 Tf", "72 730 Td"]
    for index, line in enumerate(lines):
        if index:
            commands.append("0 -18 Td")
        commands.append(f"({pdf_escape(line)}) Tj")
    commands.append("ET")
    return "\n".join(commands).encode("latin-1")


def create_valid_citation_pdf():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = (ARTIFACT_DIR / "rust-citation-fixture.pdf").resolve()
    streams = [
        page_stream(
            [
                "Deterministic Citation Fixture",
                "This page contains ordinary paper body text.",
                "The bibliography is on the following page.",
            ]
        ),
        page_stream(
            [
                "References",
                "[1] Ada Author. A DOI reference. Journal 2022. doi:10.1234/TEST.55.",
                "[2] Grace Author. An arXiv reference. arXiv:2401.01234v2 (2024).",
                "[3] Linus Author. A plain reference without persistent identifier. 2020.",
            ]
        ),
    ]

    objects = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>")
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>")
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for stream in streams:
        objects.append(b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream")

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii"))
        output.extend(body)
        output.extend(b"\nendobj\n")

    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    path.write_bytes(output)
    return path


def read_all_indexeddb(driver, store_name):
    result = driver.execute_async_script(
        """
        const storeName = arguments[0];
        const done = arguments[arguments.length - 1];
        const open = indexedDB.open("paper-map-v1");
        open.onerror = () => done({ error: String(open.error || "Could not open IndexedDB") });
        open.onsuccess = () => {
          const request = open.result.transaction(storeName, "readonly").objectStore(storeName).getAll();
          request.onerror = () => done({ error: String(request.error || "IndexedDB read failed") });
          request.onsuccess = () => done({ values: request.result || [] });
        };
        """,
        store_name,
    )
    assert_true(not result.get("error"), f"IndexedDB {store_name} read failed: {result.get('error')}")
    return result.get("values", [])


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_driver()
    wait = WebDriverWait(driver, WAIT_SECONDS)
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )
        assert_no_page_horizontal_overflow(driver)

        wait_click(driver, "#library-menu > summary")
        wait_displayed(driver, "#library-menu .library-panel")
        fixture = create_valid_citation_pdf()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        file_input.send_keys(str(fixture))
        dialog = wait.until(
            lambda d: d.find_element(By.ID, "pdf-ai-dialog")
            if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None
            else False
        )
        assert_true("Extract citations locally" in dialog.text, "Local extraction action should be visible")

        wait_click(driver, "#pdf-local-extract")
        review = wait_displayed(driver, "#pdf-ai-review")
        wait.until(lambda d: "Local extraction complete" in d.find_element(By.ID, "pdf-ai-analysis-status").text)
        assert_widget_text_visible(driver, "#pdf-ai-dialog", "Rust PDF citation review widget")
        source_kicker = driver.find_element(By.ID, "pdf-review-source-kicker").get_attribute("textContent")
        assert_true(source_kicker == "Local Rust/WASM proposal", "Review should identify the local Rust/WASM source")

        rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")
        assert_true(len(rows) == 3, f"Expected 3 segmented references, got {len(rows)}")
        assert_true("10.1234/test.55" in rows[0].text.lower(), "First reference should expose normalized DOI")
        assert_true("2401.01234v2" in rows[1].text.lower(), "Second reference should expose arXiv ID")
        assert_true("2020" in rows[2].text, "Third reference should expose publication year")
        assert_true(all(row.find_element(By.CSS_SELECTOR, "[data-reference-use]").is_selected() for row in rows), "References should be accepted by default")

        rejected = rows[2].find_element(By.CSS_SELECTOR, "[data-reference-use]")
        center_element(driver, rejected)
        rejected.click()
        assert_true(not rejected.is_selected(), "Reference review should allow rejecting an extracted entry")

        title = wait_displayed(driver, "#pdf-review-title")
        center_element(driver, title)
        title.click()
        title.send_keys(Keys.CONTROL, "a")
        title.send_keys(SAVED_TITLE)
        title.send_keys(Keys.TAB)
        assert_true(title.get_attribute("value") == SAVED_TITLE, "Locally extracted paper title should remain editable")

        save_screenshot(driver, "10-rust-citation-review.png", dialog)
        save_button = wait_displayed(driver, "#pdf-ai-save")
        center_element(driver, save_button)
        save_button.click()
        wait.until(EC.staleness_of(save_button))
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )

        papers = read_all_indexeddb(driver, "papers")
        assert_true(len(papers) == 1, f"Expected one saved local PDF paper, got {len(papers)}")
        paper = papers[0]
        assert_true(paper["title"] == SAVED_TITLE, "Edited title should persist after local extraction")
        assert_true(paper["source"] == "local-pdf", "Local extraction should persist local-pdf provenance")
        assert_true(paper["pdfExtraction"]["provider"] == "rust-wasm", "Saved extraction should record rust-wasm provider")
        assert_true(paper["pdfExtraction"]["engine"].startswith("paper-map-rust-pdf/"), "Saved extraction should retain Rust engine version")
        assert_true(paper["pdfExtraction"]["layout"]["pageCount"] == 2, "Layout summary should retain page count")
        assert_true(paper["pdfExtraction"]["layout"]["bibliographyHeading"] == "References", "Bibliography heading should be detected")
        assert_true(paper["pdfExtraction"]["layout"]["bibliographyStartPage"] == 2, "Bibliography page provenance should persist")

        references = paper.get("extractedReferences", [])
        assert_true(len(references) == 2, "Rejected reference must not be persisted")
        assert_true(references[0]["doi"] == "10.1234/test.55", "Accepted DOI reference should persist")
        assert_true(references[1]["arxivId"] == "2401.01234v2", "Accepted arXiv reference should persist")
        assert_true(all(reference.get("reviewed") for reference in references), "Persisted references should be marked reviewed")

        wait_click(driver, "#paper-list-button")
        wait_displayed(driver, "#paper-list-panel")
        items = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".paper-list-item"))
        assert_true(len(items) == 1, "Bibliography should contain the locally extracted paper")
        assert_true(SAVED_TITLE in items[0].text, "Saved local PDF title should appear in Bibliography")
        save_screenshot(driver, "11-rust-citation-saved.png")
        assert_no_page_horizontal_overflow(driver)
        print("Rust/WASM PDF bibliography detection, identifier extraction, review, and persistence checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "rust-citation-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during Rust/WASM citation extraction Selenium test: {error}")
        raise
