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


def assert_desktop_layout(driver):
    wait = WebDriverWait(driver, WAIT_SECONDS)
    wait.until(lambda d: "desktop-layout-active" in (d.find_element(By.CSS_SELECTOR, ".app-header").get_attribute("class") or ""))
    wait.until(lambda d: d.find_elements(By.ID, "desktop-filter-button"))

    structure = driver.execute_script(
        """
        const rect = (selector) => {
          const element = document.querySelector(selector);
          const box = element?.getBoundingClientRect();
          return box ? {left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height} : null;
        };
        const parentClass = (selector) => document.querySelector(selector)?.parentElement?.className || '';
        return {
          brand: rect('.app-header .brand'),
          headerOverview: rect('.desktop-header-overview'),
          headerTools: rect('.app-header .header-tools'),
          toolbarLeft: rect('.desktop-toolbar-left'),
          toolbarCenter: rect('.desktop-add-actions'),
          toolbarRight: rect('.desktop-toolbar-right'),
          stage: rect('.map-stage'),
          reset: rect('#reset-view'),
          help: rect('.map-help'),
          log: rect('#activity-log'),
          mapSummaryParent: parentClass('.map-summary'),
          headerFilterParent: parentClass('#filter-menu'),
          paperButtonParent: parentClass('#paper-list-button'),
          mapModeParent: parentClass('#map-mode'),
          addFormParent: parentClass('#add-paper-form'),
          addFileParent: parentClass('#add-pdf-button'),
          resetParent: parentClass('#reset-view'),
          statusLabel: document.querySelector('.desktop-status-label')?.textContent || '',
          paperButton: document.querySelector('#paper-list-button')?.textContent || '',
          addPlaceholder: document.querySelector('#add-paper-query')?.getAttribute('placeholder') || '',
          addSubmit: document.querySelector('#add-paper-form button[type="submit"]')?.textContent || '',
          addFile: document.querySelector('#add-pdf-button')?.textContent || '',
          modeLabels: Array.from(document.querySelectorAll('#map-mode button[data-mode]'), (button) => button.textContent.trim()),
          filterLabels: [
            document.querySelector('#filter-menu > summary')?.childNodes[0]?.textContent?.trim() || '',
            document.querySelector('#desktop-filter-button')?.textContent?.trim() || '',
          ],
        };
        """
    )

    assert_true(structure["brand"]["right"] < structure["headerOverview"]["left"], f"Header overview should follow brand: {structure}")
    assert_true(structure["headerOverview"]["right"] < structure["headerTools"]["left"], f"Status/Config/About should stay at header right: {structure}")
    assert_true(structure["toolbarLeft"]["right"] < structure["toolbarCenter"]["left"], f"Add controls should be centered after map controls: {structure}")
    assert_true(structure["toolbarCenter"]["right"] < structure["toolbarRight"]["left"], f"Trailing Filters should stay at toolbar right: {structure}")
    assert_true(structure["mapSummaryParent"] == "desktop-header-overview", f"Paper/link summary should live in header overview: {structure}")
    assert_true(structure["headerFilterParent"] == "desktop-header-overview", f"Primary Filters should live in header overview: {structure}")
    assert_true(structure["paperButtonParent"] == "desktop-toolbar-left", f"Show papers should lead the second row: {structure}")
    assert_true(structure["mapModeParent"] == "desktop-toolbar-left", f"Map switch should follow Show papers: {structure}")
    assert_true("desktop-add-actions" in structure["addFormParent"], f"Resolver should be centered in the second row: {structure}")
    assert_true("desktop-add-actions" in structure["addFileParent"], f"Add paper file picker should follow resolver: {structure}")
    assert_true(structure["resetParent"] == "map-stage", f"Reset view should float inside the map: {structure}")
    assert_true(structure["statusLabel"] == "Status", f"Desktop status should have a label: {structure}")
    assert_true(structure["paperButton"] == "Show papers", f"Desktop paper drawer button label is wrong: {structure}")
    assert_true(structure["addPlaceholder"] == "Name of a paper to add", f"Desktop resolver placeholder is wrong: {structure}")
    assert_true(structure["addSubmit"] == "Add", f"Desktop resolver submit label is wrong: {structure}")
    assert_true(structure["addFile"] == "Add paper", f"Desktop file picker label is wrong: {structure}")
    assert_true(structure["modeLabels"] == ["Citation map", "Topic map", "Timeline"], f"Desktop map switch should expose all three modes: {structure}")
    assert_true(structure["filterLabels"] == ["Filters", "Filters"], f"Both requested Filters controls should be visible: {structure}")

    stage = structure["stage"]
    reset = structure["reset"]
    help_box = structure["help"]
    log_box = structure["log"]
    assert_true(abs(stage["right"] - reset["right"] - 12) <= 2 and abs(reset["top"] - stage["top"] - 12) <= 2, f"Reset view should be top-right on the map: {structure}")
    assert_true(abs(stage["right"] - help_box["right"] - 12) <= 2 and abs(stage["bottom"] - help_box["bottom"] - 10) <= 2, f"Map interaction hint should be bottom-right: {structure}")
    assert_true(log_box["left"] <= 22 and log_box["bottom"] < driver.execute_script("return window.innerHeight"), f"Activity Log should remain bottom-left: {structure}")

    save_screenshot(driver, "desktop-layout.png")


def exercise_timeline_click(driver, label):
    wait = WebDriverWait(driver, WAIT_SECONDS)
    driver.get(TEST_URL)
    wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
    wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

    if label == "desktop":
        assert_desktop_layout(driver)
    else:
        assert_true(not driver.find_elements(By.ID, "desktop-filter-button"), "Desktop-only toolbar controls must not appear on mobile")

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