#!/usr/bin/env python3
"""Test Paper Map JSON validation using the same logic as the web app."""

import json
import sys
import unicodedata
import re


def clean_archive_key(value):
    """JavaScript cleanArchiveKey function implemented in Python."""
    if not value:
        return ""
    
    value = str(value)
    # NFKD normalization
    normalized = unicodedata.normalize('NFKD', value)
    # Remove combining characters (diacritics)
    cleaned = ''.join(c for c in normalized if not unicodedata.combining(c))
    # Replace non-alphanumeric characters (except . _ -) with hyphens
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', '-', cleaned)
    # Remove leading/trailing dots and hyphens
    cleaned = re.sub(r'^[.-]+|[.-]+$', '', cleaned)
    # Limit to 80 characters
    return cleaned[:80]


def validate_archive_payload(payload, expected_version):
    """Validate archive payload using Paper Map's validation logic."""
    if not payload or int(payload.get('archiveVersion', 0)) != expected_version or not isinstance(payload.get('papers'), list):
        raise ValueError("Paper Map archive metadata has an unsupported structure.")
    
    if (not isinstance(payload.get('edges'), list) or 
        not isinstance(payload.get('topics'), list) or 
        'meta' not in payload or 
        not isinstance(payload.get('meta'), dict)):
        raise ValueError("Paper Map archive metadata is missing database collections.")
    
    key_set = set()
    for i, item in enumerate(payload.get('papers', [])):
        key = clean_archive_key(item.get('key', ''))
        item_key = item.get('key', '')
        paper = item.get('paper')
        
        if not key or key != item_key or not paper or not isinstance(paper, dict):
            print(f"FAIL: Paper {i} with key '{item_key}' fails validation:")
            print(f"  clean_archive_key('{item_key}') = '{key}'")
            print(f"  key == clean_archive_key(key): {key == item_key}")
            print(f"  has paper: {paper is not None}")
            print(f"  paper is dict: {isinstance(paper, dict)}")
            raise ValueError("Paper Map archive contains an invalid citation key.")
        
        if key.lower() in key_set:
            raise ValueError("Paper Map archive contains duplicate citation keys.")
        
        key_set.add(key.lower())
    
    return payload


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 test_paper_map_validation.py <json-file>")
        sys.exit(1)
    
    json_file = sys.argv[1]
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            payload = json.load(f)
        
        print(f"Testing {json_file}...")
        print(f"Archive version: {payload.get('archiveVersion')}")
        print(f"Schema version: {payload.get('schemaVersion')}")
        print(f"Number of papers: {len(payload.get('papers', []))}")
        print(f"Has meta: {'meta' in payload}")
        print(f"Has edges: {isinstance(payload.get('edges'), list)}")
        print(f"Has topics: {isinstance(payload.get('topics'), list)}")
        
        # Test with the actual version
        version = int(payload.get('archiveVersion', 0))
        if version not in [1, 2, 3]:
            print(f"Unsupported archive version: {version}")
            sys.exit(1)
        
        validate_archive_payload(payload, version)
        print("✅ JSON validation passed!")
        
    except Exception as e:
        print(f"❌ Validation failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()