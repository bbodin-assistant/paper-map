#!/usr/bin/env python3
"""Combine all Paper Map JSON files into a single combined JSON file."""

import json
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 combine_paper_map_json.py <papers_dir> <output_dir>")
        sys.exit(1)
    
    papers_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    
    # Collect all papers from JSON files
    all_papers = []
    json_files = list(papers_dir.rglob('*.json'))
    
    for json_file in json_files:
        try:
            data = json.loads(json_file.read_text())
            if isinstance(data, dict) and 'papers' in data:
                all_papers.extend(data['papers'])
            else:
                # Single paper format - wrap it
                all_papers.append({'key': json_file.stem, 'paper': data})
        except (json.JSONDecodeError, Exception) as e:
            print(f"Warning: Could not process {json_file}: {e}")
    
    # Create combined JSON structure
    combined = {
        'archiveVersion': 2,
        'schemaVersion': 1,
        'exportedAt': '2026-10-09T00:00:00.000Z',
        'papers': all_papers,
        'edges': [],
        'topics': []
    }
    
    # Save combined JSON
    output_path = output_dir / 'papers-paper-map.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(combined, f, indent=2)
    
    print(f"Combined {len(all_papers)} papers into {output_path}")


if __name__ == "__main__":
    main()