#!/usr/bin/env python3
from pathlib import Path

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

from mobile_selenium_test import ARTIFACT_DIR, TEST_URL, WAIT_SECONDS, assert_true, create_driver, save_screenshot, wait_click, wait_displayed


def create_bib_fixture():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = (ARTIFACT_DIR / "source-filter-fixture.bib").resolve()
    path.write_text(
        "@article{sourcefilter,\n"
        "  title={Source Filter Imported Paper},\n"
        "  author={Import, Alice},\n"
        "  year={2026},\n"
        "  journal={Fixture Journal}\n"
        "}\n",
        encoding="utf-8",
    )
    return path


def source_option_values(driver):
    return driver.execute_script(
        "return Array.from(document.querySelectorAll('#filter-source option'), option => option.value);"
    )


def main():
    driver = create_driver()
    wait = WebDriverWait(driver, WAIT_SECONDS)
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

        wait_click(driver, "#library-menu > summary")
        wait_displayed(driver, "#library-menu .library-panel")
        wait_click(driver, "#load-demo")
        wait.until(lambda d: "demo" in source_option_values(d))

        wait_click(driver, "#library-menu > summary")
        fixture = create_bib_fixture()
        import_input = wait.until(EC.presence_of_element_located((By.ID, "import-file")))
        import_input.send_keys(str(fixture))
        wait.until(lambda d: "bibtex-import" in source_option_values(d))

        wait_click(driver, "#filter-menu > summary")
        source = Select(wait_displayed(driver, "#filter-source"))
        values = {option.get_attribute("value"): option.text for option in source.options}
        assert_true(values.get("demo") == "Bundled demo dataset", "Source filter should expose demo provenance")
        assert_true(values.get("bibtex-import") == "BibTeX import", "Source filter should expose BibTeX provenance")

        source.select_by_value("bibtex-import")
        wait.until(lambda d: d.find_element(By.ID, "visible-paper-count").get_attribute("textContent") == "1")
        assert_true("Source Filter Imported Paper" in driver.page_source, "BibTeX source filter should keep the imported paper visible")

        year_min = driver.find_element(By.ID, "filter-year-min")
        year_min.clear()
        year_min.send_keys("3000")
        wait.until(lambda d: d.find_element(By.ID, "visible-paper-count").get_attribute("textContent") == "0")
        driver.find_element(By.ID, "filter-menu").find_element(By.CSS_SELECTOR, ":scope > summary").click()
        wait_click(driver, "#library-menu > summary")
        wait_displayed(driver, "#library-menu .library-panel")
        wait_click(driver, "#export-bibtex")
        wait.until(lambda d: "There are no visible papers to export" in d.find_element(By.ID, "activity-log-summary").get_attribute("textContent"))

        wait_click(driver, "#activity-log-toggle")
        panel = wait_displayed(driver, "#activity-log-panel")
        assert_true("There are no visible papers to export" in panel.text, "Activity log should surface caught application errors")
        save_screenshot(driver, "source-filter-activity-log.png")
        print("Entry-source filtering and bottom-left activity log checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "source-filter-log-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during source-filter/activity-log Selenium test: {error}")
        raise
