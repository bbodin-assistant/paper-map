PORT ?= 8080
TEST_URL ?= http://127.0.0.1:8080/www/

.PHONY: run test test-ui-mobile

run:
	python3 -m http.server $(PORT)

test:
	node --check www/app.js
	node --check www/db.js
	node --check www/demo-data.js
	node --check www/graph.js
	node --check www/import-export.js
	node --check www/semantic-scholar.js
	node --check www/pdf-ai.js
	node --check www/pdf-ai-import.js
	node --test tests/*.test.mjs
	python3 -m py_compile tests/mobile_selenium_test.py tests/pdf_review_selenium_test.py

test-ui-mobile:
	TEST_URL="$(TEST_URL)" python3 tests/mobile_selenium_test.py
	TEST_URL="$(TEST_URL)" python3 tests/pdf_review_selenium_test.py
