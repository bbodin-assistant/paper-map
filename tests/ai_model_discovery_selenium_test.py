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

        wait_click(driver, "#ai-config-button")
        panel = wait_displayed(driver, "#ai-config-panel")
        provider = Select(panel.find_element(By.ID, "ai-config-provider"))
        provider.select_by_value("openai-compatible")

        base = panel.find_element(By.ID, "ai-config-base-url")
        base.send_keys(Keys.CONTROL, "a")
        base.send_keys(CUSTOM_BASE_URL)

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
        model.send_keys(Keys.CONTROL, "a")
        model.send_keys(SELECTED_MODEL)
        remember = panel.find_element(By.ID, "ai-config-remember-key")
        if not remember.is_selected():
            remember.click()
        wait_click(driver, "#ai-config-save")
        saved = driver.execute_script("return JSON.parse(localStorage.getItem('paper-map-ai-config-v1'))")
        assert_true(saved["baseUrl"] == CUSTOM_BASE_URL, "Configured base URL should be persisted")
        assert_true(saved["model"] == SELECTED_MODEL, "Selected discovered model should be persisted")

        save_screenshot(driver, "10-ai-model-discovery.png", panel)
        assert_no_page_horizontal_overflow(driver)
        print("AI model discovery endpoint, bearer authentication, suggestions, and persistence checks passed.")
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
        print(f"Timed out during AI model discovery Selenium test: {error}")
        raise
