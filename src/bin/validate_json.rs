use std::fs;
use std::process;
use serde::Deserialize;

// Define the expected Paper Map JSON structure
#[derive(Debug, Deserialize)]
struct PaperMapArchive {
    #[serde(default = "default_archive_version")]
    archive_version: u32,
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[allow(unused)]
    exported_at: Option<String>,
    papers: Vec<PaperEntry>,
    #[serde(default)]
    #[allow(unused)]
    edges: Vec<serde_json::Value>,
    #[serde(default)]
    #[allow(unused)]
    topics: Vec<serde_json::Value>,
    #[serde(default)]
    meta: Option<serde_json::Value>,
}

fn default_archive_version() -> u32 {
    1
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PaperEntry {
    // Wrapped format: {"key": "...", "paper": {...}}
    Wrapped {
        #[allow(unused)]
        key: String,
        paper: serde_json::Value,
    },
    // Direct paper format: {...}
    Direct(serde_json::Value),
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <json_path1> [json_path2 ...]", args[0]);
        eprintln!("Validates Paper Map JSON files for compatibility");
        process::exit(1);
    }

    let json_paths = &args[1..];
    let mut all_valid = true;

    for path in json_paths {
        let json_content = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(error) => {
                eprintln!("Error reading {}: {}", path, error);
                all_valid = false;
                continue;
            }
        };

        match validate_paper_map_json(&json_content, path) {
            true => println!("✓ {} is valid Paper Map JSON", path),
            false => {
                eprintln!("✗ {} is NOT valid Paper Map JSON", path);
                all_valid = false;
            }
        }
    }

    if !all_valid {
        process::exit(1);
    }
}

fn validate_paper_map_json(json_content: &str, path: &str) -> bool {
    // First, try to parse as the full archive format
    let result: Result<PaperMapArchive, _> = serde_json::from_str(json_content);
    
    match result {
        Ok(archive) => {
            // Validate archive version
            if archive.archive_version > 3 {
                eprintln!("  ERROR: Unsupported archive version {} in {}", archive.archive_version, path);
                return false;
            }
            
            // Check for required meta field
            if archive.meta.is_none() {
                eprintln!("  WARNING: Missing 'meta' field in {}", path);
                // For now, this is a warning as older versions might not have it
            }
            
            // Validate schema version
            if archive.schema_version != 1 {
                eprintln!("  ERROR: Unsupported schema version {} in {}", archive.schema_version, path);
                return false;
            }
            
            println!("  INFO: Archive contains {} papers", archive.papers.len());
            
            // Validate each paper entry
            for (i, entry) in archive.papers.iter().enumerate() {
                match entry {
                    PaperEntry::Wrapped { key, paper } => {
                        // Validate that the key is present and non-empty
                        if key.is_empty() {
                            eprintln!("  ERROR: Paper entry {} in {} has empty key", i, path);
                            return false;
                        }
                        if !validate_paper_object(paper, path, i) {
                            return false;
                        }
                    }
                    PaperEntry::Direct(_paper) => {
                        eprintln!("  ERROR: Paper entry {} in {} is missing key wrapper", i, path);
                        return false;
                    }
                }
            }
            
            return true;
        }
        Err(parse_error) => {
            // Try parsing as a generic JSON to see if it's at least valid JSON
            let _: Result<serde_json::Value, _> = serde_json::from_str(json_content);
            
            eprintln!("  ERROR: Failed to parse {} as Paper Map archive: {}", path, parse_error);
            return false;
        }
    }
}

fn validate_paper_object(paper: &serde_json::Value, path: &str, index: usize) -> bool {
    let paper_obj = match paper.as_object() {
        Some(obj) => obj,
        None => {
            eprintln!("  ERROR: Paper entry {} in {} is not a JSON object", index, path);
            return false;
        }
    };
    
    // Check for required fields in a paper object
    let required_fields = ["id"];
    for field in required_fields {
        if !paper_obj.contains_key(&field.to_string()) {
            eprintln!("  ERROR: Paper entry {} in {} missing required field '{}'", index, path, field);
            return false;
        }
    }
    
    // Check for common optional fields
    let common_fields = ["citationKey", "title", "authors", "year", "venue", "doi", "url"];
    let missing_common: Vec<&str> = common_fields.iter()
        .filter(|&field| !paper_obj.contains_key(&field.to_string()))
        .copied()
        .collect();
    
    if !missing_common.is_empty() {
        eprintln!("  WARNING: Paper entry {} in {} missing common fields: {:?}", 
                 index, path, missing_common);
    }
    
    true
}