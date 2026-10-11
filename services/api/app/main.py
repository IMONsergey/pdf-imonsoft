from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Depends, HTTPException, Request
from starlette.datastructures import UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from starlette.middleware.sessions import SessionMiddleware
from starlette.formparsers import MultiPartException

from .catalog import load_catalog
from .config import Settings
from .jobs import JobManager, JobStore, QueueFull
from .models import ConvertOptions, ConversionError
from .pipeline import validate_options
from .access import AccessControl, WindowLimit


MAX_OPTIONS_SIZE = 65536


class BodyTooLarge(MultiPartException):
    pass


class BodyLimitMiddleware:
    """Count actual streamed bytes; Content-Length alone is not a security boundary."""
    def __init__(self, app, limit: int):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope['headers'])
        length = headers.get(b'content-length', b'0')
        try:
            declared = int(length)
            if declared < 0:
                raise ValueError
        except ValueError:
            return await JSONResponse({'detail': 'Некорректный размер запроса.'}, 400)(scope, receive, send)
        if declared > self.limit:
            return await JSONResponse({'detail': 'Размер загрузки превышает лимит.'}, 413)(scope, receive, send)
        consumed = 0
        oversized = False
        replied = False
        async def bounded_receive():
            nonlocal consumed, oversized
            message = await receive()
            consumed += len(message.get('body', b''))
            if consumed > self.limit:
                oversized = True
                raise BodyTooLarge('Размер загрузки превышает лимит.')
            return message
        async def bounded_send(message):
            nonlocal replied
            if oversized:
                if not replied:
                    replied = True
                    await JSONResponse({'detail': 'Размер загрузки превышает лимит.'}, 413)(scope, receive, send)
                return
            await send(message)
        try:
            await self.app(scope, bounded_receive, bounded_send)
        except BodyTooLarge:
            if not replied:
                await JSONResponse({'detail': 'Размер загрузки превышает лимит.'}, 413)(scope, receive, send)


def display_name(raw: str | None) -> str:
    name = (raw or 'file').replace('\\', '/').split('/')[-1]
    name = re.sub(r'[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]', '', name).strip().strip('.')
    if len(name) > 160:
        suffix = Path(name).suffix[:24]
        name = name[:160 - len(suffix)] + suffix
    return name or 'file'


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    catalog = load_catalog(settings.tools_file)
    store = JobStore(settings)
    manager = JobManager(store, settings)
    engine_cache: dict = {'at': 0.0, 'value': {}}
    access = AccessControl(settings)
    uploads = asyncio.Semaphore(2)
    creates = WindowLimit(60, 60)
    global_creates = WindowLimit(120, 60)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await manager.start()
        yield
        await manager.stop()

    app = FastAPI(title='IMONSOFT Files API', version='0.2.0', dependencies=[Depends(access.require)], lifespan=lifespan, docs_url=None, openapi_url=None, redoc_url=None)
    app.state.store, app.state.manager, app.state.settings = store, manager, settings
    access.register(app)
    app.add_middleware(SessionMiddleware, secret_key=settings.session_secret(), session_cookie='imonsoft_session', same_site='strict', https_only=settings.secure_cookie, max_age=7 * 86400)
    app.add_middleware(BodyLimitMiddleware, limit=settings.max_upload_bytes + 1024 * 1024)

    @app.middleware('http')
    async def security_headers(request: Request, call_next):
        if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            if request.headers.get('x-imonsoft-client') != 'web':
                return JSONResponse({'detail': 'Отсутствует заголовок безопасности запроса.'}, 403)
            origin = request.headers.get('origin')
            if origin:
                try:
                    parsed_origin = urlsplit(origin)
                    valid_origin = (parsed_origin.scheme in ('http', 'https')
                        and parsed_origin.netloc == request.headers.get('host')
                        and not parsed_origin.username and not parsed_origin.password
                        and parsed_origin.path in ('', '/')
                        and not parsed_origin.query and not parsed_origin.fragment)
                except ValueError:
                    valid_origin = False
                if not valid_origin:
                    return JSONResponse({'detail': 'Запрос с другого сайта запрещён.'}, 403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'same-origin'
        return response

    def session_id(request: Request) -> str:
        if 'id' not in request.session:
            request.session['id'] = secrets.token_urlsafe(32)
        return request.session['id']

    def owned(job_id: str, request: Request) -> dict:
        if not re.fullmatch(r'[a-f0-9]{32}', job_id):
            raise HTTPException(404, 'Задача не найдена или уже удалена.')
        job = store.get(job_id, session_id(request))
        if not job:
            raise HTTPException(404, 'Задача не найдена или срок хранения истёк.')
        return job

    async def engines() -> dict:
        if time.monotonic() - engine_cache['at'] < 10:
            return engine_cache['value']
        office = False
        if settings.office_engine == 'local':
            office = bool(shutil.which(settings.libreoffice_bin) or Path(settings.libreoffice_bin).is_file())
        else:
            try:
                async with httpx.AsyncClient(timeout=2, trust_env=False) as client:
                    response = await client.get(settings.gotenberg_url + '/health')
                    office = response.status_code == 200
            except httpx.HTTPError:
                pass
        languages: list[str] = []
        if shutil.which('tesseract'):
            try:
                result = await asyncio.to_thread(subprocess.run, ['tesseract', '--list-langs'], capture_output=True, text=True, timeout=3)
                languages = [line.strip() for line in result.stdout.splitlines()[1:] if line.strip() in ('rus', 'eng')]
            except (OSError, subprocess.SubprocessError):
                pass
        value = {'pdf': True, 'image': True, 'office': office, 'ocr': bool(languages), 'ocrLanguages': languages}
        engine_cache.update(at=time.monotonic(), value=value)
        return value

    @app.get('/api/openapi.json', include_in_schema=False)
    async def schema():
        return app.openapi()

    @app.get('/api/health')
    async def health():
        alive = manager.loop_task is not None and not manager.loop_task.done()
        return JSONResponse({'status': 'ok' if alive else 'degraded', 'version': '0.2.0', 'queueAlive': alive}, status_code=200 if alive else 503)

    @app.get('/api/v1/config')
    async def config(request: Request):
        session_id(request)
        availability = await engines()
        return {
            'version': '0.2.0', 'accessEnabled': access.enabled, 'sessionStorageMb': settings.session_storage_mb, 'maxUploadMb': settings.max_upload_mb, 'maxFiles': settings.max_files,
            'maxPages': settings.max_pages, 'retentionSeconds': settings.retention_seconds,
            'engines': availability,
            'tools': [{'id': tool['id'], 'available': bool(availability[tool['engine']])} for tool in catalog.values()],
        }

    @app.get('/api/v1/jobs')
    async def list_jobs(request: Request):
        return {'jobs': [store.public(job) for job in store.list(session_id(request))]}

    def admit(request: Request):
        sid = session_id(request)
        if not creates.take(sid) or not global_creates.take('server'):
            raise HTTPException(429, 'Слишком много запусков. Подождите минуту.', headers={'Retry-After': '60'})
        if uploads.locked():
            raise HTTPException(429, 'Сервер принимает другие файлы. Повторите через несколько секунд.')
        if shutil.disk_usage(settings.data_dir).free < (settings.max_upload_mb + settings.max_output_mb * 2) * 1024 * 1024:
            raise HTTPException(507, 'Недостаточно свободного места для безопасной обработки.')
        with store.connect() as db:
            try:
                store.check_storage(db, sid, 0)
            except QueueFull as exc:
                raise HTTPException(429, str(exc)) from None
        return sid

    async def validate(tool, raw_options):
        definition = catalog.get(tool) if isinstance(tool, str) else None
        if not definition:
            raise HTTPException(400, 'Неизвестный инструмент.')
        if not isinstance(raw_options, str) or len(raw_options) > MAX_OPTIONS_SIZE:
            raise HTTPException(400, 'Некорректный набор параметров.')
        try:
            parsed = ConvertOptions.model_validate_json(raw_options)
            validate_options(definition, parsed)
            allowed = set(definition['settings']) | {'batch', 'postprocess'}
            if parsed.postprocess == 'watermark':
                allowed |= {'text', 'watermark_opacity', 'watermark_angle'}
            if parsed.postprocess == 'number':
                allowed.add('start')
            if parsed.model_fields_set - allowed:
                raise ConversionError('Параметры не соответствуют выбранному инструменту.')
        except (ValidationError, ConversionError) as exc:
            raise HTTPException(422, str(exc) if isinstance(exc, ConversionError) else 'Неверные параметры обработки.') from None
        availability = await engines()
        if not availability[definition['engine']]:
            raise HTTPException(503, 'Нужный движок сейчас недоступен. Проверьте его подключение.')
        if tool == 'ocr-pdf' and not all(lang in availability['ocrLanguages'] for lang in parsed.language.split('+')):
            raise HTTPException(422, 'Выбранный язык OCR не установлен на сервере.')
        return definition, parsed

    def persist(job_id, sid, tool, names, inputs, parsed, total_size):
        root = store.root / job_id
        manifest = root / 'manifest.json'
        manifest.write_text(json.dumps({'tool': tool, 'inputs': inputs, 'names': names, 'options': parsed.model_dump()}, ensure_ascii=False))
        os.chmod(manifest, 0o600)
        try:
            return store.public(store.create(job_id, sid, tool, names, total_size))
        except QueueFull as exc:
            raise HTTPException(429, str(exc)) from None

    @app.post('/api/v1/jobs', status_code=202)
    async def create_job(request: Request):
        sid = admit(request)
        if not request.headers.get('content-type', '').lower().startswith('multipart/form-data;'):
            raise HTTPException(415, 'Для загрузки файлов требуется multipart/form-data.')
        async with uploads:
            # Bound the number of multipart parts before they are spooled to disk.
            async with request.form(max_files=settings.max_files, max_fields=2, max_part_size=MAX_OPTIONS_SIZE) as form:
                if set(form.keys()) - {'tool', 'options', 'files'} or len(form.getlist('tool')) != 1 or len(form.getlist('options')) > 1:
                    raise HTTPException(422, 'Некорректная структура запроса.')
                tool = form.get('tool')
                definition, parsed = await validate(tool, form.get('options', '{}'))
                files = form.getlist('files')
                multiple = definition['multiple'] or parsed.batch
                if not definition['minFiles'] <= len(files) <= settings.max_files or (not multiple and len(files) != 1):
                    raise HTTPException(422, 'Неверное количество файлов для этой операции.')
                if any(not isinstance(file, UploadFile) for file in files):
                    raise HTTPException(422, 'В поле files должны находиться файлы.')
                job_id = secrets.token_hex(16)
                root = store.root / job_id
                input_dir = root / 'input'
                input_dir.mkdir(parents=True, mode=0o700)
                total_size, names, inputs = 0, [], []
                try:
                    for index, upload in enumerate(files):
                        name = display_name(upload.filename)
                        suffix = Path(name).suffix.lower()
                        if suffix not in definition['accept']:
                            raise HTTPException(415, f"Неподдерживаемый формат. Допустимы: {', '.join(definition['accept'])}.")
                        path = input_dir / f'{index:03d}{suffix}'
                        size = 0
                        with path.open('wb') as stream:
                            while chunk := await upload.read(1024 * 1024):
                                total_size += len(chunk)
                                size += len(chunk)
                                if total_size > settings.max_upload_bytes:
                                    raise HTTPException(413, f'Суммарный размер файлов превышает {settings.max_upload_mb} МБ.')
                                stream.write(chunk)
                        if size == 0:
                            raise HTTPException(422, 'Пустой файл обработать нельзя.')
                        os.chmod(path, 0o600)
                        names.append(name)
                        inputs.append(str(path.relative_to(root)))
                    return persist(job_id, sid, tool, names, inputs, parsed, total_size)
                except BaseException:
                    shutil.rmtree(root, ignore_errors=True)
                    raise

    @app.post('/api/v1/jobs/{source_id}/continue', status_code=202)
    async def continue_job(source_id: str, request: Request):
        source = owned(source_id, request)
        if source['state'] != 'done' or not source['output_file']:
            raise HTTPException(409, 'Исходный результат ещё не готов.')
        sid = admit(request)
        async with uploads:
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > MAX_OPTIONS_SIZE + 4096:
                    raise HTTPException(413, 'Слишком большой набор параметров.')
            try:
                body = json.loads(raw)
                if not isinstance(body, dict) or set(body) - {'tool', 'options'}:
                    raise ValueError
            except (ValueError, TypeError):
                raise HTTPException(422, 'Некорректный запрос продолжения.') from None
            tool = body.get('tool')
            definition, parsed = await validate(tool, json.dumps(body.get('options', {})))
            original = store.root / source_id / 'output' / source['output_file']
            if original.suffix.lower() not in definition['accept'] or definition['minFiles'] != 1 or parsed.batch:
                raise HTTPException(422, 'Результат несовместим с выбранной операцией.')
            if not original.is_file() or original.is_symlink():
                raise HTTPException(404, 'Исходный результат уже удалён.')
            if original.stat().st_size > settings.max_upload_bytes:
                raise HTTPException(413, 'Результат превышает лимит входного файла следующей задачи.')
            job_id = secrets.token_hex(16)
            root = store.root / job_id
            target = root / 'input' / ('000' + original.suffix)
            target.parent.mkdir(parents=True, mode=0o700)
            try:
                await asyncio.to_thread(shutil.copyfile, original, target)
                owned(source_id, request)  # Re-check expiry/ownership after the copy.
                os.chmod(target, 0o600)
                name = display_name(Path(json.loads(source['names'])[0]).stem + '-result' + original.suffix)
                return persist(job_id, sid, tool, [name], [str(target.relative_to(root))], parsed, target.stat().st_size)
            except FileNotFoundError:
                shutil.rmtree(root, ignore_errors=True)
                raise HTTPException(404, 'Исходный результат удалён во время копирования.') from None
            except BaseException:
                shutil.rmtree(root, ignore_errors=True)
                raise

    @app.post('/api/v1/history/clear')
    async def clear_history(request: Request):
        count = 0
        for job in store.list(session_id(request)):
            if job['state'] in ('done', 'error', 'cancelled'):
                store.delete(job['id'])
                count += 1
        return {'deleted': count}

    @app.get('/api/v1/jobs/{job_id}')
    async def get_job(job_id: str, request: Request):
        return store.public(owned(job_id, request))

    @app.post('/api/v1/jobs/{job_id}/cancel')
    async def cancel_job(job_id: str, request: Request):
        owned(job_id, request)
        await manager.cancel(job_id)
        return store.public(owned(job_id, request))

    @app.delete('/api/v1/jobs/{job_id}', status_code=204)
    async def delete_job(job_id: str, request: Request):
        owned(job_id, request)
        await manager.cancel(job_id)
        store.delete(job_id)
        from fastapi import Response
        return Response(status_code=204)

    @app.get('/api/v1/jobs/{job_id}/download')
    async def download(job_id: str, request: Request):
        job = owned(job_id, request)
        if job['state'] != 'done' or not job['output_file']:
            raise HTTPException(409, 'Результат ещё не готов.')
        path = store.root / job_id / 'output' / job['output_file']
        if not path.is_file() or path.is_symlink():
            raise HTTPException(404, 'Файл результата уже удалён.')
        original = Path(json.loads(job['names'])[0]).stem[:100]
        filename = display_name(original + '-imonsoft' + path.suffix)
        return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream', filename=filename, content_disposition_type='attachment')

    return app


app = create_app()
