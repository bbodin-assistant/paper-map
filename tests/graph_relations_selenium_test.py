#!/usr/bin/env python3
import time

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
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


def node_positions(driver):
    return driver.execute_script(
        """
        return Object.fromEntries(Array.from(document.querySelectorAll('.paper-node')).map((node) => [
          node.dataset.paperId,
          node.getAttribute('transform') || ''
        ]));
        """
    )


def wait_for_stable_node_positions(driver, timeout=WAIT_SECONDS, stable_samples=3, interval=0.12):
    deadline = time.monotonic() + timeout
    previous = None
    stable = 0
    latest = None
    while time.monotonic() < deadline:
        latest = node_positions(driver)
        if latest and latest == previous:
            stable += 1
            if stable >= stable_samples:
                return latest
        else:
            stable = 0
        previous = latest
        time.sleep(interval)
    raise AssertionError(f"Graph layout did not settle before stable-selection assertion: {latest}")


def seed_citation_counts(driver):
    result = driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        const open = indexedDB.open('paper-map-v1');
        open.onerror = () => done({error: String(open.error || 'open failed')});
        open.onsuccess = () => {
          const tx = open.result.transaction('papers', 'readwrite');
          const store = tx.objectStore('papers');
          const get = store.getAll();
          get.onerror = () => done({error: String(get.error || 'get failed')});
          get.onsuccess = () => {
            const papers = get.result || [];
            if (papers.length < 2) return done({error: 'Need at least two papers'});
            papers[0].citationCount = 5;
            papers[1].citationCount = 50000;
            store.put(papers[0]);
            store.put(papers[1]);
            tx.oncomplete = () => done({ids: [papers[0].id, papers[1].id]});
            tx.onerror = () => done({error: String(tx.error || 'write failed')});
          };
        };
        """
    )
    assert_true(not result.get("error"), f"Could not seed citation counts: {result.get('error')}")
    return result["ids"]


def dispatch_background_pointer(driver):
    driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const rect = svg.getBoundingClientRect();
        const x = rect.left + 12;
        const y = rect.top + Math.min(40, rect.height / 2);
        svg.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 700, pointerType: 'mouse', clientX: x, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 700, pointerType: 'mouse', clientX: x, clientY: y, buttons: 0}));
        """
    )


def drag_first_node(driver):
    return driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const node = document.querySelector('.paper-node');
        const before = node.getAttribute('transform');
        const rect = node.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        node.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 710, pointerType: 'mouse', clientX: x, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 710, pointerType: 'mouse', clientX: x + 48, clientY: y + 26, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 710, pointerType: 'mouse', clientX: x + 48, clientY: y + 26, buttons: 0}));
        return {before, after: node.getAttribute('transform'), id: node.dataset.paperId};
        """
    )


def pinch_zoom(driver):
    return driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const rect = svg.getBoundingClientRect();
        const before = Number(svg.dataset.graphZoom || 1);
        const y = rect.top + rect.height * 0.45;
        const x1 = rect.left + rect.width * 0.35;
        const x2 = rect.left + rect.width * 0.65;
        svg.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 721, pointerType: 'touch', clientX: x1, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 722, pointerType: 'touch', clientX: x2, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 721, pointerType: 'touch', clientX: x1 - 35, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 722, pointerType: 'touch', clientX: x2 + 35, clientY: y, buttons: 1}));
        const after = Number(svg.dataset.graphZoom || 1);
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 721, pointerType: 'touch', clientX: x1 - 35, clientY: y, buttons: 0}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 722, pointerType: 'touch', clientX: x2 + 35, clientY: y, buttons: 0}));
        return {before, after};
        """
    )


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_driver()
    wait = WebDriverWait(driver, WAIT_SECONDS)
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

        wait_click(driver, "#library-menu > summary")
        wait_displayed(driver, "#library-menu .library-panel")
        wait_click(driver, "#load-demo")
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-node")) >= 2)

        # Filter and Library menus dismiss when interaction moves elsewhere.
        wait_click(driver, "#filter-menu > summary")
        assert_true(driver.find_element(By.ID, "filter-menu").get_attribute("open") is not None, "Filter menu should open")
        dispatch_background_pointer(driver)
        wait.until(lambda d: d.find_element(By.ID, "filter-menu").get_attribute("open") is None)
        wait_click(driver, "#library-menu > summary")
        assert_true(driver.find_element(By.ID, "library-menu").get_attribute("open") is not None, "Library menu should open")
        dispatch_background_pointer(driver)
        wait.until(lambda d: d.find_element(By.ID, "library-menu").get_attribute("open") is None)

        # Provider citation counts gently affect node radius.
        low_id, high_id = seed_citation_counts(driver)
        driver.refresh()
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-node")) >= 2)
        low_radius = float(driver.find_element(By.CSS_SELECTOR, f'.paper-node[data-paper-id="{low_id}"] .paper-node-circle').get_attribute("r"))
        high_radius = float(driver.find_element(By.CSS_SELECTOR, f'.paper-node[data-paper-id="{high_id}"] .paper-node-circle').get_attribute("r"))
        assert_true(high_radius > low_radius, f"Higher-citation paper should be slightly larger: {low_radius} vs {high_radius}")
        assert_true(high_radius - low_radius < 8, "Citation sizing should remain visually modest")

        # All citation edges expose a visible directed marker.
        citation_edges = driver.find_elements(By.CSS_SELECTOR, ".citation-edge")
        assert_true(citation_edges, "Demo should render citation edges")
        assert_true(all("citation-arrow" in (edge.get_attribute("marker-end") or "") for edge in citation_edges), "Citation edges should be directed")

        # Selecting a node must preserve an already-settled graph layout. Waiting for
        # the initial force simulation avoids confusing normal layout motion with a
        # selection-triggered reset/re-simulation.
        before_positions = wait_for_stable_node_positions(driver)
        first_node = driver.find_elements(By.CSS_SELECTOR, ".paper-node")[0]
        first_node_id = first_node.get_attribute("data-paper-id")
        first_node.click()
        wait_displayed(driver, "#paper-detail")
        after_positions = node_positions(driver)
        assert_true(before_positions == after_positions, "Selecting a paper must not reset/re-simulate graph positions")

        # Detail view is richer and reading state is reading-only.
        status_values = [option.get_attribute("value") for option in Select(driver.find_element(By.ID, "detail-status")).options]
        assert_true(status_values == ["unread", "reading", "read"], f"Reading states should be reading-only: {status_values}")
        detail_text = driver.find_element(By.ID, "paper-detail").text
        assert_true("Research relationships" in detail_text, "Paper view should expose research relationships")
        assert_true("Added to library" in detail_text, "Paper view should expose local provenance")
        assert_true("Bundled demo dataset" in driver.find_element(By.ID, "detail-provenance").text, "Demo provenance should explain how the paper was added")
        assert_true(driver.find_element(By.ID, "detail-dismiss-layer").get_attribute("hidden") is not None, "Paper detail should be non-modal rather than dimming/resetting the graph")

        # Add a canonical semantic relationship and verify it is directed in the graph.
        target_select = Select(driver.find_element(By.ID, "detail-relation-target"))
        target_options = [option for option in target_select.options if option.get_attribute("value")]
        assert_true(target_options, "Relation target selector should contain other papers")
        target_select.select_by_value(target_options[0].get_attribute("value"))
        Select(driver.find_element(By.ID, "detail-relation-type")).select_by_value("outperforms")
        wait_click(driver, "#detail-add-relation")
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".research-edge")) >= 1)
        assert_true("Outperforms" in driver.find_element(By.ID, "detail-relations").text, "Relationship should appear in paper detail")
        research_edge = driver.find_elements(By.CSS_SELECTOR, ".research-edge")[0]
        assert_true("research-arrow" in (research_edge.get_attribute("marker-end") or ""), "Research relationship should be directed")
        assert_true("selected" in driver.find_element(By.CSS_SELECTOR, f'.paper-node[data-paper-id="{first_node_id}"]').get_attribute("class"), "Adding a relationship should keep the source paper selected")

        # Paper items can be manually repositioned.
        wait_click(driver, "#close-detail")
        drag_result = drag_first_node(driver)
        assert_true(drag_result["before"] != drag_result["after"], f"Node drag should change position: {drag_result}")

        # Mobile two-finger pinch changes the graph zoom factor.
        pinch = pinch_zoom(driver)
        assert_true(pinch["after"] > pinch["before"], f"Pinch-out should zoom in: {pinch}")

        save_screenshot(driver, "12-graph-relations-gestures.png")
        assert_no_page_horizontal_overflow(driver)
        print("Graph relations, directed edges, provenance, drag, stable selection, and pinch-zoom checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "graph-relations-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during graph/relations Selenium test: {error}")
        raise
