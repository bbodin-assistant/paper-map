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
          toolbar: rect('.toolbar-primary'),
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
          modeText: document.querySelector('#map-mode')?.textContent || '',
          filterLabels: [
            document.querySelector('#filter-menu > summary')?.childNodes[0]?.textContent?.trim() || '',
            document.querySelector('#desktop-filter-button')?.textContent?.trim() || '',
          ],
        };
        """
    )

    assert_true(structure["brand"]["right"] < structure["headerOverview"]["left"], f"Header overview should follow brand: {structure}")
    assert_true(structure["headerOverview"]["right"] < structure["headerTools"]["left"], f"Status/Config/About should stay at header right: {structure}")
    assert_true(structure["toolbarLeft"]["right"] < structure["toolbarCenter"]["left"], f"Add controls should stay after Papers/map controls: {structure}")
    assert_true(structure["toolbarCenter"]["right"] < structure["toolbarRight"]["left"], f"Filters should stay to the right of the add controls: {structure}")
    assert_true(abs(structure["toolbar"]["right"] - structure["toolbarRight"]["right"] - 10) <= 2, f"Filters should align to the toolbar right edge: {structure}")
    assert_true(structure["mapSummaryParent"] == "desktop-header-overview", f"Paper/link summary should live in header overview: {structure}")
    assert_true(structure["headerFilterParent"] == "desktop-toolbar-right", f"The Filters menu should remain in its desktop filter control wrapper: {structure}")
    assert_true(structure["paperButtonParent"] == "desktop-toolbar-left", f"Papers should lead the second-row controls: {structure}")
    assert_true(structure["mapModeParent"] == "desktop-toolbar-left", f"Map switch should follow Papers: {structure}")
    assert_true("desktop-add-actions" in structure["addFormParent"], f"Resolver should sit between map controls and Filters in the second row: {structure}")
    assert_true("desktop-add-actions" in structure["addFileParent"], f"Add paper file picker should follow the right-aligned resolver: {structure}")
    assert_true(structure["resetParent"] == "map-stage", f"Reset view should float inside the map: {structure}")
    assert_true(structure["statusLabel"] == "", f"Desktop status should not inject a STATUS label: {structure}")
    assert_true(structure["paperButton"] == "Papers ↓", f"Desktop paper drawer button label is wrong: {structure}")
    assert_true(structure["addPlaceholder"] == "Name of a paper to add", f"Desktop resolver placeholder is wrong: {structure}")
    assert_true(structure["addSubmit"] == "Add", f"Desktop resolver submit label is wrong: {structure}")
    assert_true(structure["addFile"] == "Add paper", f"Desktop file picker label is wrong: {structure}")
    assert_true(structure["modeLabels"] == ["Citation map", "Topic map", "Author map", "Timeline"], f"Desktop map switch should expose all four modes: {structure}")
    assert_true("\\n" not in structure["modeText"], f"Map switch must not render a literal \\n text node: {structure}")
    assert_true(structure["filterLabels"][1] == "Filters", f"The left-side Filters control should remain visible: {structure}")

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

    driver.execute_script(
        """
        localStorage.setItem('paper-map-graph-config-v1', JSON.stringify({
          layoutEffort: 2,
          layoutSpacing: 1,
          timelineClusterCount: 3,
          timelineClusterFields: ['title', 'keywords', 'abstract'],
        }));
        """
    )

    # Seed a deterministic local library without depending on network providers.
    driver.execute_script("document.querySelector('#load-demo').click()")
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-node")) >= 2)

    wait_click(driver, '#map-mode button[data-mode="timeline"]')
    timeline_papers = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".timeline-paper[data-paper-id]"))
    assert_true(timeline_papers, f"Timeline should render paper cards in {label}")

    bands = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".timeline-band-group[data-timeline-cluster-index]"))
    assert_true(1 < len(bands) <= 3, f"Configured cluster count should bound visible Timeline bands in {label}: {len(bands)}")
    band_colors = [band.get_attribute("data-timeline-cluster-color") for band in bands]
    assert_true(len(set(band_colors)) == len(band_colors), f"Every Timeline cluster should have a distinct accent color in {label}: {band_colors}")
    band_fills = [
        driver.execute_script("return getComputedStyle(arguments[0].querySelector('.timeline-band')).fill;", band)
        for band in bands
    ]
    assert_true(len(set(band_fills)) == len(band_fills), f"Every Timeline cluster should have a distinct band fill in {label}: {band_fills}")

    pan_bounds = driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const box = svg.getBoundingClientRect();
        const startX = box.left + Math.max(80, box.width * 0.45);
        const startY = box.top + Math.max(80, box.height * 0.45);
        svg.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 981, pointerType: 'mouse', clientX: startX, clientY: startY, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 981, pointerType: 'mouse', clientX: startX + 600, clientY: startY + 500, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 981, pointerType: 'mouse', clientX: startX + 600, clientY: startY + 500, buttons: 0}));
        const viewport = document.querySelector('#paper-map .graph-viewport');
        const match = /translate\(([-0-9.]+) ([-0-9.]+)\)/.exec(viewport?.getAttribute('transform') || '');
        const firstBand = document.querySelector('.timeline-band');
        const yearStrip = document.querySelector('.timeline-sticky-year-strip');
        return {
          x: Number(match?.[1] || 0),
          y: Number(match?.[2] || 0),
          bandLeft: firstBand?.getBoundingClientRect().left,
          bandTop: firstBand?.getBoundingClientRect().top,
          svgLeft: box.left,
          yearBottom: yearStrip?.getBoundingClientRect().bottom,
        };
        """
    )
    assert_true(pan_bounds["x"] <= 0.01 and pan_bounds["y"] <= 0.01, f"Timeline pan should stop before exposing blank left/top space in {label}: {pan_bounds}")
    assert_true(pan_bounds["bandLeft"] <= pan_bounds["svgLeft"] + 1, f"Timeline theme color should reach the left edge in {label}: {pan_bounds}")
    assert_true(pan_bounds["bandTop"] <= pan_bounds["yearBottom"] + 1, f"Timeline content should reach the fixed year strip without a top blank gutter in {label}: {pan_bounds}")

    band_color_by_index = {
        band.get_attribute("data-timeline-cluster-index"): band.get_attribute("data-timeline-cluster-color")
        for band in bands
    }
    for timeline_paper in timeline_papers:
        cluster_index = timeline_paper.get_attribute("data-timeline-cluster-index")
        assert_true(
            timeline_paper.get_attribute("data-timeline-cluster-color") == band_color_by_index.get(cluster_index),
            f"Timeline paper card should inherit its cluster color in {label}: cluster {cluster_index}",
        )

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

    # First click selects the paper without opening details.
    paper.click()
    wait.until(
        lambda d: "selected" in (
            d.find_element(By.CSS_SELECTOR, f'.timeline-paper[data-paper-id="{paper_id}"]').get_attribute("class") or ""
        )
    )
    assert_true(
        driver.find_element(By.ID, "paper-detail").get_attribute("hidden") is not None,
        f"First Timeline click should select without opening details in {label}",
    )
    assert_true(
        driver.find_elements(By.CSS_SELECTOR, ".timeline-paper.citation-neighbor"),
        f"Selected Timeline paper should emphasize citing/cited neighbors in {label}",
    )

    sticky_years = driver.find_elements(By.CSS_SELECTOR, ".timeline-sticky-year-label")
    sticky_themes = driver.find_elements(By.CSS_SELECTOR, ".timeline-sticky-theme")
    assert_true(sticky_years and sticky_themes, f"Timeline should keep years on top and theme details on the left in {label}")
    first_sticky = sticky_themes[0]
    sticky_index = first_sticky.get_attribute("data-band-index")
    sticky_fill = driver.execute_script("return getComputedStyle(arguments[0].querySelector('.timeline-sticky-theme-bg')).fill;", first_sticky)
    matching_band = driver.find_element(By.CSS_SELECTOR, f'.timeline-band-group[data-timeline-cluster-index="{sticky_index}"]')
    matching_fill = driver.execute_script("return getComputedStyle(arguments[0].querySelector('.timeline-band')).fill;", matching_band)
    assert_true(sticky_fill == matching_fill, f"Fixed theme label should continue the theme color to the left edge in {label}: {sticky_fill!r} != {matching_fill!r}")
    help_text = driver.find_element(By.CSS_SELECTOR, ".map-help").get_attribute("textContent")
    assert_true("Chronology" not in help_text and "observed years" not in help_text, f"Timeline should omit implementation hints in {label}: {help_text!r}")

    # Zooming out must shrink the fixed theme gutter with the world-space paper
    # gutter so sticky theme labels never cover a paper card.
    overlay_geometry = driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const box = svg.getBoundingClientRect();
        for (let index = 0; index < 12; index += 1) {
          svg.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: 500,
            clientX: box.left + box.width / 2,
            clientY: box.top + box.height / 2,
          }));
        }
        const visible = (element) => element && getComputedStyle(element).display !== 'none';
        const themes = Array.from(document.querySelectorAll('.timeline-sticky-theme'))
          .filter(visible)
          .map((group) => {
            const bg = group.querySelector('.timeline-sticky-theme-bg')?.getBoundingClientRect();
            return bg ? {left: bg.left, right: bg.right, top: bg.top, bottom: bg.bottom} : null;
          })
          .filter(Boolean);
        const papers = Array.from(document.querySelectorAll('.timeline-paper')).map((paper) => {
          const rect = paper.getBoundingClientRect();
          return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
        });
        const overlaps = [];
        for (const theme of themes) {
          for (const paper of papers) {
            const overlap = theme.left < paper.right
              && theme.right > paper.left
              && theme.top < paper.bottom
              && theme.bottom > paper.top;
            if (overlap) overlaps.push({theme, paper});
          }
        }
        return {
          zoom: Number((document.querySelector('#paper-map .graph-viewport')?.getAttribute('transform') || '').match(/scale\\(([-0-9.]+)\\)/)?.[1] || 1),
          themeCount: themes.length,
          overlaps,
        };
        """
    )
    assert_true(overlay_geometry["zoom"] <= 0.5, f"Timeline zoom-out regression did not reach a small scale in {label}: {overlay_geometry}")
    assert_true(not overlay_geometry["overlaps"], f"Timeline theme labels must not overlap paper cards when zoomed out in {label}: {overlay_geometry}")

    # Reset keeps the final year readable rather than placing it under the floating
    # Reset view control. The control is desktop-only, so mobile only checks reset.
    reset_geometry = driver.execute_script(
        """
        document.querySelector('#reset-view')?.click();
        const labels = Array.from(document.querySelectorAll('.timeline-sticky-year-label'));
        const last = labels[labels.length - 1];
        const reset = document.querySelector('#reset-view');
        const lastRect = last?.getBoundingClientRect();
        const resetRect = reset?.getBoundingClientRect();
        const resetVisible = Boolean(resetRect?.width && resetRect?.height && getComputedStyle(reset).display !== 'none');
        const overlap = Boolean(resetVisible && lastRect
          && lastRect.left < resetRect.right
          && lastRect.right > resetRect.left
          && lastRect.top < resetRect.bottom
          && lastRect.bottom > resetRect.top);
        return {
          lastDisplay: last ? getComputedStyle(last).display : 'missing',
          lastText: last?.textContent || '',
          resetVisible,
          overlap,
          lastRect: lastRect ? {left: lastRect.left, right: lastRect.right, top: lastRect.top, bottom: lastRect.bottom} : null,
          resetRect: resetRect ? {left: resetRect.left, right: resetRect.right, top: resetRect.top, bottom: resetRect.bottom} : null,
        };
        """
    )
    if reset_geometry["resetVisible"]:
        assert_true(reset_geometry["lastDisplay"] != "none", f"Reset view should keep the final Timeline year visible in {label}: {reset_geometry}")
    assert_true(not reset_geometry["overlap"], f"Reset view must not cover the final Timeline year in {label}: {reset_geometry}")

    # Second click on the already selected paper opens the detail drawer.
    paper = driver.find_element(By.CSS_SELECTOR, f'.timeline-paper[data-paper-id="{paper_id}"]')
    paper.click()
    detail = wait_displayed(driver, "#paper-detail")
    detail_title = driver.find_element(By.ID, "detail-title").get_attribute("textContent").strip()
    assert_true(detail_title == expected_title, f"Second Timeline click opened the wrong paper in {label}: {detail_title!r} != {expected_title!r}")
    assert_true("Venue:" in driver.find_element(By.ID, "detail-meta").get_attribute("textContent"), f"Timeline paper details should show venue in {label}")

    driver.find_element(By.ID, "close-detail").click()
    wait.until(lambda d: d.find_element(By.ID, "paper-detail").get_attribute("hidden") is not None)
    assert_true(
        "selected" in (driver.find_element(By.CSS_SELECTOR, f'.timeline-paper[data-paper-id="{paper_id}"]').get_attribute("class") or ""),
        f"Closing Timeline details should preserve selection in {label}",
    )

    # Clicking empty Timeline space clears the selection.
    driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const rect = svg.getBoundingClientRect();
        const x = rect.left + 8;
        const y = rect.bottom - 8;
        svg.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 980, pointerType: 'mouse', clientX: x, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 980, pointerType: 'mouse', clientX: x, clientY: y, buttons: 0}));
        """
    )
    wait.until(lambda d: not d.find_elements(By.CSS_SELECTOR, ".timeline-paper.selected"))

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
    print("timeline clustering, sticky labels, and two-step selection regression passed on desktop and mobile")


if __name__ == "__main__":
    main()
