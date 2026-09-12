#!/usr/bin/env python3

import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import (
    ARTIFACT_DIR,
    TEST_URL,
    WAIT_SECONDS,
    assert_true,
    chrome_binary,
    create_driver,
    save_screenshot,
    wait_click,
    wait_displayed,
)


def create_desktop_driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1440,960")
    binary = chrome_binary()
    if binary:
        options.binary_location = binary
    return webdriver.Chrome(options=options)


def exercise_timeline_click(driver, label):
    wait = WebDriverWait(driver, WAIT_SECONDS)
    driver.get(TEST_URL)
    wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
    wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

    # Seed a deterministic local library without depending on network providers.
    driver.execute_script("document.querySelector('#load-demo').click()")
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-node")) >= 2)

    wait_click(driver, '#map-mode button[data-mode="timeline"]')
    timeline_papers = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".timeline-paper[data-paper-id]"))
    assert_true(timeline_papers, f"Timeline should render paper cards in {label}")

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
    assert_true(expected_title, f"Could not resolve the expected title for Timeline paper {paper_id} in {label}")

    # Count every proxy click sent to the hidden bibliography, even if renderAll
    # replaces the button node between two accidental selection attempts.
    driver.execute_script(
        """
        const id = arguments[0];
        window.__timelineSelectionClicks = 0;
        document.addEventListener('click', (event) => {
          const button = event.target?.closest?.('#paper-list .paper-list-item[data-paper-id]');
          if (button?.dataset.paperId === id) window.__timelineSelectionClicks += 1;
        }, true);
        """,
        paper_id,
    )

    # Keep this as a real WebDriver click. The regression was caused by SVG
    # pointer capture retargeting the compatibility click away from the card.
    paper.click()

    detail = wait_displayed(driver, "#paper-detail")
    wait.until(
        lambda d: bool(
            d.find_elements(By.CSS_SELECTOR, f'#paper-list .paper-list-item.selected[data-paper-id="{paper_id}"]')
        )
    )
    detail_title = driver.find_element(By.ID, "detail-title").get_attribute("textContent").strip()
    assert_true(detail_title == expected_title, f"Timeline click opened the wrong paper in {label}: {detail_title!r} != {expected_title!r}")
    assert_true(detail.get_attribute("hidden") is None, f"Timeline click must leave the paper detail drawer visible in {label}")

    wait.until(
        lambda d: "selected" in (
            d.find_element(By.CSS_SELECTOR, f'.timeline-paper[data-paper-id="{paper_id}"]').get_attribute("class") or ""
        )
    )
    wait.until(lambda d: not d.find_elements(By.CSS_SELECTOR, ".timeline-selection-freeze"))
    time.sleep(0.12)
    click_count = int(driver.execute_script("return window.__timelineSelectionClicks || 0"))
    assert_true(click_count == 1, f"One Timeline click must select exactly once in {label}; got {click_count}")

    save_screenshot(driver, f"timeline-paper-detail-open-{label}.png")


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    cases = [
        ("desktop", create_desktop_driver),
        ("mobile", create_driver),
    ]
    for label, factory in cases:
        driver = factory()
        try:
            exercise_timeline_click(driver, label)
        except Exception:
            save_screenshot(driver, f"timeline-paper-detail-failure-{label}.png")
            raise
        finally:
            driver.quit()
    print("timeline Selenium regression passed on desktop and mobile")


if __name__ == "__main__":
    main()
