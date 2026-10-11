"""One conversion, one process. The parent owns timeouts, cancellation and job state."""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path


def atomic_json(path: Path, payload: dict) -> None:
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False))
    temporary.replace(path)


def main() -> int:
    manifest = Path(sys.argv[1]).resolve()
    root = manifest.parent
    config = json.loads(manifest.read_text())
    # Linux container enforcement. The parent additionally imposes a wall-clock timeout.
    if sys.platform.startswith('linux'):
        import resource
        memory = int(os.getenv('WORKER_MEMORY_MB', '1536')) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        output_limit = int(os.getenv('MAX_OUTPUT_MB', '250')) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_FSIZE, (output_limit, output_limit))
        resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    from .config import Settings
    from .models import ConversionError, ConvertOptions
    from .pipeline import execute
    try:
        settings = Settings()
        result, warnings, batch = execute(
            config['tool'], [root / path for path in config['inputs']], config.get('names', config['inputs']), root / 'output',
            ConvertOptions.model_validate(config['options']), settings,
            lambda percent, stage: atomic_json(root / 'progress.json', {'progress': percent, 'stage': stage}),
        )
        size = result.stat().st_size
        if not 0 < size <= settings.max_output_mb * 1024 * 1024:
            raise ConversionError('Результат пуст или превышает допустимый размер.')
        details_path = root / 'output' / 'details.json'
        details = json.loads(details_path.read_text()) if details_path.is_file() else {}
        atomic_json(root / 'result.json', {'file': result.name, 'size': size, 'warnings': warnings, 'batch': batch, 'details': details})
        return 0
    except ConversionError as exc:
        atomic_json(root / 'error.json', {'message': str(exc)})
        return 2
    except Exception as exc:
        # Do not send traces, input paths, passwords or document contents to clients.
        print(f'Conversion failed: {type(exc).__name__}', file=sys.stderr)
        atomic_json(root / 'error.json', {'message': 'Не удалось обработать файл. Проверьте его целостность или попробуйте другой документ.'})
        return 1
    finally:
        manifest.unlink(missing_ok=True)  # contains supplied document passwords


if __name__ == '__main__':
    raise SystemExit(main())
