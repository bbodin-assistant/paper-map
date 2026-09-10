#!/usr/bin/env python3
import shutil

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
    create_driver,
    save_screenshot,
)
from pdf_review_selenium_test import (
    CUSTOM_BASE_URL,
    configure_compatible_ai,
    create_ai_text_pdf_fixture,
    read_indexeddb,
)

BATCH_METADATA = {
    "batch-one.pdf": {
        "title": "Batch Tab Paper One",
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
    "batch-three.pdf": {
        "title": "Batch Tab Paper Three",
        "authors": ["Queue Author Three"],
        "year": 2023,
        "venue": "Batch Venue",
        "publication_type": "article",
        "doi": "10.5555/paper-map.batch.three",
        "arxiv_id": "",
        "url": "https://example.org/batch-three",
        "abstract": "Third tab saved first.",
        "keywords": ["batch", "three"],
        "topics": [],
        "warnings": [],
    },
}

ONLINE_DOI = "10.5555/paper-map.batch.four"
ONLINE_PAPER = {
    "paperId": "batch-four-s2",
    "title": "Online Batch Paper Four",
    "abstract": "Metadata supplied by the configured scholarly proxy.",
    "year": 2024,
    "venue": "Online Batch Venue",
    "publicationTypes": ["JournalArticle"],
    "authors": [{"name": "Online Author Four"}],
    "externalIds": {"DOI": ONLINE_DOI},
    "url": "https://example.org/batch-four-online",
    "citationCount": 4,
    "fieldsOfStudy": ["Information Retrieval"],
}


def create_batch_fixtures():
    source = create_ai_text_pdf_fixture()
    fixtures = []
    for name in ["batch-one.pdf", "batch-two.pdf", "batch-three.pdf", "batch-four.pdf"]:
        target = (ARTIFACT_DIR / name).resolve()
        shutil.copyfile(source, target)
        fixtures.append(target)
    return fixtures


def install_batch_fetch_mock(driver):
    driver.execute_script(
        """
        const metadataByFile = arguments[0];
        const aiUrl = arguments[1];
        const onlineDoi = arguments[2];
        const onlinePaper = arguments[3];
        const originalFetch = window.fetch.bind(window);
        window.__paperMapBatchAiRequests = [];
        window.__paperMapBatchOnlineRequests = [];
        window.fetch = async (url, options = {}) => {
          const textUrl = String(url);
          if (textUrl === aiUrl) {
            const payload = JSON.parse(options.body || '{}');
            const prompt = payload.messages?.[1]?.content || '';
            const fileName = Object.keys(metadataByFile).find((name) => prompt.includes(`Research PDF: ${name}`));
            if (!fileName) {
              return new Response(JSON.stringify({ error: { message: 'Unknown batch PDF fixture' } }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            window.__paperMapBatchAiRequests.push(fileName);
            return new Response(
              JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(metadataByFile[fileName]) } }] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          const parsed = new URL(textUrl, window.location.href);
          if (parsed.hostname === 'api.semanticscholar.org') {
            window.__paperMapBatchOnlineRequests.push(textUrl);
            const decodedPath = decodeURIComponent(parsed.pathname);
            if (decodedPath.includes(`DOI:${onlineDoi}`)) {
              return new Response(JSON.stringify(onlinePaper), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            return new Response(JSON.stringify({ message: 'Unknown scholarly lookup fixture' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return originalFetch(url, options);
        };
        """,
        BATCH_METADATA,
        f"{CUSTOM_BASE_URL}/chat/completions",
        ONLINE_DOI,
        ONLINE_PAPER,
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


def tab_for_file(driver, file_name):
    tabs = driver.find_elements(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]")
    return next((tab for tab in tabs if tab.get_attribute("title") == file_name), None)


def activate_tab(driver, file_name):
    wait = WebDriverWait(driver, WAIT_SECONDS)
    tab = wait.until(lambda d: tab_for_file(d, file_name))
    driver.execute_script("arguments[0].scrollIntoView({block: 'nearest', inline: 'center'});", tab)
    tab.click()
    wait.until(lambda d: d.find_element(By.ID, "pdf-ai-file-name").text == file_name)


def run_ai_for_active(driver, expected_title):
    wait = WebDriverWait(driver, WAIT_SECONDS)
    wait.until(EC.element_to_be_clickable((By.ID, "pdf-ai-analyze"))).click()
    wait.until(lambda d: "AI extraction merged" in d.find_element(By.ID, "pdf-ai-analysis-status").text)
    assert_true(driver.find_element(By.ID, "pdf-review-title").get_attribute("value") == expected_title, "AI result should merge into only the active tab")


def save_active(driver, file_name):
    wait = WebDriverWait(driver, WAIT_SECONDS)
    tab = tab_for_file(driver, file_name)
    save = wait.until(EC.element_to_be_clickable((By.ID, "pdf-ai-save")))
    save.click()
    wait.until(EC.staleness_of(tab))
    assert_true(tab_for_file(driver, file_name) is None, "Saving should remove only the saved tab")


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_driver()
    wait = WebDriverWait(driver, WAIT_SECONDS)
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))
        configure_compatible_ai(driver)
        driver.execute_script("localStorage.setItem('paper-map-paper-provider-config-v1', JSON.stringify({provider:'semantic-scholar'}));")
        install_batch_fetch_mock(driver)

        fixtures = create_batch_fixtures()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        assert_true(file_input.get_dom_attribute("multiple") is not None, "PDF picker should accept multiple files")
        file_input.send_keys("\n".join(str(path) for path in fixtures))

        dialog = wait.until(
            lambda d: d.find_element(By.ID, "pdf-ai-dialog")
            if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None
            else False
        )
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]")) == 4)
        wait.until(
            lambda d: all(
                tab.get_attribute("data-local-status") == "complete"
                for tab in d.find_elements(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]")
            )
        )
        assert_no_page_horizontal_overflow(driver)

        activate_tab(driver, "batch-three.pdf")
        run_ai_for_active(driver, BATCH_METADATA["batch-three.pdf"]["title"])
        save_active(driver, "batch-three.pdf")
        third = read_indexeddb(driver, "papers", "doi:10.5555/paper-map.batch.three")
        assert_true(third is not None, "An out-of-order saved tab should persist immediately")
        assert_true(third["sourceFileName"] == "batch-three.pdf", "Out-of-order save should retain per-file provenance")

        activate_tab(driver, "batch-one.pdf")
        run_ai_for_active(driver, BATCH_METADATA["batch-one.pdf"]["title"])
        save_active(driver, "batch-one.pdf")
        first = read_indexeddb(driver, "papers", "doi:10.5555/paper-map.batch.one")
        assert_true(first is not None, "First tab should remain independently saveable after a later tab")

        activate_tab(driver, "batch-four.pdf")
        doi = driver.find_element(By.ID, "pdf-review-doi")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", doi)
        doi.click()
        doi.send_keys(Keys.CONTROL, "a")
        doi.send_keys(ONLINE_DOI)
        doi.send_keys(Keys.TAB)
        online = wait.until(EC.element_to_be_clickable((By.ID, "pdf-online-extract")))
        driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", online)
        online.click()
        wait.until(lambda d: "metadata merged" in d.find_element(By.ID, "pdf-ai-analysis-status").text)
        assert_true(driver.find_element(By.ID, "pdf-review-title").get_attribute("value") == ONLINE_PAPER["title"], "Online extraction should enrich the active tab")
        save_active(driver, "batch-four.pdf")
        fourth = read_indexeddb(driver, "papers", f"doi:{ONLINE_DOI}")
        assert_true(fourth is not None, "Online-enriched tab should save with canonical DOI identity")
        assert_true(fourth["onlineExtraction"]["provider"] == "semantic-scholar", "Online extraction should persist provider provenance")
        assert_true("semantic-scholar" in fourth["metadataSources"], "Online scholarly metadata source should be retained")

        activate_tab(driver, "batch-two.pdf")
        last_tab = tab_for_file(driver, "batch-two.pdf")
        wait.until(EC.element_to_be_clickable((By.ID, "pdf-ai-skip-file"))).click()
        wait.until(EC.staleness_of(last_tab))
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

        papers = read_all_papers(driver)
        by_file = {paper.get("sourceFileName"): paper for paper in papers if paper.get("sourceFileName")}
        assert_true(set(by_file) == {"batch-one.pdf", "batch-three.pdf", "batch-four.pdf"}, "Skipped tab should be the only selected PDF not persisted")
        assert_true(driver.execute_script("return window.__paperMapBatchAiRequests || []") == [], "Reload should clear page-local AI request state")
        assert_no_page_horizontal_overflow(driver)
        save_screenshot(driver, "pdf-batch-review-tabs.png")
        print("Automatic local extraction, out-of-order tabs, per-tab save/skip, AI merge, online merge, and provenance checks passed.")
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
        print(f"Timed out during tabbed multi-PDF review Selenium test: {error}")
        raise
