#!/usr/bin/env python3
"""Score the reviewed local-import path against the on-disk test paper corpus.

This is deliberately a report, rather than a pass/fail quality gate: it gives the
extractor a stable, repeatable percentage while it is being improved.
"""
import json
import hashlib
import os
from pathlib import Path

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from mobile_selenium_test import ARTIFACT_DIR, TEST_URL, WAIT_SECONDS, assert_true, create_driver, save_screenshot
from local_import_scoring import RUBRIC_VERSION, WEIGHTS, score_import


CORPUS_DIR = Path(__file__).resolve().parent.parent / "test_papers"

# Author order is transcribed from the PDFs, with explicit alternatives only
# where the paper itself supplies different spellings. References live beside
# the private PDFs and are bound to their SHA-256 hashes.
CORPUS = {
    "1911.02430v1.pdf": {
        "title": "Graph-based Approach for Buffer-aware Timing Analysis of Heterogeneous Wormhole NoCs under Bursty Traffic",
        "authors": ["Frédéric Giroudot", "Ahlem Mifdaoui"],
        "year": "2019",
    },
    "2107.09333v1.pdf": {
        "title": "StreamBlocks: A compiler for heterogeneous dataflow computing (Technical Report)",
        "titles": [
            "StreamBlocks: A compiler for heterogeneous dataflow computing (Technical Report)",
            "Stream Blocks: A compiler for heterogeneous dataflow computing (Technical Report)",
        ],
        "authors": ["Endri Bezati", "Mahyar Emami", "Jorn W. Janneck", "James R. Larus"],
        "year": "2021",
    },
    "3362692.pdf": {
        "title": "Tÿcho: A Framework for Compiling Stream Programs",
        "authors": ["Gustav Cedersjö", "Jörn W. Janneck"],
        "year": "2019",
        "doi": "10.1145/3362692",
    },
    "978-3-031-15074-6_16.pdf": {
        "title": "A Hybrid Performance Prediction Approach for Fully-Connected Artificial Neural Networks on Multi-core Platforms",
        "authors": ["Quentin Dariol", "Sebastien Le Nours", "Sebastien Pillement", "Ralf Stemmer", "Domenik Helms", "Kim Grüttner"],
        "year": "2022",
        "doi": "10.1007/978-3-031-15074-6_16",
    },
    "978-3-031-29970-4.pdf": {
        "title": "Design and Architecture for Signal and Image Processing",
        "authors": ["Miguel Chavarrías", "Alfonso Rodríguez"],
        "contributor_role": "editors",
        "year": "2023",
    },
    "A_Compressed_Data_Partition_and_Loop_Scheduling_Scheme_for_Neural_Networks.pdf": {
        "title": "A Compressed Data Partition and Loop Scheduling Scheme for Neural Networks",
        "authors": ["Dejian Li", "Rongqiang Fang", "Jing Wang", "Dongyan Zhao", "Ting Chong", "Zengmin Ren", "Jun Ma"],
        "year": "2022",
        "doi": "10.1109/ACCESS.2022.3204038",
    },
    "Becker2017.pdf": {
        "title": "End-to-end timing analysis of cause-effect chains in automotive embedded systems",
        "authors": ["Matthias Becker", "Dakshina Dasari", "Saad Mubeen", "Moris Behnam", "Thomas Nolte"],
        "year": "2017",
        "doi": "10.1016/j.sysarc.2017.09.004",
    },
    "Davare2007.pdf": {
        "title": "Period Optimization for Hard Real-time Distributed Automotive Systems",
        "authors": ["Abhijit Davare", "Qi Zhu", "Marco Di Natale", "Claudio Pinello", "Sri Kanajan", "Alberto Sangiovanni-Vincentelli"],
        "year": "2007",
    },
    "Design and Architecture for Signal and Image Processing - 978-3-031-29970-4.pdf": {
        "title": "SCAPE: HW-Aware Clustering of Dataflow Actors for Tunable Scheduling Complexity",
        "authors": ["Ophélie Renaud", "Dylan Gageot", "Karol Desnos", "Jean-François Nezan"],
        "year": "2023",
        "doi": "10.1007/978-3-031-29970-4_1",
    },
    "Efficient_Computation_of_the_Max-Plus_Semantics_of_Synchronous_Dataflow_Graphs.pdf": {
        "title": "Efficient Computation of the Max-Plus Semantics of Synchronous Dataflow Graphs",
        "authors": ["Hossein Elahi", "Marc Geilen", "Twan Basten"],
        "year": "2023",
        "doi": "10.1109/TCAD.2023.3239538",
    },
    "Efficient_Retiming_of_Unfolded_Synchronous_Dataflow_Graphs.pdf": {
        "title": "Efficient Retiming of Unfolded Synchronous Dataflow Graphs",
        "authors": ["Xue-Yang Zhu"],
        "year": "2019",
        "doi": "10.1109/ICECCS.2019.00022",
    },
    "ERTS2020_paper_83.pdf": {
        "title": "CoCoSim, a code generation framework for control/command applications: An overview of CoCoSim for multi-periodic discrete Simulink models",
        "titles": [
            "CoCoSim, a code generation framework for control/command applications: An overview of CoCoSim for multi-periodic discrete Simulink models",
            "CoCoSim, a code generation framework for control/command applications",
        ],
        "authors": ["Hamza Bourbouh", "Pierre-Loïc Garoche", "Thomas Loquen", "Eric Noulard", "Claire Pagetti"],
        "year": "2020",
    },
    "Feiertag2009.pdf": {
        "title": "A Compositional Framework for End-to-End Path Delay Calculation of Automotive Systems under Different Path Semantics",
        "authors": ["Nico Feiertag", "Kai Richter", "Johan Nordlander", "Jan Jonsson"],
        "year": "2009",
    },
    "Forget2017.pdf": {
        "title": "Verifying end-to-end real-time constraints on multi-periodic models",
        "authors": ["Julien Forget", "Frédéric Boniol", "Claire Pagetti"],
        "year": "2017",
    },
    "Gemlau2021.pdf": {
        "title": "System-level Logical Execution Time: Augmenting the Logical Execution Time Paradigm for Distributed Real-time Automotive Software",
        "authors": ["Kai-Björn Gemlau", "Leonie Köhler", "Rolf Ernst", "Sophie Quinton"],
        "year": "2021",
        "doi": "10.1145/3381847",
    },
    "Günzel2023.pdf": {
        "title": "On the Equivalence of Maximum Reaction Time and Maximum Data Age for Cause-Effect Chains",
        "authors": ["Mario Günzel", "Harun Teper", "Kuan-Hsun Chen", "Georg von der Brüggen", "Jian-Jia Chen"],
        "year": "2023",
        "doi": "10.4230/LIPIcs.ECRTS.2023.10",
    },
    "Kohler2023.pdf": {
        "title": "Robust Cause-Effect Chains with Bounded Execution Time and System-Level Logical Execution Time",
        "authors": ["Leonie Köhler", "Phil Hertha", "Matthias Beckert", "Alex Bendrick", "Rolf Ernst"],
        "year": "2023",
        "doi": "10.1145/3573388",
    },
    "Martinez2020.pdf": {
        "title": "End-to-end latency characterization of task communication models for automotive systems",
        "authors": ["Jorge Martinez", "Ignacio Sañudo", "Marko Bertogna"],
        "year": "2020",
        "doi": "10.1007/s11241-020-09350-3",
    },
    "ppdp21.pdf": {
        "title": "A Mechanized Semantic Metalanguage for High Level Synthesis",
        "authors": ["William L. Harrison", "Chris Hathhorn", "Gerard Allwein"],
        "year": "2021",
        "doi": "10.1145/3479394.3479417",
    },
    "RizziAug22_AComprehensiveTimingModelForAccurateFrequencyTuningInDataflowCircuits_FPL22.pdf": {
        "title": "A Comprehensive Timing Model for Accurate Frequency Tuning in Dataflow Circuits",
        "authors": ["Carmine Rizzi", "Andrea Guerrieri", "Paolo Ienne", "Lana Josipović"],
        "year": "2022",
        "doi": "10.1109/FPL57034.2022.00063",
    },
    "Sensitivity_Analysis_of_Strictly_Periodic_Tasks_in_Multi-Core_Real-Time_Systems.pdf": {
        "title": "Sensitivity Analysis of Strictly Periodic Tasks in Multi-Core Real-Time Systems",
        "authors": ["Jinchao Chen", "Chenglie Du", "Pengcheng Han", "Yong Zhang"],
        "year": "2019",
        "doi": "10.1109/ACCESS.2019.2941958",
    },
}


def active_tab(driver):
    return driver.find_element(By.CSS_SELECTOR, "#pdf-review-tabs [aria-selected='true']")


def wait_for_all_local_results(driver, wait, expected_count):
    def complete_or_error(d):
        statuses = d.execute_script(
            "return Array.from(document.querySelectorAll('#pdf-review-tabs [data-pdf-tab-id]'), "
            "tab => tab.dataset.localStatus);"
        )
        return len(statuses) == expected_count and all(status in {"complete", "error"} for status in statuses)

    wait.until(complete_or_error)


def score_active_import(driver, expected):
    status = active_tab(driver).get_attribute("data-local-status")
    title = driver.find_element(By.ID, "pdf-review-title").get_attribute("value")
    authors = driver.find_element(By.ID, "pdf-review-authors").get_attribute("value")
    year = driver.find_element(By.ID, "pdf-review-year").get_attribute("value")
    doi = driver.find_element(By.ID, "pdf-review-doi").get_attribute("value")
    references = driver.execute_script("""
      return Array.from(document.querySelectorAll('#pdf-reference-list .pdf-reference-row'), row => ({
        text: row.querySelector('.pdf-reference-body > p').textContent,
        pageStart: Number(row.__paperMapReference.pageStart) || 0,
        pageEnd: Number(row.__paperMapReference.pageEnd || row.__paperMapReference.pageStart) || 0
      }));
    """)
    return score_import({"status": status, "title": title, "authors": authors, "year": year,
                         "doi": doi, "references": references}, expected)


def load_reference_expectations(paths):
    path = Path(os.environ.get("TEST_PAPERS_EXPECTATIONS", CORPUS_DIR / "expected_local_import.json"))
    assert_true(path.is_file(), f"Missing independent reference expectations: {path}. See tests/README-local-import.md; never bootstrap from importer output.")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    assert_true(manifest.get("schemaVersion") == 1, "Unsupported reference expectation schema")
    result = {}
    for pdf in paths:
        entry = manifest.get("papers", {}).get(pdf.name)
        assert_true(entry is not None, f"Missing reference expectations for {pdf.name}")
        assert_true(hashlib.sha256(pdf.read_bytes()).hexdigest() == entry["sha256"], f"PDF changed: review reference expectations for {pdf.name}")
        refs = entry.get("references", [])
        assert_true(bool(refs), f"Empty reference expectations for {pdf.name}")
        assert_true(len({ref["id"] for ref in refs}) == len(refs), f"Duplicate reference IDs for {pdf.name}")
        assert_true(all(len(ref["text"].strip()) >= 10 and 1 <= ref["pageStart"] <= ref["pageEnd"] for ref in refs), f"Invalid reference expectations for {pdf.name}")
        result[pdf.name] = refs
    return result


def main():
    threshold = float(os.environ.get("TEST_PAPERS_MIN_SCORE", "0"))
    assert_true(0 <= threshold <= 100, "TEST_PAPERS_MIN_SCORE must be between 0 and 100")
    requested = [name.strip() for name in os.environ.get("TEST_PAPERS_FILES", "").split(",") if name.strip()]
    names = requested or list(CORPUS)
    unknown = set(names) - set(CORPUS)
    assert_true(not unknown, f"No scorecard expectations for: {', '.join(sorted(unknown))}")
    paths = [(CORPUS_DIR / name).resolve() for name in names]
    missing = [str(path) for path in paths if not path.is_file()]
    assert_true(not missing, f"Missing test paper PDF(s): {', '.join(missing)}")
    discovered = {path.name for path in CORPUS_DIR.glob("*.pdf")}
    unscored = discovered - set(CORPUS)
    assert_true(not unscored, f"PDFs missing scorecard expectations: {', '.join(sorted(unscored))}")
    expected_references = load_reference_expectations(paths)

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
            result = score_active_import(driver, {**CORPUS[name], "references": expected_references[name]})
            report.append({"file": name, **result})

        total = sum(item["score"] for item in report)
        percent = round(total / len(report), 1)
        payload = {"rubricVersion": RUBRIC_VERSION, "weights": WEIGHTS, "corpus": "test papers", "files": len(report),
                   "scorePercent": percent, "results": report}
        report_path = ARTIFACT_DIR / f"test-papers-local-import-score-v{RUBRIC_VERSION}.json"
        report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        save_screenshot(driver, f"test-papers-local-import-score-v{RUBRIC_VERSION}.png")
        for item in report:
            refs = item["references"]
            print(f"{item['file']}: {item['score']:.1f}%; authors complete={item['authors']['complete']}; "
                  f"references matched={refs['matchedCount']}/{refs['expectedCount']}, rows={refs['actualCount']}, "
                  f"precision={refs['precision']:.1%}, recall={refs['recall']:.1%}")
        print(f"Test papers local import score: {percent:.1f}% ({total}/{len(report) * 100}). Report: {report_path}")
        assert_true(percent >= threshold, f"Quality score {percent:.1f}% fell below required {threshold:.1f}%")
    except Exception:
        try:
            save_screenshot(driver, "test-papers-local-import-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out while importing test papers locally: {error}")
        raise
