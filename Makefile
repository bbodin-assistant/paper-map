PORT ?= 8080

.PHONY: run test

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
