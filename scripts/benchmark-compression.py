"""Reproducible before/after comparison with the old 0.2 compression algorithm.

Only deterministic synthetic files. Run from the repository with .venv/bin/python.
PDFs and render comparisons stay in .data/qa/compression, never in Git.
"""
from __future__ import annotations
import argparse
import json
import shutil
import sys
import time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'services/api'), str(ROOT / 'services/api/tests')]
from compression_fixtures import create_corpus
from app.compression import compress_pdf
from app.config import Settings
from app.models import ConvertOptions
from pypdf import PdfReader, PdfWriter
import pypdfium2 as pdfium


def old_compress(source, target):
    writer = PdfWriter(clone_from=source)
    for page in writer.pages:
        page.compress_content_streams()
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    writer.write(target); writer.close()
    if target.stat().st_size >= source.stat().st_size:
        shutil.copyfile(source, target)


def render_first(path, output):
    document = pdfium.PdfDocument(path); page = document[0]; bitmap = None
    try:
        bitmap = page.render(scale=1.5)
        bitmap.to_pil().convert('RGB').save(output)
    finally:
        if bitmap is not None: bitmap.close()
        page.close(); document.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args()
    directory = ROOT / '.data/qa/compression'; directory.mkdir(parents=True, exist_ok=True)
    corpus = create_corpus(directory / 'inputs')
    results = []
    for name, source in corpus.items():
        before_text = [page.extract_text() for page in PdfReader(source).pages]
        output = directory / name; output.mkdir(exist_ok=True)
        baseline = output / 'old.pdf'; started = time.monotonic(); old_compress(source, baseline)
        row = {'fixture': name, 'inputBytes': source.stat().st_size, 'oldBytes': baseline.stat().st_size,
            'oldSeconds': round(time.monotonic() - started, 2), 'modes': {}}
        if args.render: render_first(source, output / 'before.png')
        for mode in ('lossless', 'balanced', 'strong'):
            target = output / mode; target.mkdir(exist_ok=True); started = time.monotonic()
            result, warnings = compress_pdf(source, target, ConvertOptions(compression=mode), Settings(), lambda *_: None)
            details = json.loads((target / 'compression.json').read_text())
            details['seconds'] = round(time.monotonic() - started, 2)
            details['textExact'] = before_text == [page.extract_text() for page in PdfReader(result).pages]
            assert details['textExact'], (name, mode, 'Text layer changed')
            assert result.stat().st_size <= source.stat().st_size, (name, mode, 'File grew')
            row['modes'][mode] = details
            if args.render: render_first(result, output / f'{mode}.png')
        results.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    report = {'corpus': 'Deterministic synthetic fixtures, not customer documents', 'results': results}
    (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('Report:', directory / 'report.json')


if __name__ == '__main__':
    main()
