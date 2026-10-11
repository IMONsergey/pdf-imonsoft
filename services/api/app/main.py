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
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from starlette.middleware.sessions import SessionMiddleware
from starlette.formparsers import MultiPartException

from .catalog import load_catalog
from .config import Settings
from .jobs import JobManager, JobStore, QueueFull
from .models import ConvertOptions


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
    name = re.sub(r'[\x00-\x1f\x7f]', '', name).strip().strip('.')[:160]
    return name or 'file'


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    catalog = load_catalog(settings.tools_file)
    store = JobStore(settings)
    manager = JobManager(store, settings)
    engine_cache: dict = {'at': 0.0, 'value': {}}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await manager.start()
        yield
        await manager.stop()

    app = FastAPI(title='IMONSOFT Files API', version='0.1.0', lifespan=lifespan, docs_url=None, openapi_url='/api/openapi.json', redoc_url=None)
    app.state.store, app.state.manager, app.state.settings = store, manager, settings
    app.add_middleware(SessionMiddleware, secret_key=settings.session_secret(), session_cookie='imonsoft_session', same_site='strict', https_only=settings.secure_cookie, max_age=7 * 86400)
    app.add_middleware(BodyLimitMiddleware, limit=settings.max_upload_bytes + 1024 * 1024)

    @app.middleware('http')
    async def security_headers(request: Request, call_next):
        if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            if request.headers.get('x-imonsoft-client') != 'web':
                return JSONResponse({'detail': 'Отсутствует заголовок безопасности запроса.'}, 403)
            origin = request.headers.get('origin')
            if origin and urlsplit(origin).netloc != request.headers.get('host'):
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

    @app.get('/api/health')
    async def health():
        return {'status': 'ok', 'version': '0.1.0'}

    @app.get('/api/v1/config')
    async def config(request: Request):
        session_id(request)
        availability = await engines()
        return {
            'version': '0.1.0', 'maxUploadMb': settings.max_upload_mb, 'maxFiles': settings.max_files,
            'maxPages': settings.max_pages, 'retentionSeconds': settings.retention_seconds,
            'engines': availability,
            'tools': [{'id': tool['id'], 'available': bool(availability[tool['engine']])} for tool in catalog.values()],
        }

    @app.get('/api/v1/jobs')
    async def list_jobs(request: Request):
        return {'jobs': [store.public(job) for job in store.list(session_id(request))]}

    @app.post('/api/v1/jobs', status_code=202)
    async def create_job(request: Request, tool: str = Form(...), options: str = Form('{}'), files: list[UploadFile] = File(...)):
        definition = catalog.get(tool)
        if not definition:
            raise HTTPException(400, 'Неизвестный инструмент.')
        availability = await engines()
        if not availability[definition['engine']]:
            raise HTTPException(503, 'Нужный движок сейчас недоступен. Проверьте его подключение.')
        if len(options) > 16384:
            raise HTTPException(400, 'Слишком большой набор параметров.')
        try:
            parsed = ConvertOptions.model_validate_json(options)
        except ValidationError:
            raise HTTPException(422, 'Неверные параметры обработки.') from None
        if tool == 'protect-pdf' and len(parsed.new_password) < 8:
            raise HTTPException(422, 'Новый пароль должен содержать не менее 8 символов.')
        if tool in ('extract-pages', 'remove-pages') and not parsed.pages.strip():
            raise HTTPException(422, 'Укажите номера страниц.')
        if tool == 'watermark-pdf' and not parsed.text.strip():
            raise HTTPException(422, 'Введите текст водяного знака.')
        if tool == 'ocr-pdf' and not all(lang in availability['ocrLanguages'] for lang in parsed.language.split('+')):
            raise HTTPException(422, 'Выбранный язык OCR не установлен на сервере.')
        if not definition['minFiles'] <= len(files) <= settings.max_files or (not definition['multiple'] and len(files) != 1):
            raise HTTPException(422, f"Для этого инструмента нужно файлов: {definition['minFiles']}–{settings.max_files if definition['multiple'] else 1}.")
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
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'tool': tool, 'inputs': inputs, 'options': parsed.model_dump()}, ensure_ascii=False))
            os.chmod(manifest, 0o600)
            job = store.create(job_id, session_id(request), tool, names, total_size)
        except QueueFull as exc:
            shutil.rmtree(root, ignore_errors=True)
            raise HTTPException(429, str(exc)) from None
        except BaseException:
            shutil.rmtree(root, ignore_errors=True)
            raise
        finally:
            for upload in files:
                await upload.close()
        return store.public(job)

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
