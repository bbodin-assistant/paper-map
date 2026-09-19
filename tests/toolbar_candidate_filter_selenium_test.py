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
    wait_displayed,
)
from pdf_local_citation_selenium_test import read_all_indexeddb

QUERY = "Progressive Multi Provider Candidate Fixture"


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


def configure_search_sources(driver):
    config = {
        "provider": "semantic-scholar",
        "searchProviders": {
            "semantic-scholar": {"enabled": True, "limit": 2},
            "openalex": {"enabled": True, "limit": 3},
            "crossref": {"enabled": False, "limit": 4},
        },
    }
    driver.execute_script(
        "localStorage.setItem('paper-map-paper-provider-config-v1', JSON.stringify(arguments[0]));",
        config,
    )
    driver.refresh()


def install_progressive_provider_mocks(driver):
    driver.execute_script(
        """
        const originalFetch = window.fetch.bind(window);
        window.__paperMapToolbarSearchUrls = [];
        let releaseOpenAlex;
        const openAlexGate = new Promise((resolve) => { releaseOpenAlex = resolve; });
        window.__releasePaperMapOpenAlex = () => releaseOpenAlex();

        const openAlexWork = (id, title, authors, year, venue) => ({
          id: 'https://openalex.org/' + id,
          title,
          publication_year: year,
          cited_by_count: 10,
          authorships: authors.map((name) => ({ author: { display_name: name } })),
          primary_location: {
            source: { display_name: venue },
            landing_page_url: 'https://openalex.org/' + id,
          },
          best_oa_location: null,
          locations: [],
          referenced_works: [],
          keywords: [],
          topics: [],
          concepts: [],
        });

        window.fetch = async (url, options = {}) => {
          const parsed = new URL(String(url), window.location.href);
          if (!['api.semanticscholar.org', 'api.openalex.org', 'api.crossref.org'].includes(parsed.hostname)) {
            return originalFetch(url, options);
          }
          window.__paperMapToolbarSearchUrls.push(parsed.toString());

          if (parsed.hostname === 'api.semanticscholar.org' && parsed.pathname === '/graph/v1/paper/search') {
            return new Response(JSON.stringify({
              data: [
                {
                  paperId: '1111111111111111111111111111111111111111',
                  title: 'Progressive Multi Provider Candidate Fixture',
                  year: 2024,
                  venue: 'Semantic Venue A',
                  publicationTypes: ['Conference'],
                  authors: [{ name: 'Semantic First Author' }],
                  externalIds: {},
                  url: 'https://www.semanticscholar.org/paper/s2-a',
                  citationCount: 2,
                  fieldsOfStudy: ['Computer Science'],
                },
                {
                  paperId: '2222222222222222222222222222222222222222',
                  title: 'Progressive Multi Provider Candidate Overview',
                  year: 2023,
                  venue: 'Semantic Venue B',
                  publicationTypes: ['JournalArticle'],
                  authors: [{ name: 'Semantic Candidate Author' }],
                  externalIds: {},
                  url: 'https://www.semanticscholar.org/paper/s2-b',
                  citationCount: 3,
                  fieldsOfStudy: ['Computer Science'],
                },
              ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }

          if (parsed.hostname === 'api.openalex.org' && parsed.pathname === '/works' && parsed.searchParams.has('search')) {
            await openAlexGate;
            return new Response(JSON.stringify({
              results: [
                openAlexWork(
                  'W201',
                  'Progressive Multi Provider Candidate Background',
                  ['OpenAlex Background Author'],
                  2022,
                  'OpenAlex Background Venue',
                ),
                openAlexWork(
                  'W202',
                  'PROGRESSIVE MULTI PROVIDER CANDIDATE FIXTURE',
                  [
                    'First Extremely Long Author Name',
                    'Second Extremely Long Author Name',
                    'Third Extremely Long Author Name',
                    'Fourth Extremely Long Author Name',
                    'Fifth Extremely Long Author Name',
                    'Sixth Very Long Author Name',
                  ],
                  2025,
                  'OpenAlex Target Venue',
                ),
                openAlexWork(
                  'W203',
                  'Progressive Multi Provider Candidate Companion',
                  ['OpenAlex Companion Author'],
                  2021,
                  'OpenAlex Companion Venue',
                ),
              ],
              meta: { count: 3 },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }

          if (parsed.hostname === 'api.crossref.org') {
            throw new Error('Crossref should be disabled for this Add search');
          }
          throw new Error('Unexpected provider request: ' + parsed.toString());
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
        configure_search_sources(driver)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )
        wait.until(lambda d: "desktop-layout-active" in d.find_element(By.CSS_SELECTOR, ".toolbar-primary").get_attribute("class"))
        install_progressive_provider_mocks(driver)

        query = wait_displayed(driver, "#add-paper-query")
        query.send_keys(QUERY)
        query.submit()

        chooser = wait_displayed(driver, "#add-paper-candidates")
        semantic_section = wait.until(
            lambda d: d.find_element(By.CSS_SELECTOR, '[data-add-paper-provider="semantic-scholar"].complete')
        )
        openalex_section = driver.find_element(By.CSS_SELECTOR, '[data-add-paper-provider="openalex"]')
        assert_true("Searching" in openalex_section.text, "OpenAlex should still show progress while Semantic Scholar results are already usable")
        semantic_buttons = semantic_section.find_elements(By.CSS_SELECTOR, "[data-add-paper-candidate-index]")
        assert_true(len(semantic_buttons) == 2, f"Semantic Scholar limit should expose two results, got {len(semantic_buttons)}")
        assert_true("Semantic First Author" in semantic_buttons[0].text, "Semantic Scholar candidates should be visible before OpenAlex finishes")

        exact_title = semantic_buttons[0].find_element(By.CSS_SELECTOR, ".add-paper-candidate-title")
        exact_matches = exact_title.find_elements(By.CSS_SELECTOR, ".add-paper-search-match")
        assert_true(len(exact_matches) == 1, f"Exact title should highlight one contiguous query phrase, got {len(exact_matches)}")
        assert_true(exact_matches[0].text.lower() == QUERY.lower(), "Exact title highlight should preserve and bold the full matching phrase")
        exact_weight = int(driver.execute_script("return parseInt(getComputedStyle(arguments[0]).fontWeight, 10);", exact_matches[0]))
        assert_true(exact_weight >= 700, f"Matching title phrase should be visibly bold, got font weight {exact_weight}")

        broad_title = semantic_buttons[1].find_element(By.CSS_SELECTOR, ".add-paper-candidate-title")
        broad_matches = [item.text.lower() for item in broad_title.find_elements(By.CSS_SELECTOR, ".add-paper-search-match")]
        assert_true(
            broad_matches == ["progressive", "multi", "provider", "candidate"],
            f"Broader titles should bold the individual matching search terms, got {broad_matches}",
        )
        broad_authors = semantic_buttons[1].find_element(By.CSS_SELECTOR, ".add-paper-candidate-authors")
        author_matches = [item.text.lower() for item in broad_authors.find_elements(By.CSS_SELECTOR, ".add-paper-search-match")]
        assert_true(author_matches == ["candidate"], f"Matching author text should also be bold, got {author_matches}")

        assert_true(len(read_all_indexeddb(driver, "papers")) == 0, "Progressive search must not persist a candidate before explicit selection")

        driver.execute_script("window.__releasePaperMapOpenAlex();")
        openalex_section = wait.until(
            lambda d: d.find_element(By.CSS_SELECTOR, '[data-add-paper-provider="openalex"].complete')
        )
        openalex_buttons = openalex_section.find_elements(By.CSS_SELECTOR, "[data-add-paper-candidate-index]")
        assert_true(len(openalex_buttons) == 3, f"OpenAlex limit should expose three results, got {len(openalex_buttons)}")
        target = next((button for button in openalex_buttons if "Sixth Very Long Author Name" in button.text), None)
        assert_true(target is not None, "The complete long OpenAlex author list should remain visible")
        authors = target.find_element(By.CSS_SELECTOR, ".add-paper-candidate-authors")
        author_style = driver.execute_script(
            "const s=getComputedStyle(arguments[0]); return {whiteSpace:s.whiteSpace,overflow:s.overflow,height:arguments[0].getBoundingClientRect().height};",
            authors,
        )
        assert_true(author_style["whiteSpace"] == "normal", f"Author list should wrap instead of truncating: {author_style}")
        assert_true(author_style["overflow"] != "hidden", f"Author list should not be clipped: {author_style}")
        assert_true(author_style["height"] > 20, f"Long author list should occupy multiple visible lines: {author_style}")

        searches = driver.execute_script("return window.__paperMapToolbarSearchUrls.slice();")
        semantic_urls = [url for url in searches if "api.semanticscholar.org" in url]
        openalex_urls = [url for url in searches if "api.openalex.org" in url]
        crossref_urls = [url for url in searches if "api.crossref.org" in url]
        assert_true(len(semantic_urls) == 1 and "limit=2" in semantic_urls[0], f"Semantic Scholar should use its configured limit: {semantic_urls}")
        assert_true(len(openalex_urls) == 1 and "per-page=3" in openalex_urls[0], f"OpenAlex should use its configured limit: {openalex_urls}")
        assert_true(not crossref_urls, f"Disabled Crossref must not be queried: {crossref_urls}")

        target.click()
        wait.until(lambda d: "Selected paper added" in d.find_element(By.ID, "library-status-text").text)
        papers = read_all_indexeddb(driver, "papers")
        assert_true(len(papers) == 1, f"Expected one explicitly selected paper, got {len(papers)}")
        assert_true(papers[0].get("openAlexId") == "W202", "Only the explicitly selected OpenAlex proposal should persist")

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

        save_screenshot(driver, "toolbar-candidate-filter-regression.png")
        print("Progressive multi-provider toolbar candidates, search highlighting, full author visibility, and filter placement checks passed.")
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
