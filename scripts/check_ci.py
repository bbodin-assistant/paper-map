#!/usr/bin/env python3
"""Read-only CI: version gate, advisory/release sanity, and compiled-log checks."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import check_bibliography_sanity as bibliography
from scripts import check_editorial_markers as editorial
from scripts import check_latex_source_style as style


REPORTS = (
    (
        Path("reports/logical-execution-time-models/logical-execution-time-models.tex"),
        Path("reports/logical-execution-time-models/logical-execution-time-models.bib"),
    ),
    (
        Path("reports/embedded-edge-cloud-orchestration/embedded-edge-cloud-orchestration.tex"),
        Path("reports/embedded-edge-cloud-orchestration/embedded-edge-cloud-orchestration.bib"),
    ),
    (
        Path("reports/Engineering_Transportation_Software_outline/Engineering_Transportation_Software_outline.tex"),
        Path("reports/Engineering_Transportation_Software_outline/Engineering_Transportation_Software.bib"),
    ),
    (
        Path("reports/Automotive_Programming_and_Modeling_Scientific_Report/Automotive_Programming_and_Modeling_Scientific_Report.tex"),
        Path("reports/Automotive_Programming_and_Modeling_Scientific_Report/Automotive_Programming_and_Modeling_Scientific_Report.bib"),
    ),
    (
        Path("reports/dataflow-models-of-computation/dataflow-models-of-computation.tex"),
        Path("reports/dataflow-models-of-computation/dataflow-models-of-computation.bib"),
    ),
    (
        Path("reports/mixed-event-time-triggered/mixed-event-time-triggered.tex"),
        Path("reports/mixed-event-time-triggered/mixed-event-time-triggered.bib"),
    ),
)
CONTINUUM_EXAMPLE = Path(
    "reports/embedded-edge-cloud-orchestration/scripts/evaluate_continuum_example.py"
)
OUTPUT_DIR = Path("output/reports")
VERSION_RE = re.compile(r"[A-Za-z0-9._-]+")
UNRESOLVED_RE = re.compile(
    r"(?:LaTeX|Package natbib) Warning: (?:Citation|Reference).*undefined"
    r"|There were undefined (?:references|citations)"
)


def normalized_version(value: str) -> str:
    return "".join(value.split())


def git_version(revision: str) -> str:
    # Distinguish a missing version file from an unavailable comparison commit.
    subprocess.run(["git", "cat-file", "-e", revision + "^{commit}"], check=True, capture_output=True)
    result = subprocess.run(
        ["git", "show", revision + ":REPORT_VERSION"], capture_output=True, text=True,
    )
    return normalized_version(result.stdout) if result.returncode == 0 else ""


def release_gate(event: str, ref: str, before: str, after: str) -> tuple[bool, str]:
    if event != "push" or ref != "refs/heads/main":
        return False, ""
    current = git_version(after)
    if not before or set(before) == {"0"}:
        # Initial branch push: compare the tip with its parent, if one exists.
        parents = subprocess.check_output(["git", "rev-list", "--parents", "-n", "1", after], text=True).split()
        before = parents[1] if len(parents) > 1 else ""
    previous = git_version(before) if before else ""
    changed = current != previous
    if changed and not VERSION_RE.fullmatch(current):
        raise ValueError("A version change requires a nonempty REPORT_VERSION using letters, digits, dot, _ or -.")
    return changed, current


def sanity(strict: bool) -> int:
    findings = 0
    sources: dict[Path, str] = {}
    try:
        version = normalized_version(Path("REPORT_VERSION").read_text())
        if not VERSION_RE.fullmatch(version):
            raise ValueError("REPORT_VERSION must contain only letters, digits, dot, underscore or hyphen")
    except (OSError, ValueError) as exc:
        print(f"Version: {exc}")
        findings += 1

    for tex, bib in REPORTS:
        try:
            sources.update(bibliography.manuscript_sources(tex))
            errors, warnings = bibliography.check_pair(tex, bib)
        except (OSError, ValueError) as exc:
            errors, warnings = [str(exc)], []
        for warning in warnings:
            print(f"Bibliography warning: {warning}")
        for error in errors:
            print(f"Bibliography error: {error}")
        findings += len(errors)

    for path, text in sources.items():
        findings += style.check_file(path, None)
        for number, line in enumerate(text.splitlines(), 1):
            if editorial.MARKER_RE.search(line):
                print(f"Editorial marker: {path}:{number}: {line.strip()}")
                findings += 1

    commands = [
        [sys.executable, "scripts/check_cross_bibliography_metadata.py", *[str(bib) for _, bib in REPORTS]],
        [sys.executable, str(CONTINUUM_EXAMPLE)],
    ]
    for command in commands:
        result = subprocess.run(command)
        if result.returncode != 0:
            print(f"Sanity command failed ({result.returncode}): {' '.join(command)}")
            findings += 1

    mode = "strict release" if strict else "advisory development"
    message = f"Sanity ({mode}): {len(sources)} manuscript source files; {findings} blocking-at-release finding(s)."
    print(message)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(message + "\n\n")
            stream.write("See the job log for findings. Bibliography warnings remain informational.\n")
    return int(strict and findings > 0)


def check_logs() -> int:
    failures = []
    for tex, _ in REPORTS:
        path = OUTPUT_DIR / (tex.stem + ".log")
        if not path.is_file():
            failures.append(f"Missing build log: {path}")
        elif UNRESOLVED_RE.search(path.read_text(errors="replace")):
            failures.append(f"Unresolved citation/reference: {path}")
    for failure in failures:
        print(failure)
    return int(bool(failures))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    gate = commands.add_parser("gate")
    for argument in ("event", "ref", "before", "after"):
        gate.add_argument("--" + argument, default="")
    checks = commands.add_parser("sanity")
    checks.add_argument("--strict", action="store_true")
    commands.add_parser("logs")
    args = parser.parse_args()
    if args.command == "sanity":
        return sanity(args.strict)
    if args.command == "logs":
        return check_logs()
    try:
        release, version = release_gate(args.event, args.ref, args.before, args.after)
    except (ValueError, subprocess.CalledProcessError) as exc:
        print(f"Cannot determine release gate: {exc}", file=sys.stderr)
        return 1
    values = f"release={str(release).lower()}\nversion={version if release else ''}\n"
    print(values, end="")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as stream:
            stream.write(values)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
