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
    assert_no_page_horizontal_overflow,
    assert_true,
    assert_widget_text_visible,
    create_driver,
    create_pdf_fixture,
    save_screenshot,
    wait_click,
    wait_displayed,
)

PAPER_ID = "doi:10.5555/selenium.pdf.review"
ACCEPTED_TOPIC_ID = "topic:ai:accepted-topic-edited"
REJECTED_TOPIC_ID = "topic:ai:rejected-topic"

MOCK_METADATA = {
    "title": "AI Proposed Paper Title",
    "authors": ["Proposed Author One", "Proposed Author Two"],
    "year": 2024,
    "venue": "Proposed Venue",
    "publication_type": "conference-paper",
    "doi": "10.5555/proposed.pdf.review",
    "arxiv_id": "2401.01234",
    "url": "https://example.org/proposed-paper",
    "abstract": "AI proposed abstract for the deterministic Selenium review flow.",
    "keywords": ["proposal", "selenium"],
    "topics": [
        {
            "name": "Rejected Topic",
            "description": "This topic should be rejected before saving.",
            "confidence": 0.83,
        },
        {
            "name": "Accepted Topic",
            "description": "This topic should be accepted and edited before saving.",
            "confidence": 0.94,
        },
    ],
    "warnings": ["Deterministic Selenium fixture: review all fields."],
}

EDITED_FIELDS = {
    "#pdf-review-title": "Selenium Edited PDF Review Paper",
    "#pdf-review-authors": "Ada Reviewer\nGrace Editor",
    "#pdf-review-year": "2025",
    "#pdf-review-type": "journal-article",
    "#pdf-review-venue": "Selenium Journal of Reviewed Imports",
    "#pdf-review-doi": "10.5555/selenium.pdf.review",
    "#pdf-review-arxiv": "2501.54321",
    "#pdf-review-url": "https://example.org/selenium-reviewed-paper",
    "#pdf-review-abstract": "Edited abstract saved by the mobile Selenium PDF review test.",
    "#pdf-review-keywords": "selenium, reviewed, editable metadata",
}


def install_openai_fetch_mock(driver):
    driver.execute_script(
        """
        const metadata = arguments[0];
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (url, options) => {
          if (String(url).includes("api.openai.com/v1/responses")) {
            return new Response(
              JSON.stringify({ output_text: JSON.stringify(metadata) }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return originalFetch(url, options);
        };
        """,
        MOCK_METADATA,
    )


def center_element(driver, element):
    driver.execute_script(
        "arguments[0].scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});",
        element,
    )


def replace_field(driver, selector, value):
    field = wait_displayed(driver, selector)
    assert_true(field.is_enabled(), f"Review field {selector} should be editable")
    assert_true(field.get_attribute("readonly") is None, f"Review field {selector} should not be readonly")
    center_element(driver, field)
    field.click()
    field.send_keys(Keys.CONTROL, "a")
    field.send_keys(value)
    field.send_keys(Keys.TAB)
    assert_true(field.get_attribute("value") == value, f"Review field {selector} did not retain edited value")
    return field


def read_indexeddb(driver, store_name, key):
    result = driver.execute_async_script(
        """
        const storeName = arguments[0];
        const key = arguments[1];
        const done = arguments[arguments.length - 1];
        const open = indexedDB.open("paper-map-v1");
        open.onerror = () => done({ error: String(open.error || "Could not open IndexedDB") });
        open.onsuccess = () => {
          const db = open.result;
          let request;
          try {
            request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
          } catch (error) {
            done({ error: String(error) });
            return;
          }
          request.onerror = () => done({ error: String(request.error || "IndexedDB read failed") });
          request.onsuccess = () => done({ value: request.result ?? null });
        };
        """,
        store_name,
        key,
    )
    assert_true(not result.get("error"), f"IndexedDB {store_name} read failed: {result.get('error')}")
    return result.get("value")


def assert_initial_review_values(driver):
    expected = {
        "#pdf-review-title": MOCK_METADATA["title"],
        "#pdf-review-authors": "\n".join(MOCK_METADATA["authors"]),
        "#pdf-review-year": str(MOCK_METADATA["year"]),
        "#pdf-review-type": MOCK_METADATA["publication_type"],
        "#pdf-review-venue": MOCK_METADATA["venue"],
        "#pdf-review-doi": MOCK_METADATA["doi"],
        "#pdf-review-arxiv": MOCK_METADATA["arxiv_id"],
        "#pdf-review-url": MOCK_METADATA["url"],
        "#pdf-review-abstract": MOCK_METADATA["abstract"],
        "#pdf-review-keywords": ", ".join(MOCK_METADATA["keywords"]),
    }
    for selector, value in expected.items():
        field = wait_displayed(driver, selector)
        assert_true(field.is_enabled(), f"Review field {selector} should be enabled")
        assert_true(field.get_attribute("value") == value, f"Unexpected proposed value in {selector}")


def assert_saved_review(driver):
    paper = read_indexeddb(driver, "papers", PAPER_ID)
    assert_true(paper is not None, "Final save action should persist the reviewed paper")
    assert_true(paper["title"] == EDITED_FIELDS["#pdf-review-title"], "Edited title was not persisted")
    assert_true(paper["authors"] == ["Ada Reviewer", "Grace Editor"], "Edited authors were not persisted")
    assert_true(paper["year"] == 2025, "Edited year was not persisted")
    assert_true(paper["type"] == EDITED_FIELDS["#pdf-review-type"], "Edited publication type was not persisted")
    assert_true(paper["venue"] == EDITED_FIELDS["#pdf-review-venue"], "Edited venue was not persisted")
    assert_true(paper["doi"] == EDITED_FIELDS["#pdf-review-doi"], "Edited DOI was not persisted")
    assert_true(paper["arxivId"] == EDITED_FIELDS["#pdf-review-arxiv"], "Edited arXiv ID was not persisted")
    assert_true(paper["url"] == EDITED_FIELDS["#pdf-review-url"], "Edited URL was not persisted")
    assert_true(paper["abstract"] == EDITED_FIELDS["#pdf-review-abstract"], "Edited abstract was not persisted")
    assert_true(
        paper["keywords"] == ["selenium", "reviewed", "editable metadata"],
        "Edited keywords were not persisted",
    )
    assert_true(paper["topics"] == [ACCEPTED_TOPIC_ID], "Only the accepted topic should be attached to the paper")
    assert_true(paper["source"] == "ai-pdf", "Saved review should retain the AI PDF source marker")
    assert_true(paper["sourceFileName"] == "mobile-test-paper.pdf", "Saved review should retain the source PDF name")

    accepted_topic = read_indexeddb(driver, "topics", ACCEPTED_TOPIC_ID)
    rejected_topic = read_indexeddb(driver, "topics", REJECTED_TOPIC_ID)
    assert_true(accepted_topic is not None, "Accepted topic should be persisted")
    assert_true(accepted_topic["name"] == "Accepted Topic Edited", "Edited accepted topic name was not persisted")
    assert_true(
        accepted_topic["description"] == "Accepted and edited by Selenium before save.",
        "Edited accepted topic description was not persisted",
    )
    assert_true(rejected_topic is None, "Rejected topic should not be persisted")


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

        install_openai_fetch_mock(driver)
        wait_click(driver, "#library-menu > summary")
        wait_displayed(driver, "#library-menu .library-panel")

        fixture = create_pdf_fixture()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        file_input.send_keys(str(fixture))
        dialog = wait.until(
            lambda d: d.find_element(By.ID, "pdf-ai-dialog")
            if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None
            else False
        )
        assert_widget_text_visible(driver, "#pdf-ai-dialog", "PDF AI analysis widget")

        wait_click(driver, ".pdf-ai-provider-settings > summary")
        key_input = wait_displayed(driver, "#pdf-ai-key")
        key_input.send_keys("selenium-test-api-key")
        wait_click(driver, "#pdf-ai-analyze")
        review = wait_displayed(driver, "#pdf-ai-review")
        wait.until(lambda d: "AI analysis complete" in d.find_element(By.ID, "pdf-ai-analysis-status").text)
        assert_widget_text_visible(driver, "#pdf-ai-dialog", "PDF AI review widget")
        assert_true("Review before saving" in review.text, "Review heading should be visible after analysis")
        assert_true("Deterministic Selenium fixture" in review.text, "Extraction warning should be visible")
        assert_initial_review_values(driver)

        for selector, value in EDITED_FIELDS.items():
            replace_field(driver, selector, value)

        topic_rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-ai-topics .pdf-ai-topic-row")
        assert_true(len(topic_rows) == 2, "Mock analysis should propose exactly two topics")
        rejected_checkbox = topic_rows[0].find_element(By.CSS_SELECTOR, "[data-topic-use]")
        accepted_checkbox = topic_rows[1].find_element(By.CSS_SELECTOR, "[data-topic-use]")
        assert_true(rejected_checkbox.is_selected(), "Proposed topic should be accepted by default")
        assert_true(accepted_checkbox.is_selected(), "Proposed topic should be accepted by default")
        center_element(driver, rejected_checkbox)
        rejected_checkbox.click()
        assert_true(not rejected_checkbox.is_selected(), "Topic reject control should uncheck the rejected topic")
        assert_true(accepted_checkbox.is_selected(), "Accepted topic should remain selected")

        accepted_name = topic_rows[1].find_element(By.CSS_SELECTOR, "[data-topic-name]")
        center_element(driver, accepted_name)
        accepted_name.click()
        accepted_name.send_keys(Keys.CONTROL, "a")
        accepted_name.send_keys("Accepted Topic Edited")
        accepted_description = topic_rows[1].find_element(By.CSS_SELECTOR, "[data-topic-description]")
        center_element(driver, accepted_description)
        accepted_description.click()
        accepted_description.send_keys(Keys.CONTROL, "a")
        accepted_description.send_keys("Accepted and edited by Selenium before save.")
        assert_true(accepted_name.get_attribute("value") == "Accepted Topic Edited", "Accepted topic name should be editable")
        assert_true(
            accepted_description.get_attribute("value") == "Accepted and edited by Selenium before save.",
            "Accepted topic description should be editable",
        )

        save_screenshot(driver, "08-pdf-review-edited.png", dialog)
        save_button = wait_displayed(driver, "#pdf-ai-save")
        assert_true(save_button.is_enabled(), "Final save action should be enabled after review")
        center_element(driver, save_button)
        save_button.click()
        wait.until(EC.staleness_of(save_button))
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )

        assert_saved_review(driver)
        assert_true(
            driver.find_element(By.ID, "visible-paper-count").get_attribute("textContent") == "1",
            "Saved reviewed paper should be visible after reload",
        )
        wait_click(driver, "#paper-list-button")
        wait_displayed(driver, "#paper-list-panel")
        items = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".paper-list-item"))
        assert_true(len(items) == 1, "Bibliography should contain the saved reviewed paper")
        assert_true(EDITED_FIELDS["#pdf-review-title"] in items[0].text, "Edited saved title should appear in Bibliography")
        items[0].click()
        wait_displayed(driver, "#paper-detail")
        assert_true(
            driver.find_element(By.ID, "detail-title").text == EDITED_FIELDS["#pdf-review-title"],
            "Paper detail should display the edited saved title",
        )
        save_screenshot(driver, "09-pdf-review-saved.png")
        assert_no_page_horizontal_overflow(driver)
        print("PDF import review metadata, topic controls, final save, and persistence checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "pdf-review-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during PDF review Selenium test: {error}")
        raise
