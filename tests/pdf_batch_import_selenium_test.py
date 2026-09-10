#!/usr/bin/env python3
import shutil

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import (
    ARTIFACT_DIR,
    TEST_URL,
    WAIT_SECONDS,
    assert_no_page_horizontal_overflow,
    assert_true,
    create_driver,
    save_screenshot,
    wait_click,
    wait_displayed,
)
from pdf_review_selenium_test import (
    CUSTOM_BASE_URL,
    CUSTOM_MODEL,
    configure_compatible_ai,
    create_ai_text_pdf_fixture,
    read_indexeddb,
)

BATCH_METADATA = {
    "batch-one.pdf": {
        "title": "Batch Queue Paper One",
        "authors": ["Queue Author One"],
        "year": 2021,
        "venue": "Batch Venue",
        "publication_type": "article",
        "doi": "10.5555/paper-map.batch.one",
        "arxiv_id": "",
        "url": "https://example.org/batch-one",
        "abstract": "First saved batch PDF.",
        "keywords": ["batch", "one"],
        "topics": [],
        "warnings": [],
    },
    "batch-two.pdf": {
        "title": "Batch Queue Paper Two",
        "authors": ["Queue Author Two"],
        "year": 2022,
        "venue": "Batch Venue",
        "publication_type": "article",
        "doi": "10.5555/paper-map.batch.two",
        "arxiv_id": "",
        "url": "https://example.org/batch-two",
        "abstract": "Skipped batch PDF.",
        "keywords": ["batch", "two"],
        "topics": [],
        "warnings": [],
    },
    "batch-three.pdf": {
        "title": "Batch Queue Paper Three",
        "authors": ["Queue Author Three"],
        "year": 2023,
        "venue": "Batch Venue",
        "publication_type": "article",
        "doi": "10.5555/paper-map.batch.three",
        "arxiv_id": "",
        "url": "https://example.org/batch-three",
        "abstract": "Second saved batch PDF.",
        "keywords": ["batch", "three"],
        "topics": [],
        "warnings": [],
    },
    "batch-four.pdf": {
        "title": "Batch Queue Paper Four",
        "authors": ["Queue Author Four"],
        "year": 2024,
        "venue": "Batch Venue",
        "publication_type": "article",
        "doi": "10.5555/paper-map.batch.four",
        "arxiv_id": "",
        "url": "https://example.org/batch-four",
        "abstract": "Discarded batch PDF.",
        "keywords": ["batch", "four"],
        "topics": [],
        "warnings": [],
    },
}


def create_batch_fixtures():
    source = create_ai_text_pdf_fixture()
    fixtures = []
    for name in BATCH_METADATA:
        target = (ARTIFACT_DIR / name).resolve()
        shutil.copyfile(source, target)
        fixtures.append(target)
    return fixtures


def install_batch_fetch_mock(driver):
    driver.execute_script(
        """
        const metadataByFile = arguments[0];
        const expectedUrl = arguments[1];
        const originalFetch = window.fetch.bind(window);
        window.__paperMapBatchRequests = [];
        window.fetch = async (url, options = {}) => {
          if (String(url) === expectedUrl) {
            const payload = JSON.parse(options.body || '{}');
            const prompt = payload.messages?.[1]?.content || '';
            const fileName = Object.keys(metadataByFile).find((name) => prompt.includes(`Research PDF: ${name}`));
            if (!fileName) {
              return new Response(JSON.stringify({ error: { message: 'Unknown batch PDF fixture' } }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            window.__paperMapBatchRequests.push(fileName);
            return new Response(
              JSON.stringify({
                choices: [{ message: { role: 'assistant', content: JSON.stringify(metadataByFile[fileName]) } }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return originalFetch(url, options);
        };
        """,
        BATCH_METADATA,
        f"{CUSTOM_BASE_URL}/chat/completions",
    )


def wait_for_queue(driver, position, file_name):
    wait = WebDriverWait(driver, WAIT_SECONDS)
    wait.until(lambda d: d.find_element(By.ID, "pdf-ai-queue-progress").text == position)
    wait.until(lambda d: d.find_element(By.ID, "pdf-ai-file-name").text == file_name)


def analyze_current(driver):
    wait_click(driver, "#pdf-ai-analyze")
    wait_displayed(driver, "#pdf-ai-review")
    WebDriverWait(driver, WAIT_SECONDS).until(
        lambda d: "AI analysis complete" in d.find_element(By.ID, "pdf-ai-analysis-status").text
    )


def read_all_papers(driver):
    result = driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        const open = indexedDB.open('paper-map-v1');
        open.onerror = () => done({ error: String(open.error || 'Could not open IndexedDB') });
        open.onsuccess = () => {
          const request = open.result.transaction('papers', 'readonly').objectStore('papers').getAll();
          request.onerror = () => done({ error: String(request.error || 'IndexedDB read failed') });
          request.onsuccess = () => done({ value: request.result || [] });
        };
        """
    )
    assert_true(not result.get("error"), f"IndexedDB papers read failed: {result.get('error')}")
    return result.get("value") or []


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
        configure_compatible_ai(driver)
        install_batch_fetch_mock(driver)
        wait_click(driver, "#library-menu > summary")
        wait_displayed(driver, "#library-menu .library-panel")

        fixtures = create_batch_fixtures()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        assert_true(file_input.get_dom_attribute("multiple") is not None, "PDF picker should accept multiple files")
        file_input.send_keys("\n".join(str(path) for path in fixtures))

        dialog = wait.until(
            lambda d: d.find_element(By.ID, "pdf-ai-dialog")
            if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None
            else False
        )
        wait_for_queue(driver, "1 of 4", "batch-one.pdf")
        assert_no_page_horizontal_overflow(driver)

        analyze_current(driver)
        assert_true(
            driver.find_element(By.ID, "pdf-review-title").get_attribute("value") == "Batch Queue Paper One",
            "First queued PDF should receive its own AI proposal",
        )
        wait_click(driver, "#pdf-ai-save")
        wait_for_queue(driver, "2 of 4", "batch-two.pdf")
        first = read_indexeddb(driver, "papers", "doi:10.5555/paper-map.batch.one")
        assert_true(first is not None, "Saving the first queued PDF should persist it before advancing")
        assert_true(first["sourceFileName"] == "batch-one.pdf", "First saved PDF should retain its own filename provenance")

        wait_click(driver, "#pdf-ai-skip-file")
        wait_for_queue(driver, "3 of 4", "batch-three.pdf")

        analyze_current(driver)
        assert_true(
            driver.find_element(By.ID, "pdf-review-title").get_attribute("value") == "Batch Queue Paper Three",
            "Third queued PDF should receive its own AI proposal after skipping the second",
        )
        wait_click(driver, "#pdf-ai-save")
        wait_for_queue(driver, "4 of 4", "batch-four.pdf")
        third = read_indexeddb(driver, "papers", "doi:10.5555/paper-map.batch.three")
        assert_true(third is not None, "Saving a later queued PDF should persist it without reloading the queue")
        assert_true(third["sourceFileName"] == "batch-three.pdf", "Later saved PDF should retain its own filename provenance")

        analyze_current(driver)
        assert_true(
            driver.find_element(By.ID, "pdf-review-title").get_attribute("value") == "Batch Queue Paper Four",
            "Final queued PDF should be independently reviewable",
        )
        save_screenshot(driver, "pdf-batch-review-queue.png", dialog)
        wait_click(driver, "#pdf-ai-discard")
        wait.until(EC.staleness_of(dialog))
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )

        papers = read_all_papers(driver)
        by_file = {paper.get("sourceFileName"): paper for paper in papers if paper.get("sourceFileName")}
        assert_true(set(by_file) == {"batch-one.pdf", "batch-three.pdf"}, "Skipped and discarded PDFs should not be saved")
        assert_true(by_file["batch-one.pdf"]["doi"] == "10.5555/paper-map.batch.one", "First PDF provenance should stay attached to the first paper")
        assert_true(by_file["batch-three.pdf"]["doi"] == "10.5555/paper-map.batch.three", "Third PDF provenance should stay attached to the third paper")
        requests = driver.execute_script("return window.__paperMapBatchRequests || []")
        assert_true(requests == [], "Reload after discarding remaining files should clear page-local request state")
        assert_no_page_horizontal_overflow(driver)
        print("Multi-PDF selection, review queue progress, save/skip/discard flow, and per-file provenance checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "pdf-batch-review-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during multi-PDF review queue Selenium test: {error}")
        raise
