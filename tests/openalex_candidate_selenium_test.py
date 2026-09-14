#!/usr/bin/env python3
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

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
from pdf_review_selenium_test import center_element, create_ai_text_pdf_fixture
from pdf_local_citation_selenium_test import read_all_indexeddb

QUERY_TITLE = "FLOWER: A FRIENDLY FEDERATED LEARNING FRAMEWORK"
CORRECT_AUTHORS = [
    "Daniel J. Beutel",
    "Taner Topal",
    "Akhil Mathur",
    "Xinchi Qiu",
]


def configure_openalex(driver):
    wait_click(driver, "#ai-config-button")
    panel = wait_displayed(driver, "#ai-config-panel")
    Select(panel.find_element(By.ID, "paper-provider-config-provider")).select_by_value("openalex")
    wait_click(driver, "#ai-config-save")
    WebDriverWait(driver, WAIT_SECONDS).until(
        lambda d: d.find_element(By.ID, "ai-config-panel").get_attribute("hidden") is not None
    )


def install_openalex_mock(driver):
    driver.execute_script(
        """
        const originalFetch = window.fetch.bind(window);
        window.__paperMapOpenAlexSearches = [];
        window.__paperMapOpenAlexWorkFetches = [];
        const work = (id, title, authors, year, venue, arxiv = '') => ({
          id: `https://openalex.org/${id}`,
          title,
          publication_year: year,
          cited_by_count: 10,
          authorships: authors.map((name) => ({ author: { display_name: name } })),
          primary_location: {
            source: { display_name: venue },
            landing_page_url: `https://openalex.org/${id}`,
          },
          best_oa_location: null,
          locations: arxiv ? [{ landing_page_url: `https://arxiv.org/abs/${arxiv}` }] : [],
          referenced_works: [],
          keywords: [],
          topics: [],
          concepts: [],
        });
        const candidates = [
          work(
            'W101',
            'Flower Federated Learning at Scale',
            ['Wrong Broad Author'],
            2022,
            'Broad Result Venue',
          ),
          work(
            'W202',
            'Flower: A Friendly Federated Learning Framework',
            ['Incorrect Version Author'],
            2020,
            'Alternate Flower Record',
            '2007.14390v1',
          ),
          work(
            'W303',
            'FLOWER: A FRIENDLY FEDERATED LEARNING FRAMEWORK',
            ['Daniel J. Beutel', 'Taner Topal', 'Akhil Mathur', 'Xinchi Qiu'],
            2021,
            'Proceedings of Machine Learning Systems',
            '2007.14390v5',
          ),
        ];
        window.fetch = async (url, options = {}) => {
          const parsed = new URL(String(url), window.location.href);
          if (parsed.hostname !== 'api.openalex.org') return originalFetch(url, options);
          if (parsed.pathname === '/works' && parsed.searchParams.has('search')) {
            window.__paperMapOpenAlexSearches.push(parsed.toString());
            return new Response(JSON.stringify({ results: candidates, meta: { count: candidates.length } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          const match = parsed.pathname.match(/^\/works\/(W\d+)$/);
          if (match) {
            window.__paperMapOpenAlexWorkFetches.push(match[1]);
            const selected = candidates.find((candidate) => candidate.id.endsWith(`/${match[1]}`));
            return new Response(JSON.stringify(selected || candidates[0]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw new Error(`Unexpected OpenAlex request: ${parsed.toString()}`);
        };
        """
    )


def replace_title(driver, value):
    field = wait_displayed(driver, "#pdf-review-title")
    center_element(driver, field)
    field.click()
    field.send_keys(Keys.CONTROL, "a")
    field.send_keys(value)
    field.send_keys(Keys.TAB)
    assert_true(field.get_attribute("value") == value, "Title edit should be retained before online lookup")


def assert_field_search_buttons(driver):
    for field_id, button_id in [
        ("pdf-review-title", "pdf-online-search-title"),
        ("pdf-review-doi", "pdf-online-search-doi"),
        ("pdf-review-arxiv", "pdf-online-search-arxiv"),
    ]:
        field = driver.find_element(By.ID, field_id)
        wrapper = field.find_element(By.XPATH, "..")
        assert_true(
            wrapper.find_element(By.ID, button_id).text == "Search online",
            f"{field_id} should have its own adjacent Search online action",
        )


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
        configure_openalex(driver)
        install_openalex_mock(driver)

        fixture = create_ai_text_pdf_fixture()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        file_input.send_keys(str(fixture))
        dialog = wait.until(
            lambda d: d.find_element(By.ID, "pdf-ai-dialog")
            if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None
            else False
        )
        wait.until(
            lambda d: d.find_element(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]").get_attribute("data-local-status")
            in ("complete", "error")
        )
        tab = driver.find_element(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]")
        assert_true(tab.get_attribute("data-local-status") == "complete", "Fixture should complete local extraction before online candidate review")
        assert_true(
            tab.get_attribute("data-review-status") in ("searchable", "error"),
            "A locally extracted tab should immediately expose metadata readiness instead of defaulting green",
        )
        assert_field_search_buttons(driver)
        replace_title(driver, QUERY_TITLE)
        assert_true(not driver.find_element(By.ID, "pdf-review-doi").get_attribute("value"), "Fixture should not provide a DOI")
        assert_true(not driver.find_element(By.ID, "pdf-review-arxiv").get_attribute("value"), "Fixture should not provide an arXiv ID")

        wait_click(driver, "#pdf-online-search-title")
        candidate_section = wait.until(
            lambda d: d.find_element(By.ID, "pdf-online-candidates")
            if d.find_element(By.ID, "pdf-online-candidates").get_attribute("hidden") is None
            else False
        )
        buttons = candidate_section.find_elements(By.CSS_SELECTOR, "[data-online-candidate-index]")
        assert_true(len(buttons) == 3, f"Expected three ranked OpenAlex candidates, got {len(buttons)}")
        assert_true("Incorrect Version Author" in buttons[0].text, "First exact-title OpenAlex result should retain provider order")
        assert_true("Daniel J. Beutel" in buttons[1].text, "Second exact-title candidate should expose its authors")
        assert_true("2021" in buttons[1].text, "Candidate should expose publication year")
        assert_true("Proceedings of Machine Learning Systems" in buttons[1].text, "Candidate should expose venue")
        assert_true("Flower Federated Learning at Scale" in buttons[2].text, "Non-exact provider result should remain available after exact-title candidates")
        assert_true("choose match" in driver.find_element(By.ID, "pdf-source-status").text, "OpenAlex source status should require an explicit choice")
        assert_true(
            "Incorrect Version Author" not in driver.find_element(By.ID, "pdf-review-authors").get_attribute("value"),
            "Candidate search must not auto-merge the first result",
        )
        searches = driver.execute_script("return window.__paperMapOpenAlexSearches.slice();")
        assert_true(len(searches) == 1 and "per-page=20" in searches[0], f"Expected one bounded ranked OpenAlex search, got {searches}")

        center_element(driver, buttons[1])
        buttons[1].click()
        wait.until(lambda d: "Online (OpenAlex): ready" in d.find_element(By.ID, "pdf-source-status").text)
        assert_true(
            driver.find_element(By.ID, "pdf-review-authors").get_attribute("value") == "\n".join(CORRECT_AUTHORS),
            "Only the explicitly selected candidate authors should be merged",
        )
        assert_true(driver.find_element(By.ID, "pdf-review-year").get_attribute("value") == "2021", "Selected candidate year should merge")
        assert_true(
            driver.find_element(By.ID, "pdf-review-venue").get_attribute("value") == "Proceedings of Machine Learning Systems",
            "Selected candidate venue should merge",
        )
        assert_true(driver.find_element(By.ID, "pdf-review-title").get_attribute("value") == QUERY_TITLE, "A manually edited title should remain untouched after candidate selection")
        assert_true(
            driver.find_element(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]").get_attribute("data-review-status") == "resolved",
            "Explicit online selection should turn the tab green/resolved",
        )
        work_fetches = driver.execute_script("return window.__paperMapOpenAlexWorkFetches.slice();")
        assert_true(work_fetches == ["W303"], f"Reference expansion should canonicalize only the selected OpenAlex work, got {work_fetches}")

        save_screenshot(driver, "13-openalex-candidate-selection.png", dialog)
        save_button = wait.until(EC.element_to_be_clickable((By.ID, "pdf-ai-save")))
        center_element(driver, save_button)
        save_button.click()
        wait.until(EC.staleness_of(save_button))
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

        papers = read_all_indexeddb(driver, "papers")
        assert_true(len(papers) == 1, f"Expected one saved paper, got {len(papers)}")
        paper = papers[0]
        assert_true(paper["openAlexId"] == "W303", "Selected OpenAlex work ID should persist")
        assert_true(paper["authors"] == CORRECT_AUTHORS, "Selected candidate authors should persist")
        assert_true(paper["onlineExtraction"]["selectedBy"] == "user", "Online provenance should record explicit selection")
        assert_true(paper["onlineExtraction"]["selectedCandidateRank"] == 2, "Online provenance should retain selected candidate rank")
        assert_true(paper["onlineExtraction"]["query"] == QUERY_TITLE, "Online provenance should retain the original title query")
        print("OpenAlex field-specific title search, candidate review, and explicit selection checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "openalex-candidate-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during OpenAlex candidate Selenium test: {error}")
        raise
