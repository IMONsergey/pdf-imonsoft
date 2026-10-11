"""PDF compression without rendering whole pages: QPDF structure + bounded image edits.

Text, drawing commands, forms and links are not rasterized. Unsupported colour/mask
semantics are preserved, never guessed. The smallest valid result wins; the input is
never modified. All parsing runs inside the existing killable conversion worker.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import shutil
import struct
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import pikepdf
from PIL import Image
from .config import Settings
from .models import ConversionError, ConvertOptions

REPORT_NAME = 'compression.json'
PRESETS = {'balanced': (160, 82), 'strong': (96, 60), 'lossless': (0, 100)}
IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
MAX_IMAGE_PIXELS = 32_000_000
MAX_TOTAL_PIXELS = 250_000_000


@dataclass
class PlacementScan:
    sizes: dict[tuple[int, int], tuple[float, float]] = field(default_factory=dict)
    uncertain: bool = False
    operations: int = 0
    inline: int = 0


def compose(left, right):
    """Column-vector PDF transform: existing CTM multiplied by a local matrix."""
    a, b, c, d, e, f = left
    x, y, z, w, u, v = map(float, right)
    result = (a*x+c*y, b*x+d*y, a*z+c*w, b*z+d*w, a*u+c*v+e, b*u+d*v+f)
    if not all(math.isfinite(value) and abs(value) <= 1e12 for value in result):
        raise ValueError('Invalid transform')
    return result


def scan_placements(pdf) -> PlacementScan:
    scan = PlacementScan()

    def walk(container, resources, ctm, ancestors):
        if len(ancestors) > 24:
            raise ValueError('Form nesting limit')
        stack = []
        for instruction in pikepdf.parse_content_stream(container, operators='q Q cm Do BI ID EI'):
            scan.operations += 1
            if scan.operations > 250_000:
                raise ValueError('Content operation limit')
            args, operation = instruction
            op = str(operation)
            if op == 'q':
                if len(stack) >= 128:
                    raise ValueError('Graphics stack limit')
                stack.append(ctm)
            elif op == 'Q':
                if not stack:
                    raise ValueError('Unbalanced graphics stack')
                ctm = stack.pop()
            elif op == 'cm':
                if len(args) != 6:
                    raise ValueError('Invalid matrix')
                ctm = compose(ctm, args)
            elif op == 'Do':
                if len(args) != 1:
                    raise ValueError('Invalid XObject invocation')
                xobjects = resources.get('/XObject', {})
                obj = xobjects.get(str(args[0]))
                if obj is None:
                    raise ValueError('Missing resource')
                subtype = obj.get('/Subtype')
                if subtype == pikepdf.Name.Image:
                    width, height = math.hypot(ctm[0], ctm[1]), math.hypot(ctm[2], ctm[3])
                    if not (width > 0 and height > 0):
                        continue
                    previous = scan.sizes.get(obj.objgen, (0.0, 0.0))
                    scan.sizes[obj.objgen] = (max(previous[0], width), max(previous[1], height))
                elif subtype == pikepdf.Name.Form:
                    key = obj.objgen
                    if key in ancestors:
                        raise ValueError('Recursive Form')
                    walk(obj, obj.get('/Resources', resources), compose(ctm, obj.get('/Matrix', IDENTITY)), ancestors | {key})
            elif op == 'INLINE IMAGE':
                scan.inline += 1
        if stack:
            raise ValueError('Unbalanced graphics stack')

    for page in pdf.pages:
        try:
            unit = float(page.obj.get('/UserUnit', 1))
            if not math.isfinite(unit) or not 0 < unit <= 75000:
                raise ValueError('Invalid page unit')
            walk(page, page.resources, (unit, 0, 0, unit, 0, 0), set())
        except (pikepdf.PdfError, TypeError, ValueError, KeyError, AttributeError, RuntimeError):
            # A shared image could be used at a larger unknown size: do not downsample.
            scan.uncertain = True
    return scan


def protected_images(pdf) -> set[tuple[int, int]]:
    """Do not change images in contexts whose physical scale was not interpreted."""
    roots = []
    protected = set()
    for obj in pdf.objects:
        if not isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream)):
            continue
        for key in ('/AP', '/CharProcs', '/Pattern'):
            if key in obj:
                roots.append(obj[key])
        mask = obj.get('/SMask')
        if isinstance(mask, pikepdf.Dictionary):
            roots.append(mask)  # Graphics-state transparency group.
        elif isinstance(mask, pikepdf.Stream):
            protected.add(mask.objgen)  # A mask is not an independent colour image.
        explicit_mask = obj.get('/Mask')
        if isinstance(explicit_mask, pikepdf.Stream):
            protected.add(explicit_mask.objgen)
    visited = set()
    steps = 0
    while roots:
        obj = roots.pop(); steps += 1
        if steps > 50000:
            return {item.objgen for item in pdf.objects if isinstance(item, pikepdf.Stream) and item.get('/Subtype') == pikepdf.Name.Image}
        if not isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream, pikepdf.Array)):
            continue
        if obj.is_indirect:
            if obj.objgen in visited:
                continue
            visited.add(obj.objgen)
        if isinstance(obj, pikepdf.Array):
            roots.extend(obj)
        elif obj.get('/Subtype') == pikepdf.Name.Image:
            protected.add(obj.objgen)
        else:
            roots.extend(value for key, value in obj.items() if key not in ('/P', '/Parent', '/Pages'))
    return protected


def png_stream(image: Image.Image):
    """Use real PNG row predictors; storing raw RGB through zlib wastes space."""
    buffer = io.BytesIO(); image.save(buffer, 'PNG', optimize=True, compress_level=9)
    data = buffer.getvalue(); chunks = []; position = 8
    while position + 12 <= len(data):
        size = struct.unpack_from('>I', data, position)[0]
        kind = data[position + 4:position + 8]
        if kind == b'IDAT':
            chunks.append(data[position + 8:position + 8 + size])
        position += size + 12
    return b''.join(chunks), pikepdf.Dictionary(Predictor=15, Colors=len(image.getbands()), BitsPerComponent=8, Columns=image.width)


def identity_decode(obj, components: int) -> bool:
    decode = obj.get('/Decode')
    return decode is None or list(map(float, decode)) == [0.0, 1.0] * components


def jpeg_is_already_small(image, quality: int) -> bool:
    tables = getattr(image, 'quantization', None)
    if not tables:
        return False
    with Image.new(image.mode, (8, 8)) as patch:
        stream = io.BytesIO(); patch.save(stream, 'JPEG', quality=quality)
    stream.seek(0)
    with Image.open(stream) as target:
        target_tables = target.quantization
        return all(key in tables and sum(tables[key]) >= sum(table) for key, table in target_tables.items())


def optimize_image(pdf, obj, placement, dpi, quality, lossy, report, decoded_pixels):
    width, height = int(obj.get('/Width', 0)), int(obj.get('/Height', 0))
    pixels = width * height
    if width < 1 or height < 1 or pixels > MAX_IMAGE_PIXELS or decoded_pixels + pixels > MAX_TOTAL_PIXELS:
        return 'pixel-limit', decoded_pixels
    colorspace = obj.get('/ColorSpace')
    components = {'/DeviceRGB': 3, '/DeviceGray': 1}.get(str(colorspace))
    if isinstance(colorspace, pikepdf.Array) and len(colorspace) == 2 and str(colorspace[0]) == '/ICCBased':
        components = int(colorspace[1].get('/N', 0))
        if components not in (1, 3): components = None
    if not components or int(obj.get('/BitsPerComponent', 0)) != 8 or obj.get('/ImageMask', False):
        return 'special-color-or-bitdepth', decoded_pixels
    if not identity_decode(obj, components) or any(key in obj for key in ('/Mask', '/SMaskInData', '/Alternates', '/OPI', '/F')):
        return 'special-mask-or-decode', decoded_pixels
    mask = obj.get('/SMask')
    if mask is not None and str(mask) == '/None':
        mask = None
    if mask is not None and (not isinstance(mask, pikepdf.Stream) or '/Matte' in mask
        or str(mask.get('/ColorSpace')) != '/DeviceGray' or int(mask.get('/BitsPerComponent', 0)) != 8
        or (int(mask.get('/Width', 0)), int(mask.get('/Height', 0))) != (width, height)
        or not identity_decode(mask, 1) or any(key in mask for key in ('/SMask', '/Mask'))):
        return 'special-mask-or-decode', decoded_pixels
    original = obj.read_raw_bytes()
    if len(original) < 2048:
        return 'already-small', decoded_pixels
    resized = (width, height)
    if lossy and placement:
        ratio = min(1.0, max(placement[0] * dpi / 72 / width, placement[1] * dpi / 72 / height))
        if ratio < 0.90:
            resized = (max(1, math.ceil(width * ratio)), max(1, math.ceil(height * ratio)))
    is_jpeg = '/DCTDecode' in str(obj.get('/Filter', ''))
    if not lossy and is_jpeg:
        return 'jpeg-preserved', decoded_pixels
    # Removing a simple soft mask only for decoding prevents accidental alpha compositing.
    if mask is not None:
        del obj['/SMask']
    try:
        image = pikepdf.PdfImage(obj).as_pil_image(apply_decode_array=False, apply_mask=False)
    finally:
        if mask is not None:
            obj['/SMask'] = mask
    decoded_pixels += pixels
    alpha = None; processed = None
    try:
        if image.mode != ('RGB' if components == 3 else 'L') or image.size != (width, height):
            return 'unsupported-image', decoded_pixels
        image.load()
        if is_jpeg and resized == image.size and jpeg_is_already_small(image, quality):
            return 'jpeg-preserved', decoded_pixels
        processed = image.resize(resized, Image.Resampling.LANCZOS) if resized != image.size else image.copy()
        payload, parameters = png_stream(processed)
        filter_name = pikepdf.Name.FlateDecode
        used_jpeg = False
        if lossy:
            with processed.resize((min(96, processed.width), min(96, processed.height)), Image.Resampling.NEAREST) as sample:
                flat_graphic = sample.getcolors(maxcolors=64) is not None
            if not flat_graphic:
                buffer = io.BytesIO()
                processed.save(buffer, 'JPEG', quality=quality, optimize=True, progressive=False, subsampling=0 if quality >= 90 else 2)
                jpeg = buffer.getvalue()
                if len(jpeg) < len(payload) * .90:
                    payload, parameters, filter_name, used_jpeg = jpeg, None, pikepdf.Name.DCTDecode, True
        old_size = len(original)
        new_size = len(payload)
        mask_data = None; mask_parameters = None
        if mask is not None and resized != (width, height):
            alpha = pikepdf.PdfImage(mask).as_pil_image()
            if alpha.mode != 'L' or alpha.size != (width, height):
                return 'special-mask-or-decode', decoded_pixels
            alpha.load()
            with alpha.resize(resized, Image.Resampling.LANCZOS) as scaled:
                mask_data, mask_parameters = png_stream(scaled)
            old_size += len(mask.read_raw_bytes()); new_size += len(mask_data)
        if new_size + 128 >= old_size * .98:
            return 'no-image-gain', decoded_pixels
        obj.write(payload, filter=filter_name, decode_parms=parameters)
        obj.Width, obj.Height = resized
        if '/Decode' in obj:
            del obj['/Decode']
        if mask_data is not None:
            replacement = pdf.make_stream(mask_data)
            replacement.Type = pikepdf.Name.XObject; replacement.Subtype = pikepdf.Name.Image
            replacement.ColorSpace = pikepdf.Name.DeviceGray; replacement.BitsPerComponent = 8
            replacement.Width, replacement.Height = resized
            replacement.Filter = pikepdf.Name.FlateDecode; replacement.DecodeParms = mask_parameters
            if '/Interpolate' in mask:
                replacement.Interpolate = mask.Interpolate
            obj.SMask = replacement
        report['imagesOptimized'] += 1
        report['imagesDownsampled'] += int(resized != (width, height))
        report['jpegReencoded'] += int(used_jpeg)
        report['imageBytesSaved'] += old_size - new_size
        return None, decoded_pixels
    finally:
        image.close()
        if processed is not None: processed.close()
        if alpha is not None: alpha.close()


def deduplicate_images(pdf) -> int:
    """Merge only byte-identical image streams with identical complete dictionaries."""
    canonical = {}; hashes = {}; replaced = set()
    for obj in list(pdf.objects):
        if not isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream)):
            continue
        resources = obj.get('/Resources')
        containers = [obj]
        if isinstance(resources, pikepdf.Dictionary): containers.append(resources)
        for resource in containers:
            mapping = resource.get('/XObject')
            if not isinstance(mapping, pikepdf.Dictionary): continue
            for name, image in list(mapping.items()):
                if not isinstance(image, pikepdf.Stream) or image.get('/Subtype') != pikepdf.Name.Image:
                    continue
                key = image.objgen
                if key not in hashes:
                    signature = pikepdf.Dictionary({k: v for k, v in image.items() if k != '/Length'}).unparse()
                    digest = hashlib.sha256(signature + image.read_raw_bytes()).digest()
                    hashes[key] = digest
                digest = hashes[key]
                if digest in canonical and canonical[digest].objgen != key:
                    mapping[name] = canonical[digest]; replaced.add(key)
                else:
                    canonical[digest] = image
    return len(replaced)


def page_geometry(pdf):
    return [(tuple(map(float, page.mediabox)), tuple(map(float, page.cropbox)),
             int(page.obj.get('/Rotate', 0)), float(page.obj.get('/UserUnit', 1))) for page in pdf.pages]


def compress_pdf(path: Path, outdir: Path, options: ConvertOptions, settings: Settings, progress):
    mode = options.compression
    dpi, quality = PRESETS.get(mode, (options.compression_dpi, options.compression_quality))
    lossy = mode != 'lossless'
    original_size = path.stat().st_size
    report = {'mode': mode, 'targetDpi': dpi or None, 'jpegQuality': quality if lossy else None,
        'inputBytes': original_size, 'outputBytes': original_size, 'savedBytes': 0,
        'reductionPercent': 0.0, 'imagesFound': 0, 'imagesOptimized': 0,
        'imagesDownsampled': 0, 'jpegReencoded': 0, 'duplicatesRemoved': 0,
        'imageBytesSaved': 0, 'imagesPreserved': 0, 'skipReasons': {},
        'unchanged': False, 'lossyApplied': False, 'encryptionPreserved': False,
        'pageCount': 0, 'inlineImages': 0}
    warnings = []
    output = outdir / 'result.pdf'
    candidate = outdir / 'candidate.pdf'
    try:
        with pikepdf.open(path, password=options.password) as pdf:
            if not 1 <= len(pdf.pages) <= settings.max_pages:
                raise ConversionError(f'Допустимо от 1 до {settings.max_pages} страниц в документе.')
            report['pageCount'] = len(pdf.pages)
            report['encryptionPreserved'] = pdf.is_encrypted
            geometry = page_geometry(pdf)
            signed = any(isinstance(obj, pikepdf.Dictionary) and '/ByteRange' in obj for obj in pdf.objects)
            progress(8, 'Анализируем изображения и размеры на страницах')
            # QPDF converts large inline images to addressable XObjects, including nested forms.
            for page in pdf.pages:
                page.externalize_inline_images(min_size=16384, shallow=False)
            scan = scan_placements(pdf)
            protected = protected_images(pdf)
            images = [obj for obj in pdf.objects if isinstance(obj, pikepdf.Stream)
                and obj.get('/Subtype') == pikepdf.Name.Image and obj.objgen not in protected]
            report['imagesFound'], report['inlineImages'] = len(images), scan.inline
            if len(images) > 4000:
                raise ConversionError('Слишком много изображений в PDF. Разделите документ на части.')
            skipped = Counter(); decoded = 0
            for index, image in enumerate(images):
                placement = scan.sizes.get(image.objgen) if not scan.uncertain else None
                try:
                    if lossy and not placement:
                        reason = 'untracked-placement'
                    else:
                        reason, decoded = optimize_image(pdf, image, placement, dpi, quality, lossy, report, decoded)
                    if reason: skipped[reason] += 1
                except (pikepdf.PdfError, pikepdf.UnsupportedImageTypeError, OSError, ValueError, TypeError, KeyError, NotImplementedError):
                    skipped['unsupported-image'] += 1
                progress(12 + round(66 * (index + 1) / max(1, len(images))), f'Оптимизация изображения {index + 1} из {len(images)}')
            report['skipReasons'] = dict(skipped)
            report['imagesPreserved'] = sum(skipped.values())
            report['duplicatesRemoved'] = deduplicate_images(pdf)
            progress(82, 'Упаковываем структуру PDF')
            # Avoid changing declarations of archival PDFs or inferring conformance.
            archival = False
            try:
                metadata = pdf.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False)
                archival = bool(metadata.get('pdfaid:part'))
            except (pikepdf.PdfError, ValueError, TypeError):
                archival = True
            pikepdf.settings.set_flate_compression_level(9)
            pdf.save(candidate, compress_streams=True, recompress_flate=True,
                object_stream_mode=pikepdf.ObjectStreamMode.preserve if archival else pikepdf.ObjectStreamMode.generate,
                normalize_content=False, encryption=pdf.is_encrypted,
                progress=lambda value: progress(83 + round(value * .10), 'Сохраняем сжатый PDF'))
            if archival:
                warnings.append('В документе есть признаки архивного формата. Соответствие PDF/A после обработки не проверялось.')
        progress(94, 'Проверяем результат и сравниваем размеры')
        with pikepdf.open(candidate, password=options.password) as check:
            if page_geometry(check) != geometry or check.is_encrypted != report['encryptionPreserved']:
                raise ConversionError('Проверка структуры результата не пройдена. Исходный файл не изменён.')
        if candidate.stat().st_size >= original_size:
            candidate.unlink(missing_ok=True)
            shutil.copyfile(path, output)
            report.update(unchanged=True, imagesOptimized=0, imagesDownsampled=0,
                jpegReencoded=0, duplicatesRemoved=0, imageBytesSaved=0)
            warnings.append('Выбранный режим не уменьшил размер. Возвращён исходный PDF без изменений; более сильное сжатие не применялось автоматически.')
        else:
            candidate.replace(output)
            report['outputBytes'] = output.stat().st_size
            report['savedBytes'] = original_size - report['outputBytes']
            report['reductionPercent'] = min(99.9, round(100 * report['savedBytes'] / original_size, 1))
            report['lossyApplied'] = bool(report['imagesDownsampled'] or report['jpegReencoded'])
            if signed:
                warnings.append('PDF содержит цифровую подпись. Сжатие изменяет файл: подпись результата нельзя считать действительной. Сохраните оригинал.')
        if report['lossyApplied']:
            warnings.append('Оптимизированы встроенные изображения. Текст и векторные команды не растрировались; мелкий текст внутри сканов может стать менее чётким — проверьте сравнение.')
        elif not report['imagesFound'] and not scan.inline:
            warnings.append('Подходящих растровых изображений не найдено. Для текста и векторов доступна только структурная упаковка, поэтому эффект может быть небольшим.')
        elif not report['imagesOptimized'] and lossy:
            warnings.append('Изображения не удалось дополнительно уменьшить в этом режиме или их особенности требуют сохранения оригинала. Применена только доступная структурная упаковка.')
        special = sum(value for reason, value in skipped.items() if reason not in ('already-small', 'jpeg-preserved', 'no-image-gain'))
        if special:
            warnings.append(f'Изображений оставлено без перекодирования из-за особенностей цвета, масок, масштаба или лимитов: {special}.')
        if scan.inline:
            warnings.append('Встроенные inline-изображения оставлены без изменения разрешения.')
        if report['encryptionPreserved']:
            warnings.append('Защита исходного PDF сохранена. Для открытия результата нужен прежний пароль.')
        (outdir / REPORT_NAME).write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
        progress(98, 'Сжатие завершено' if not report['unchanged'] else 'Размер не уменьшился')
        return output, warnings
    except pikepdf.PasswordError:
        raise ConversionError('Необходим верный пароль для открытия PDF.') from None
    except pikepdf.PdfError:
        raise ConversionError('Не удалось безопасно пересобрать PDF. Проверьте файл; исходник не изменён.') from None
    finally:
        candidate.unlink(missing_ok=True)
