PORT ?= 8080
TEST_URL ?= http://127.0.0.1:8080/www/
WASM_OUT_DIR ?= www/pkg
TEST_PAPERS_DIR ?= test_papers

DOWNLOADABLE_TEST_PAPERS := \
	$(TEST_PAPERS_DIR)/1911.02430v1.pdf \
	$(TEST_PAPERS_DIR)/2107.09333v1.pdf \
	$(TEST_PAPERS_DIR)/Becker2017.pdf \
	$(TEST_PAPERS_DIR)/Davare2007.pdf \
	$(TEST_PAPERS_DIR)/Feiertag2009.pdf \
	$(TEST_PAPERS_DIR)/Forget2017.pdf \
	$(TEST_PAPERS_DIR)/Gemlau2021.pdf \
	$(TEST_PAPERS_DIR)/Günzel2023.pdf \
	$(TEST_PAPERS_DIR)/Kohler2023.pdf \
	$(TEST_PAPERS_DIR)/Martinez2020.pdf \
	$(TEST_PAPERS_DIR)/ppdp21.pdf \
	$(TEST_PAPERS_DIR)/RizziAug22_AComprehensiveTimingModelForAccurateFrequencyTuningInDataflowCircuits_FPL22.pdf

.PHONY: install-wasm build-wasm run test test-rust test-ui-mobile test-papers-local-import test-papers-citation-links download-test-papers clean

install-wasm:
	@command -v wasm-pack >/dev/null || { echo "Install wasm-pack first: https://rustwasm.github.io/wasm-pack/"; exit 1; }

build-wasm: install-wasm
	wasm-pack build --target web --out-dir "$(WASM_OUT_DIR)"

test-rust:
	cargo test
	cargo check --target wasm32-unknown-unknown

run: build-wasm
	python3 -m http.server $(PORT)

test:
	node --check www/app.js
	node --check www/db.js
	node --check www/demo-data.js
	node --check www/graph.js
	node --check www/graph-layout.js
	node --check www/graph-config.js
	node --check www/import-export.js
	node --check www/paper-source.js
	node --check www/paper-provider-config.js
	node --check www/paper-provider.js
	node --check www/providers/semantic-scholar.js
	node --check www/providers/openalex.js
	node --check www/providers/crossref.js
	node --check www/activity-log.js
	node --check www/semantic-scholar.js
	node --check www/research-relations.js
	node --check www/ai-config.js
	node --check www/ai-config-ui.js
	node --check www/ai-models.js
	node --check www/ai-provider.js
	node --check www/pdf-ai.js
	node --check www/pdf-metadata.js
	node --check www/pdf-local.js
	node --check www/pdf-review-merge.js
	node --check www/reference-resolver.js
	node --check www/reference-resolution-ui.js
	node --check www/pdf-ai-import.js
	node --test tests/*.test.mjs
	python3 -m unittest discover -s tests -p 'local_import_scoring_test.py'
	python3 -m py_compile tests/mobile_selenium_test.py tests/ai_model_discovery_selenium_test.py tests/pdf_review_selenium_test.py tests/pdf_batch_import_selenium_test.py tests/pdf_local_citation_selenium_test.py tests/test_papers_local_import_selenium_test.py tests/reference_candidate_selenium_test.py tests/source_filter_log_selenium_test.py tests/real_pdf_smoke_selenium.py tests/graph_relations_selenium_test.py
	python3 -m py_compile tests/test_papers_citation_links_selenium_test.py
	cargo test

test-ui-mobile: build-wasm
	TEST_URL="$(TEST_URL)" python3 tests/mobile_selenium_test.py
	TEST_URL="$(TEST_URL)" python3 tests/ai_model_discovery_selenium_test.py
	TEST_URL="$(TEST_URL)" python3 tests/pdf_review_selenium_test.py
	TEST_URL="$(TEST_URL)" python3 tests/pdf_batch_import_selenium_test.py
	TEST_URL="$(TEST_URL)" python3 tests/pdf_local_citation_selenium_test.py
	TEST_URL="$(TEST_URL)" python3 tests/reference_candidate_selenium_test.py
	TEST_URL="$(TEST_URL)" python3 tests/source_filter_log_selenium_test.py
	TEST_URL="$(TEST_URL)" python3 tests/graph_relations_selenium_test.py

test-papers-local-import: build-wasm
	TEST_URL="$(TEST_URL)" python3 tests/test_papers_local_import_selenium_test.py

test-papers-citation-links: build-wasm
	TEST_URL="$(TEST_URL)" TEST_PAPERS_DIR="$(TEST_PAPERS_DIR)" python3 tests/test_papers_citation_links_selenium_test.py

# Each file target is skipped automatically when the expected PDF is present.
download-test-papers: $(DOWNLOADABLE_TEST_PAPERS)

$(TEST_PAPERS_DIR):
	mkdir -p "$@"

$(TEST_PAPERS_DIR)/1911.02430v1.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://arxiv.org/pdf/1911.02430v1"
	test "$$(sha256sum "$@.tmp" | cut -d ' ' -f 1)" = "2a46c0d5a35c9f6d70cabfb06cecadf5b289351b50314575558bcad17c5f195c"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/2107.09333v1.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://arxiv.org/pdf/2107.09333v1"
	test "$$(sha256sum "$@.tmp" | cut -d ' ' -f 1)" = "057039867609fda5f272aed4563203f6cfff33644da8143360fd3d1736784ae5"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/Becker2017.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://www.es.mdh.se/pdf_publications/4877.pdf"
	test "$$(head -c 4 "$@.tmp")" = "%PDF"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/Davare2007.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://dl.acm.org/doi/pdf/10.1145/1278480.1278553"
	test "$$(head -c 4 "$@.tmp")" = "%PDF"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/Feiertag2009.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://www.diva-portal.org/smash/get/diva2%3A1003533/FULLTEXT01.pdf"
	test "$$(head -c 4 "$@.tmp")" = "%PDF"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/Forget2017.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://hal.science/hal-01620403v1/document"
	test "$$(head -c 4 "$@.tmp")" = "%PDF"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/Gemlau2021.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://dl.acm.org/doi/pdf/10.1145/3381847"
	test "$$(head -c 4 "$@.tmp")" = "%PDF"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/Günzel2023.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://daes.cs.tu-dortmund.de/storages/daes-cs/r/publications/guenzel23ecrts-equivalence.pdf"
	test "$$(head -c 4 "$@.tmp")" = "%PDF"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/Kohler2023.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://dl.acm.org/doi/pdf/10.1145/3573388"
	test "$$(head -c 4 "$@.tmp")" = "%PDF"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/Martinez2020.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://link.springer.com/content/pdf/10.1007/s11241-020-09350-3.pdf"
	test "$$(head -c 4 "$@.tmp")" = "%PDF"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/ppdp21.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://harrisonwl.github.io/assets/papers/ppdp21.pdf"
	test "$$(sha256sum "$@.tmp" | cut -d ' ' -f 1)" = "2ffa5567da9a91901e5f49b68bdcea76e8a3587fb1dc63a9186322c679902808"
	mv "$@.tmp" "$@"

$(TEST_PAPERS_DIR)/RizziAug22_AComprehensiveTimingModelForAccurateFrequencyTuningInDataflowCircuits_FPL22.pdf: | $(TEST_PAPERS_DIR)
	curl --fail --location --retry 3 --output "$@.tmp" "https://www.epfl.ch/labs/lap/wp-content/uploads/2022/09/RizziAug22_AComprehensiveTimingModelForAccurateFrequencyTuningInDataflowCircuits_FPL22.pdf"
	test "$$(sha256sum "$@.tmp" | cut -d ' ' -f 1)" = "2ef4b85d74b7b588d7c6977d36083799ef7c6f2cbf59b71bf5f1b588b29bfc3a"
	mv "$@.tmp" "$@"

clean:
	rm -rf target "$(WASM_OUT_DIR)"
