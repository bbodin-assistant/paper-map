#!/usr/bin/env python3
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import (
    ARTIFACT_DIR,
    TEST_URL,
    WAIT_SECONDS,
    assert_true,
    chrome_binary,
    save_screenshot,
    wait_click,
    wait_displayed,
)
from pdf_local_citation_selenium_test import read_all_indexeddb

QUERY = "Explicit Candidate Selection Fixture"


def create_desktop_driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,800")
    binary = chrome_binary()
    if binary:
        options.binary_location = binary
    return webdriver.Chrome(options=options)


def install_semantic_scholar_search_mock(driver):
    driver.execute_script(
        """
        const originalFetch = window.fetch.bind(window);
        window.__paperMapToolbarSearchUrls = [];
        window.fetch = async (url, options = {}) => {
          const parsed = new URL(String(url), window.location.href);
          if (parsed.hostname !== 'api.semanticscholar.org') return originalFetch(url, options);
          if (parsed.pathname === '/graph/v1/paper/search') {
            window.__paperMapToolbarSearchUrls.push(parsed.toString());
            return new Response(JSON.stringify({
              data: [
                {
                  paperId: '1111111111111111111111111111111111111111',
                  title: 'Explicit Candidate Selection Overview',
                  year: 2024,
                  venue: 'Broad Results',
                  publicationTypes: ['JournalArticle'],
                  authors: [{ name: 'Broad Author' }],
                  externalIds: {},
                  url: 'https://www.semanticscholar.org/paper/broad',
                  citationCount: 2,
                  fieldsOfStudy: ['Computer Science'],
                },
                {
                  paperId: '2222222222222222222222222222222222222222',
                  title: 'Explicit Candidate Selection Fixture',
                  year: 2023,
                  venue: 'Candidate Venue A',
                  publicationTypes: ['Conference'],
                  authors: [{ name: 'First Exact Author' }],
                  externalIds: {},
                  url: 'https://www.semanticscholar.org/paper/exact-a',
                  citationCount: 3,
                  fieldsOfStudy: ['Computer Science'],
                },
                {
                  paperId: '3333333333333333333333333333333333333333',
                  title: 'EXPLICIT CANDIDATE SELECTION FIXTURE',
                  year: 2025,
                  venue: 'Candidate Venue B',
                  publicationTypes: ['Conference'],
                  authors: [{ name: 'Chosen Exact Author' }],
                  externalIds: {},
                  url: 'https://www.semanticscholar.org/paper/exact-b',
                  citationCount: 4,
                  fieldsOfStudy: ['Computer Science'],
                },
              ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          throw new Error(`Unexpected Semantic Scholar request: ${parsed.toString()}`);
        };
        """
    )


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_desktop_driver()
    wait = WebDriverWait(driver, WAIT_SECONDS)
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )
        wait.until(lambda d: d.find_element(By.CSS_SELECTOR, ".toolbar-primary").get_attribute("class").find("desktop-layout-active") >= 0)
        install_semantic_scholar_search_mock(driver)

        query = wait_displayed(driver, "#add-paper-query")
        query.send_keys(QUERY)
        wait_click(driver, "#add-paper-form button[type='submit']")

        chooser = wait.until(
            lambda d: d.find_element(By.ID, "add-paper-candidates")
            if d.find_element(By.ID, "add-paper-candidates").get_attribute("hidden") is None
            else False
        )
        buttons = chooser.find_elements(By.CSS_SELECTOR, "[data-add-paper-candidate-index]")
        assert_true(len(buttons) == 3, f"Expected three explicit toolbar candidates, got {len(buttons)}")
        assert_true("First Exact Author" in buttons[0].text, "Exact title candidates should be promoted while preserving provider order")
        assert_true("Chosen Exact Author" in buttons[1].text, "Second exact candidate should remain available for explicit selection")
        assert_true("Broad Author" in buttons[2].text, "Broader provider results should remain visible after exact matches")
        assert_true(len(read_all_indexeddb(driver, "papers")) == 0, "Searching must not persist the provider's first match")

        buttons[1].click()
        wait.until(lambda d: "Selected paper added" in d.find_element(By.ID, "library-status-text").text)
        papers = read_all_indexeddb(driver, "papers")
        assert_true(len(papers) == 1, f"Expected one explicitly selected paper, got {len(papers)}")
        assert_true(
            papers[0].get("semanticScholarId") == "3333333333333333333333333333333333333333",
            "Toolbar add should persist only the candidate selected by the user",
        )

        filter_button = wait_displayed(driver, "#desktop-filter-button")
        filter_rect = driver.execute_script(
            "const r=arguments[0].getBoundingClientRect(); return {left:r.left,right:r.right,width:innerWidth};",
            filter_button,
        )
        assert_true(filter_rect["right"] > filter_rect["width"] * 0.8, "Desktop filter control should remain on the right side of the toolbar")
        filter_button.click()
        filter_panel = wait_displayed(driver, "#filter-menu .filter-panel")
        rect = driver.execute_script(
            "const r=arguments[0].getBoundingClientRect(); return {left:r.left,right:r.right,width:innerWidth};",
            filter_panel,
        )
        assert_true(rect["left"] >= -0.5, f"Filter drawer extends off the left edge: {rect}")
        assert_true(rect["right"] <= rect["width"] + 0.5, f"Filter drawer extends off the right edge: {rect}")

        searches = driver.execute_script("return window.__paperMapToolbarSearchUrls.slice();")
        assert_true(len(searches) == 1 and "limit=8" in searches[0], f"Expected one bounded provider search, got {searches}")
        save_screenshot(driver, "toolbar-candidate-filter-regression.png")
        print("Toolbar candidate selection and desktop filter placement checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "toolbar-candidate-filter-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
