#!/usr/bin/env python3
"""
Create a Paper Map ZIP archive containing metadata.json and all PDFs.

Paper Map expects:
- metadata.json with archiveVersion: 3
- papers array with {key, paper} format
- PDFs in the ZIP with filenames matching paper.key
"""

import json
import zipfile
from pathlib import Path
import unicodedata
import re


def clean_archive_key(value):
    """Clean archive key to match Paper Map's cleanArchiveKey function."""
    if not value:
        return ""
    value = str(value)
    normalized = unicodedata.normalize('NFKD', value)
    cleaned = ''.join(c for c in normalized if not unicodedata.combining(c))
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', '-', cleaned)
    cleaned = re.sub(r'^[.-]+|[.-]+$', '', cleaned)
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


def generate_zip(papers_dir, json_file, output_zip):
    """Generate Paper Map ZIP archive."""
    papers_dir = Path(papers_dir)
    json_file = Path(json_file)
    output_zip = Path(output_zip)
    
    # Load the combined JSON
    with open(json_file, 'r') as f:
        data = json.load(f)
    
    # Collect all PDF files
    pdf_files = list(papers_dir.rglob('*.pdf'))
    
    # Track duplicate filenames
    filename_occurrences = {}
    for pdf_file in pdf_files:
        filename = pdf_file.name
        if filename not in filename_occurrences:
            filename_occurrences[filename] = []
        filename_occurrences[filename].append(pdf_file)
    
    # For each PDF, determine its arcname in the ZIP
    # For duplicates, add suffix like _2, _3, etc.
    # Also clean the filename to match Paper Map's key format
    pdf_to_arcname = {}
    for pdf_file in pdf_files:
        filename = pdf_file.name
        if filename in filename_occurrences and len(filename_occurrences[filename]) > 1:
            # Duplicate filename
            occurrences = filename_occurrences[filename]
            index = occurrences.index(pdf_file)
            if index == 0:
                stem = pdf_file.stem
                ext = pdf_file.suffix
                # Clean the stem for the first occurrence
                cleaned_stem = clean_archive_key(stem)
                arcname = f"{cleaned_stem}{ext}"
            else:
                stem = pdf_file.stem
                ext = pdf_file.suffix
                cleaned_stem = clean_archive_key(stem)
                arcname = f"{cleaned_stem}_{index + 1}{ext}"
        else:
            # Clean the filename for non-duplicates
            stem = pdf_file.stem
            ext = pdf_file.suffix
            cleaned_stem = clean_archive_key(stem)
            arcname = f"{cleaned_stem}{ext}"
        pdf_to_arcname[pdf_file] = arcname
    
    # Build mapping from PDF stem to list of (pdf_file, arcname) pairs
    pdf_stem_to_files = {}
    for pdf_file in pdf_files:
        stem = pdf_file.stem
        arcname = pdf_to_arcname[pdf_file]
        if stem not in pdf_stem_to_files:
            pdf_stem_to_files[stem] = []
        pdf_stem_to_files[stem].append((pdf_file, arcname))
    
    def find_matching_pdf(paper):
        """Find a PDF file that matches this paper."""
        citation_key = paper.get('citationKey', '')
        paper_id = paper.get('id', '')
        
        # Try exact citationKey match
        if citation_key and citation_key in pdf_stem_to_files:
            for pdf_file, arcname in pdf_stem_to_files[citation_key]:
                if pdf_file not in pdf_assigned:
                    return pdf_file, arcname
        
        # Try citationKey without numeric suffix (e.g., Roumage2025b-3 -> Roumage2025b)
        if citation_key:
            import re
            base_key = re.sub(r'-?\d+$', '', citation_key)
            if base_key and base_key in pdf_stem_to_files:
                for pdf_file, arcname in pdf_stem_to_files[base_key]:
                    if pdf_file not in pdf_assigned:
                        return pdf_file, arcname
        
        # Try extracting filename from id (e.g., pdf:papers-dataflow-roumage2025b.pdf)
        if paper_id and paper_id.startswith('pdf:'):
            pdf_path = paper_id[4:]  # Remove 'pdf:' prefix
            pdf_filename = Path(pdf_path).name
            pdf_stem = Path(pdf_filename).stem
            if pdf_stem in pdf_stem_to_files:
                for pdf_file, arcname in pdf_stem_to_files[pdf_stem]:
                    if pdf_file not in pdf_assigned:
                        return pdf_file, arcname
        
        # Try matching PDF stems that contain the citationKey
        if citation_key:
            for pdf_stem, files in pdf_stem_to_files.items():
                if citation_key.lower() in pdf_stem.lower():
                    for pdf_file, arcname in files:
                        if pdf_file not in pdf_assigned:
                            return pdf_file, arcname
        
        # Try matching by paper id (e.g., doi:10.6028/nist.sp.500-325 -> NIST.SP.500-325)
        if paper_id:
            import re
            # Extract potential filename from various id formats
            id_lower = paper_id.lower()
            for pdf_stem, files in pdf_stem_to_files.items():
                pdf_stem_lower = pdf_stem.lower()
                # Check if id contains the pdf stem or vice versa
                if id_lower in pdf_stem_lower or pdf_stem_lower in id_lower:
                    for pdf_file, arcname in files:
                        if pdf_file not in pdf_assigned:
                            return pdf_file, arcname
        
        return None, None
    
    # Create {key, paper} format for archive
    # Each paper with a matching PDF gets the PDF's arcname (without extension) as key
    keyed_papers = []
    used_keys = set()
    papers_with_pdf = set()
    
    # Track which PDFs have been assigned to papers
    pdf_assigned = set()
    
    for i, paper in enumerate(data['papers']):
        citation_key = paper.get('citationKey', '')
        
        # Find matching PDF
        pdf_file, arcname = find_matching_pdf(paper)
        
        if pdf_file and arcname:
            # Use the PDF's arcname (without extension) as key
            key = arcname.rsplit('.', 1)[0] if '.' in arcname else arcname
            papers_with_pdf.add(citation_key)
            pdf_assigned.add(pdf_file)
        else:
            # No PDF for this paper, use citationKey or generate
            if citation_key:
                key = clean_archive_key(citation_key)
            else:
                key = default_archive_key(paper, i)
        
        # Ensure uniqueness for papers without PDFs
        original_key = key
        suffix = 2
        while key.lower() in used_keys:
            max_base_len = max(1, 78 - len(str(suffix)))
            key = key[:max_base_len] + "-" + str(suffix)
            suffix += 1
        
        used_keys.add(key.lower())
        keyed_papers.append({'key': key, 'paper': paper})
    
    # Create archive payload
    payload = {
        'archiveVersion': 3,
        'schemaVersion': 1,
        'exportedAt': '2026-10-09T00:00:00.000Z',
        'papers': keyed_papers,
        'edges': data.get('edges', []),
        'topics': data.get('topics', []),
        'meta': data.get('meta', {})
    }
    
    # Create ZIP file
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Add metadata.json
        metadata_json = json.dumps(payload, indent=2)
        zipf.writestr('metadata.json', metadata_json)
        
        # Add only PDFs that were assigned to papers
        assigned_pdfs = [f for f in pdf_assigned if f in pdf_to_arcname]
        print(f"Adding {len(assigned_pdfs)} PDF files to ZIP...")
        for pdf_file in assigned_pdfs:
            arcname = pdf_to_arcname[pdf_file]
            zipf.write(pdf_file, arcname)
            print(f"  Added: {arcname}")
        
        # Warn about unassigned PDFs
        unassigned_pdfs = [f for f in pdf_files if f not in pdf_assigned]
        if unassigned_pdfs:
            print(f"\nWarning: {len(unassigned_pdfs)} PDFs without matching papers (not included in ZIP):")
            for pdf_file in unassigned_pdfs:
                print(f"  - {pdf_file.name}")
    
    # Count duplicates
    duplicate_count = sum(1 for k, v in filename_occurrences.items() if len(v) > 1)
    
    print(f"\nCreated Paper Map ZIP archive: {output_zip}")
    print(f"  Papers: {len(keyed_papers)}")
    print(f"  Papers with matching PDFs: {len(papers_with_pdf)}")
    print(f"  Edges: {len(payload['edges'])}")
    print(f"  Topics: {len(payload['topics'])}")
    print(f"  PDFs in ZIP: {len(assigned_pdfs)}")
    print(f"  Total PDFs found: {len(pdf_files)}")
    if duplicate_count > 0:
        print(f"  Duplicate filenames resolved: {duplicate_count}")


if __name__ == '__main__':
    import sys
    if len(sys.argv) < 4:
        print("Usage: python3 create_paper_map_zip.py <papers_dir> <json_file> <output_zip>")
        sys.exit(1)
    
    papers_dir = sys.argv[1]
    json_file = sys.argv[2]
    output_zip = sys.argv[3]
    
    generate_zip(papers_dir, json_file, output_zip)
