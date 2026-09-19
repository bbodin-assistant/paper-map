#!/usr/bin/env python3
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
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
from pdf_local_citation_selenium_test import read_all_indexeddb

QUERY = "Reviewed Import Candidate Fixture"
DOI = "10.5555/reviewed.import.fixture"


def configure_candidate_sources(driver):
    config = {
        "provider": "crossref",
        "searchProviders": {
            "semantic-scholar": {"enabled": True, "limit": 1},
            "openalex": {"enabled": False, "limit": 4},
            "crossref": {"enabled": True, "limit": 2},
        },
    }
    driver.execute_script(
        "localStorage.setItem('paper-map-paper-provider-config-v1', JSON.stringify(arguments[0]));",
        config,
    )
    driver.refresh()


def install_provider_mocks(driver):
    driver.execute_script(
        """
        const originalFetch = window.fetch.bind(window);
        window.__paperMapReviewedSearchUrls = [];
        window.__paperMapCrossrefSearchCount = 0;
        let releaseFirstCrossref;
        const firstCrossrefGate = new Promise((resolve) => { releaseFirstCrossref = resolve; });
        window.__releaseReviewedCrossref = () => releaseFirstCrossref();

        const semanticPaper = {
          paperId: '9999999999999999999999999999999999999999',
          title: 'Reviewed Import Candidate Fixture',
          year: 2021,
          venue: 'Wrong Semantic Venue',
          publicationTypes: ['JournalArticle'],
          authors: [{ name: 'Wrong Semantic Author' }],
          externalIds: {},
          url: 'https://www.semanticscholar.org/paper/wrong',
          citationCount: 1,
          fieldsOfStudy: ['Computer Science'],
        };

        const crossrefWork = (author, year, venue) => ({
          DOI: '10.5555/reviewed.import.fixture',
          title: ['Reviewed Import Candidate Fixture'],
          author: [{ given: author.split(' ')[0], family: author.split(' ').slice(1).join(' ') }],
          issued: { 'date-parts': [[year]] },
          'container-title': [venue],
          type: 'journal-article',
          URL: 'https://doi.org/10.5555/reviewed.import.fixture',
          publisher: 'Candidate Publisher',
          subject: ['Candidate Review'],
          'is-referenced-by-count': 4,
          reference: [],
        });

        window.fetch = async (url, options = {}) => {
          const parsed = new URL(String(url), window.location.href);
          if (!['api.semanticscholar.org', 'api.crossref.org'].includes(parsed.hostname)) {
            return originalFetch(url, options);
          }
          window.__paperMapReviewedSearchUrls.push(parsed.toString());

          if (parsed.hostname === 'api.semanticscholar.org' && parsed.pathname === '/graph/v1/paper/search') {
            return new Response(JSON.stringify({ data: [semanticPaper] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (parsed.hostname === 'api.crossref.org' && parsed.pathname === '/works' && parsed.searchParams.has('query.bibliographic')) {
            window.__paperMapCrossrefSearchCount += 1;
            const count = window.__paperMapCrossrefSearchCount;
            if (count === 1) await firstCrossrefGate;
            const work = count === 1
              ? crossrefWork('Chosen Import Author', 2024, 'Imported Candidate Venue')
              : crossrefWork('Chosen Update Author', 2025, 'Updated Candidate Venue');
            return new Response(JSON.stringify({ message: { items: [work] } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          throw new Error('Unexpected reviewed candidate request: ' + parsed.toString());
        };
        """
    )


def create_bibtex_fixture():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = (ARTIFACT_DIR / "reviewed-candidate-import.bib").resolve()
    path.write_text(
        """@article{reviewedfixture,
  title = {Reviewed Import Candidate Fixture},
  author = {Original BibTeX Author},
  year = {2020},
  journal = {Original BibTeX Venue}
}
""",
        encoding="utf-8",
    )
    return path


def paper_snapshot(driver):
    papers = read_all_indexeddb(driver, "papers")
    assert_true(len(papers) <= 1, f"Expected at most one paper in fixture library, got {len(papers)}")
    return papers[0] if papers else None


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
        configure_candidate_sources(driver)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )
        install_provider_mocks(driver)

        bib_path = create_bibtex_fixture()
        file_input = driver.find_element(By.ID, "import-file")
        file_input.send_keys(str(bib_path))
        dialog = wait.until(
            lambda d: d.find_element(By.ID, "bibtex-import-review-dialog")
            if d.find_element(By.ID, "bibtex-import-review-dialog").get_attribute("open") is not None
            else False
        )

        semantic_section = wait.until(
            lambda d: d.find_element(
                By.CSS_SELECTOR,
                '#bibtex-import-candidates [data-paper-candidate-provider="semantic-scholar"].complete',
            )
        )
        crossref_section = driver.find_element(
            By.CSS_SELECTOR,
            '#bibtex-import-candidates [data-paper-candidate-provider="crossref"]',
        )
        assert_true(
            "Wrong Semantic Author" in semantic_section.text,
            "BibTeX review should expose Semantic Scholar proposals before Crossref finishes",
        )
        assert_true(
            "Searching" in crossref_section.text,
            "BibTeX review should keep showing Crossref progress while another provider is usable",
        )
        assert_true(
            paper_snapshot(driver) is None,
            "BibTeX candidate search must not persist or merge the first online proposal",
        )

        driver.execute_script("window.__releaseReviewedCrossref();")
        crossref_button = wait.until(
            lambda d: d.find_element(
                By.CSS_SELECTOR,
                '#bibtex-import-candidates button[data-paper-candidate-provider="crossref"]',
            )
        )
        assert_true("Chosen Import Author" in crossref_button.text, "Crossref import candidate should expose authors")
        assert_true("2024" in crossref_button.text, "Crossref import candidate should expose year")
        assert_true("Imported Candidate Venue" in crossref_button.text, "Crossref import candidate should expose venue")

        urls = driver.execute_script("return window.__paperMapReviewedSearchUrls.slice();")
        semantic_urls = [url for url in urls if "api.semanticscholar.org" in url]
        crossref_urls = [url for url in urls if "api.crossref.org" in url]
        assert_true(
            len(semantic_urls) == 1 and "limit=1" in semantic_urls[0],
            f"BibTeX title review should use the Semantic Scholar configured limit: {semantic_urls}",
        )
        assert_true(
            len(crossref_urls) == 1 and "rows=2" in crossref_urls[0],
            f"BibTeX title review should use the Crossref configured limit: {crossref_urls}",
        )

        crossref_button.click()
        wait.until(lambda d: d.find_element(By.ID, "bibtex-import-review-dialog").get_attribute("open") is None)
        imported = wait.until(lambda d: paper_snapshot(d))
        assert_true(imported["authors"] == ["Chosen Import Author"], "Only the selected BibTeX candidate should be merged")
        assert_true(imported["year"] == 2024, "Selected BibTeX candidate year should be merged")
        assert_true(imported["venue"] == "Imported Candidate Venue", "Selected BibTeX candidate venue should be merged")
        assert_true(imported["source"] == "bibtex", "Reviewed BibTeX imports should preserve BibTeX entry provenance")
        assert_true("crossref" in imported.get("metadataSources", []), "Selected provider should be recorded in metadata sources")

        wait_click(driver, "#paper-list-button")
        paper_list = wait_displayed(driver, "#paper-list-panel")
        paper_list.find_element(By.CSS_SELECTOR, ".paper-list-item").click()
        wait_displayed(driver, "#paper-detail")
        update_title = wait_displayed(driver, "#paper-online-update-title")
        assert_true(update_title.get_attribute("value") == QUERY, "Update online should start from the stored title")

        wait_click(driver, "#paper-online-update-run")
        update_candidates = wait_displayed(driver, "#paper-online-update-candidates")
        wait.until(
            lambda d: len(
                d.find_elements(
                    By.CSS_SELECTOR,
                    '#paper-online-update-candidates button[data-paper-candidate-provider="crossref"]',
                )
            ) == 1
        )
        before_update = paper_snapshot(driver)
        assert_true(
            before_update["authors"] == ["Chosen Import Author"],
            "Update online search must not merge any candidate before explicit selection",
        )
        assert_true(
            "Wrong Semantic Author" in update_candidates.text
            and "Chosen Update Author" in update_candidates.text,
            "Update online should show alternative title matches from multiple enabled providers",
        )

        update_crossref = driver.find_element(
            By.CSS_SELECTOR,
            '#paper-online-update-candidates button[data-paper-candidate-provider="crossref"]',
        )
        update_crossref.click()
        wait.until(lambda d: paper_snapshot(d)["authors"] == ["Chosen Update Author"])
        updated = paper_snapshot(driver)
        assert_true(updated["year"] == 2025, "Selected Update online candidate year should be merged")
        assert_true(updated["venue"] == "Updated Candidate Venue", "Selected Update online venue should be merged")
        assert_true(updated["onlineExtraction"]["selectedBy"] == "user", "Update provenance should record explicit selection")
        assert_true(updated["onlineExtraction"]["selectedCandidateRank"] == 1, "Update provenance should retain provider candidate rank")
        assert_true(updated["onlineExtraction"]["provider"] == "crossref", "Update provenance should retain selected provider")

        save_screenshot(driver, "reviewed-title-candidate-flows.png")
        print("BibTeX and Update online title candidate review checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "reviewed-title-candidate-flows-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during reviewed title candidate Selenium test: {error}")
        raise
