#!/usr/bin/env python3
"""Score the reviewed local-import path against the on-disk LET paper corpus.

This is deliberately a report, rather than a pass/fail quality gate: it gives the
extractor a stable, repeatable percentage while it is being improved.
"""
import json
import os
import unicodedata
from pathlib import Path

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import ARTIFACT_DIR, TEST_URL, WAIT_SECONDS, assert_true, create_driver, save_screenshot


CORPUS_DIR = Path(__file__).resolve().parent.parent / "LET_papers"

# Each paper is scored out of 100: title 30, first author 20, year 15,
# source DOI 15 (when the source exposes one), and bibliography 20.
CORPUS = {
    "Becker2017.pdf": {
        "title": "End-to-end timing analysis of cause-effect chains in automotive embedded systems",
        "first_author": "Matthias Becker",
        "year": "2017",
        "doi": "10.1016/j.sysarc.2017.09.004",
    },
    "Davare2007.pdf": {
        "title": "Period Optimization for Hard Real-time Distributed Automotive Systems",
        "first_author": "Abhijit Davare",
        "year": "2007",
    },
    "Feiertag2009.pdf": {
        "title": "A Compositional Framework for End-to-End Path Delay Calculation of Automotive Systems under Different Path Semantics",
        "first_author": "Nico Feiertag",
        "year": "2009",
    },
    "Forget2017.pdf": {
        "title": "Verifying end-to-end real-time constraints on multi-periodic models",
        "first_author": "Julien Forget",
        "year": "2017",
    },
    "Gemlau2021.pdf": {
        "title": "System-level Logical Execution Time: Augmenting the Logical Execution Time Paradigm for Distributed Real-time Automotive Software",
        "first_author": "Kai-Björn Gemlau",
        "year": "2021",
        "doi": "10.1145/3381847",
    },
    "Günzel2023.pdf": {
        "title": "On the Equivalence of Maximum Reaction Time and Maximum Data Age for Cause-Effect Chains",
        "first_author": "Mario Günzel",
        "year": "2023",
        "doi": "10.4230/LIPIcs.ECRTS.2023.10",
    },
    "Kohler2023.pdf": {
        "title": "Robust Cause-Effect Chains with Bounded Execution Time and System-Level Logical Execution Time",
        "first_author": "Leonie Köhler",
        "year": "2023",
        "doi": "10.1145/3573388",
    },
    "Martinez2020.pdf": {
        "title": "End-to-end latency characterization of task communication models for automotive systems",
        "first_author": "Jorge Martinez",
        "year": "2020",
        "doi": "10.1007/s11241-020-09350-3",
    },
}


def normalized(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join("".join(char if char.isalnum() else " " for char in text).casefold().split())


def active_tab(driver):
    return driver.find_element(By.CSS_SELECTOR, "#pdf-review-tabs [aria-selected='true']")


def wait_for_all_local_results(driver, wait, expected_count):
    def complete_or_error(d):
        tabs = d.find_elements(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]")
        statuses = [tab.get_attribute("data-local-status") for tab in tabs]
        return len(tabs) == expected_count and all(status in {"complete", "error"} for status in statuses)

    wait.until(complete_or_error)


def score_active_import(driver, expected):
    status = active_tab(driver).get_attribute("data-local-status")
    title = driver.find_element(By.ID, "pdf-review-title").get_attribute("value")
    authors = driver.find_element(By.ID, "pdf-review-authors").get_attribute("value")
    year = driver.find_element(By.ID, "pdf-review-year").get_attribute("value")
    doi = driver.find_element(By.ID, "pdf-review-doi").get_attribute("value")
    references = driver.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")

    checks = {
        "local_complete": status == "complete",
        "title": normalized(title) == normalized(expected["title"]),
        "first_author": normalized(expected["first_author"]) in normalized(authors),
        "year": str(year).strip() == expected["year"],
        "bibliography": len(references) > 0,
    }
    if expected.get("doi"):
        checks["doi"] = str(doi).strip().casefold() == expected["doi"].casefold()

    # A local extraction failure receives zero even if the editable fallback fields
    # happen to resemble the filename.
    score = 0
    if checks["local_complete"]:
        score += 30 if checks["title"] else 0
        score += 20 if checks["first_author"] else 0
        score += 15 if checks["year"] else 0
        score += 20 if checks["bibliography"] else 0
        if expected.get("doi"):
            score += 15 if checks["doi"] else 0
        else:
            # Keep every file equally weighted when its source has no DOI.
            score += 15

    return {
        "score": score,
        "checks": checks,
        "actual": {"title": title, "authors": authors, "year": year, "doi": doi, "references": len(references)},
    }


def main():
    requested = [name for name in os.environ.get("LET_PAPERS_FILES", "").split(",") if name]
    names = requested or list(CORPUS)
    unknown = set(names) - set(CORPUS)
    assert_true(not unknown, f"No scorecard expectations for: {', '.join(sorted(unknown))}")
    paths = [(CORPUS_DIR / name).resolve() for name in names]
    missing = [str(path) for path in paths if not path.is_file()]
    assert_true(not missing, f"Missing LET paper PDF(s): {', '.join(missing)}")

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_driver()
    wait = WebDriverWait(driver, max(WAIT_SECONDS, 60))
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(lambda d: "Opening local library" not in d.find_element(By.ID, "library-status-text").get_attribute("textContent"))

        # Use the user-facing Add PDFs control before Selenium supplies the files.
        wait.until(EC.element_to_be_clickable((By.ID, "add-pdf-button"))).click()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        file_input.send_keys("\n".join(str(path) for path in paths))
        wait.until(lambda d: d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None)
        wait_for_all_local_results(driver, wait, len(paths))

        report = []
        for name in names:
            tab = wait.until(lambda d: next(
                (candidate for candidate in d.find_elements(By.CSS_SELECTOR, "#pdf-review-tabs [data-pdf-tab-id]")
                 if candidate.get_attribute("title") == name),
                False,
            ))
            wait.until(lambda d: tab.is_enabled())
            tab.click()
            wait.until(lambda d: d.find_element(By.ID, "pdf-ai-file-name").text == name)
            result = score_active_import(driver, CORPUS[name])
            report.append({"file": name, **result})

        total = sum(item["score"] for item in report)
        percent = round(total / len(report), 1)
        payload = {"corpus": "LET papers", "files": len(report), "scorePercent": percent, "results": report}
        report_path = ARTIFACT_DIR / "let-papers-local-import-score.json"
        report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        save_screenshot(driver, "let-papers-local-import-score.png")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        print(f"LET papers local import score: {percent:.1f}% ({total}/{len(report) * 100}). Report: {report_path}")
    except Exception:
        try:
            save_screenshot(driver, "let-papers-local-import-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out while importing LET papers locally: {error}")
        raise
