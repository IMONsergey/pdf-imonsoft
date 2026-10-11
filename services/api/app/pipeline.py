"""Bounded batch conversion and optional PDF finishing in the same killable worker."""
from __future__ import annotations
import json
import re
import shutil
import zipfile
from pathlib import Path
from .catalog import load_catalog
from .config import Settings
from .engines import convert
from .models import ConversionError, ConvertOptions


def validate_options(tool: dict, options: ConvertOptions) -> None:
    if options.batch and not tool.get('batch', False):
        raise ConversionError('Этот инструмент не поддерживает пакетную обработку.')
    if options.postprocess != 'none' and not tool.get('postprocess', False):
        raise ConversionError('Дополнительная обработка недоступна для этого инструмента.')
    if (tool['id'] == 'watermark-pdf' or options.postprocess == 'watermark') and not options.text.strip():
        raise ConversionError('Введите текст водяного знака.')
    if tool['id'] == 'protect-pdf' and len(options.new_password) < 8:
        raise ConversionError('Новый пароль должен содержать не менее 8 символов.')
    if tool['id'] in ('extract-pages', 'remove-pages') and not options.pages.strip():
        raise ConversionError('Укажите номера страниц.')
    if tool['id'] == 'organize-pdf' and not options.page_plan:
        raise ConversionError('Оставьте хотя бы одну страницу.')


def result_stem(name: str) -> str:
    # A display name is never allowed to create an archive path.
    stem = Path(name.replace('\\', '/').split('/')[-1]).stem
    stem = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', '_', stem).strip(' .')[:90]
    return stem or 'document'


def execute(tool: str, inputs: list[Path], names: list[str], outdir: Path, options: ConvertOptions, settings: Settings, progress):
    definition = load_catalog(settings.tools_file)[tool]
    validate_options(definition, options)
    outdir.mkdir(parents=True, exist_ok=True)
    work = outdir / '.work'
    work.mkdir(mode=0o700)
    basic = options.model_copy(update={'batch': False, 'postprocess': 'none'})
    finishing = {'compress': 'compress-pdf', 'watermark': 'watermark-pdf', 'number': 'number-pages'}

    def one(files, destination, report):
        result, warnings = convert(tool, files, destination / 'convert', basic, settings, report)
        if options.postprocess != 'none':
            finish_options = ConvertOptions(text=options.text, start=options.start,
                watermark_opacity=options.watermark_opacity, watermark_angle=options.watermark_angle,
                compression=options.compression, compression_dpi=options.compression_dpi, compression_quality=options.compression_quality)
            report(None, 'Дополнительная обработка PDF')
            result, more = convert(finishing[options.postprocess], [result], destination / 'finish', finish_options, settings, report)
            warnings.extend(more)
        details = {}
        sidecar = result.parent / 'compression.json'
        if sidecar.is_file():
            details['compression'] = json.loads(sidecar.read_text())
        return result, warnings, details

    try:
        if not options.batch:
            result, warnings, details = one(inputs, work / 'single', progress)
            target = outdir / ('result' + result.suffix)
            result.replace(target)
            if details:
                (outdir / 'details.json').write_text(json.dumps(details, ensure_ascii=False))
            return target, warnings, None
        report, success, total_size = [], 0, 0
        target = outdir / 'batch.zip'
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            for i, path in enumerate(inputs):
                destination = work / f'{i:03d}'
                def status(percent, stage):
                    value = None if percent is None else round(95 * (i + percent / 100) / len(inputs))
                    progress(value, f'Файл {i + 1} из {len(inputs)} · {stage}')
                try:
                    result, warnings, details = one([path], destination, status)
                    next_size = total_size + result.stat().st_size
                    if next_size > settings.max_output_mb * 1024 * 1024:
                        raise ConversionError('Суммарный результат превышает лимит. Уменьшите число файлов.')
                    entry = f'{i + 1:02d}-{result_stem(names[i])}{result.suffix}'
                    archive.write(result, arcname=entry)
                    total_size = next_size
                    report.append({'source': names[i], 'status': 'done', 'result': entry, 'warnings': warnings, 'details': details})
                    success += 1
                except ConversionError as exc:
                    report.append({'source': names[i], 'status': 'error', 'error': str(exc)})
                except Exception:
                    report.append({'source': names[i], 'status': 'error', 'error': 'Файл не обработан: повреждён или содержит неподдерживаемые элементы.'})
                finally:
                    shutil.rmtree(destination, ignore_errors=True)
                if target.stat().st_size > settings.max_output_mb * 1024 * 1024:
                    raise ConversionError('Архив превышает допустимый размер результата.')
            archive.writestr('report.json', json.dumps({'processed': success, 'total': len(inputs), 'files': report}, ensure_ascii=False, indent=2))
            summary = [f'Обработано {success} из {len(inputs)} файлов.', '']
            for item in report:
                summary.append(item['source'] + ': ' + (item.get('result') or item['error']))
                summary.extend('  ' + warning for warning in item.get('warnings', []))
            archive.writestr('readme.txt', '\n'.join(summary))
        if success == 0:
            target.unlink(missing_ok=True)
            raise ConversionError('Не обработан ни один файл. Первый результат: ' + report[0]['error'])
        warnings = [f'Обработано {success} из {len(inputs)} файлов. Отчёт по каждому файлу находится в архиве.']
        if success != len(inputs):
            warnings.append('Часть файлов завершилась с ошибкой. Не считайте архив полным результатом — проверьте report.json или readme.txt.')
        progress(98, 'Архив готов')
        return target, warnings, {'processed': success, 'total': len(inputs), 'failed': len(inputs) - success}
    finally:
        shutil.rmtree(work, ignore_errors=True)
