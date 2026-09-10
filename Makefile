PORT ?= 8080
TEST_URL ?= http://127.0.0.1:8080/www/
WASM_OUT_DIR ?= www/pkg

.PHONY: install-wasm build-wasm run test test-rust test-ui-mobile clean

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
	python3 -m py_compile tests/mobile_selenium_test.py tests/ai_model_discovery_selenium_test.py tests/pdf_review_selenium_test.py tests/pdf_batch_import_selenium_test.py tests/pdf_local_citation_selenium_test.py tests/reference_candidate_selenium_test.py tests/source_filter_log_selenium_test.py tests/real_pdf_smoke_selenium.py tests/graph_relations_selenium_test.py
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

clean:
	rm -rf target "$(WASM_OUT_DIR)"
