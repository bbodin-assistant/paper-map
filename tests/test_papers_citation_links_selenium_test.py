"""Real local PDF import: reviewed citations connect without online resolution."""
import json
import os
from pathlib import Path

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import ARTIFACT_DIR, TEST_URL, create_driver
from pdf_batch_import_selenium_test import activate_tab, save_active

# Sources deliberately saved before their targets. Expectations checked against
# the printed bibliographies, independently of the reconciliation implementation.
FILES = ["Gemlau2021", "Günzel2023", "Kohler2023", "Martinez2020",
         "Becker2017", "Davare2007", "Feiertag2009", "Forget2017"]
EXPECTED = {
    ("Gemlau2021", "Becker2017"), ("Gemlau2021", "Feiertag2009"),
    ("Günzel2023", "Becker2017"), ("Günzel2023", "Davare2007"),
    ("Günzel2023", "Feiertag2009"), ("Günzel2023", "Forget2017"),
    ("Günzel2023", "Martinez2020"), ("Kohler2023", "Becker2017"),
    ("Kohler2023", "Feiertag2009"), ("Kohler2023", "Gemlau2021"),
    ("Martinez2020", "Becker2017"), ("Martinez2020", "Davare2007"),
    ("Martinez2020", "Feiertag2009"),
}


def snapshot(driver, clear_edges=False):
    # Read raw IndexedDB: calling loadLibrary here would mask save-time bugs.
    return driver.execute_async_script("""
      const clear = arguments[0], done = arguments[arguments.length - 1];
      const open = indexedDB.open('paper-map-v1');
      open.onerror = () => done({error: String(open.error)});
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['papers', 'edges'], clear ? 'readwrite' : 'readonly');
        const papers = tx.objectStore('papers').getAll();
        const edges = tx.objectStore('edges').getAll();
        if (clear) tx.objectStore('edges').clear();
        tx.oncomplete = () => { db.close(); done({papers: papers.result, edges: edges.result}); };
        tx.onerror = () => done({error: String(tx.error)});
      };
    """, clear_edges)


def verify(driver, wait):
    data = snapshot(driver)
    assert "error" not in data, data
    names = {p["id"]: Path(p["sourceFileName"]).stem for p in data["papers"]}
    assert set(names.values()) == set(FILES), names
    edges = data["edges"]
    pairs = {(names[e["source"]], names[e["target"]]) for e in edges}
    assert EXPECTED <= pairs, f"Missing citations: {EXPECTED - pairs}"
    assert len(pairs) == len(edges), "Duplicate citation edges"
    assert all(a != b for a, b in pairs), "Self citation"
    assert all(e["provenance"] == "reviewed-reference" and
               e["referenceResolution"]["provider"] == "local-library" for e in edges)
    wait.until(lambda d: len(d.find_elements(
        By.CSS_SELECTOR, '[data-edge-id][marker-end="url(#citation-arrow)"]')) == len(edges))
    assert not driver.execute_script("return window.__externalRequests"), "Local import requested network resolution"
    return sorted(pairs)


def main():
    folder = Path(os.environ.get("TEST_PAPERS_DIR", "test_papers")).resolve()
    paths = [folder / f"{name}.pdf" for name in FILES]
    assert all(p.is_file() for p in paths), "Download the eight LET PDFs into test_papers first"
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_driver()
    wait = WebDriverWait(driver, 120)
    try:
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": """
          window.__externalRequests = [];
          const fetchOriginal = window.fetch.bind(window);
          window.fetch = (input, options) => {
            const url = new URL(input instanceof Request ? input.url : input, location.href);
            if (url.origin !== location.origin) {
              window.__externalRequests.push(url.href);
              return Promise.reject(new Error('External requests prohibited in local import test'));
            }
            return fetchOriginal(input, options);
          };
        """})
        driver.get(TEST_URL)
        wait.until(EC.element_to_be_clickable((By.ID, "add-pdf-button"))).click()
        driver.find_element(By.ID, "pdf-ai-file").send_keys("\n".join(map(str, paths)))
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR,
            '#pdf-review-tabs [data-local-status="complete"]')) == len(FILES))
        for name in FILES:
            activate_tab(driver, f"{name}.pdf")
            save_active(driver, f"{name}.pdf")
        pairs = verify(driver, wait)
        driver.refresh()
        wait.until(EC.element_to_be_clickable((By.ID, "add-pdf-button")))
        assert verify(driver, wait) == pairs
        # Simulate a previously saved local library without reconciled edges.
        snapshot(driver, clear_edges=True)
        driver.refresh()
        wait.until(EC.element_to_be_clickable((By.ID, "add-pdf-button")))
        assert verify(driver, wait) == pairs
        (ARTIFACT_DIR / "test-papers-citation-links.json").write_text(
            json.dumps({"papers": len(FILES), "citations": pairs}, indent=2), encoding="utf-8")
        driver.save_screenshot(str(ARTIFACT_DIR / "test-papers-citation-links.png"))
        print(f"PASS: {len(FILES)} real PDFs, {len(pairs)} local citation arrows; save, reload and backfill")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
