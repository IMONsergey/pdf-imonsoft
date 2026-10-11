from __future__ import annotations

import asyncio
import json
import os
import secrets
import shutil
import signal
import sqlite3
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .config import Settings

TERMINAL = {'done', 'error', 'cancelled'}


class QueueFull(Exception):
    pass


class JobStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.root = settings.data_dir / 'jobs'
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.database = settings.data_dir / 'jobs.sqlite3'
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, session TEXT NOT NULL, tool TEXT NOT NULL,
                names TEXT NOT NULL, state TEXT NOT NULL, created REAL NOT NULL,
                expires REAL NOT NULL, input_size INTEGER NOT NULL,
                output_file TEXT, output_size INTEGER, warnings TEXT NOT NULL DEFAULT '[]', error TEXT
            )''')
            db.execute('CREATE INDEX IF NOT EXISTS jobs_session_created ON jobs(session, created DESC)')
            db.execute('CREATE INDEX IF NOT EXISTS jobs_state_created ON jobs(state, created)')
        with self.connect() as db:
            columns = {row[1] for row in db.execute('PRAGMA table_info(jobs)')}
            if 'batch_result' not in columns:
                db.execute('ALTER TABLE jobs ADD COLUMN batch_result TEXT')
        os.chmod(self.database, 0o600)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def create(self, job_id: str, session: str, tool: str, names: list[str], input_size: int) -> dict:
        now = time.time()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            global_count = db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued', 'running')").fetchone()[0]
            session_count = db.execute("SELECT COUNT(*) FROM jobs WHERE session=? AND state IN ('queued', 'running')", (session,)).fetchone()[0]
            if global_count >= self.settings.max_jobs or session_count >= self.settings.session_jobs:
                raise QueueFull('Очередь заполнена. Дождитесь завершения текущих задач.')
            self.check_storage(db, session, input_size)
            db.execute('INSERT INTO jobs(id,session,tool,names,state,created,expires,input_size) VALUES(?,?,?,?,?,?,?,?)',
                       (job_id, session, tool, json.dumps(names), 'queued', now, now + self.settings.retention_seconds, input_size))
        return self.get(job_id, session)  # type: ignore[return-value]

    def check_storage(self, db, session: str, input_size: int) -> None:
        # Reserve output space for queued/running jobs, not only the bytes uploaded so far.
        reserve = self.settings.max_output_mb * 1024 * 1024
        expression = "CASE WHEN state IN ('queued','running') THEN input_size + ? ELSE COALESCE(output_size,0) END"
        global_size, global_count = db.execute(f'SELECT COALESCE(SUM({expression}),0),COUNT(*) FROM jobs', (reserve,)).fetchone()
        session_size, session_count = db.execute(f'SELECT COALESCE(SUM({expression}),0),COUNT(*) FROM jobs WHERE session=?', (reserve, session)).fetchone()
        if global_count >= 1000 or session_count >= 100:
            raise QueueFull('Слишком много сохранённых задач. Удалите завершённые результаты.')
        if global_size + input_size + reserve > self.settings.max_storage_mb * 1024 * 1024:
            raise QueueFull('Хранилище сервера заполнено. Удалите результаты или дождитесь автоудаления.')
        if session_size + input_size + reserve > self.settings.session_storage_mb * 1024 * 1024:
            raise QueueFull('Лимит хранилища сессии исчерпан. Удалите ненужные результаты.')

    def get(self, job_id: str, session: str | None = None) -> dict | None:
        with self.connect() as db:
            if session is None:
                row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            else:
                row = db.execute('SELECT * FROM jobs WHERE id=? AND session=? AND expires>?', (job_id, session, time.time())).fetchone()
        return dict(row) if row else None

    def list(self, session: str) -> list[dict]:
        with self.connect() as db:
            rows = db.execute('SELECT * FROM jobs WHERE session=? AND expires>? ORDER BY created DESC LIMIT 100', (session, time.time())).fetchall()
        return [dict(row) for row in rows]

    def claim(self) -> dict | None:
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM jobs WHERE state='queued' AND expires>? ORDER BY created LIMIT 1", (time.time(),)).fetchone()
            if not row:
                return None
            db.execute("UPDATE jobs SET state='running' WHERE id=?", (row['id'],))
        return dict(row)

    def finish(self, job_id: str, state: str, *, error: str | None = None, result: dict | None = None) -> None:
        result = result or {}
        with self.connect() as db:
            db.execute("UPDATE jobs SET state=?, error=?, output_file=?, output_size=?, warnings=?, batch_result=? WHERE id=? AND state NOT IN ('cancelled')",
                       (state, error, result.get('file'), result.get('size'), json.dumps(result.get('warnings', []), ensure_ascii=False), json.dumps(result['batch']) if result.get('batch') else None, job_id))

    def cancel(self, job_id: str) -> None:
        with self.connect() as db:
            db.execute("UPDATE jobs SET state='cancelled' WHERE id=? AND state IN ('queued','running')", (job_id,))

    def delete(self, job_id: str) -> None:
        with self.connect() as db:
            db.execute('DELETE FROM jobs WHERE id=?', (job_id,))
        shutil.rmtree(self.root / job_id, ignore_errors=True)

    def recover(self) -> None:
        with self.connect() as db:
            rows = db.execute("SELECT id,state FROM jobs WHERE state IN ('running','done','error','cancelled')").fetchall()
            db.execute("UPDATE jobs SET state='error',error='Обработка прервана перезапуском сервера. Загрузите файл повторно.' WHERE state='running'")
        for row in rows:
            self.clean_inputs(row['id'])
            if row['state'] != 'done':
                shutil.rmtree(self.root / row['id'] / 'output', ignore_errors=True)

    def clean_inputs(self, job_id: str) -> None:
        root = self.root / job_id
        shutil.rmtree(root / 'input', ignore_errors=True)
        shutil.rmtree(root / 'scratch', ignore_errors=True)
        (root / 'manifest.json').unlink(missing_ok=True)

    def expired(self) -> list[str]:
        with self.connect() as db:
            return [row['id'] for row in db.execute('SELECT id FROM jobs WHERE expires<=?', (time.time(),)).fetchall()]

    def public(self, job: dict) -> dict[str, Any]:
        state = job['state']
        batch = json.loads(job['batch_result']) if job.get('batch_result') else None
        progress: int | None = 100 if state == 'done' else 0
        stage = {'queued': 'В очереди', 'running': 'Подготавливаем обработку', 'done': 'Готово', 'error': 'Ошибка обработки', 'cancelled': 'Отменено'}[state]
        if state == 'done' and batch and batch['failed']:
            stage = 'Готово с ошибками'
        if state == 'running':
            try:
                current = json.loads((self.root / job['id'] / 'progress.json').read_text())
                progress, stage = current['progress'], current['stage']
            except (OSError, ValueError, KeyError):
                pass
        return {
            'batch': batch, 'id': job['id'], 'tool': job['tool'], 'names': json.loads(job['names']),
            'state': state, 'createdAt': job['created'], 'expiresAt': job['expires'],
            'inputSize': job['input_size'], 'outputSize': job['output_size'],
            'progress': progress, 'stage': stage, 'error': job['error'],
            'warnings': json.loads(job['warnings']),
            'downloadUrl': f"/api/v1/jobs/{job['id']}/download" if state == 'done' else None,
            'outputExtension': Path(job['output_file']).suffix if job['output_file'] else None,
        }


class JobManager:
    def __init__(self, store: JobStore, settings: Settings):
        self.store, self.settings = store, settings
        self.tasks: dict[str, asyncio.Task] = {}
        self.processes: dict[str, asyncio.subprocess.Process] = {}
        self.loop_task: asyncio.Task | None = None
        self.closed = False

    async def start(self) -> None:
        self.closed = False
        self.store.recover()
        self.loop_task = asyncio.create_task(self.loop())

    async def stop(self) -> None:
        self.closed = True
        if self.loop_task:
            self.loop_task.cancel()
            await asyncio.gather(self.loop_task, return_exceptions=True)
        for job_id in list(self.tasks):
            await self.cancel(job_id)

    async def loop(self) -> None:
        last_cleanup = 0.0
        while not self.closed:
            if time.monotonic() - last_cleanup > 30:
                for job_id in self.store.expired():
                    await self.cancel(job_id)
                    self.store.delete(job_id)
                # Orphan staging directories from interrupted uploads contain no DB row.
                for path in self.store.root.iterdir():
                    try:
                        if path.is_dir() and time.time() - path.stat().st_mtime > self.settings.retention_seconds and not self.store.get(path.name):
                            shutil.rmtree(path, ignore_errors=True)
                    except FileNotFoundError:
                        pass  # Concurrent cancellation/deletion already removed the staging directory.
                last_cleanup = time.monotonic()
            while len(self.tasks) < self.settings.concurrency:
                job = self.store.claim()
                if not job:
                    break
                task = asyncio.create_task(self.run(job))
                self.tasks[job['id']] = task
                task.add_done_callback(lambda _, jid=job['id']: self.tasks.pop(jid, None))
            await asyncio.sleep(0.2)

    async def kill(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        try:
            if os.name == 'posix':
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except ProcessLookupError:
            pass
        await process.wait()

    async def cancel(self, job_id: str) -> None:
        self.store.cancel(job_id)
        task = self.tasks.get(job_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self.store.clean_inputs(job_id)

    async def run(self, job: dict) -> None:
        job_id = job['id']
        root = self.store.root / job_id
        process = None
        try:
            allowed_env = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'STAMP_FONT_PATH', 'TESSDATA_PREFIX']
            env = {key: value for key, value in os.environ.items() if key in allowed_env}
            # Do not pass API session secrets or unrelated deployment credentials to parsers.
            env.update({
                'PYTHONPATH': str(Path(__file__).resolve().parents[1]),
                'GOTENBERG_URL': self.settings.gotenberg_url,
                'OFFICE_ENGINE': self.settings.office_engine,
                'LIBREOFFICE_BIN': self.settings.libreoffice_bin,
                'MAX_PAGES': str(self.settings.max_pages),
                'JOB_TIMEOUT_SECONDS': str(self.settings.job_timeout),
                'WORKER_MEMORY_MB': str(self.settings.worker_memory_mb),
                'DATA_DIR': str(root),
                'TOOLS_FILE': str(self.settings.tools_file),
                'MAX_OUTPUT_MB': str(self.settings.max_output_mb),
                'TMPDIR': str(root / 'scratch'),
                'OMP_NUM_THREADS': '1',
            })
            (root / 'scratch').mkdir(exist_ok=True, mode=0o700)
            process = await asyncio.create_subprocess_exec(
                sys.executable, '-m', 'app.worker', str(root / 'manifest.json'),
                cwd=root, env=env, stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                start_new_session=os.name == 'posix',
            )
            self.processes[job_id] = process
            try:
                return_code = await asyncio.wait_for(process.wait(), timeout=self.settings.job_timeout)
            except asyncio.TimeoutError:
                await self.kill(process)
                self.store.finish(job_id, 'error', error='Превышено время обработки. Уменьшите размер файла или число страниц.')
                return
            if return_code == 0:
                result = json.loads((root / 'result.json').read_text())
                filename = result['file']
                target = root / 'output' / filename
                if Path(filename).name != filename or not target.is_file() or target.is_symlink():
                    raise ValueError('Invalid result path')
                self.store.finish(job_id, 'done', result=result)
            else:
                error = 'Обработка остановлена. Возможно, превышен лимит памяти или файл повреждён.'
                try:
                    error = json.loads((root / 'error.json').read_text())['message']
                except (OSError, ValueError, KeyError):
                    pass
                self.store.finish(job_id, 'error', error=error)
        except asyncio.CancelledError:
            if process:
                await self.kill(process)
            raise
        except Exception:
            if process:
                await self.kill(process)
            self.store.finish(job_id, 'error', error='Внутренняя ошибка обработки. Попробуйте загрузить файл повторно.')
        finally:
            self.processes.pop(job_id, None)
            self.store.clean_inputs(job_id)
            current = self.store.get(job_id)
            if current and current['state'] != 'done':
                shutil.rmtree(root / 'output', ignore_errors=True)
