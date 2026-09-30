use std::fs;
use std::io::Write;

use paper_map_wasm::{parse_pdf, CitationExtraction};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <pdf_path1> [pdf_path2 ...]", args[0]);
        std::process::exit(1);
    }

    let pdf_paths = &args[1..];
    let mut results = Vec::new();

    for path in pdf_paths {
        let pdf_bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) => {
                eprintln!("Error reading {}: {}", path, error);
                continue;
            }
        };

        match parse_pdf(&pdf_bytes) {
            Ok(extraction) => {
                results.push(ExtractionResult {
                    path: path.to_string(),
                    extraction,
                });
            }
            Err(error) => {
                eprintln!("Error parsing {}: {}", path, error);
                continue;
            }
        }
    }

    let json_output = serde_json::to_string(&results).expect("Failed to serialize results");
    std::io::stdout().write_all(json_output.as_bytes()).expect("Failed to write output");
}

#[derive(serde::Serialize)]
struct ExtractionResult {
    path: String,
    extraction: CitationExtraction,
}
