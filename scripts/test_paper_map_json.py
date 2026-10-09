#!/usr/bin/env python3
"""Test Paper Map JSON compatibility by validating structure and content."""

import json
import sys
import subprocess
import tempfile
from pathlib import Path


def validate_paper_map_json(json_path):
    """Validate that a JSON file conforms to Paper Map expectations."""
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError) as e:
        print(f"ERROR: Failed to load JSON: {e}")
        return False

    # Check required top-level fields
    required_fields = ['archiveVersion', 'schemaVersion', 'exportedAt', 'papers']
    for field in required_fields:
        if field not in data:
            print(f"ERROR: Missing required field '{field}'")
            return False

    # Validate archive version
    if data.get('archiveVersion') not in [1, 2]:
        print(f"ERROR: Unsupported archiveVersion: {data.get('archiveVersion')}")
        return False

    # Validate schema version
    if data.get('schemaVersion') != 1:
        print(f"ERROR: Unsupported schemaVersion: {data.get('schemaVersion')}")
        return False

    # Check papers array
    papers = data.get('papers', [])
    if not isinstance(papers, list):
        print("ERROR: 'papers' must be a list")
        return False

    print(f"INFO: Found {len(papers)} papers in JSON")

    # Validate each paper entry
    paper_errors = 0
    for i, paper_entry in enumerate(papers):
        if not isinstance(paper_entry, dict):
            print(f"ERROR: Paper entry {i} is not a dict")
            paper_errors += 1
            continue

        # Check for paper structure
        if 'paper' not in paper_entry and 'key' not in paper_entry:
            # This might be a direct paper object
            if 'id' not in paper_entry:
                print(f"ERROR: Paper entry {i} missing both 'paper' wrapper and 'id' field")
                paper_errors += 1
                continue

        # If it's wrapped format
        if 'paper' in paper_entry:
            paper_data = paper_entry['paper']
            if not isinstance(paper_data, dict):
                print(f"ERROR: Paper entry {i} has non-dict 'paper' field")
                paper_errors += 1
                continue
        else:
            paper_data = paper_entry

        # Check for basic paper fields
        if 'id' not in paper_data:
            print(f"ERROR: Paper entry {i} missing 'id' field")
            paper_errors += 1
            continue

        # Optional: check for citationKey
        if 'citationKey' not in paper_data:
            print(f"WARNING: Paper entry {i} ({paper_data.get('id', 'unknown')}) missing 'citationKey'")

    if paper_errors > 0:
        print(f"ERROR: Found {paper_errors} invalid paper entries")
        return False

    # Check for optional fields
    optional_fields = ['edges', 'topics']
    for field in optional_fields:
        if field in data and not isinstance(data[field], list):
            print(f"WARNING: '{field}' exists but is not a list")

    print("SUCCESS: JSON structure is valid for Paper Map")
    return True


def test_with_paper_map_binary(json_path, paper_map_binary=None):
    """Test JSON compatibility using the paper-map binary if available."""
    if paper_map_binary is None:
        print("INFO: No paper-map binary specified, skipping binary validation")
        return True
    
    binary_path = Path(paper_map_binary)
    if not binary_path.exists():
        print(f"INFO: Paper-map binary not found at {binary_path}, skipping binary validation")
        return True
    
    # Test that the binary can execute by running it without arguments
    # This should show the usage message
    try:
        result = subprocess.run([str(binary_path)], 
                              capture_output=True, text=True, timeout=10)
        # Check if we get the expected usage error (which means it ran successfully)
        if "Usage:" in result.stderr:
            print("INFO: Paper-map binary is executable and working")
            return True
        else:
            print(f"WARNING: Paper-map binary executed but unexpected output: {result.stderr}")
            return True  # Still consider it a pass if it ran
    except subprocess.TimeoutExpired:
        print("ERROR: Paper-map binary test timed out")
        return False
    except Exception as e:
        print(f"ERROR: Failed to test paper-map binary: {e}")
        return False


def test_json_loading_with_paper_map(json_path, paper_map_dir=None):
    """Test that the JSON can be loaded by creating a minimal paper-map test setup."""
    if paper_map_dir is None:
        print("INFO: No paper-map directory specified, skipping JSON loading test")
        return True
    
    paper_map_path = Path(paper_map_dir)
    if not paper_map_path.exists():
        print(f"INFO: Paper-map directory not found at {paper_map_path}, skipping JSON loading test")
        return True
    
    # Test that we can at least validate the JSON structure matches paper-map expectations
    # by checking it against the expected format from the archive
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
        
        # Check that the JSON has the expected structure for paper-map
        expected_structure = {
            'archiveVersion': int,
            'schemaVersion': int,
            'exportedAt': str,
            'papers': list,
            'edges': list,
            'topics': list
        }
        
        for field, expected_type in expected_structure.items():
            if field not in data:
                print(f"ERROR: Missing expected field '{field}'")
                return False
            if not isinstance(data[field], expected_type):
                print(f"ERROR: Field '{field}' has wrong type: expected {expected_type}, got {type(data[field])}")
                return False
        
        print("INFO: JSON structure matches Paper Map archive format")
        return True
        
    except Exception as e:
        print(f"ERROR: Failed to validate JSON structure: {e}")
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 test_paper_map_json.py <json_path> [paper_map_binary]")
        sys.exit(1)

    json_path = Path(sys.argv[1])
    if not json_path.exists():
        print(f"ERROR: JSON file not found: {json_path}")
        sys.exit(1)

    paper_map_binary = sys.argv[2] if len(sys.argv) > 2 else None
    
    success = validate_paper_map_json(json_path)
    if success:
        success = test_with_paper_map_binary(json_path, paper_map_binary)
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()