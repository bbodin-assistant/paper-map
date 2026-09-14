#!/usr/bin/env python3
from pathlib import Path

from selenium.common.exceptions import TimeoutException
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
)
from pdf_local_citation_selenium_test import pdf_escape


def positioned_text(lines, x, y, font_size=8, leading=10):
    commands = [
        "BT",
        f"/F1 {font_size} Tf",
        f"{leading} TL",
        f"1 0 0 1 {x} {y} Tm",
    ]
    for index, line in enumerate(lines):
        if index:
            commands.append("T*")
        commands.append(f"({pdf_escape(line)}) Tj")
    commands.append("ET")
    return "\n".join(commands).encode("latin-1")


def create_two_column_citation_pdf():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = (ARTIFACT_DIR / "rust-two-column-citation-fixture.pdf").resolve()

    stream = b"\n".join(
        [
            positioned_text(["References"], 54, 735, font_size=12, leading=12),
            positioned_text(
                [
                    "[1] Ada Left. Left reference one. Journal 2001.",
                    "Continuation for left reference one.",
                    "[2] Bob Left. Left reference two. Journal 2002.",
                    "Continuation for left reference two.",
                    "[3] Carol Left. Left reference three. Journal 2003.",
                    "Continuation for left reference three.",
                    "[4] David Left. Left reference four. Journal 2004.",
                    "Continuation for left reference four.",
                ],
                54,
                700,
            ),
            positioned_text(
                [
                    "[5] Eve Right. Right reference five. Journal 2005.",
                    "Continuation for right reference five.",
                    "[6] Frank Right. Final reference. Conference 2006.",
                    "pp. 61-75.",
                ],
                320,
                700,
            ),
            positioned_text(
                [
                    "Thomas Example is a professor of computer science.",
                    "His research focuses on embedded systems.",
                    "Christoph Example is a postdoctoral researcher.",
                    "His biography must not become citation text.",
                ],
                320,
                610,
            ),
        ]
    )

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii"))
        output.extend(body)
        output.extend(b"\nendobj\n")

    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    path.write_bytes(output)
    return path


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    driver = create_driver()
    wait = WebDriverWait(driver, WAIT_SECONDS)
    try:
        driver.get(TEST_URL)
        wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        wait.until(
            lambda d: "Opening local library"
            not in d.find_element(By.ID, "library-status-text").get_attribute("textContent")
        )

        fixture = create_two_column_citation_pdf()
        file_input = wait.until(EC.presence_of_element_located((By.ID, "pdf-ai-file")))
        file_input.send_keys(str(Path(fixture)))
        dialog = wait.until(
            lambda d: d.find_element(By.ID, "pdf-ai-dialog")
            if d.find_element(By.ID, "pdf-ai-dialog").get_attribute("open") is not None
            else False
        )
        wait.until(
            lambda d: d.execute_script(
                "return document.querySelector(\"#pdf-review-tabs button[aria-selected='true']\")?.dataset.localStatus === 'complete';"
            )
        )
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, "#pdf-reference-list .pdf-reference-row")) == 6)

        references = driver.execute_script(
            """
            return Array.from(document.querySelectorAll('#pdf-reference-list .pdf-reference-row'), (row) => ({
              label: row.__paperMapReference?.label || '',
              rawText: row.__paperMapReference?.rawText || '',
              pageStart: row.__paperMapReference?.pageStart || 0,
              pageEnd: row.__paperMapReference?.pageEnd || 0,
            }));
            """
        )
        assert_true(
            [reference["label"] for reference in references] == ["1", "2", "3", "4", "5", "6"],
            f"Two-column references should remain in column-major numeric order: {references}",
        )
        assert_true(
            references[4]["rawText"].startswith("Eve Right. Right reference five"),
            f"The right bibliography column should be retained: {references[4]}",
        )
        assert_true(
            "Frank Right. Final reference" in references[5]["rawText"] and "pp. 61-75" in references[5]["rawText"],
            f"The final right-column reference should keep its wrapped continuation: {references[5]}",
        )
        assert_true(
            all("professor" not in reference["rawText"].lower() and "biography" not in reference["rawText"].lower() for reference in references),
            f"Author biographies must not be appended to the final citation: {references}",
        )
        assert_true(
            all(reference["pageStart"] == 1 and reference["pageEnd"] == 1 for reference in references),
            f"Two-column reference page provenance should remain intact: {references}",
        )

        save_screenshot(driver, "12-rust-two-column-citations.png", dialog)
        driver.find_element(By.ID, "pdf-ai-skip-file").click()
        wait.until(EC.staleness_of(dialog))
        print("Rust/WASM two-column bibliography ordering and biography-boundary checks passed.")
    except Exception:
        try:
            save_screenshot(driver, "rust-two-column-citation-failure.png")
        except Exception:
            pass
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        main()
    except TimeoutException as error:
        print(f"Timed out during two-column Rust/WASM citation extraction Selenium test: {error}")
        raise
