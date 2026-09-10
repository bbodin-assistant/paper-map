"""Pure, versioned quality rubric; contains no application extraction logic."""
from collections import Counter
import re
import unicodedata


RUBRIC_VERSION = 2
WEIGHTS = {"title": 20, "authors": 25, "year": 10, "doi": 10, "references": 35}
REFERENCE_MATCH_THRESHOLD = 0.70
REFERENCE_COMPLETE_THRESHOLD = 0.90


def normalized(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join("".join(char if char.isalnum() else " " for char in text).casefold().split())


def alternatives(value):
    return value if isinstance(value, list) else [value]


def title_match(actual, expected):
    """Only explicitly approved whole-title alternatives, never substrings."""
    return next((title for title in alternatives(expected) if normalized(actual) == normalized(title)), None)


def f1(precision, recall):
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0


def author_metrics(actual, expected):
    actual = [line.strip() for line in actual.splitlines() if line.strip()] if isinstance(actual, str) else actual
    remaining = set(range(len(expected)))
    matched = []
    extra = []
    for name in actual:
        index = next((i for i in sorted(remaining) if normalized(name) in {normalized(alias) for alias in alternatives(expected[i])}), None)
        if index is None:
            extra.append(name)
        else:
            remaining.remove(index)
            matched.append(index)
    # Longest increasing subsequence measures how much of the printed order was
    # preserved, without rewarding duplicate names or partial-name substrings.
    lengths = []
    for i, value in enumerate(matched):
        lengths.append(1 + max((lengths[j] for j in range(i) if matched[j] < value), default=0))
    order_coverage = max(lengths, default=0) / len(expected)
    precision = len(matched) / len(actual) if actual else 0.0
    recall = len(matched) / len(expected)
    return {
        "precision": precision, "recall": recall, "f1": f1(precision, recall),
        "orderCoverage": order_coverage,
        "complete": not remaining and not extra and matched == list(range(len(expected))),
        "missing": [expected[i] for i in sorted(remaining)], "unexpected": extra,
        "score": 0.8 * f1(precision, recall) + 0.2 * order_coverage,
    }


def reference_grams(text):
    # Character shingles tolerate PDF word joining, line breaks, hyphenation,
    # punctuation and Unicode ligatures, but retain all substantive text.
    text = re.sub(r"^\s*(?:\[\d+\]|\d+\.)\s*", "", text)
    compact = normalized(text).replace(" ", "")
    return Counter(compact[i:i + 5] for i in range(max(0, len(compact) - 4)))


def reference_metrics(actual, expected):
    expected_grams = [reference_grams(ref["text"]) for ref in expected]
    actual_grams = [reference_grams(ref["text"]) for ref in actual]
    candidates = []
    for ei, eg in enumerate(expected_grams):
        for ai, ag in enumerate(actual_grams):
            common = sum((eg & ag).values())
            recall = common / eg.total() if eg else 0.0
            precision = common / ag.total() if ag else 0.0
            similarity = f1(precision, recall)
            if similarity >= REFERENCE_MATCH_THRESHOLD:
                page_match = (actual[ai].get("pageStart", 0) <= expected[ei]["pageEnd"]
                              and actual[ai].get("pageEnd", 0) >= expected[ei]["pageStart"])
                candidates.append((similarity, page_match, ei, ai, precision, recall))
    # Best-first, one-to-one assignment. A duplicate or merged row cannot earn
    # credit for two expected references, even when the total row count matches.
    used_expected, used_actual, matches = set(), set(), []
    for similarity, page_match, ei, ai, precision, recall in sorted(candidates, key=lambda c: (-c[0], -c[1], c[2], c[3])):
        if ei in used_expected or ai in used_actual:
            continue
        used_expected.add(ei)
        used_actual.add(ai)
        matches.append({
            "expectedId": expected[ei]["id"], "actualIndex": ai + 1,
            "precision": precision, "recall": recall, "similarity": similarity,
            "pageMatch": page_match,
            "complete": min(precision, recall) >= REFERENCE_COMPLETE_THRESHOLD and page_match,
        })
    precision = sum(m["precision"] for m in matches) / len(actual) if actual else 0.0
    recall = sum(m["recall"] for m in matches) / len(expected)
    page_coverage = sum(m["pageMatch"] for m in matches) / len(expected)
    return {
        "expectedCount": len(expected), "actualCount": len(actual), "matchedCount": len(matches),
        "precision": precision, "recall": recall, "f1": f1(precision, recall),
        "complete": len(matches) == len(expected) == len(actual) and all(m["complete"] for m in matches),
        "missing": [ref["id"] for i, ref in enumerate(expected) if i not in used_expected],
        "unexpectedIndices": [i + 1 for i in range(len(actual)) if i not in used_actual],
        "matches": matches, "score": 0.9 * f1(precision, recall) + 0.1 * page_coverage,
    }


def normalize_doi(value):
    return re.sub(r"^(?:https?://(?:dx\.)?doi.org/|doi:\s*)", "", str(value).strip(), flags=re.I).casefold()


def score_import(actual, expected):
    title = title_match(actual["title"], expected.get("titles", expected["title"]))
    authors = author_metrics(actual["authors"], expected["authors"])
    references = reference_metrics(actual["references"], expected["references"])
    checks = {
        "local_complete": actual["status"] == "complete", "title": title is not None,
        "authors_complete": authors["complete"], "year": str(actual["year"]).strip() == expected["year"],
        "references_complete": references["complete"],
    }
    values = {"title": float(checks["title"]), "authors": authors["score"],
              "year": float(checks["year"]), "references": references["score"]}
    if expected.get("doi"):
        checks["doi"] = normalize_doi(actual["doi"]) == normalize_doi(expected["doi"])
        values["doi"] = float(checks["doi"])
    # Missing DOI expectations are N/A, not automatic bonus points.
    possible = sum(WEIGHTS[key] for key in values)
    earned = sum(WEIGHTS[key] * value for key, value in values.items()) if checks["local_complete"] else 0.0
    return {
        "score": round(100 * earned / possible, 2), "earnedPoints": earned, "possiblePoints": possible,
        "checks": checks, "matchedTitle": title, "authors": authors, "references": references,
        "contributorRole": expected.get("contributor_role", "authors"),
        "actual": actual,
    }
