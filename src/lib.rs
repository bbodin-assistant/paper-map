use pdfplumber::{Pdf, TextOptions};
use regex::Regex;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug)]
struct PageText {
    page: usize,
    width: f64,
    height: f64,
    text: String,
}

#[derive(Clone, Debug)]
struct SourceLine {
    page: usize,
    text: String,
}

#[derive(Clone, Debug)]
struct ReferenceDraft {
    label: Option<String>,
    lines: Vec<SourceLine>,
    numbered: bool,
}

#[derive(Clone, Debug)]
struct BibliographyStart {
    page_index: usize,
    line_index: usize,
    heading: Option<String>,
    inferred: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageLayoutSummary {
    page: usize,
    width: f64,
    height: f64,
    line_count: usize,
    text_length: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayoutSummary {
    page_count: usize,
    pages: Vec<PageLayoutSummary>,
    bibliography_heading: Option<String>,
    bibliography_start_page: Option<usize>,
    bibliography_end_page: Option<usize>,
    bibliography_inferred: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedReference {
    index: usize,
    label: Option<String>,
    raw_text: String,
    doi: Option<String>,
    arxiv_id: Option<String>,
    year: Option<u16>,
    page_start: usize,
    page_end: usize,
    confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CitationExtraction {
    schema_version: u32,
    engine: String,
    layout: LayoutSummary,
    document_text: String,
    references: Vec<ExtractedReference>,
    warnings: Vec<String>,
}

fn js_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(|error| js_error(error.to_string()))
}

fn heading_name(line: &str) -> Option<&'static str> {
    let normalized = line
        .trim()
        .trim_matches(|c: char| c == ':' || c == '.' || c == '—' || c == '-')
        .trim()
        .to_lowercase();
    match normalized.as_str() {
        "references" => Some("References"),
        "bibliography" => Some("Bibliography"),
        "works cited" => Some("Works Cited"),
        "literature cited" => Some("Literature Cited"),
        "references and notes" => Some("References and Notes"),
        _ => None,
    }
}

fn is_post_bibliography_heading(line: &str) -> bool {
    let normalized = line
        .trim()
        .trim_matches(|c: char| c == ':' || c == '.' || c == '—' || c == '-')
        .trim()
        .to_lowercase();
    matches!(
        normalized.as_str(),
        "appendix"
            | "appendices"
            | "supplementary material"
            | "supplemental material"
            | "acknowledgements"
            | "acknowledgments"
    )
}

fn numbered_reference_regex() -> Regex {
    Regex::new(r"^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s*(.*)$").expect("valid numbered reference regex")
}

fn year_regex() -> Regex {
    Regex::new(r"\b((?:19|20)\d{2})[a-z]?\b").expect("valid year regex")
}

fn doi_regex() -> Regex {
    Regex::new(r"(?i)\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b").expect("valid DOI regex")
}

fn arxiv_new_regex() -> Regex {
    Regex::new(r"(?i)(?:arxiv\s*:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)").expect("valid arXiv regex")
}

fn arxiv_old_regex() -> Regex {
    Regex::new(r"(?i)(?:arxiv\s*:\s*)?([a-z][a-z0-9.\-]+/\d{7}(?:v\d+)?)").expect("valid legacy arXiv regex")
}

fn author_year_start_regex() -> Regex {
    Regex::new(r"^\s*\p{Lu}[\p{L}'’\-]+(?:,|\s).{0,150}\b(?:19|20)\d{2}[a-z]?\b")
        .expect("valid author-year regex")
}

fn author_list_start_regex() -> Regex {
    Regex::new(
        r"^\s*(?:\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){1,3}\s*,\s*\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){0,3}(?:\s*,|\s+and\b)|\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){1,3}\s+and\s+\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){0,3})",
    )
    .expect("valid author-list start regex")
}

fn trim_identifier_punctuation(mut value: String) -> String {
    while matches!(value.chars().last(), Some('.' | ',' | ';' | ':')) {
        value.pop();
    }
    loop {
        let opens = value.chars().filter(|c| *c == '(').count();
        let closes = value.chars().filter(|c| *c == ')').count();
        if closes > opens && value.ends_with(')') {
            value.pop();
        } else {
            break;
        }
    }
    value
}

fn extract_doi(text: &str) -> Option<String> {
    doi_regex()
        .find(text)
        .map(|matched| trim_identifier_punctuation(matched.as_str().to_lowercase()))
}

fn extract_arxiv(text: &str) -> Option<String> {
    if let Some(captures) = arxiv_new_regex().captures(text) {
        return captures.get(1).map(|value| value.as_str().to_string());
    }
    arxiv_old_regex()
        .captures(text)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_lowercase())
}

fn extract_year(text: &str) -> Option<u16> {
    year_regex()
        .captures(text)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<u16>().ok())
}

fn looks_like_author_year_start(line: &str) -> bool {
    author_year_start_regex().is_match(line)
}

fn looks_like_author_list_start(line: &str) -> bool {
    author_list_start_regex().is_match(line)
}

fn draft_has_year(reference: &ReferenceDraft) -> bool {
    reference
        .lines
        .iter()
        .any(|line| extract_year(&line.text).is_some())
}

fn reference_signal_count(text: &str) -> usize {
    let numbered = numbered_reference_regex();
    text.lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty()
                && (numbered.is_match(line)
                    || looks_like_author_year_start(line)
                    || extract_doi(line).is_some()
                    || extract_arxiv(line).is_some())
        })
        .count()
}

fn find_bibliography_start(pages: &[PageText]) -> Option<BibliographyStart> {
    let mut exact = None;
    for (page_index, page) in pages.iter().enumerate() {
        for (line_index, line) in page.text.lines().enumerate() {
            if let Some(heading) = heading_name(line) {
                exact = Some(BibliographyStart {
                    page_index,
                    line_index: line_index + 1,
                    heading: Some(heading.to_string()),
                    inferred: false,
                });
            }
        }
    }
    if exact.is_some() {
        return exact;
    }

    if pages.is_empty() {
        return None;
    }
    let search_start = pages.len().saturating_mul(3) / 5;
    for (page_index, page) in pages.iter().enumerate().skip(search_start) {
        if reference_signal_count(&page.text) >= 3 {
            return Some(BibliographyStart {
                page_index,
                line_index: 0,
                heading: None,
                inferred: true,
            });
        }
    }
    None
}

fn bibliography_lines(pages: &[PageText], start: &BibliographyStart) -> Vec<Option<SourceLine>> {
    let mut result = Vec::new();
    'pages: for (page_index, page) in pages.iter().enumerate().skip(start.page_index) {
        let first_line = if page_index == start.page_index {
            start.line_index
        } else {
            0
        };
        for line in page.text.lines().skip(first_line) {
            if page_index > start.page_index && is_post_bibliography_heading(line) {
                break 'pages;
            }
            let text = line.trim_end().to_string();
            if text.trim().is_empty() {
                if result.last().is_some_and(Option::is_some) {
                    result.push(None);
                }
                continue;
            }
            result.push(Some(SourceLine {
                page: page.page,
                text,
            }));
        }
        if result.last().is_some_and(Option::is_some) {
            result.push(None);
        }
    }
    while result.last().is_some_and(Option::is_none) {
        result.pop();
    }
    result
}

fn flush_reference(current: &mut Option<ReferenceDraft>, output: &mut Vec<ReferenceDraft>) {
    if let Some(reference) = current.take() {
        if reference.lines.iter().any(|line| !line.text.trim().is_empty()) {
            output.push(reference);
        }
    }
}

fn segment_numbered(lines: &[Option<SourceLine>]) -> Vec<ReferenceDraft> {
    let numbered = numbered_reference_regex();
    let mut output = Vec::new();
    let mut current: Option<ReferenceDraft> = None;

    for source in lines.iter().flatten() {
        if let Some(captures) = numbered.captures(&source.text) {
            flush_reference(&mut current, &mut output);
            let label = captures
                .get(1)
                .or_else(|| captures.get(2))
                .map(|value| value.as_str().to_string());
            let body = captures.get(3).map(|value| value.as_str()).unwrap_or("").trim();
            current = Some(ReferenceDraft {
                label,
                lines: vec![SourceLine {
                    page: source.page,
                    text: body.to_string(),
                }],
                numbered: true,
            });
        } else if let Some(reference) = current.as_mut() {
            reference.lines.push(source.clone());
        }
    }
    flush_reference(&mut current, &mut output);
    output
}

fn segment_author_year(lines: &[Option<SourceLine>]) -> Vec<ReferenceDraft> {
    let mut output = Vec::new();
    let mut current: Option<ReferenceDraft> = None;

    for item in lines {
        match item {
            None => flush_reference(&mut current, &mut output),
            Some(source) => {
                let current_has_year = current.as_ref().is_some_and(draft_has_year);
                let starts_new = current_has_year
                    && (looks_like_author_year_start(&source.text)
                        || looks_like_author_list_start(&source.text));
                if starts_new {
                    flush_reference(&mut current, &mut output);
                }
                if current.is_none() {
                    current = Some(ReferenceDraft {
                        label: None,
                        lines: Vec::new(),
                        numbered: false,
                    });
                }
                current.as_mut().unwrap().lines.push(source.clone());
            }
        }
    }
    flush_reference(&mut current, &mut output);
    output
}

fn segment_references(lines: &[Option<SourceLine>]) -> Vec<ReferenceDraft> {
    let numbered = numbered_reference_regex();
    let numbered_count = lines
        .iter()
        .flatten()
        .filter(|line| numbered.is_match(&line.text))
        .count();
    if numbered_count >= 2 {
        segment_numbered(lines)
    } else {
        segment_author_year(lines)
    }
}

fn normalize_reference_text(lines: &[SourceLine]) -> String {
    let mut result = String::new();
    for line in lines {
        let fragment = line.text.split_whitespace().collect::<Vec<_>>().join(" ");
        if fragment.is_empty() {
            continue;
        }
        if !result.is_empty() {
            if result.ends_with('-') && fragment.chars().next().is_some_and(char::is_lowercase) {
                result.pop();
            } else {
                result.push(' ');
            }
        }
        result.push_str(&fragment);
    }
    result.trim().to_string()
}

fn materialize_reference(index: usize, draft: ReferenceDraft) -> Option<ExtractedReference> {
    let raw_text = normalize_reference_text(&draft.lines);
    if raw_text.len() < 8 {
        return None;
    }
    let doi = extract_doi(&raw_text);
    let arxiv_id = extract_arxiv(&raw_text);
    let year = extract_year(&raw_text);
    let page_start = draft.lines.first()?.page;
    let page_end = draft.lines.last()?.page;
    let confidence: f64 = if doi.is_some() {
        0.99
    } else if arxiv_id.is_some() {
        0.97
    } else if draft.numbered {
        0.82
    } else if year.is_some() && looks_like_author_year_start(&raw_text) {
        0.72
    } else {
        0.48
    };
    Some(ExtractedReference {
        index,
        label: draft.label,
        raw_text,
        doi,
        arxiv_id,
        year,
        page_start,
        page_end,
        confidence: confidence.min(1.0),
    })
}

fn document_text(pages: &[PageText]) -> String {
    pages
        .iter()
        .map(|page| format!("--- Page {} ---\n{}", page.page, page.text.trim()))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn extract_from_pages(pages: Vec<PageText>) -> CitationExtraction {
    let mut warnings = Vec::new();
    let start = find_bibliography_start(&pages);
    let references = if let Some(start_ref) = start.as_ref() {
        if start_ref.inferred {
            warnings.push(
                "No explicit bibliography heading was found; the reference section start was inferred from citation-like lines near the end of the document."
                    .to_string(),
            );
        }
        let lines = bibliography_lines(&pages, start_ref);
        segment_references(&lines)
            .into_iter()
            .enumerate()
            .filter_map(|(index, draft)| materialize_reference(index + 1, draft))
            .collect::<Vec<_>>()
    } else {
        warnings.push("No bibliography or reference section could be detected.".to_string());
        Vec::new()
    };

    if references.is_empty() && start.is_some() {
        warnings.push("A bibliography region was detected, but no reference entries could be segmented.".to_string());
    }
    if !references.is_empty() && references.len() < 3 {
        warnings.push("Only a small number of references were detected; review the segmentation before saving.".to_string());
    }

    let bibliography_end_page = references.last().map(|reference| reference.page_end);
    let page_summaries = pages
        .iter()
        .map(|page| PageLayoutSummary {
            page: page.page,
            width: page.width,
            height: page.height,
            line_count: page.text.lines().count(),
            text_length: page.text.chars().count(),
        })
        .collect();
    let document_text = document_text(&pages);

    CitationExtraction {
        schema_version: 1,
        engine: "paper-map-rust-pdf/0.1".to_string(),
        layout: LayoutSummary {
            page_count: pages.len(),
            pages: page_summaries,
            bibliography_heading: start.as_ref().and_then(|value| value.heading.clone()),
            bibliography_start_page: start.as_ref().map(|value| pages[value.page_index].page),
            bibliography_end_page,
            bibliography_inferred: start.as_ref().is_some_and(|value| value.inferred),
        },
        document_text,
        references,
        warnings,
    }
}

fn parse_pdf(pdf_bytes: &[u8]) -> Result<CitationExtraction, String> {
    if pdf_bytes.is_empty() {
        return Err("Select a non-empty PDF file.".to_string());
    }
    let pdf = Pdf::open_bytes(pdf_bytes, None).map_err(|error| format!("Could not parse PDF: {error}"))?;
    let options = TextOptions {
        layout: true,
        ..Default::default()
    };
    let mut pages = Vec::new();
    for page_result in pdf.pages() {
        let page = page_result.map_err(|error| format!("Could not extract PDF page: {error}"))?;
        let text = page.extract_text(&options);
        pages.push(PageText {
            page: page.page_number() + 1,
            width: page.width(),
            height: page.height(),
            text,
        });
    }
    if pages.is_empty() {
        return Err("The PDF contains no readable pages.".to_string());
    }
    if pages.iter().all(|page| page.text.trim().is_empty()) {
        return Err("No embedded text was found in this PDF. It may be scanned and require OCR.".to_string());
    }
    Ok(extract_from_pages(pages))
}

#[wasm_bindgen]
pub fn extract_pdf_citations(pdf_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let extraction = parse_pdf(pdf_bytes).map_err(js_error)?;
    to_js(&extraction)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(page: usize, text: &str) -> PageText {
        PageText {
            page,
            width: 612.0,
            height: 792.0,
            text: text.to_string(),
        }
    }

    #[test]
    fn extracts_numbered_references_and_identifiers() {
        let extraction = extract_from_pages(vec![
            page(1, "Paper title\nBody text"),
            page(
                2,
                "References\n[1] A. Author. A useful paper. 2022. https://doi.org/10.1234/ABC.55.\n    Journal Name.\n[2] B. Author. Another paper. arXiv:2401.01234v2 (2024).\n[3] C. Author. Plain reference. 2020.",
            ),
        ]);
        assert_eq!(extraction.references.len(), 3);
        assert_eq!(extraction.references[0].doi.as_deref(), Some("10.1234/abc.55"));
        assert_eq!(extraction.references[1].arxiv_id.as_deref(), Some("2401.01234v2"));
        assert_eq!(extraction.references[2].year, Some(2020));
        assert_eq!(extraction.layout.bibliography_heading.as_deref(), Some("References"));
        assert!(extraction.document_text.contains("--- Page 1 ---"));
        assert!(extraction.document_text.contains("Paper title"));
    }

    #[test]
    fn segments_blank_line_author_year_references() {
        let extraction = extract_from_pages(vec![page(
            1,
            "Bibliography\nSmith, J. and Doe, A. 2019. First title. Journal.\n\nTaylor, B. 2021. Second title. doi:10.9999/example.2\n\nWilliams, C. 2020. Third title.",
        )]);
        assert_eq!(extraction.references.len(), 3);
        assert_eq!(extraction.references[1].doi.as_deref(), Some("10.9999/example.2"));
    }

    #[test]
    fn segments_wrapped_author_year_references_without_blank_lines() {
        let extraction = extract_from_pages(vec![page(
            1,
            "References\nAlan Akbik, Duncan Blythe, and Roland Vollgraf.\n2018. Contextual string embeddings for sequence labeling.\nRami Al-Rfou, Dokook Choe, Noah Constant, Mandy\nGuo, and Llion Jones. 2018. Character-level language modeling.\nJacob Devlin, Ming-Wei Chang, Kenton Lee, and Kristina Toutanova.\n2019. Deep bidirectional transformers for language understanding.\nRie Kubota Ando and Tong Zhang. 2005. A framework for learning predictive structures.",
        )]);
        assert_eq!(extraction.references.len(), 4);
        assert!(extraction.references[0].raw_text.starts_with("Alan Akbik"));
        assert!(extraction.references[1].raw_text.contains("Mandy Guo, and Llion Jones. 2018"));
        assert!(extraction.references[2].raw_text.starts_with("Jacob Devlin"));
        assert_eq!(extraction.references[3].year, Some(2005));
    }

    #[test]
    fn infers_reference_region_near_document_end() {
        let extraction = extract_from_pages(vec![
            page(1, "Introduction\nBody"),
            page(2, "Methods\nBody"),
            page(
                3,
                "[1] A. Author. Work. 2018.\n[2] B. Author. Work. 2019.\n[3] C. Author. Work. 2020.",
            ),
        ]);
        assert!(extraction.layout.bibliography_inferred);
        assert_eq!(extraction.references.len(), 3);
        assert!(!extraction.warnings.is_empty());
    }

    #[test]
    fn leaves_graph_resolution_for_later() {
        let extraction = extract_from_pages(vec![page(
            1,
            "References\n[1] Unknown formatting without identifier. 2017.\n[2] Known. 2021. doi:10.1111/test.1",
        )]);
        assert_eq!(extraction.references.len(), 2);
        assert!(extraction.references[0].doi.is_none());
        assert_eq!(extraction.references[1].doi.as_deref(), Some("10.1111/test.1"));
    }
}
