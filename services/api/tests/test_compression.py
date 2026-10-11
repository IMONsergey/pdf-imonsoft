import io
import json
import hashlib
import zipfile
from pathlib import Path

import pikepdf
import pytest
from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader, PdfWriter
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from app.compression import compress_pdf, scan_placements
from app.models import ConvertOptions, ConversionError
from app.pipeline import execute
from app.main import create_app
from compression_fixtures import image_pdf, vector_pdf
from test_api import HEADERS, wait_for_job


@pytest.fixture(scope='module')
def heavy_pdf(tmp_path_factory):
    return image_pdf(tmp_path_factory.mktemp('compression') / 'heavy.pdf', jpeg=True, nested=True, multiple_sizes=True)


def run(source, directory, settings, **kwargs):
    directory.mkdir(parents=True, exist_ok=True)
    output, warnings = compress_pdf(source, directory, ConvertOptions(**kwargs), settings, lambda *_: None)
    report = json.loads((directory / 'compression.json').read_text())
    assert output.stat().st_size == report['outputBytes']
    assert report['inputBytes'] == source.stat().st_size
    assert output.stat().st_size <= source.stat().st_size
    return output, report, warnings


def rendered(path, password=''):
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(path, password=password or None); page = doc[0]; bitmap = None
    try:
        bitmap = page.render(scale=1.5)
        return bitmap.to_pil().convert('RGB').copy()
    finally:
        if bitmap: bitmap.close()
        page.close(); doc.close()


def test_balanced_and_strong_actually_reduce_heavy_images(heavy_pdf, tmp_path, settings):
    digest = hashlib.sha256(heavy_pdf.read_bytes()).digest()
    balanced, a, _ = run(heavy_pdf, tmp_path/'balanced', settings)
    strong, b, _ = run(heavy_pdf, tmp_path/'strong', settings, compression='strong')
    assert balanced.stat().st_size < heavy_pdf.stat().st_size * .5
    assert strong.stat().st_size < balanced.stat().st_size
    assert a['imagesDownsampled'] >= 1 and a['imagesOptimized'] >= 1 and a['lossyApplied']
    before = PdfReader(heavy_pdf); after = PdfReader(balanced)
    assert [p.extract_text() for p in before.pages] == [p.extract_text() for p in after.pages]
    assert len(after.pages[0].get('/Annots')) == len(before.pages[0].get('/Annots'))
    assert after.metadata.title == before.metadata.title
    assert len(after.outline) == len(before.outline)
    assert hashlib.sha256(heavy_pdf.read_bytes()).digest() == digest


def test_shared_image_uses_largest_form_placement(heavy_pdf, tmp_path, settings):
    with pikepdf.open(heavy_pdf) as pdf:
        scan = scan_placements(pdf)
        assert not scan.uncertain and len(scan.sizes) == 1
        assert next(iter(scan.sizes.values())) == pytest.approx((600, 375))
    output, report, _ = run(heavy_pdf, tmp_path/'result', settings)
    with pikepdf.open(output) as pdf:
        images = [obj for obj in pdf.objects if isinstance(obj, pikepdf.Stream) and obj.get('/Subtype') == pikepdf.Name.Image]
        assert len(images) == 1
        assert int(images[0].Width) >= 1333 and int(images[0].Height) >= 833


def test_lossless_keeps_render_and_image_samples(tmp_path, settings):
    source = image_pdf(tmp_path/'original.pdf', transparent=True)
    output, report, _ = run(source, tmp_path/'lossless', settings, compression='lossless')
    assert not report['lossyApplied'] and report['imagesDownsampled'] == 0
    before, after = rendered(source), rendered(output)
    try:
        assert before.size == after.size and ImageChops.difference(before, after).getbbox() is None
    finally:
        before.close(); after.close()


def test_soft_mask_remains_transparent_and_aligned(tmp_path, settings):
    source = image_pdf(tmp_path/'alpha.pdf', transparent=True, nested=True)
    output, report, _ = run(source, tmp_path/'balanced', settings)
    assert report['imagesDownsampled'] == 1
    with pikepdf.open(output) as pdf:
        images = [obj for obj in pdf.objects if isinstance(obj, pikepdf.Stream) and '/SMask' in obj]
        assert images
        assert images[0].Width == images[0].SMask.Width and images[0].Height == images[0].SMask.Height
    before, after = rendered(source), rendered(output)
    try:
        assert before.getpixel((20, 300)) == after.getpixel((20, 300))  # Untouched page background.
        # No black/white flattening of the transparent region; compare low-frequency composition.
        a=before.resize((60,40)); b=after.resize((60,40))
        assert max(ImageStat.Stat(ImageChops.difference(a,b)).mean) < 4
        a.close(); b.close()
    finally:
        before.close(); after.close()


def test_encrypted_input_stays_encrypted(heavy_pdf, tmp_path, settings):
    source = tmp_path/'encrypted.pdf'
    writer = PdfWriter(clone_from=heavy_pdf); writer.encrypt('compression-password-123', algorithm='AES-256'); writer.write(source); writer.close()
    output, report, _ = run(source, tmp_path/'result', settings, password='compression-password-123')
    assert report['encryptionPreserved']
    reader = PdfReader(output); assert reader.is_encrypted
    assert not reader.decrypt('wrong') and reader.decrypt('compression-password-123')
    assert 'Searchable vector text' in reader.pages[0].extract_text()
    with pytest.raises(ConversionError): run(source, tmp_path/'wrong', settings, password='wrong')


def test_repeated_compression_does_not_degrade_same_jpeg(heavy_pdf, tmp_path, settings):
    first, _, _ = run(heavy_pdf, tmp_path/'first', settings)
    second, report, _ = run(first, tmp_path/'second', settings)
    assert report['imagesDownsampled'] == 0 and report['jpegReencoded'] == 0
    assert report['unchanged']
    assert first.read_bytes() == second.read_bytes()


def test_special_colors_and_inverted_samples_not_guessed(heavy_pdf, tmp_path, settings):
    source = tmp_path/'profile.pdf'
    with pikepdf.open(heavy_pdf) as pdf:
        image = next(obj for obj in pdf.objects if isinstance(obj,pikepdf.Stream) and obj.get('/Subtype')==pikepdf.Name.Image)
        image.Decode = pikepdf.Array([1,0,1,0,1,0]); pdf.save(source)
    output, report, _ = run(source, tmp_path/'output', settings)
    assert report['imagesOptimized'] == 0
    assert report['skipReasons'].get('special-mask-or-decode') == 1
    a,b = rendered(source),rendered(output)
    try: assert ImageChops.difference(a,b).getbbox() is None
    finally: a.close(); b.close()


def test_vector_text_uses_only_structural_compression(tmp_path, settings):
    source = vector_pdf(tmp_path/'text.pdf')
    output, report, warnings = run(source, tmp_path/'result', settings)
    assert report['imagesFound'] == 0 and not report['lossyApplied']
    assert report['imagesOptimized'] == 0 and warnings
    assert [p.extract_text() for p in PdfReader(source).pages] == [p.extract_text() for p in PdfReader(output).pages]
    a,b = rendered(source),rendered(output)
    try: assert ImageChops.difference(a,b).getbbox() is None
    finally: a.close(); b.close()


def test_custom_profile_and_postprocess_use_same_compressor(heavy_pdf, tmp_path, settings, sample_image):
    _, report, _ = run(heavy_pdf,tmp_path/'custom',settings,compression='custom',compression_dpi=300,compression_quality=92)
    assert report['targetDpi']==300 and report['jpegQuality']==92
    output, _, _ = execute('images-to-pdf',[sample_image],['photo.png'],tmp_path/'pipeline',
        ConvertOptions(postprocess='compress',compression='lossless'),settings,lambda *_:None)
    details=json.loads((output.parent/'details.json').read_text())
    assert details['compression']['mode']=='lossless'


def test_batch_report_contains_per_file_compression(sample_pdf, tmp_path, settings):
    output, _, summary = execute('compress-pdf',[sample_pdf,sample_pdf],['one.pdf','two.pdf'],
        tmp_path/'batch',ConvertOptions(batch=True),settings,lambda *_:None)
    assert summary['processed']==2
    with zipfile.ZipFile(output) as archive:
        report=json.loads(archive.read('report.json'))
        assert all(item['details']['compression']['inputBytes']==sample_pdf.stat().st_size for item in report['files'])
        assert all(item['details']['compression']['outputBytes']>0 for item in report['files'])


def test_job_api_exposes_real_compression_details(sample_pdf, settings):
    with TestClient(create_app(settings)) as client:
        response=client.post('/api/v1/jobs',headers=HEADERS,data={'tool':'compress-pdf','options':json.dumps({'compression':'balanced'})},files={'files':('report.pdf',sample_pdf.read_bytes())})
        assert response.status_code==202,response.text
        job=wait_for_job(client,response.json()['id'])
        assert job['state']=='done',job
        info=job['details']['compression']
        assert info['outputBytes']==job['outputSize']
        assert info['inputBytes']==job['inputSize']
        assert 'password' not in json.dumps(info)
        response=client.post('/api/v1/jobs',headers=HEADERS,data={'tool':'compress-pdf','options':'{"compression_dpi":9999}'},files={'files':('report.pdf',sample_pdf.read_bytes())})
        assert response.status_code==422


def test_rgb_icc_profile_is_preserved_not_replaced(heavy_pdf, tmp_path, settings):
    from PIL import ImageCms
    profile_data = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    source = tmp_path/'icc.pdf'
    with pikepdf.open(heavy_pdf) as pdf:
        profile = pdf.make_stream(profile_data); profile.N = 3; profile.Alternate = pikepdf.Name.DeviceRGB
        image = next(obj for obj in pdf.objects if isinstance(obj,pikepdf.Stream) and obj.get('/Subtype')==pikepdf.Name.Image)
        image.ColorSpace = pikepdf.Array([pikepdf.Name.ICCBased, profile]); pdf.save(source)
    output, report, _ = run(source, tmp_path/'compressed', settings)
    assert report['imagesOptimized'] == 1
    with pikepdf.open(output) as pdf:
        image = next(obj for obj in pdf.objects if isinstance(obj,pikepdf.Stream) and obj.get('/Subtype')==pikepdf.Name.Image)
        assert str(image.ColorSpace[0]) == '/ICCBased'
        assert image.ColorSpace[1].read_bytes() == profile_data
    a,b = rendered(source),rendered(output)
    try:
        small_a=a.resize((60,40)); small_b=b.resize((60,40))
        assert max(ImageStat.Stat(ImageChops.difference(small_a,small_b)).mean) < 4
        small_a.close(); small_b.close()
    finally: a.close(); b.close()


def test_large_inline_image_is_compressed_as_an_xobject(tmp_path, settings):
    from compression_fixtures import detailed_image
    source = tmp_path/'inline.pdf'
    pdf = canvas.Canvas(str(source), pagesize=(720,480))
    with detailed_image() as image:
        pdf.drawInlineImage(image,40,40,600,375)
    pdf.drawString(40,440,'Inline fixture text remains searchable')
    pdf.showPage(); pdf.save()
    output, report, _ = run(source,tmp_path/'output',settings)
    assert report['imagesOptimized']==1 and report['imagesDownsampled']==1
    assert output.stat().st_size < source.stat().st_size * .5
    # pypdf's ASCII85 inline extractor rejects this valid large ReportLab stream.
    # Use the renderer's text extraction on BOTH original and result, not a weaker assertion.
    import pypdfium2 as pdfium
    texts=[]
    for path in (source,output):
        doc=pdfium.PdfDocument(path); page=doc[0]; text=page.get_textpage()
        try: texts.append(text.get_text_range())
        finally: text.close(); page.close(); doc.close()
    assert texts[0] == texts[1] and 'Inline fixture text remains searchable' in texts[1]


def test_one_bit_and_cmyk_images_are_not_lossy_reencoded(tmp_path, settings):
    import random
    source = tmp_path/'special.pdf'
    pdf = pikepdf.Pdf.new(); page = pdf.add_blank_page(page_size=(400,400))
    bits = pdf.make_stream(random.Random(41).randbytes(256*256//8))
    bits.Type=pikepdf.Name.XObject; bits.Subtype=pikepdf.Name.Image
    bits.Width=256; bits.Height=256; bits.BitsPerComponent=1; bits.ColorSpace=pikepdf.Name.DeviceGray
    cmyk = pdf.make_stream(random.Random(42).randbytes(96*96*4))
    cmyk.Type=pikepdf.Name.XObject; cmyk.Subtype=pikepdf.Name.Image
    cmyk.Width=96; cmyk.Height=96; cmyk.BitsPerComponent=8; cmyk.ColorSpace=pikepdf.Name.DeviceCMYK
    page.Resources=pikepdf.Dictionary(XObject=pikepdf.Dictionary(Bitonal=bits,CMYK=cmyk))
    page.Contents=pdf.make_stream(b'q 190 0 0 190 0 0 cm /Bitonal Do Q q 190 0 0 190 200 200 cm /CMYK Do Q')
    pdf.save(source); pdf.close()
    output, report, _=run(source,tmp_path/'output',settings,compression='strong')
    assert report['imagesOptimized']==0
    assert report['skipReasons'].get('special-color-or-bitdepth')==2
    a,b=rendered(source),rendered(output)
    try: assert ImageChops.difference(a,b).getbbox() is None
    finally: a.close(); b.close()
