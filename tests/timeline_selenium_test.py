#!/usr/bin/env python3

from selenium.webdriver.common.by import By
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


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_driver()
    wait = WebDriverWait(driver, WAIT_SECONDS)
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

        # Seed a deterministic local library without depending on network providers.
        driver.execute_script("document.querySelector('#load-demo').click()")
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-node")) >= 2)

        wait_click(driver, '#map-mode button[data-mode="timeline"]')
        timeline_papers = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".timeline-paper[data-paper-id]"))
        assert_true(timeline_papers, "Timeline should render paper cards")

        paper = timeline_papers[0]
        paper_id = paper.get_attribute("data-paper-id")
        expected_title = driver.execute_script(
            """
            const id = arguments[0];
            const button = Array.from(document.querySelectorAll('#paper-list .paper-list-item[data-paper-id]'))
              .find((candidate) => candidate.dataset.paperId === id);
            return button?.querySelector('strong')?.textContent?.replace(/^★\\s*/, '').trim() || '';
            """,
            paper_id,
        )
        assert_true(expected_title, f"Could not resolve the expected title for Timeline paper {paper_id}")

        # This must be a real WebDriver click. The regression was caused by SVG
        # pointer capture retargeting the compatibility click away from the card.
        paper.click()

        detail = wait_displayed(driver, "#paper-detail")
        wait.until(
            lambda d: bool(
                d.find_elements(By.CSS_SELECTOR, f'#paper-list .paper-list-item.selected[data-paper-id="{paper_id}"]')
            )
        )
        detail_title = driver.find_element(By.ID, "detail-title").get_attribute("textContent").strip()
        assert_true(detail_title == expected_title, f"Timeline click opened the wrong paper: {detail_title!r} != {expected_title!r}")
        assert_true(detail.get_attribute("hidden") is None, "Timeline click must leave the paper detail drawer visible")

        wait.until(
            lambda d: "selected" in (
                d.find_element(By.CSS_SELECTOR, f'.timeline-paper[data-paper-id="{paper_id}"]').get_attribute("class") or ""
            )
        )
        save_screenshot(driver, "timeline-paper-detail-open.png")
        print("timeline Selenium regression passed")
    except Exception:
        save_screenshot(driver, "timeline-paper-detail-failure.png")
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
