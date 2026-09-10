#!/usr/bin/env python3
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import Select, WebDriverWait

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

CUSTOM_BASE_URL = "https://models.example.test/v1"
DISCOVERED_MODELS = ["research-small", "research-large", "research-small"]
SELECTED_MODEL = "research-large"
API_KEY = "selenium-model-key"


def install_models_fetch_mock(driver):
    driver.execute_script(
        """
        const expectedUrl = arguments[0];
        const models = arguments[1];
        const originalFetch = window.fetch.bind(window);
        window.__paperMapModelsRequests = [];
        window.fetch = async (url, options = {}) => {
          if (String(url) === expectedUrl) {
            window.__paperMapModelsRequests.push({
              url: String(url),
              method: options.method || 'GET',
              authorization: options.headers?.Authorization || options.headers?.authorization || '',
            });
            return new Response(
              JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return originalFetch(url, options);
        };
        """,
        f"{CUSTOM_BASE_URL}/models",
        DISCOVERED_MODELS,
    )


def replace_value(element, value):
    element.send_keys(Keys.CONTROL, "a")
    element.send_keys(value)


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
        install_models_fetch_mock(driver)

        config_button = wait.until(lambda d: d.find_element(By.ID, "ai-config-button"))
        assert_true(config_button.text == "Config", "The former AI toolbar button should be presented as Config")
        wait_click(driver, "#ai-config-button")
        panel = wait_displayed(driver, "#ai-config-panel")
        assert_true("Configuration" in panel.text, "General configuration heading should be visible")
        assert_true("Paper information" in panel.text, "Paper metadata provider settings should live in Config")
        assert_true("Graph visualizer" in panel.text, "Graph visualizer settings should live in Config")
        assert_true("AI" in panel.text, "AI settings should remain available inside Config")

        paper_provider = Select(panel.find_element(By.ID, "paper-provider-config-provider"))
        assert_true(
            [option.get_attribute("value") for option in paper_provider.options]
            == ["semantic-scholar", "openalex", "crossref", "auto"],
            "Paper information config should expose Semantic Scholar, OpenAlex, Crossref, and automatic merge",
        )
        paper_provider.select_by_value("auto")

        effort = panel.find_element(By.ID, "graph-config-layout-effort")
        spacing = panel.find_element(By.ID, "graph-config-layout-spacing")
        assert_true(effort.get_attribute("value") == "2", "Default graph effort should extend the old settling budget to 2x")
        replace_value(effort, "3.25")
        replace_value(spacing, "1.4")

        provider = Select(panel.find_element(By.ID, "ai-config-provider"))
        provider.select_by_value("openai-compatible")

        base = panel.find_element(By.ID, "ai-config-base-url")
        replace_value(base, CUSTOM_BASE_URL)

        key = panel.find_element(By.ID, "ai-config-key")
        key.send_keys(API_KEY)
        key.send_keys(Keys.TAB)

        wait.until(
            lambda d: "2 models available" in d.find_element(By.ID, "ai-config-model-status").get_attribute("textContent")
        )
        options = driver.find_elements(By.CSS_SELECTOR, "#ai-config-model-options option")
        values = [option.get_attribute("value") for option in options]
        assert_true(values == ["research-large", "research-small"], f"Unexpected model suggestions: {values}")

        request = driver.execute_script("return window.__paperMapModelsRequests.at(-1)")
        assert_true(request is not None, "Model discovery should call the configured /models endpoint")
        assert_true(request["url"] == f"{CUSTOM_BASE_URL}/models", "Model discovery should use the configured base URL")
        assert_true(request["method"] == "GET", "Model discovery should use GET")
        assert_true(request["authorization"] == f"Bearer {API_KEY}", "Model discovery should forward the configured bearer key")

        model = panel.find_element(By.ID, "ai-config-model")
        replace_value(model, SELECTED_MODEL)
        remember = panel.find_element(By.ID, "ai-config-remember-key")
        if not remember.is_selected():
            remember.click()
        wait_click(driver, "#ai-config-save")
        wait.until(lambda d: d.find_element(By.ID, "ai-config-panel").get_attribute("hidden") is not None)
        assert_true(config_button.get_attribute("aria-expanded") == "false", "Saving configuration should close the Config dialog")

        saved_ai = driver.execute_script("return JSON.parse(localStorage.getItem('paper-map-ai-config-v1'))")
        assert_true(saved_ai["baseUrl"] == CUSTOM_BASE_URL, "Configured base URL should be persisted")
        assert_true(saved_ai["model"] == SELECTED_MODEL, "Selected discovered model should be persisted")
        saved_paper = driver.execute_script("return JSON.parse(localStorage.getItem('paper-map-paper-provider-config-v1'))")
        assert_true(saved_paper["provider"] == "auto", "Selected scholarly methodology should be persisted")
        saved_graph = driver.execute_script("return JSON.parse(localStorage.getItem('paper-map-graph-config-v1'))")
        assert_true(saved_graph["layoutEffort"] == 3.25, "Graph layout effort should be persisted")
        assert_true(saved_graph["layoutSpacing"] == 1.4, "Graph layout spacing should be persisted")

        save_screenshot(driver, "10-ai-model-discovery.png")
        assert_no_page_horizontal_overflow(driver)
        print("General config, scholarly method selection, graph settings, AI model discovery, persistence, and close-after-save checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "ai-model-discovery-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during general configuration Selenium test: {error}")
        raise
