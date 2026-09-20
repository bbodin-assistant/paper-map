#!/usr/bin/env python3
import time

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
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
            const expansionParent = papers.find((paper) => paper.id === 'demo:transformer');
            const expansionChild = papers.find((paper) => paper.id !== 'demo:transformer');
            if (expansionParent && expansionChild) {
              expansionChild.libraryEntry = {
                ...(expansionChild.libraryEntry || {}),
                method: 'openalex-expansion',
                parentPaperId: expansionParent.id,
                detail: 'references',
              };
              store.put(expansionChild);
            }
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


def tap_aggregate_block(driver, selector, pointer_id):
    return driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const block = document.querySelector(arguments[0]);
        if (!block) return {error: 'block not found'};
        const rect = block.getBoundingClientRect();
        const x = rect.left + Math.min(18, rect.width / 2);
        const y = rect.top + Math.min(18, rect.height / 2);
        block.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: arguments[1], pointerType: 'mouse', clientX: x, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: arguments[1], pointerType: 'mouse', clientX: x, clientY: y, buttons: 0}));
        svg.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: x, clientY: y, button: 0}));
        return {id: block.dataset.blockId || '', label: block.getAttribute('aria-label') || ''};
        """,
        selector,
        pointer_id,
    )


def tap_citation_label_area(driver):
    return driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const label = document.querySelector('.paper-node-label');
        const rect = label.getBoundingClientRect();
        const x = rect.left + Math.max(2, rect.width / 2);
        const y = rect.top + Math.max(2, rect.height / 2);
        const target = document.elementFromPoint(x, y) || svg;
        target.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 702, pointerType: 'mouse', clientX: x, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 702, pointerType: 'mouse', clientX: x, clientY: y, buttons: 0}));
        target.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: x, clientY: y, button: 0}));
        return {
          hitClass: typeof target.className === 'object' ? target.className.baseVal : (target.className || ''),
          labelPointerEvents: getComputedStyle(label).pointerEvents,
        };
        """
    )


def tap_first_node(driver):
    return driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const node = document.querySelector('.paper-node');
        const circle = node.querySelector('.paper-node-circle');
        const rect = circle.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const id = node.dataset.paperId;
        circle.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 703, pointerType: 'mouse', clientX: x, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 703, pointerType: 'mouse', clientX: x, clientY: y, buttons: 0}));
        svg.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: x, clientY: y, button: 0}));
        return {id};
        """
    )


def jitter_first_node(driver):
    return driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const node = document.querySelector('.paper-node');
        const circle = node.querySelector('.paper-node-circle');
        const before = node.getAttribute('transform');
        const rect = circle.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        circle.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 705, pointerType: 'mouse', clientX: x, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 705, pointerType: 'mouse', clientX: x + 3, clientY: y + 2, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 705, pointerType: 'mouse', clientX: x + 3, clientY: y + 2, buttons: 0}));
        svg.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: x + 3, clientY: y + 2, button: 0}));
        return {before, after: node.getAttribute('transform'), id: node.dataset.paperId};
        """
    )


def drag_first_node(driver):
    return driver.execute_script(
        """
        const svg = document.querySelector('#paper-map');
        const node = document.querySelector('.paper-node');
        const circle = node.querySelector('.paper-node-circle');
        const before = node.getAttribute('transform');
        const rect = circle.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        circle.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 710, pointerType: 'mouse', clientX: x, clientY: y, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 710, pointerType: 'mouse', clientX: x + 48, clientY: y + 26, buttons: 1}));
        svg.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 710, pointerType: 'mouse', clientX: x + 48, clientY: y + 26, buttons: 0}));
        node.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: x + 48, clientY: y + 26, button: 0}));
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

        wait_click(driver, "#ai-config-button")
        wait_displayed(driver, "#ai-config-panel")
        wait_click(driver, "#load-demo")
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-node")) >= 2)
        wait_click(driver, "#ai-config-close")
        wait.until(EC.invisibility_of_element_located((By.ID, "ai-config-panel")))

        # Topic selection is visual focus only: preserve the complete map, color the
        # selected topic pink, connected topics yellow, and bold outgoing links.
        wait_click(driver, '#map-mode button[data-mode="topics"]')
        topic_blocks = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".topic-block"))
        topic_edges = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".topic-edge"))
        assert_true(not driver.find_elements(By.CSS_SELECTOR, '.topic-block[data-topic-id="topic:uncategorized"]'), "Topic map should not expose a synthetic Uncategorized block")
        topic_block_count = len(topic_blocks)
        topic_edge_count = len(topic_edges)
        topic_source_id = topic_edges[0].get_attribute("data-source-block-id")
        tap_aggregate_block(driver, f'.topic-block[data-block-id="{topic_source_id}"]', 730)
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, f'.topic-block[data-block-id="{topic_source_id}"].selected'))
        assert_true(len(driver.find_elements(By.CSS_SELECTOR, ".topic-block")) == topic_block_count, "Topic selection must not filter topics out of the map")
        assert_true(len(driver.find_elements(By.CSS_SELECTOR, ".topic-edge")) == topic_edge_count, "Topic selection must preserve all topic links")
        selected_topic_fill = driver.execute_script("return getComputedStyle(document.querySelector('.topic-block.selected rect')).fill")
        assert_true(selected_topic_fill == "rgb(244, 189, 197)", f"Selected topic should be pink, got {selected_topic_fill!r}")
        connected_topics = driver.find_elements(By.CSS_SELECTOR, ".topic-block.connected")
        assert_true(connected_topics, "Topic selection should identify connected topics")
        connected_topic_fill = driver.execute_script("return getComputedStyle(document.querySelector('.topic-block.connected rect')).fill")
        assert_true(connected_topic_fill == "rgb(246, 196, 69)", f"Connected topics should be yellow, got {connected_topic_fill!r}")
        focused_topic_edges = driver.find_elements(By.CSS_SELECTOR, ".topic-edge.focus-source")
        assert_true(focused_topic_edges, "Outgoing links from the selected topic should be emphasized")
        assert_true(all(edge.get_attribute("data-source-block-id") == topic_source_id for edge in focused_topic_edges), "Only outgoing links from the selected topic should receive focus styling")
        topic_bar = wait_displayed(driver, "#active-topic-filter")
        wait_click(driver, "#paper-list-button")
        paper_panel = wait_displayed(driver, "#paper-list-panel")
        wait.until(lambda d: d.find_element(By.ID, "paper-list-panel").rect["y"] >= d.find_element(By.ID, "active-topic-filter").rect["y"] + d.find_element(By.ID, "active-topic-filter").rect["height"] - 1)
        assert_true(paper_panel.rect["y"] >= topic_bar.rect["y"] + topic_bar.rect["height"] - 1, "Topic focus bar should not overlap the Papers panel")
        wait_click(driver, "#close-paper-list")
        wait_click(driver, "#clear-topic-focus")

        # Author selection uses the same visual focus model and must never enter the
        # topic-focus state or mutate the Author text filter.
        wait_click(driver, '#map-mode button[data-mode="authors"]')
        author_blocks = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".author-block"))
        author_edges = wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".author-edge"))
        assert_true(len(author_blocks) >= 2, "Author map should render author blocks for the demo library")
        author_x = {
            block.get_attribute("transform").split(" ")[0]
            for block in author_blocks
            if block.get_attribute("transform")
        }
        assert_true(len(author_x) > 1, "Author map should use multiple hierarchy columns instead of a circular orbit")
        author_block_count = len(author_blocks)
        author_edge_count = len(author_edges)
        author_source_id = author_edges[0].get_attribute("data-source-block-id")
        tap_aggregate_block(driver, f'.author-block[data-block-id="{author_source_id}"]', 731)
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, f'.author-block[data-block-id="{author_source_id}"].selected'))
        assert_true(len(driver.find_elements(By.CSS_SELECTOR, ".author-block")) == author_block_count, "Author selection must not filter authors out of the map")
        assert_true(len(driver.find_elements(By.CSS_SELECTOR, ".author-edge")) == author_edge_count, "Author selection must preserve all author links")
        assert_true(driver.find_element(By.ID, "filter-author").get_attribute("value") == "", "Author-map selection must stay separate from the Author filter")
        assert_true(driver.find_element(By.ID, "active-topic-filter").get_attribute("hidden") is not None, "Selecting an author must not create a Topic focus")
        selected_author_fill = driver.execute_script("return getComputedStyle(document.querySelector('.author-block.selected rect')).fill")
        assert_true(selected_author_fill == "rgb(244, 189, 197)", f"Selected author should be pink, got {selected_author_fill!r}")
        connected_authors = driver.find_elements(By.CSS_SELECTOR, ".author-block.connected")
        assert_true(connected_authors, "Author selection should identify connected authors")
        connected_author_fill = driver.execute_script("return getComputedStyle(document.querySelector('.author-block.connected rect')).fill")
        assert_true(connected_author_fill == "rgb(246, 196, 69)", f"Connected authors should be yellow, got {connected_author_fill!r}")
        focused_author_edges = driver.find_elements(By.CSS_SELECTOR, ".author-edge.focus-source")
        assert_true(focused_author_edges, "Outgoing links from the selected author should be emphasized")
        assert_true(all(edge.get_attribute("data-source-block-id") == author_source_id for edge in focused_author_edges), "Only outgoing links from the selected author should receive focus styling")

        wait_click(driver, '#map-mode button[data-mode="citations"]')
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-node")) >= 2)

        # Filter and Add publication menus dismiss when interaction moves elsewhere.
        wait_click(driver, "#filter-menu > summary")
        assert_true(driver.find_element(By.ID, "filter-menu").get_attribute("open") is not None, "Filter menu should open")
        dispatch_background_pointer(driver)
        wait.until(lambda d: d.find_element(By.ID, "filter-menu").get_attribute("open") is None)
        wait_click(driver, "#library-menu > summary")
        assert_true(driver.find_element(By.ID, "library-menu").get_attribute("open") is not None, "Add publication menu should open")
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

        # Citation labels are informational only; clicking where the label is painted
        # must behave like background interaction rather than selecting its paper.
        label_tap = tap_citation_label_area(driver)
        assert_true(label_tap["labelPointerEvents"] == "none", f"Citation label should not be a hit target: {label_tap}")
        assert_true(not driver.find_elements(By.CSS_SELECTOR, ".paper-node.selected"), f"Citation label area must not select a paper: {label_tap}")

        # Citation-map paper activation is deliberately two-step. A plain press/release
        # selects the node even when pointer capture makes pointerup and the compatibility
        # click land on the SVG rather than the node, but it must not open details yet.
        before_positions = wait_for_stable_node_positions(driver)
        tap_result = tap_first_node(driver)
        wait.until(lambda d: "selected" in d.find_element(By.CSS_SELECTOR, f'.paper-node[data-paper-id="{tap_result["id"]}"]').get_attribute("class"))
        assert_true(driver.find_element(By.ID, "paper-detail").get_attribute("hidden") is not None, "First citation-map tap should select without opening details")
        after_tap_positions = node_positions(driver)
        assert_true(before_positions == after_tap_positions, "First citation-map tap must not reset/re-simulate graph positions")

        # A small pointer wobble remains a tap gesture. Because it targets the already
        # selected node, this second activation opens the paper details without moving it.
        jitter_result = jitter_first_node(driver)
        assert_true(jitter_result["before"] == jitter_result["after"], f"Sub-threshold pointer jitter must not move a node: {jitter_result}")
        wait_displayed(driver, "#paper-detail")
        after_jitter_positions = node_positions(driver)
        assert_true(before_positions == after_jitter_positions, "Second citation-map tap must not reset/re-simulate graph positions")
        first_node_id = jitter_result["id"]
        assert_true(tap_result["id"] == first_node_id, "Two-step citation regression should exercise the same stable first node")

        # Detail view is richer and reading state is reading-only.
        status_values = [option.get_attribute("value") for option in Select(driver.find_element(By.ID, "detail-status")).options]
        assert_true(status_values == ["unread", "reading", "read"], f"Reading states should be reading-only: {status_values}")
        relation_heading = driver.find_element(By.CSS_SELECTOR, ".research-relations-section h3").get_attribute("textContent").strip()
        provenance_heading = driver.find_element(By.CSS_SELECTOR, ".provenance-section h3").get_attribute("textContent").strip()
        assert_true(relation_heading == "Research relationships", f"Paper view should expose research relationships: {relation_heading!r}")
        assert_true(provenance_heading == "Added to library", f"Paper view should expose local provenance: {provenance_heading!r}")
        assert_true("Bundled demo dataset" in driver.find_element(By.ID, "detail-provenance").get_attribute("textContent"), "Demo provenance should explain how the paper was added")
        assert_true(driver.find_element(By.ID, "detail-dismiss-layer").get_attribute("hidden") is not None, "Paper detail should be non-modal rather than dimming/resetting the graph")
        assert_true("Venue:" in driver.find_element(By.ID, "detail-meta").get_attribute("textContent"), "Paper detail should explicitly show venue")
        selected_fill = driver.execute_script(
            "return getComputedStyle(document.querySelector('.paper-node.selected .paper-node-circle')).fill"
        )
        assert_true(selected_fill == "rgb(244, 189, 197)", f"Selected citation node should be pinkish-red, got {selected_fill!r}")

        # Add a canonical semantic relationship and verify it is directed in the graph.
        target_select = Select(driver.find_element(By.ID, "detail-relation-target"))
        target_options = [option for option in target_select.options if option.get_attribute("value")]
        assert_true(target_options, "Relation target selector should contain other papers")
        target_select.select_by_value(target_options[0].get_attribute("value"))
        Select(driver.find_element(By.ID, "detail-relation-type")).select_by_value("outperforms")
        wait_click(driver, "#detail-add-relation")
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".research-edge")) >= 1)
        assert_true("Outperforms" in driver.find_element(By.ID, "detail-relations").get_attribute("textContent"), "Relationship should appear in paper detail")
        research_edge = driver.find_elements(By.CSS_SELECTOR, ".research-edge")[0]
        assert_true("research-arrow" in (research_edge.get_attribute("marker-end") or ""), "Research relationship should be directed")
        assert_true("selected" in driver.find_element(By.CSS_SELECTOR, f'.paper-node[data-paper-id="{first_node_id}"]').get_attribute("class"), "Adding a relationship should keep the source paper selected")

        # A true drag repositions and pins the node, then reheats the remaining layout.
        # The compatibility click that a browser emits after drag must remain suppressed.
        wait_click(driver, "#close-detail")
        before_drag_positions = wait_for_stable_node_positions(driver)
        drag_result = drag_first_node(driver)
        assert_true(drag_result["before"] != drag_result["after"], f"Node drag should change position: {drag_result}")
        assert_true(driver.find_element(By.ID, "paper-detail").get_attribute("hidden") is not None, "Dragging a node must not open paper info")
        dragged_id = drag_result["id"]
        wait.until(lambda d: any(
            transform != before_drag_positions.get(paper_id)
            for paper_id, transform in node_positions(d).items()
            if paper_id != dragged_id
        ))
        settled_after_drag = wait_for_stable_node_positions(driver)
        assert_true(settled_after_drag[dragged_id] == drag_result["after"], "Dragged node should remain pinned while neighboring nodes settle")

        # Closing details keeps citation selection, so the next deliberate click on the
        # same moved node opens its paper info normally after drag suppression is consumed.
        moved_node = driver.find_element(By.CSS_SELECTOR, f'.paper-node[data-paper-id="{dragged_id}"]')
        moved_node.find_element(By.CSS_SELECTOR, ".paper-node-circle").click()
        wait_displayed(driver, "#paper-detail")
        wait_click(driver, "#close-detail")
        assert_true(
            "selected" in driver.find_element(By.CSS_SELECTOR, f'.paper-node[data-paper-id="{dragged_id}"]').get_attribute("class"),
            "Closing citation details should preserve the selected paper",
        )

        # A real background press/release clears that preserved selection before changing modes.
        dispatch_background_pointer(driver)
        wait.until(lambda d: not d.find_elements(By.CSS_SELECTOR, ".paper-node.selected"))

        # Timeline selection is deliberately two-step: select first, open detail second.
        wait_click(driver, '#map-mode button[data-mode="timeline"]')
        timeline_card = wait.until(
            lambda d: d.find_element(By.CSS_SELECTOR, '.timeline-paper[data-paper-id="demo:transformer"]')
        )
        help_text = driver.find_element(By.CSS_SELECTOR, ".map-help").get_attribute("textContent")
        assert_true("Chronology" not in help_text and "observed years" not in help_text, f"Timeline should omit implementation hints: {help_text!r}")
        assert_true(driver.find_elements(By.CSS_SELECTOR, ".timeline-sticky-year-label"), "Timeline years should render in the fixed top overlay")
        assert_true(driver.find_elements(By.CSS_SELECTOR, ".timeline-sticky-theme"), "Timeline theme details should render in the fixed left overlay")
        assert_true(timeline_card.find_elements(By.CSS_SELECTOR, ".timeline-paper-star"), "Starred timeline paper should show a star marker")

        timeline_card.click()
        wait.until(lambda d: "selected" in d.find_element(By.CSS_SELECTOR, '.timeline-paper[data-paper-id="demo:transformer"]').get_attribute("class"))
        assert_true(driver.find_element(By.ID, "paper-detail").get_attribute("hidden") is not None, "First Timeline click should select without opening details")
        assert_true(driver.find_elements(By.CSS_SELECTOR, ".timeline-paper.citation-neighbor"), "Timeline should bold papers citing or cited by the selected paper")

        timeline_card = driver.find_element(By.CSS_SELECTOR, '.timeline-paper[data-paper-id="demo:transformer"]')
        timeline_card.click()
        wait_displayed(driver, "#paper-detail")
        assert_true("Venue: NeurIPS" in driver.find_element(By.ID, "detail-meta").get_attribute("textContent"), "Timeline paper details should show venue")
        assert_true(driver.find_element(By.ID, "expand-references").get_attribute("disabled") is not None, "Previously completed reference expansion should disable the button")
        assert_true(driver.find_element(By.ID, "expand-citations").get_attribute("disabled") is None, "Independent citing-paper expansion should remain available")
        wait_click(driver, "#close-detail")
        assert_true(
            "selected" in driver.find_element(By.CSS_SELECTOR, '.timeline-paper[data-paper-id="demo:transformer"]').get_attribute("class"),
            "Closing Timeline details should keep the paper selected",
        )
        dispatch_background_pointer(driver)
        wait.until(lambda d: not d.find_elements(By.CSS_SELECTOR, ".timeline-paper.selected"))

        # Mobile two-finger pinch changes the graph zoom factor after returning to the citation map.
        wait_click(driver, '#map-mode button[data-mode="citations"]')
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".paper-node")) >= 2)
        pinch = pinch_zoom(driver)
        assert_true(pinch["after"] > pinch["before"], f"Pinch-out should zoom in: {pinch}")

        save_screenshot(driver, "12-graph-relations-gestures.png")
        assert_no_page_horizontal_overflow(driver)
        print("Graph topic focus, drag reheat, directed edges, provenance, stable selection, and pinch-zoom checks passed.")
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
