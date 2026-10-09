#!/usr/bin/env python3
"""Combine all Paper Map JSON files into a single combined JSON file."""

import json
import sys
import re
from pathlib import Path


def clean_archive_key(value):
    """Clean archive key to match Paper Map's cleanArchiveKey function."""
    if not value:
        return ""
    
    # Convert to string and normalize
    value = str(value)
    # NFKD normalization and remove diacritics
    import unicodedata
    normalized = unicodedata.normalize('NFKD', value)
    # Remove combining characters
    cleaned = ''.join(c for c in normalized if not unicodedata.combining(c))
    # Replace non-alphanumeric characters with hyphens
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', '-', cleaned)
    # Remove leading/trailing dots and hyphens
    cleaned = re.sub(r'^[.-]+|[.-]+$', '', cleaned)
    # Limit to 80 characters
    return cleaned[:80]


def default_archive_key(paper, index):
    """Generate default archive key based on paper data."""
    author = ""
    if paper and isinstance(paper, dict) and 'authors' in paper and paper['authors']:
        author = str(paper['authors'][0] or "paper").strip().split()[-1]
    if not author:
        author = "paper"
    
    title = ""
    if paper and isinstance(paper, dict) and 'title' in paper and paper['title']:
        title_parts = str(paper['title']).strip().split()[:4]
        title = '-'.join(title_parts)
    
    year = ""
    if paper and isinstance(paper, dict) and 'year' in paper and paper['year']:
        year = str(paper['year'])
    
    parts = [author, year, title]
    key_parts = [part for part in parts if part]
    base_key = '-'.join(key_parts) if key_parts else f"paper-{index + 1}"
    return clean_archive_key(base_key)


def assign_archive_keys(papers):
    """Assign unique archive keys to papers, matching Paper Map's logic."""
    used_keys = set()
    keyed_papers = []
    
    for i, paper_entry in enumerate(papers):
        # Extract the paper object
        if isinstance(paper_entry, dict) and 'paper' in paper_entry:
            paper_data = paper_entry['paper']
            existing_key = paper_entry.get('key', '')
        else:
            paper_data = paper_entry
            existing_key = ''
        
        # Try to use citationKey first, then existing key, then generate default
        base_key = ""
        if isinstance(paper_data, dict):
            citation_key = paper_data.get('citationKey', '')
            if citation_key:
                base_key = clean_archive_key(citation_key)
            elif existing_key:
                base_key = clean_archive_key(existing_key)
        
        if not base_key:
            base_key = default_archive_key(paper_data, i)
        
        # Ensure uniqueness
        key = base_key
        suffix = 2
        while key.lower() in used_keys:
            # Truncate if needed to make room for suffix
            max_base_len = max(1, 78 - len(str(suffix)))
            key = key[:max_base_len] + "-" + str(suffix)
            suffix += 1
        
        used_keys.add(key.lower())
        
        # Create the properly formatted entry
        # Note: The key must already be in cleaned form for Paper Map validation
        if isinstance(paper_data, dict):
            keyed_papers.append({'key': key, 'paper': paper_data})
        else:
            keyed_papers.append({'key': key, 'paper': paper_data})
    
    return keyed_papers


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 combine_paper_map_json.py <papers_dir> <output_dir>")
        sys.exit(1)
    
    papers_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    
    # Collect all papers, edges, and topics from JSON files
    all_papers = []
    all_edges = []
    all_topics = []
    json_files = list(papers_dir.rglob('*.json'))
    
    for json_file in json_files:
        try:
            data = json.loads(json_file.read_text())
            if isinstance(data, dict):
                # Extract papers
                if 'papers' in data:
                    for entry in data['papers']:
                        if isinstance(entry, dict) and 'paper' in entry:
                            all_papers.append(entry['paper'])
                        else:
                            # Direct paper format
                            all_papers.append(entry)
                else:
                    # Single paper format - use directly
                    all_papers.append(data)
                
                # Extract edges
                if 'edges' in data:
                    all_edges.extend(data['edges'])
                
                # Extract topics
                if 'topics' in data:
                    all_topics.extend(data['topics'])
        except (json.JSONDecodeError, Exception) as e:
            print(f"Warning: Could not process {json_file}: {e}")
    
    # Make paper ids unique by adding suffix for duplicates
    # IndexedDB requires unique keys, so we need to ensure all paper ids are unique
    id_counts = {}
    for paper in all_papers:
        paper_id = paper.get('id', '')
        if paper_id:
            id_counts[paper_id] = id_counts.get(paper_id, 0) + 1
    
    # Build mapping of original ids to new unique ids
    id_mapping = {}  # original_id -> new_id
    id_suffixes = {}
    for paper in all_papers:
        paper_id = paper.get('id', '')
        if paper_id and id_counts.get(paper_id, 0) > 1:
            if paper_id not in id_suffixes:
                id_suffixes[paper_id] = 0
            id_suffixes[paper_id] += 1
            if id_suffixes[paper_id] > 1:
                # Add suffix to make id unique
                new_id = f"{paper_id}_{id_suffixes[paper_id]}"
                paper['id'] = new_id
                id_mapping[paper_id] = new_id
            else:
                # First occurrence keeps original id
                id_mapping[paper_id] = paper_id
        else:
            # No duplicates, keep original id
            id_mapping[paper_id] = paper_id
    
    # Update edges to use the new paper ids
    for edge in all_edges:
        if isinstance(edge, dict):
            # Update source if it's in the mapping
            source_id = edge.get('source', '')
            if source_id in id_mapping:
                edge['source'] = id_mapping[source_id]
            
            # Update target if it's in the mapping
            target_id = edge.get('target', '')
            if target_id in id_mapping:
                edge['target'] = id_mapping[target_id]
            
            # Update edge id if it contains paper ids
            edge_id = edge.get('id', '')
            if edge_id:
                for original_id, new_id in id_mapping.items():
                    if original_id in edge_id:
                        edge['id'] = edge_id.replace(original_id, new_id)
    
    # Extract unique topics from papers' keywords and tags
    # Paper Map uses topics for filtering and visualization
    topic_set = set()
    for paper in all_papers:
        # Extract from keywords and add to paper.topics
        if 'keywords' in paper and paper['keywords']:
            paper_topics = []
            for keyword in paper['keywords']:
                if isinstance(keyword, str) and keyword:
                    topic_set.add(keyword)
                    paper_topics.append(keyword)
            # Add keywords as paper topics if paper doesn't have topics yet
            if paper_topics and 'topics' not in paper:
                paper['topics'] = paper_topics
            elif paper_topics and 'topics' in paper:
                # Merge with existing topics
                existing_topics = paper['topics'] if isinstance(paper['topics'], list) else []
                paper['topics'] = list(set(existing_topics + paper_topics))
        
        # Extract from tags (but not report tags)
        if 'tags' in paper and paper['tags']:
            for tag in paper['tags']:
                if isinstance(tag, str) and tag:
                    # Remove report prefix if present
                    if tag.startswith('report:'):
                        continue  # Skip report tags as they're not topics
                    topic_set.add(tag)
                    # Add tag to paper topics
                    if 'topics' not in paper:
                        paper['topics'] = [tag]
                    elif isinstance(paper['topics'], list):
                        if tag not in paper['topics']:
                            paper['topics'].append(tag)
    
    # Convert to list of topic objects with id and name (Paper Map expects 'name' field)
    unique_topics = [{'id': topic, 'name': topic} for topic in sorted(topic_set)]
    
    # Merge with any topics from source files (which may be dicts or strings)
    all_topics_extended = unique_topics.copy()
    for topic in all_topics:
        if isinstance(topic, dict):
            topic_id = topic.get('id')
            if topic_id and topic_id not in topic_set:
                # Ensure topic has 'name' field (Paper Map expects this)
                if 'name' not in topic:
                    topic['name'] = topic.get('label', topic_id)
                all_topics_extended.append(topic)
        elif isinstance(topic, str) and topic not in topic_set:
            all_topics_extended.append({'id': topic, 'name': topic})
    
    # Create combined JSON structure with correct format
    # For direct JSON import, Paper Map expects papers array to contain paper objects directly
    # (not wrapped in {key, paper} objects), because IndexedDB uses paper.id as the key
    combined = {
        'archiveVersion': 3,
        'schemaVersion': 1,
        'exportedAt': '2026-10-09T00:00:00.000Z',
        'papers': all_papers,
        'edges': all_edges,
        'topics': all_topics_extended,
        'meta': {}
    }
    
    # Save combined JSON
    output_path = output_dir / 'papers-paper-map.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(combined, f, indent=2)
    
    print(f"Combined {len(all_papers)} papers into {output_path}")


if __name__ == "__main__":
    main()