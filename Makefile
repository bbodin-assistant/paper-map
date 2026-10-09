REPORTS_DIR := reports
OUTPUT_DIR ?= output
OUTPUT_DIR_ABS := $(abspath $(OUTPUT_DIR))
REPORTS_OUTPUT_DIR ?= $(OUTPUT_DIR)/reports
REPORTS_OUTPUT_DIR_ABS := $(abspath $(REPORTS_OUTPUT_DIR))
VERSION_DIFF_DIR ?= $(OUTPUT_DIR)/version-diffs
VERSION_DIFF_BASE ?=

FIGURE_OUTPUT_DIR ?= $(OUTPUT_DIR)/figures
FIGURE ?=
REPORT ?=
PAPER ?=
FIGURE_FORMAT ?= pdf
FIGURE_DPI ?= 200
FIGURE_JOBS ?= 4
FIGURE_REPORT_ARG = $(if $(strip $(REPORT)),--report "$(REPORT)",)

LET_DIR := $(REPORTS_DIR)/logical-execution-time-models
CONTINUUM_DIR := $(REPORTS_DIR)/embedded-edge-cloud-orchestration
TRANSPORT_DIR := $(REPORTS_DIR)/Engineering_Transportation_Software_outline
AUTOMOTIVE_DIR := $(REPORTS_DIR)/Automotive_Programming_and_Modeling_Scientific_Report
DATAFLOW_DIR := $(REPORTS_DIR)/dataflow-models-of-computation
MIXED_DIR := $(REPORTS_DIR)/mixed-event-time-triggered
SHARED_STYLE := $(REPORTS_DIR)/shared/report-style.tex

LET_TEX_SOURCES := $(wildcard $(LET_DIR)/*.tex) $(wildcard $(LET_DIR)/chapters/*.tex) \
	$(wildcard $(LET_DIR)/figures/*.tex) $(wildcard $(LET_DIR)/tables/*.tex)
CONTINUUM_TEX_SOURCES := $(wildcard $(CONTINUUM_DIR)/*.tex) $(wildcard $(CONTINUUM_DIR)/chapters/*.tex) \
	$(wildcard $(CONTINUUM_DIR)/figures/*.tex) $(wildcard $(CONTINUUM_DIR)/tables/*.tex)
TRANSPORT_TEX_SOURCES := $(wildcard $(TRANSPORT_DIR)/*.tex) $(wildcard $(TRANSPORT_DIR)/chapters/*.tex) \
	$(wildcard $(TRANSPORT_DIR)/figures/*.tex) $(wildcard $(TRANSPORT_DIR)/tables/*.tex)
AUTOMOTIVE_TEX_SOURCES := $(wildcard $(AUTOMOTIVE_DIR)/*.tex) $(wildcard $(AUTOMOTIVE_DIR)/chapters/*.tex) \
	$(wildcard $(AUTOMOTIVE_DIR)/figures/*.tex) $(wildcard $(AUTOMOTIVE_DIR)/tables/*.tex)
DATAFLOW_TEX_SOURCES := $(wildcard $(DATAFLOW_DIR)/*.tex) $(wildcard $(DATAFLOW_DIR)/chapters/*.tex) \
	$(wildcard $(DATAFLOW_DIR)/figures/*.tex) $(wildcard $(DATAFLOW_DIR)/tables/*.tex)
MIXED_TEX_SOURCES := $(wildcard $(MIXED_DIR)/*.tex) $(wildcard $(MIXED_DIR)/chapters/*.tex) \
	$(wildcard $(MIXED_DIR)/figures/*.tex) $(wildcard $(MIXED_DIR)/tables/*.tex)

LET_PDF := $(REPORTS_OUTPUT_DIR)/logical-execution-time-models.pdf
CONTINUUM_PDF := $(REPORTS_OUTPUT_DIR)/embedded-edge-cloud-orchestration.pdf
TRANSPORT_PDF := $(REPORTS_OUTPUT_DIR)/Engineering_Transportation_Software_outline.pdf
AUTOMOTIVE_PDF := $(REPORTS_OUTPUT_DIR)/Automotive_Programming_and_Modeling_Scientific_Report.pdf
DATAFLOW_PDF := $(REPORTS_OUTPUT_DIR)/dataflow-models-of-computation.pdf
MIXED_PDF := $(REPORTS_OUTPUT_DIR)/mixed-event-time-triggered.pdf

TARGETS := $(LET_PDF) $(CONTINUUM_PDF) $(TRANSPORT_PDF) $(AUTOMOTIVE_PDF) $(DATAFLOW_PDF) $(MIXED_PDF)
ALIASES := logical-execution-time-models.pdf embedded-edge-cloud-orchestration.pdf \
	Engineering_Transportation_Software_outline.pdf Automotive_Programming_and_Modeling_Scientific_Report.pdf \
	dataflow-models-of-computation.pdf mixed-event-time-triggered.pdf

.PHONY: all clean download-paper paper-map-archive paper-map-json test-paper-map-json version-diffs check-report-layout check-report-theme check-report-style figures figures-pdf figures-svg figures-png \
	figures-all figures-list tikz-pdf figure clean-figures $(ALIASES)

all: $(TARGETS)

# Download and identity-check source PDFs. Set PAPER=<path/to/key.json> to process one archive.
download-paper:
	bash download_pdfs_only.sh $(if $(strip $(PAPER)),"$(PAPER)",)

# Create Paper Map compatible archive from papers/**/*.{pdf,json}
paper-map-archive:
	@mkdir -p /tmp/paper-map-simple
	@find papers -name "*.pdf" -exec cp {} /tmp/paper-map-simple/ \;
	@find papers -name "*.json" -exec cp {} /tmp/paper-map-simple/ \;
	@echo '% Paper Map full database archive\n% PaperMap-Archive-Version: 2\n' > /tmp/paper-map-simple/library.bib
	@python3 scripts/create_paper_map_archive.py /tmp/paper-map-simple $(OUTPUT_DIR_ABS)
	@rm -rf /tmp/paper-map-simple
	@echo "Paper Map archive created at $(OUTPUT_DIR_ABS)/papers-paper-map.zip"

# Generate combined Paper Map JSON from all papers/**/*.json
paper-map-json:
	@python3 scripts/combine_paper_map_json.py papers $(OUTPUT_DIR_ABS)
	@echo "Combined Paper Map JSON created at $(OUTPUT_DIR_ABS)/papers-paper-map.json"

# Test Paper Map JSON compatibility by generating JSON and validating with paper-map
PAPER_MAP_DIR ?= $(shell pwd)/paper-map

test-paper-map-json: paper-map-json
	@mkdir -p "$(PAPER_MAP_DIR)"
	@echo "Testing Paper Map JSON compatibility..."
	@python3 scripts/test_paper_map_json.py $(OUTPUT_DIR_ABS)/papers-paper-map.json
	@echo "Paper Map JSON test completed successfully"

check-report-layout:
	python3 scripts/check_report_layout.py

check-report-theme:
	python3 scripts/check_report_theme.py

check-report-style: check-report-layout check-report-theme

# Compile isolated figure sources with the owning report's real document class and
# report-style.tex. PDF is the canonical render; SVG/PNG are derived from it.
figures: figures-pdf

figures-pdf:
	python3 scripts/export_figures.py --kind figure --format pdf \
		--output-dir "$(FIGURE_OUTPUT_DIR)" --dpi "$(FIGURE_DPI)" --jobs "$(FIGURE_JOBS)" \
		$(FIGURE_REPORT_ARG)

figures-svg:
	python3 scripts/export_figures.py --kind figure --format svg \
		--output-dir "$(FIGURE_OUTPUT_DIR)" --dpi "$(FIGURE_DPI)" --jobs "$(FIGURE_JOBS)" \
		$(FIGURE_REPORT_ARG)

figures-png:
	python3 scripts/export_figures.py --kind figure --format png \
		--output-dir "$(FIGURE_OUTPUT_DIR)" --dpi "$(FIGURE_DPI)" --jobs "$(FIGURE_JOBS)" \
		$(FIGURE_REPORT_ARG)

figures-all:
	python3 scripts/export_figures.py --kind figure --format all \
		--output-dir "$(FIGURE_OUTPUT_DIR)" --dpi "$(FIGURE_DPI)" --jobs "$(FIGURE_JOBS)" \
		$(FIGURE_REPORT_ARG)

figures-list:
	python3 scripts/export_figures.py --kind figure --list $(FIGURE_REPORT_ARG)

# Raw TikZ-only previews are useful when the caption/float wrapper is not wanted.
tikz-pdf:
	python3 scripts/export_figures.py --kind tikz --format pdf \
		--output-dir "$(FIGURE_OUTPUT_DIR)" --dpi "$(FIGURE_DPI)" --jobs "$(FIGURE_JOBS)" \
		$(FIGURE_REPORT_ARG)

# Select one source by basename, stem, path, substring, or glob.
# Examples:
#   make figure REPORT=let FIGURE=04-figure-01-zet-bet-let
#   make figure REPORT=let FIGURE=04-tikz-01 FIGURE_FORMAT=svg
figure:
	@test -n "$(strip $(FIGURE))" || \
		(echo 'Usage: make figure FIGURE=<name-or-path> [REPORT=let] [FIGURE_FORMAT=pdf|svg|png|all]' >&2; exit 2)
	python3 scripts/export_figures.py --kind all --figure "$(FIGURE)" --format "$(FIGURE_FORMAT)" \
		--output-dir "$(FIGURE_OUTPUT_DIR)" --dpi "$(FIGURE_DPI)" --jobs "$(FIGURE_JOBS)" \
		$(FIGURE_REPORT_ARG)

clean-figures:
	rm -rf "$(FIGURE_OUTPUT_DIR)"

# Compare the current report version with the previous distinct REPORT_VERSION snapshot.
# Requires: git, latexpand, latexdiff, pdflatex, and xelatex.
# Override VERSION_DIFF_BASE=<git-ref> to select an explicit older version snapshot.
version-diffs:
	python3 scripts/build_version_diffs.py \
		--output-dir "$(VERSION_DIFF_DIR)" \
		$(if $(strip $(VERSION_DIFF_BASE)),--base-ref "$(VERSION_DIFF_BASE)",)

$(OUTPUT_DIR):
	mkdir -p "$@"

$(REPORTS_OUTPUT_DIR):
	mkdir -p "$@"

logical-execution-time-models.pdf: $(LET_PDF)
embedded-edge-cloud-orchestration.pdf: $(CONTINUUM_PDF)
Engineering_Transportation_Software_outline.pdf: $(TRANSPORT_PDF)
Automotive_Programming_and_Modeling_Scientific_Report.pdf: $(AUTOMOTIVE_PDF)
dataflow-models-of-computation.pdf: $(DATAFLOW_PDF)
mixed-event-time-triggered.pdf: $(MIXED_PDF)

# Mixed event/time-triggered survey.
$(MIXED_PDF): $(MIXED_TEX_SOURCES) $(MIXED_DIR)/mixed-event-time-triggered.bib $(SHARED_STYLE) | $(REPORTS_OUTPUT_DIR)
	latexmk -cd -pdf -outdir="$(REPORTS_OUTPUT_DIR_ABS)" -interaction=nonstopmode -halt-on-error $(MIXED_DIR)/mixed-event-time-triggered.tex

$(TRANSPORT_PDF): $(TRANSPORT_TEX_SOURCES) $(TRANSPORT_DIR)/Engineering_Transportation_Software.bib $(SHARED_STYLE) | $(REPORTS_OUTPUT_DIR)
	latexmk -cd -pdf -outdir="$(REPORTS_OUTPUT_DIR_ABS)" -interaction=nonstopmode -halt-on-error $(TRANSPORT_DIR)/Engineering_Transportation_Software_outline.tex

$(CONTINUUM_PDF): $(CONTINUUM_TEX_SOURCES) $(CONTINUUM_DIR)/embedded-edge-cloud-orchestration.bib $(SHARED_STYLE) | $(REPORTS_OUTPUT_DIR)
	latexmk -cd -pdf -outdir="$(REPORTS_OUTPUT_DIR_ABS)" -interaction=nonstopmode -halt-on-error $(CONTINUUM_DIR)/embedded-edge-cloud-orchestration.tex

$(LET_PDF): $(LET_TEX_SOURCES) $(LET_DIR)/logical-execution-time-models.bib $(SHARED_STYLE) | $(REPORTS_OUTPUT_DIR)
	latexmk -cd -pdf -outdir="$(REPORTS_OUTPUT_DIR_ABS)" -interaction=nonstopmode -halt-on-error $(LET_DIR)/logical-execution-time-models.tex

$(AUTOMOTIVE_PDF): $(AUTOMOTIVE_TEX_SOURCES) $(AUTOMOTIVE_DIR)/Automotive_Programming_and_Modeling_Scientific_Report.bib $(SHARED_STYLE) | $(REPORTS_OUTPUT_DIR)
	latexmk -cd -pdf -outdir="$(REPORTS_OUTPUT_DIR_ABS)" -interaction=nonstopmode -halt-on-error $(AUTOMOTIVE_DIR)/Automotive_Programming_and_Modeling_Scientific_Report.tex

$(DATAFLOW_PDF): $(DATAFLOW_TEX_SOURCES) $(DATAFLOW_DIR)/dataflow-models-of-computation.bib $(SHARED_STYLE) | $(REPORTS_OUTPUT_DIR)
	latexmk -cd -pdf -outdir="$(REPORTS_OUTPUT_DIR_ABS)" -interaction=nonstopmode -halt-on-error $(DATAFLOW_DIR)/dataflow-models-of-computation.tex


clean:
	latexmk -cd -C $(MIXED_DIR)/mixed-event-time-triggered.tex
	latexmk -cd -C $(TRANSPORT_DIR)/Engineering_Transportation_Software_outline.tex
	latexmk -cd -C $(CONTINUUM_DIR)/embedded-edge-cloud-orchestration.tex
	latexmk -cd -C $(LET_DIR)/logical-execution-time-models.tex
	latexmk -cd -C $(AUTOMOTIVE_DIR)/Automotive_Programming_and_Modeling_Scientific_Report.tex
	latexmk -cd -C $(DATAFLOW_DIR)/dataflow-models-of-computation.tex
	rm -rf "$(OUTPUT_DIR)"
