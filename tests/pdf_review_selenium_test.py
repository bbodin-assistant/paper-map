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
    assert_no_page_horizontal_overflow,
    assert_true,
    assert_widget_text_visible,
    create_driver,
    save_screenshot,
    wait_click,
    wait_displayed,
)

PAPER_ID = "doi:10.5555/selenium.pdf.review"
ACCEPTED_TOPIC_ID = "topic:ai:accepted-topic-edited"
REJECTED_TOPIC_ID = "topic:ai:rejected-topic"
CUSTOM_BASE_URL = "https://llm.example.test/v1"
CUSTOM_MODEL = "selenium-compatible-model"

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


def pdf_escape(value):
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def create_ai_text_pdf_fixture():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = (ARTIFACT_DIR / "mobile-test-paper.pdf").resolve()
    lines = [
        "Deterministic AI Proxy Fixture",
        "This research paper fixture contains embedded PDF text.",
        "Paper Map must extract this text locally before calling a compatible AI server.",
        "The external AI response itself is mocked by Selenium.",
    ]
    commands = ["BT", "/F1 11 Tf", "72 730 Td"]
    for index, line in enumerate(lines):
        if index:
            commands.append("0 -18 Td")
        commands.append(f"({pdf_escape(line)}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]

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


def install_compatible_fetch_mock(driver):
    driver.execute_script(
        """
        const metadata = arguments[0];
        const expectedUrl = arguments[1];
        const originalFetch = window.fetch.bind(window);
        window.__paperMapCompatibleRequest = null;
        window.fetch = async (url, options = {}) => {
          if (String(url) === expectedUrl) {
            const payload = JSON.parse(options.body || '{}');
            window.__paperMapCompatibleRequest = {
              url: String(url),
              authorization: options.headers?.Authorization || options.headers?.authorization || '',
              payload,
            };
            return new Response(
              JSON.stringify({
                choices: [{ message: { role: 'assistant', content: JSON.stringify(metadata) } }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return originalFetch(url, options);
        };
        """,
        MOCK_METADATA,
        f"{CUSTOM_BASE_URL}/chat/completions",
    )


def configure_compatible_ai(driver):
    wait_click(driver, "#ai-config-button")
    panel = wait_displayed(driver, "#ai-config-panel")
    assert_true(driver.find_element(By.ID, "ai-config-button").text == "Config", "Toolbar should expose general Config")
    provider = Select(panel.find_element(By.ID, "ai-config-provider"))
    assert_true(
        [option.get_attribute("value") for option in provider.options]
        == ["openai", "ollama", "openai-compatible"],
        "AI configuration should expose OpenAI, Ollama, and OpenAI-compatible providers",
    )
    provider.select_by_value("ollama")
    assert_true(
        panel.find_element(By.ID, "ai-config-base-url").get_attribute("value") == "http://localhost:11434/v1",
        "Ollama preset should select the local OpenAI-compatible endpoint",
    )
    provider.select_by_value("openai-compatible")

    base = panel.find_element(By.ID, "ai-config-base-url")
    base.send_keys(Keys.CONTROL, "a")
    base.send_keys(CUSTOM_BASE_URL)
    model = panel.find_element(By.ID, "ai-config-model")
    model.send_keys(Keys.CONTROL, "a")
    model.send_keys(CUSTOM_MODEL)
    key = panel.find_element(By.ID, "ai-config-key")
    key.send_keys("selenium-compatible-key")
    remember = panel.find_element(By.ID, "ai-config-remember-key")
    if not remember.is_selected():
        remember.click()
    wait_click(driver, "#ai-config-save")
    WebDriverWait(driver, WAIT_SECONDS).until(
        lambda d: "OpenAI-compatible" in d.find_element(By.ID, "ai-config-button").get_attribute("aria-label")
    )
    WebDriverWait(driver, WAIT_SECONDS).until(
        lambda d: d.find_element(By.ID, "ai-config-panel").get_attribute("hidden") is not None
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
    assert_true(paper["keywords"] == ["selenium", "reviewed", "editable metadata"], "Edited keywords were not persisted")
    assert_true(paper["topics"] == [ACCEPTED_TOPIC_ID], "Only the accepted topic should be attached to the paper")
    assert_true(paper["source"] == "reviewed-pdf", "Saved review should use the unified reviewed-PDF source marker")
    assert_true(paper["sourceFileName"] == "mobile-test-paper.pdf", "Saved review should retain the source PDF name")
    assert_true("local-pdf" in paper["metadataSources"], "Automatic local extraction should be recorded")
    assert_true("ai:openai-compatible" in paper["metadataSources"], "AI extraction should be recorded as a metadata source")
    assert_true(paper["pdfExtraction"]["provider"] == "rust-wasm", "Local PDF provenance should be retained")
    assert_true(paper["aiExtraction"]["provider"] == "openai-compatible", "AI provenance should record the selected provider")
    assert_true(paper["aiExtraction"]["model"] == CUSTOM_MODEL, "AI provenance should record the selected model")
    assert_true(paper["aiExtraction"]["baseUrl"] == CUSTOM_BASE_URL, "AI provenance should record the selected server")
    assert_true(paper["aiExtraction"]["transport"]["mode"] == "chat-text", "Custom provider should use local-text chat transport")
    forbidden = {"pdfBytes", "fileBytes", "pdfData", "dataUrl", "file"}
    assert_true(not forbidden.intersection(paper.keys()), "Saved paper must not contain uploaded PDF bytes")

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
            lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )
        assert_no_page_horizontal_overflow(driver)

        add_button = driver.find_element(By.ID, "add-pdf-button")
        assert_true(add_button.text == "Add files", "The unified file-import toolbar button should be labeled Add files")
        assert_true(".pdf" in (driver.find_element(By.ID, "pdf-ai-file").get_attribute("accept") or ""), "Unified Add picker should still accept PDF files")
        configure_compatible_ai(driver)
        install_compatible_fetch_mock(driver)

        fixture = create_ai_text_pdf_fixture()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        file_input.send_keys(str(fixture))
        dialog = wait.until(
            lambda d: d.find_element(By.ID, "pdf-ai-dialog")
            if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None
            else False
        )
        assert_widget_text_visible(driver, "#pdf-ai-dialog", "Reviewed PDF import widget")
        assert_true(not driver.find_elements(By.CSS_SELECTOR, ".pdf-ai-provider-settings"), "AI settings must not be embedded in reviewed import")
        open_pdf = wait.until(EC.element_to_be_clickable((By.ID, "pdf-ai-open-file")))
        driver.execute_script("window.__paperMapOpenedPdf = ''; window.open = (url) => { window.__paperMapOpenedPdf = String(url); return null; };")
        open_pdf.click()
        wait.until(lambda d: (d.execute_script("return window.__paperMapOpenedPdf || ''") or '').startswith('blob:'))
        assert_true(len(driver.find_elements(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]")) == 1, "Single PDF should create one review tab")
        wait.until(
            lambda d: d.find_element(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]").get_attribute("data-local-status")
            in ("complete", "error")
        )
        assert_true(
            driver.find_element(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]").get_attribute("data-local-status") == "complete",
            "Selected PDF should run local extraction automatically",
        )
        assert_true(
            driver.find_element(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]").get_attribute("data-review-status") == "success",
            "A successfully processed PDF tab should be marked success for green styling",
        )

        wait_click(driver, "#pdf-ai-analyze")
        review = wait_displayed(driver, "#pdf-ai-review")
        wait.until(lambda d: "AI extraction merged" in d.find_element(By.ID, "pdf-ai-analysis-status").text)

        request = driver.execute_script("return window.__paperMapCompatibleRequest")
        assert_true(request is not None, "Custom OpenAI-compatible endpoint should receive the AI request")
        assert_true(request["url"] == f"{CUSTOM_BASE_URL}/chat/completions", "Proxy should use the configured base URL")
        assert_true(request["authorization"] == "Bearer selenium-compatible-key", "Proxy should forward an optional bearer key")
        assert_true(request["payload"]["model"] == CUSTOM_MODEL, "Proxy should use the configured model")
        assert_true(request["payload"]["response_format"]["type"] == "json_schema", "Proxy should request structured output")
        user_prompt = request["payload"]["messages"][1]["content"]
        assert_true("BEGIN PDF TEXT" in user_prompt, "Compatible providers should receive locally extracted PDF text")
        assert_true("Deterministic AI Proxy Fixture" in user_prompt, "Proxy prompt should include text extracted from the real PDF fixture")

        assert_true("Review before saving" in review.text, "Review heading should remain visible")
        assert_true("Deterministic Selenium fixture" in review.text, "Extraction warning should be visible")
        assert_initial_review_values(driver)

        for selector, value in EDITED_FIELDS.items():
            replace_field(driver, selector, value)

        topic_rows = driver.find_elements(By.CSS_SELECTOR, "#pdf-ai-topics .pdf-ai-topic-row")
        assert_true(len(topic_rows) == 2, "Mock analysis should propose exactly two topics")
        rejected_checkbox = topic_rows[0].find_element(By.CSS_SELECTOR, "[data-topic-use]")
        accepted_checkbox = topic_rows[1].find_element(By.CSS_SELECTOR, "[data-topic-use]")
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

        save_screenshot(driver, "08-pdf-review-edited.png", dialog)
        save_button = wait.until(EC.element_to_be_clickable((By.ID, "pdf-ai-save")))
        center_element(driver, save_button)
        save_button.click()
        wait.until(EC.staleness_of(save_button))
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )

        assert_saved_review(driver)
        assert_true(driver.find_element(By.ID, "visible-paper-count").get_attribute("textContent") == "1", "Saved reviewed paper should be visible after reload")
        wait_click(driver, "#paper-list-button")
        wait_displayed(driver, "#paper-list-panel")
        items = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".paper-list-item"))
        assert_true(len(items) == 1, "Bibliography should contain the saved reviewed paper")
        assert_true(EDITED_FIELDS["#pdf-review-title"] in items[0].text, "Edited saved title should appear in Bibliography")
        items[0].click()
        wait_displayed(driver, "#paper-detail")
        assert_true(driver.find_element(By.ID, "detail-title").text == EDITED_FIELDS["#pdf-review-title"], "Paper detail should display the edited saved title")
        save_screenshot(driver, "09-pdf-review-saved.png")
        assert_no_page_horizontal_overflow(driver)
        print("Global Config, automatic local extraction, per-tab AI merge, editable review, and persistence checks passed.")
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
