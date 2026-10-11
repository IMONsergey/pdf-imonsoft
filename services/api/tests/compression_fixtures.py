"""Deterministic synthetic documents for compression tests. No customer data."""
from __future__ import annotations
import io
import random
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


def detailed_image(width=2400, height=1500):
    noise = Image.frombytes('L', (width, height), random.Random(41011).randbytes(width * height))
    blurred = noise.filter(ImageFilter.GaussianBlur(.65))
    gradient = Image.linear_gradient('L').resize((width, height))
    red = Image.blend(gradient, blurred, .45)
    green = Image.blend(ImageOps_invert(gradient), blurred, .55)
    blue = ImageChops.offset(blurred, width // 5, height // 3)
    image = Image.merge('RGB', (red, green, blue))
    draw = ImageDraw.Draw(image)
    for index in range(12):
        x = index * width // 12
        draw.rectangle((x, height * .65, x + width // 20, height * .88), fill=(index * 19, 120, 220 - index * 12))
    for item in (noise, blurred, gradient, red, green, blue): item.close()
    return image


def ImageOps_invert(image):
    from PIL import ImageOps
    return ImageOps.invert(image)


def image_pdf(path: Path, *, jpeg=False, transparent=False, nested=False, multiple_sizes=False):
    with detailed_image() as image:
        if transparent:
            alpha = Image.linear_gradient('L').resize(image.size)
            image.putalpha(alpha); alpha.close()
        data = io.BytesIO()
        image.save(data, 'JPEG' if jpeg else 'PNG', **({'quality': 97, 'subsampling': 0} if jpeg else {}))
    data.seek(0)
    pdf = canvas.Canvas(str(path), pagesize=(720, 480))
    pdf.setFillColorRGB(.95, .94, .91); pdf.rect(0, 0, 720, 480, fill=1, stroke=0)
    if nested:
        pdf.beginForm('Inner', 0, 0, 600, 375)
        pdf.drawImage(ImageReader(data), 0, 0, 600, 375, mask='auto')
        pdf.endForm()
        pdf.beginForm('Outer', 0, 0, 600, 375)
        pdf.doForm('Inner'); pdf.endForm()
        pdf.saveState(); pdf.translate(40, 40); pdf.doForm('Outer'); pdf.restoreState()
    else:
        pdf.drawImage(ImageReader(data), 40, 40, 600, 375, mask='auto')
    if multiple_sizes:
        pdf.drawImage(ImageReader(data), 630, 20, 60, 37.5, mask='auto')
    pdf.setFillColorRGB(.03, .05, .08); pdf.setFont('Helvetica', 20)
    pdf.drawString(40, 442, 'Searchable vector text: IMONSOFT 12345')
    pdf.linkURL('https://example.com', (40, 431, 450, 460), relative=0)
    pdf.bookmarkPage('start'); pdf.addOutlineEntry('Compression fixture', 'start')
    pdf.setTitle('Compression fixture title')
    pdf.showPage(); pdf.save()
    return path


def scanned_pdf(path: Path):
    width, height = 2480, 3508
    noise = Image.frombytes('L', (width, height), random.Random(17).randbytes(width * height))
    paper = noise.point(lambda value: 244 + value // 24).convert('RGB'); noise.close()
    draw = ImageDraw.Draw(paper)
    font = ImageFont.load_default(size=44); title = ImageFont.load_default(size=76)
    draw.text((170, 170), 'IMONSOFT / SCANNED DOCUMENT', font=title, fill=(20, 25, 30))
    for index in range(38):
        draw.text((170, 370 + index * 64), f'{index + 1:02d}. Synthetic scan: invoice 12345, amount 987.65. Read this line.', font=font, fill=(30, 30, 30))
    buffer = io.BytesIO(); paper.save(buffer, 'JPEG', quality=98, subsampling=0); paper.close(); buffer.seek(0)
    pdf = canvas.Canvas(str(path), pagesize=(595.28, 841.89))
    pdf.drawImage(ImageReader(buffer), 0, 0, 595.28, 841.89)
    # Existing OCR layer must stay searchable and must not be replaced by a page image.
    text = pdf.beginText(40, 40); text.setFont('Helvetica', 10); text.setTextRenderMode(3)
    text.textLine('Existing OCR layer: invoice 12345 amount 987.65'); pdf.drawText(text)
    pdf.showPage(); pdf.save()
    return path


def vector_pdf(path: Path):
    pdf = canvas.Canvas(str(path), pagesize=(595.28, 841.89), pageCompression=0)
    for page in range(3):
        pdf.setFont('Helvetica', 11)
        for line in range(45):
            pdf.drawString(35, 800 - line * 16, f'Page {page + 1}, row {line + 1}: searchable text without raster pictures.')
        for row in range(80):
            pdf.line(35, 60 + row, 550, 60 + row)
        pdf.showPage()
    pdf.save(); return path


def create_corpus(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    return {
        'lossless-rgb': image_pdf(directory / 'lossless-rgb.pdf'),
        'high-quality-jpeg': image_pdf(directory / 'high-quality-jpeg.pdf', jpeg=True),
        'scan-with-ocr': scanned_pdf(directory / 'scan-with-ocr.pdf'),
        'transparent-form': image_pdf(directory / 'transparent-form.pdf', transparent=True, nested=True),
        'text-and-vectors': vector_pdf(directory / 'text-and-vectors.pdf'),
    }
