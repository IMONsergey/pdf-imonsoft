"""Additional bounded converters. No paid APIs or AGPL wrappers."""
from __future__ import annotations
import json
import re
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import RectangleObject
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from .config import Settings
from .models import ConversionError, ConvertOptions
from .pages import parse_pages

EXTRA_TOOLS = {'organize-pdf', 'crop-pdf', 'pdf-to-docx', 'pdf-to-markdown', 'pdf-extract-images', 'flatten-pdf', 'pdf-info'}


def safe_text(text: str) -> str:
    # XML 1.0 cannot store arbitrary controls extracted from an untrusted PDF.
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]', '', text)


def convert_extra(tool: str, path: Path, outdir: Path, options: ConvertOptions, settings: Settings, progress):
    from .engines import reader_for, write_pdf, render_pages, make_zip
    reader = reader_for(path, options, settings)
    indexes = parse_pages(options.pages, len(reader.pages))
    writer = PdfWriter()
    output = outdir / 'result.pdf'
    if tool == 'organize-pdf':
        plan = options.page_plan
        if not plan or len(plan) > settings.max_pages:
            raise ConversionError('Оставьте хотя бы одну страницу в пределах лимита сервера.')
        if len({item.page for item in plan}) != len(plan):
            raise ConversionError('Страница не должна повторяться в плане.')
        for item in plan:
            if item.page > len(reader.pages):
                raise ConversionError('Номер страницы выходит за пределы документа.')
            page = writer.add_page(reader.pages[item.page - 1])
            if item.rotation:
                page.rotate(item.rotation)
        return write_pdf(writer, output), []
    if tool == 'crop-pdf':
        chosen = set(indexes)
        for index, source in enumerate(reader.pages):
            page = writer.add_page(source)
            if index not in chosen:
                continue
            page.transfer_rotation_to_content()
            box = page.cropbox
            l, b, r, t = map(float, box)
            width, height = r - l, t - b
            if width <= 0 or height <= 0:
                raise ConversionError('Некорректный размер страницы.')
            page.cropbox = RectangleObject((l + width * options.crop_left / 100,
                b + height * options.crop_bottom / 100,
                r - width * options.crop_right / 100,
                t - height * options.crop_top / 100))
        return write_pdf(writer, output), ['Обрезка меняет видимую область. Скрытое за полями содержимое остаётся в PDF и может быть восстановлено.']
    if tool in ('pdf-to-docx', 'pdf-to-markdown'):
        texts = []
        characters = 0
        for i, index in enumerate(indexes):
            text = safe_text(reader.pages[index].extract_text() or '').strip()
            characters += len(text)
            if characters > 2_000_000:
                raise ConversionError('В документе слишком много текста для одной задачи. Выберите часть страниц.')
            texts.append((index, text))
            progress(10 + round(70 * (i + 1) / len(indexes)), f'Текст страницы {index + 1}')
        if not any(text for _, text in texts):
            raise ConversionError('Текстовый слой не найден. Для скана сначала выполните OCR.')
        warnings = ['Экспортирован текстовый слой. Вёрстка, изображения, колонки и структура таблиц не восстановлены.']
        if any(not text for _, text in texts):
            warnings.append('Некоторые страницы не содержат текста; для них оставлены пустые разделы.')
        if tool == 'pdf-to-docx':
            from docx import Document
            from docx.shared import Pt, Cm
            document = Document()
            normal = document.styles['Normal']
            normal.font.name, normal.font.size = 'Arial', Pt(11)
            normal.paragraph_format.space_after = Pt(6)
            for section in document.sections:
                section.top_margin = section.bottom_margin = Cm(2)
                section.left_margin = section.right_margin = Cm(2)
            document.core_properties.title = 'Text exported from PDF'
            document.core_properties.author = ''
            document.core_properties.last_modified_by = ''
            for i, (_, text) in enumerate(texts):
                if i:
                    document.add_page_break()
                for paragraph in re.split(r'\n\s*\n', text):
                    document.add_paragraph(paragraph)
            target = outdir / 'result.docx'
            document.save(target)
        else:
            # Escape Markdown controls so extracted document text is not executable markup.
            def escape(text):
                return re.sub(r'([\\`*_{}\[\]()<>#!|~])', r'\\\1', text)
            target = outdir / 'result.md'
            target.write_text('\n\n'.join(f'## Страница {index + 1}\n\n{escape(text)}' for index, text in texts), encoding='utf-8')
        return target, warnings
    if tool == 'pdf-extract-images':
        files, total = [], 0
        for index in indexes:
            for position, image in enumerate(reader.pages[index].images):
                if len(files) >= 2000:
                    raise ConversionError('Слишком много встроенных изображений. Выберите часть страниц.')
                extension = Path(image.name).suffix.lower()
                if extension not in ('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.jp2', '.jpx', '.bmp'):
                    extension = '.bin'
                data = image.data
                total += len(data)
                if total > settings.max_output_mb * 1024 * 1024:
                    raise ConversionError('Изображения превышают лимит размера результата.')
                file = outdir / f'page-{index + 1:03d}-image-{position + 1:03d}{extension}'
                file.write_bytes(data)
                files.append(file)
            progress(10 + round(75 * (indexes.index(index) + 1) / len(indexes)), f'Изображения страницы {index + 1}')
        if not files:
            raise ConversionError('Встроенные растровые изображения не найдены. Для снимков страниц используйте PDF → PNG.')
        return make_zip(files, outdir / 'images.zip'), ['Извлечены встроенные растровые изображения, не векторная графика. Маски и эффекты могут отличаться от вида страницы.']
    if tool == 'flatten-pdf':
        document = canvas.Canvas(str(output))
        for image, (width, height) in render_pages(path, indexes, options.dpi, options.password, progress):
            try:
                document.setPageSize((width, height))
                document.drawImage(ImageReader(image), 0, 0, width, height)
                document.showPage()
            finally:
                image.close()
        document.save()
        return output, ['Страницы превращены в изображения. Текстовый слой, векторы, формы, ссылки и цифровые подписи не сохраняются.']
    if tool == 'pdf-info':
        pages = []
        for i, page in enumerate(reader.pages):
            resources = page.get('/Resources', {})
            resources = (resources.get_object() if hasattr(resources, 'get_object') else resources) or {}
            font_resources = resources.get('/Font', {})
            font_resources = (font_resources.get_object() if hasattr(font_resources, 'get_object') else font_resources) or {}
            fonts = []
            for font in font_resources.values():
                definition = font.get_object()
                fonts.append(str(definition.get('/BaseFont', 'Unknown'))[:200])
            annotations = page.get('/Annots', [])
            annotations = (annotations.get_object() if hasattr(annotations, 'get_object') else annotations) or []
            pages.append({'page': i + 1, 'mediaBox': list(map(float, page.mediabox)),
                'cropBox': list(map(float, page.cropbox)), 'rotation': page.rotation,
                'fonts': sorted(set(fonts)), 'annotations': len(annotations)})
        target = outdir / 'report.json'
        target.write_text(json.dumps({'pageCount': len(pages), 'encrypted': reader.is_encrypted,
            'metadata': {str(k)[:200]: str(v)[:10000] for k, v in (reader.metadata or {}).items()},
            'pages': pages, 'notice': 'Диагностика структуры; не проверка PDF/A, PDF/UA или цифровой подписи.'}, ensure_ascii=False, indent=2), encoding='utf-8')
        return target, ['Отчёт содержит исходные метаданные документа. Учитывайте это при передаче третьим лицам.']
    raise ConversionError('Неизвестная операция.')
