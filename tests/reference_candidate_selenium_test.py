#!/usr/bin/env python3
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import (
    ARTIFACT_DIR,
    TEST_URL,
    WAIT_SECONDS,
    assert_true,
    create_driver,
    save_screenshot,
    wait_click,
    wait_displayed,
)
from pdf_local_citation_selenium_test import (
    create_valid_citation_pdf,
    read_all_indexeddb,
)
from pdf_review_selenium_test import center_element

SAVED_TITLE = "Identifier-less Reference Candidate Fixture"


def install_reference_provider_fetch_mock(driver):
    """Mock the provider boundary once, matching the production browser request flow."""
    driver.execute_script(
        """
        const originalFetch = window.fetch.bind(window);
        window.__paperMapCandidateSearchUrls = [];
        window.__paperMapProviderUrls = [];
        window.fetch = async (url, options = {}) => {
          const text = String(url);
          window.__paperMapProviderUrls.push(text);
          let parsed = null;
          try { parsed = new URL(text, window.location.href); } catch {}
          const hostname = parsed?.hostname || '';
          const pathname = parsed?.pathname || '';

          if (hostname === 'api.crossref.org' && pathname.includes('/works/10.1234%2Ftest.55')) {
            return new Response(JSON.stringify({
              message: {
                DOI: '10.1234/TEST.55',
                title: ['Canonical Crossref DOI Paper'],
                author: [{ given: 'Ada', family: 'Canonical' }],
                issued: { 'date-parts': [[2022]] },
                'container-title': ['Canonical Journal'],
                type: 'journal-article',
                URL: 'https://doi.org/10.1234/TEST.55',
                publisher: 'Fixture Press',
                'is-referenced-by-count': 12,
              },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }

          if (
            hostname === 'api.semanticscholar.org'
            && pathname.includes('/graph/v1/paper/ARXIV%3A2401.01234')
          ) {
            return new Response(JSON.stringify({
              paperId: '0123456789abcdef0123456789abcdef01234567',
              title: 'Canonical Semantic Scholar arXiv Paper',
              year: 2024,
              venue: 'arXiv',
              publicationTypes: ['JournalArticle'],
              authors: [{ name: 'Grace Canonical' }],
              externalIds: { ArXiv: '2401.01234' },
              url: 'https://www.semanticscholar.org/paper/fixture',
              citationCount: 8,
              fieldsOfStudy: ['Computer Science'],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }

          if (
            hostname === 'api.semanticscholar.org'
            && (pathname.includes('/paper/search') || parsed?.searchParams?.has('query'))
          ) {
            window.__paperMapCandidateSearchUrls.push(text);
            const payload = {
              data: [
                {
                  paperId: '1111111111111111111111111111111111111111',
                  title: 'A Plain Reference Without Persistent Identifier',
                  year: 2020,
                  venue: 'Fixture Proceedings',
                  publicationTypes: ['Conference'],
                  authors: [{ name: 'Linus Author' }],
                  externalIds: {},
                  url: 'https://www.semanticscholar.org/paper/candidate-one',
                  citationCount: 3,
                  fieldsOfStudy: ['Computer Science'],
                },
                {
                  paperId: '2222222222222222222222222222222222222222',
                  title: 'Plain Reference Without Persistent Identifier',
                  year: 2020,
                  venue: 'Alternate Fixture Proceedings',
                  publicationTypes: ['Conference'],
                  authors: [{ name: 'Linus Author' }],
                  externalIds: {},
                  url: 'https://www.semanticscholar.org/paper/candidate-two',
                  citationCount: 4,
                  fieldsOfStudy: ['Computer Science'],
                },
              ],
            };
            return {
              ok: true,
              status: 200,
              json: async () => payload,
              text: async () => JSON.stringify(payload),
            };
          }

          return originalFetch(url, options);
        };
        """
    )


def row_status(driver, index=2):
    rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")
    return rows[index].get_attribute("data-resolution-status") if len(rows) > index else ""


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
        install_reference_provider_fetch_mock(driver)

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

        wait_click(driver, "#pdf-local-extract")
        wait_displayed(driver, "#pdf-ai-review")
        wait.until(lambda d: "Local extraction complete" in d.find_element(By.ID, "pdf-ai-analysis-status").text)
        rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")
        assert_true(len(rows) == 3, f"Expected three extracted references, got {len(rows)}")
        assert_true(row_status(driver) == "no-identifier", "Text-only reference should remain outside the exact identifier batch resolver")
        assert_true("Ready to match by title/author/year" in rows[2].text, "Identifier-less reference should explain its matching evidence")

        resolve_button = wait_displayed(driver, "#pdf-reference-resolve")
        center_element(driver, resolve_button)
        resolve_button.click()
        wait.until(
            lambda d: all(
                row.get_attribute("data-resolution-status") == "matched"
                for row in d.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")[:2]
            )
        )
        assert_true(row_status(driver) == "no-identifier", "Bulk DOI/arXiv resolution should not silently search text-only references")

        rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")
        metadata_search = rows[2].find_element(By.CSS_SELECTOR, "[data-reference-search]")
        center_element(driver, metadata_search)
        metadata_search.click()
        assert_true(row_status(driver) == "resolving", "Candidate search click should enter resolving state immediately")
        try:
            terminal_status = wait.until(
                lambda d: row_status(d) if row_status(d) in {"candidates", "matched", "unresolved"} else False
            )
        except TimeoutException:
            rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")
            provider_urls = driver.execute_script("return window.__paperMapProviderUrls.slice();")
            search_urls = driver.execute_script("return window.__paperMapCandidateSearchUrls.slice();")
            raise AssertionError(
                f"Candidate resolver did not leave resolving state; status={row_status(driver)!r}; "
                f"row={rows[2].text!r}; provider_urls={provider_urls!r}; searches={search_urls!r}"
            )
        rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")
        search_urls = driver.execute_script("return window.__paperMapCandidateSearchUrls.slice();")
        assert_true(
            terminal_status == "candidates",
            f"Expected candidate review state, got {terminal_status!r}; row={rows[2].text!r}; searches={search_urls!r}",
        )
        assert_true(len(search_urls) == 1, f"Expected one Semantic Scholar candidate search, got {search_urls}")
        assert_true("2 candidates" in rows[2].text, "Ambiguous metadata matches should remain a review queue")
        assert_true(
            "A Plain Reference Without Persistent Identifier" in rows[2].text
            and "Plain Reference Without Persistent Identifier" in rows[2].text,
            "Both plausible candidates should be visible before selection",
        )
        canonical_before = driver.execute_script("return arguments[0].__paperMapReference.resolution.canonical;", rows[2])
        assert_true(canonical_before is None, "Ambiguous candidates must not select a canonical paper silently")

        candidate_buttons = rows[2].find_elements(By.CSS_SELECTOR, "[data-reference-candidate]")
        assert_true(len(candidate_buttons) == 2, "Candidate review should expose one explicit action per match")
        center_element(driver, candidate_buttons[1])
        candidate_buttons[1].click()
        wait.until(lambda d: row_status(d) == "matched")
        rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")
        assert_true("Selected explicitly from resolver candidates" in rows[2].text, "Chosen metadata candidate should record explicit review")

        title = wait_displayed(driver, "#pdf-review-title")
        center_element(driver, title)
        title.click()
        title.send_keys(Keys.CONTROL, "a")
        title.send_keys(SAVED_TITLE)
        title.send_keys(Keys.TAB)

        save_screenshot(driver, "12-reference-candidate-review.png", dialog)
        save_button = wait_displayed(driver, "#pdf-ai-save")
        center_element(driver, save_button)
        save_button.click()
        wait.until(EC.staleness_of(save_button))
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

        papers = read_all_indexeddb(driver, "papers")
        assert_true(len(papers) == 1, f"Expected one saved paper, got {len(papers)}")
        references = papers[0].get("extractedReferences", [])
        assert_true(len(references) == 3, "All accepted references should persist")
        selected = references[2]["resolution"]
        assert_true(selected["status"] == "matched", "Selected candidate should persist as a canonical match")
        assert_true(selected["selectedBy"] == "user", "Persistence should retain explicit candidate review provenance")
        assert_true(selected["selectedCandidateIndex"] == 1, "Persistence should retain the selected candidate index")
        assert_true(selected["canonical"]["semanticScholarId"] == "2222222222222222222222222222222222222222", "The explicitly chosen canonical candidate should persist")
        assert_true(references[2]["rawText"].startswith("Linus Author"), "Original raw bibliography evidence should remain alongside the canonical selection")
        print("Identifier-less candidate resolution and explicit browser review checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "reference-candidate-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during identifier-less reference candidate Selenium test: {error}")
        raise