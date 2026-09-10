import unittest

from local_import_scoring import author_metrics, reference_metrics, score_import, title_match


def reference(text, identifier="1:1", page=2):
    return {"id": identifier, "text": text, "pageStart": page, "pageEnd": page}


FIRST = reference("Ada Lovelace. A compiler for symbolic calculations on analytical machines. Computing Studies 12 (2020), 123–145.")
SECOND = reference("Grace Hopper. Reliable runtime verification in distributed sensor networks. Systems Journal 7 (2021), 56–78.", "1:2")


class TitleTests(unittest.TestCase):
    def test_only_explicit_whole_title_alternatives(self):
        expected = ["FooBar: A compiler (Technical Report)", "Foo Bar: A compiler (Technical Report)"]
        self.assertIsNotNone(title_match("FooBar — A compiler (Technical Report)", expected))
        for wrong in ["FooBar", "FooBar: A decompiler (Technical Report)", "FooBar: A compiler", "FooBar: A compiler (Technical Report) Ada Lovelace"]:
            self.assertIsNone(title_match(wrong, expected))


class AuthorTests(unittest.TestCase):
    def test_accents_punctuation_and_explicit_initial_alias(self):
        self.assertTrue(author_metrics("Amelie Martin\nJ W Smith", ["Amélie Martin", ["John W. Smith", "J. W. Smith"]])["complete"])

    def test_missing_extra_duplicate_and_partial_names(self):
        expected = ["Ada Lovelace", "Grace Hopper"]
        for actual in [["Ada Lovelace"], ["Ada Lovelace", "Grace Hopper", "Example University"], ["Ada Lovelace", "Ada Lovelace"], ["Ada", "Grace Hopper"], ["AdaLovelace", "Grace Hopper"]]:
            metrics = author_metrics(actual, expected)
            self.assertFalse(metrics["complete"])
            self.assertLess(metrics["score"], 1)

    def test_reordering_is_reported_without_losing_all_credit(self):
        metrics = author_metrics(["Grace Hopper", "Ada Lovelace"], ["Ada Lovelace", "Grace Hopper"])
        self.assertFalse(metrics["complete"])
        self.assertEqual(metrics["f1"], 1)
        self.assertLess(metrics["score"], 1)


class ReferenceTests(unittest.TestCase):
    def test_layout_changes_and_reordering_are_harmless(self):
        joined = reference(FIRST["text"].replace(" ", "").replace("compiler", "com-\npiler"))
        metrics = reference_metrics([SECOND, joined], [FIRST, SECOND])
        self.assertTrue(metrics["complete"])
        self.assertEqual(metrics["score"], 1)

    def test_missing_middle_entry_lowers_recall(self):
        metrics = reference_metrics([FIRST], [FIRST, SECOND])
        self.assertEqual(metrics["precision"], 1)
        self.assertEqual(metrics["recall"], 0.5)
        self.assertEqual(metrics["missing"], ["1:2"])

    def test_right_count_wrong_content_does_not_pass(self):
        metrics = reference_metrics([FIRST, FIRST], [FIRST, SECOND])
        self.assertFalse(metrics["complete"])
        self.assertEqual(metrics["matchedCount"], 1)
        self.assertLess(metrics["precision"], 1)

    def test_extra_reference_lowers_precision(self):
        metrics = reference_metrics([FIRST, SECOND, FIRST], [FIRST, SECOND])
        self.assertEqual(metrics["recall"], 1)
        self.assertAlmostEqual(metrics["precision"], 2 / 3)

    def test_merged_entries_cannot_satisfy_two_expectations(self):
        metrics = reference_metrics([reference(FIRST["text"] + " " + SECOND["text"])], [FIRST, SECOND])
        self.assertLess(metrics["matchedCount"], 2)
        self.assertFalse(metrics["complete"])
        self.assertLess(metrics["score"], 1)

    def test_truncated_and_split_references_do_not_count_as_complete(self):
        for actual in [[reference(FIRST["text"][:80])], [reference(FIRST["text"][:60]), reference(FIRST["text"][60:])]]:
            metrics = reference_metrics(actual, [FIRST])
            self.assertFalse(metrics["complete"])
            self.assertLess(metrics["recall"], 1)

    def test_appended_prose_is_penalized(self):
        metrics = reference_metrics([reference(FIRST["text"] + " Discussion of unrelated experiments and their substantial limitations.")], [FIRST])
        self.assertFalse(metrics["complete"])
        self.assertLess(metrics["precision"], 1)

    def test_multiple_sections_require_separate_occurrences_and_correct_pages(self):
        later = reference(FIRST["text"], "2:1", page=20)
        self.assertTrue(reference_metrics([later, FIRST], [FIRST, later])["complete"])
        metrics = reference_metrics([FIRST, FIRST], [FIRST, later])
        self.assertFalse(metrics["complete"])
        self.assertLess(metrics["score"], 1)


class ScoreTests(unittest.TestCase):
    def setUp(self):
        self.expected = {"title": "A Compiler", "authors": ["Ada Lovelace"], "year": "2020", "references": [FIRST]}
        self.actual = {"status": "complete", "title": "A Compiler", "authors": "Ada Lovelace", "year": "2020", "doi": "", "references": [FIRST]}

    def test_failure_receives_zero_even_with_matching_fallbacks(self):
        self.assertEqual(score_import({**self.actual, "status": "error"}, self.expected)["score"], 0)

    def test_doi_not_applicable_and_url_normalization(self):
        score = score_import(self.actual, self.expected)
        self.assertEqual(score["score"], 100)
        self.assertEqual(score["possiblePoints"], 90)
        expected = {**self.expected, "doi": "10.1234/example"}
        actual = {**self.actual, "doi": "https://doi.org/10.1234/EXAMPLE"}
        self.assertEqual(score_import(actual, expected)["score"], 100)
        self.assertLess(score_import(self.actual, expected)["score"], 100)


if __name__ == "__main__":
    unittest.main()
