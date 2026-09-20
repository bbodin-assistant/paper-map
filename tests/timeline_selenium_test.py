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
        const bandRect = firstBand?.getBoundingClientRect();
        return {
          x: Number(match?.[1] || 0),
          y: Number(match?.[2] || 0),
          bandLeft: bandRect?.left,
          bandRight: bandRect?.right,
          bandTop: bandRect?.top,
          svgLeft: box.left,
          svgRight: box.right,
          yearBottom: yearStrip?.getBoundingClientRect().bottom,
        };
        """
    )
    assert_true(0 < pan_bounds["x"] <= 129 and 0 < pan_bounds["y"] <= 49, f"Timeline drag should allow bounded right/down room beside sticky overlays in {label}: {pan_bounds}")
    assert_true(pan_bounds["bandLeft"] <= pan_bounds["svgLeft"] - 2, f"Timeline theme band should extend past the left viewport edge in {label}: {pan_bounds}")
    assert_true(pan_bounds["bandRight"] >= pan_bounds["svgRight"] + 2, f"Timeline theme band should extend past the right viewport edge in {label}: {pan_bounds}")
    assert_true(pan_bounds["bandTop"] >= pan_bounds["yearBottom"] + 1, f"Timeline top band should be draggable fully below the fixed year strip in {label}: {pan_bounds}")

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

    clickable_paper_id = driver.execute_script(
        """
        const svgRect = document.querySelector('#paper-map')?.getBoundingClientRect();
        if (!svgRect) return null;
        const paper = Array.from(document.querySelectorAll('.timeline-paper[data-paper-id]'))
          .find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const centerX = (rect.left + rect.right) / 2;
            const centerY = (rect.top + rect.bottom) / 2;
            return centerX >= svgRect.left
              && centerX <= svgRect.right
              && centerY >= svgRect.top
              && centerY <= svgRect.bottom;
          });
        return paper?.dataset.paperId || null;
        """
    )
    assert_true(clickable_paper_id, f"Timeline should keep at least one rendered paper center inside the viewport after bounded pan in {label}")
    paper = driver.find_element(By.CSS_SELECTOR, f'.timeline-paper[data-paper-id="{clickable_paper_id}"]')
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

    # Drag the world far left so papers pass underneath the sticky theme box.
    # Theme titles and their fixed box must remain independent of paper geometry.
    dragged_theme_titles = driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const box = svg.getBoundingClientRect();
        const startX = box.left + box.width * 0.7;
        const startY = box.top + box.height * 0.45;
        svg.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 982, pointerType: 'mouse', clientX: startX, clientY: startY, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 982, pointerType: 'mouse', clientX: startX - 2000, clientY: startY, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 982, pointerType: 'mouse', clientX: startX - 2000, clientY: startY, buttons: 0}));
        const visible = (element) => element && getComputedStyle(element).display !== 'none';
        const themes = Array.from(document.querySelectorAll('.timeline-sticky-theme'))
          .filter(visible)
          .map((group) => {
            const name = group.querySelector('.timeline-sticky-theme-name');
            const bg = group.querySelector('.timeline-sticky-theme-bg');
            return {
              text: name?.textContent?.trim() || '',
              nameVisible: visible(name),
              width: Number(bg?.getAttribute('width') || 0),
            };
          });
        document.querySelector('#reset-view')?.click();
        return themes;
        """
    )
    assert_true(dragged_theme_titles, f"Timeline should keep visible theme headers after a far-left drag in {label}")
    assert_true(
        all(theme["nameVisible"] and theme["text"] and theme["width"] >= 160 for theme in dragged_theme_titles),
        f"Timeline theme titles must never disappear when horizontally dragged in {label}: {dragged_theme_titles}",
    )

    help_text = driver.find_element(By.CSS_SELECTOR, ".map-help").get_attribute("textContent")
    assert_true("Chronology" not in help_text and "observed years" not in help_text, f"Timeline should omit implementation hints in {label}: {help_text!r}")

    # At maximum zoom-out the sticky theme box remains fixed. Paper cards may
    # pass beneath it; the label drawing no longer depends on paper geometry.
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
            const name = group.querySelector('.timeline-sticky-theme-name');
            return bg ? {
              left: bg.left,
              right: bg.right,
              top: bg.top,
              bottom: bg.bottom,
              name: name?.textContent || '',
              nameVisible: visible(name),
            } : null;
          })
          .filter(Boolean);
        const papers = Array.from(document.querySelectorAll('.timeline-paper')).map((paper) => {
          const rect = paper.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            fullyVisible: rect.left >= box.left && rect.right <= box.right,
          };
        });
        const yearLabels = Array.from(document.querySelectorAll('.timeline-sticky-year-label'))
          .filter(visible)
          .map((label) => {
            const rect = label.getBoundingClientRect();
            return {text: label.textContent || '', left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
          });
        const overlaps = [];
        for (const theme of themes) {
          for (const paper of papers) {
            if (!paper.fullyVisible) continue;
            const overlap = theme.left < paper.right
              && theme.right > paper.left
              && theme.top < paper.bottom
              && theme.bottom > paper.top;
            if (overlap) overlaps.push({theme, paper});
          }
        }
        const yearPaperOverlaps = [];
        for (const year of yearLabels) {
          for (const paper of papers) {
            const overlap = year.left < paper.right
              && year.right > paper.left
              && year.top < paper.bottom
              && year.bottom > paper.top;
            if (overlap) yearPaperOverlaps.push({year, paper});
          }
        }
        const yearLabelOverlaps = [];
        for (let left = 0; left < yearLabels.length; left += 1) {
          for (let right = left + 1; right < yearLabels.length; right += 1) {
            const a = yearLabels[left];
            const b = yearLabels[right];
            const overlap = a.left < b.right
              && a.right > b.left
              && a.top < b.bottom
              && a.bottom > b.top;
            if (overlap) yearLabelOverlaps.push({a, b});
          }
        }
        return {
          zoom: Number((document.querySelector('#paper-map .graph-viewport')?.getAttribute('transform') || '').match(/scale\\(([-0-9.]+)\\)/)?.[1] || 1),
          themeCount: themes.length,
          visibleThemeNames: themes.filter((theme) => theme.nameVisible && theme.name.trim()).length,
          overlaps,
          yearPaperOverlaps,
          yearLabelOverlaps,
        };
        """
    )
    assert_true(overlay_geometry["zoom"] <= 0.5, f"Timeline zoom-out regression did not reach a small scale in {label}: {overlay_geometry}")
    assert_true(overlay_geometry["themeCount"] > 0, f"Timeline should retain visible theme headers when zoomed out in {label}: {overlay_geometry}")
    assert_true(overlay_geometry["visibleThemeNames"] == overlay_geometry["themeCount"], f"Every visible Timeline theme should keep its name when zoomed out in {label}: {overlay_geometry}")
    assert_true(not overlay_geometry["yearPaperOverlaps"], f"Timeline year labels must not overlap paper cards when zoomed out in {label}: {overlay_geometry}")
    assert_true(not overlay_geometry["yearLabelOverlaps"], f"Timeline year labels must not overlap each other when zoomed out in {label}: {overlay_geometry}")

    reveal_geometry = driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const box = svg.getBoundingClientRect();
        const startX = box.left + box.width * 0.45;
        const startY = box.top + box.height * 0.45;
        svg.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 983, pointerType: 'mouse', clientX: startX, clientY: startY, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 983, pointerType: 'mouse', clientX: startX + 1000, clientY: startY + 1000, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 983, pointerType: 'mouse', clientX: startX + 1000, clientY: startY + 1000, buttons: 0}));

        const viewport = document.querySelector('#paper-map .graph-viewport');
        const transform = /translate\\(([-0-9.]+) ([-0-9.]+)\\)/.exec(viewport?.getAttribute('transform') || '');
        const bandRect = document.querySelector('.timeline-band')?.getBoundingClientRect();
        const yearBottom = document.querySelector('.timeline-sticky-year-strip')?.getBoundingClientRect().bottom;
        const themeRects = Array.from(document.querySelectorAll('.timeline-sticky-theme'))
          .filter((theme) => getComputedStyle(theme).display !== 'none')
          .map((theme) => theme.querySelector('.timeline-sticky-theme-bg')?.getBoundingClientRect())
          .filter(Boolean);
        const paperRects = Array.from(document.querySelectorAll('.timeline-paper'))
          .map((paper) => paper.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        const leftmostPaper = paperRects.sort((a, b) => a.left - b.left)[0];
        return {
          x: Number(transform?.[1] || 0),
          y: Number(transform?.[2] || 0),
          bandLeft: bandRect?.left,
          bandRight: bandRect?.right,
          bandTop: bandRect?.top,
          svgLeft: box.left,
          svgRight: box.right,
          yearBottom,
          themeWidths: themeRects.map((rect) => rect.width),
          themeRight: themeRects.length ? Math.max(...themeRects.map((rect) => rect.right)) : null,
          leftmostPaper: leftmostPaper ? {left: leftmostPaper.left, right: leftmostPaper.right} : null,
        };
        """
    )
    assert_true(100 < reveal_geometry["x"] <= 129 and 0 < reveal_geometry["y"] <= 49, f"Timeline max zoom-out should retain enough bounded drag room in {label}: {reveal_geometry}")
    assert_true(reveal_geometry["themeWidths"] and all(width >= 160 for width in reveal_geometry["themeWidths"]), f"Timeline theme boxes should keep a fixed width independent of paper positions in {label}: {reveal_geometry}")
    assert_true(reveal_geometry["bandLeft"] <= reveal_geometry["svgLeft"] - 2 and reveal_geometry["bandRight"] >= reveal_geometry["svgRight"] + 2, f"Timeline bands should read as borderless horizontal continuations across the viewport in {label}: {reveal_geometry}")
    assert_true(reveal_geometry["bandTop"] >= reveal_geometry["yearBottom"] + 1, f"Timeline top band should be movable below the years at maximum zoom-out in {label}: {reveal_geometry}")
    assert_true(
        reveal_geometry["leftmostPaper"]
        and reveal_geometry["leftmostPaper"]["left"] >= reveal_geometry["themeRight"] - 1
        and reveal_geometry["leftmostPaper"]["right"] <= reveal_geometry["svgRight"] + 1,
        f"Timeline rightward drag should fully reveal the earliest paper card beside the fixed theme box in {label}: {reveal_geometry}",
    )

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
        const visibleLabels = labels.filter((label) => getComputedStyle(label).display !== 'none');
        const lastCollisions = visibleLabels
          .filter((label) => label !== last)
          .filter((label) => {
            const rect = label.getBoundingClientRect();
            return Boolean(lastRect
              && rect.left < lastRect.right
              && rect.right > lastRect.left
              && rect.top < lastRect.bottom
              && rect.bottom > lastRect.top);
          })
          .map((label) => label.textContent || '');
        return {
          lastDisplay: last ? getComputedStyle(last).display : 'missing',
          lastText: last?.textContent || '',
          resetVisible,
          overlap,
          lastCollisions,
          lastRect: lastRect ? {left: lastRect.left, right: lastRect.right, top: lastRect.top, bottom: lastRect.bottom} : null,
          resetRect: resetRect ? {left: resetRect.left, right: resetRect.right, top: resetRect.top, bottom: resetRect.bottom} : null,
        };
        """
    )
    if reset_geometry["resetVisible"]:
        assert_true(reset_geometry["lastDisplay"] != "none", f"Reset view should keep the final Timeline year visible in {label}: {reset_geometry}")
    assert_true(not reset_geometry["overlap"], f"Reset view must not cover the final Timeline year in {label}: {reset_geometry}")
    assert_true(not reset_geometry["lastCollisions"], f"The final Timeline year must not overlap another visible year label in {label}: {reset_geometry}")

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
