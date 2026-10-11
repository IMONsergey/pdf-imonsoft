"""Optional shared-password access for a private workspace, not multi-user SSO."""
from __future__ import annotations
import asyncio
import hashlib
import hmac
import json
import re
import secrets
import time
from collections import OrderedDict
from fastapi import HTTPException, Request


def hash_password(password: str) -> str:
    if not 12 <= len(password) <= 1024:
        raise ValueError('Пароль должен содержать 12–1024 символа.')
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32).hex()
    return f'scrypt:{salt}:{digest}'


def verify_password(password: str, encoded: str) -> bool:
    if not re.fullmatch(r'scrypt:[a-f0-9]{32}:[a-f0-9]{64}', encoded):
        return False
    _, salt, expected = encoded.split(':')
    try:
        encoded_password = password.encode('utf-8')
    except UnicodeEncodeError:
        return False
    actual = hashlib.scrypt(encoded_password, salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32).hex()
    return hmac.compare_digest(actual, expected)


class WindowLimit:
    """Single-process rolling window with bounded cardinality. Not a distributed limiter."""
    def __init__(self, limit: int, seconds: int, max_keys: int = 4096):
        self.limit, self.seconds, self.max_keys = limit, seconds, max_keys
        self.events: OrderedDict[str, list[float]] = OrderedDict()

    def take(self, key: str) -> bool:
        now = time.monotonic()
        entries = [value for value in self.events.pop(key, []) if value > now - self.seconds]
        allowed = len(entries) < self.limit
        if allowed:
            entries.append(now)
        self.events[key] = entries
        while len(self.events) > self.max_keys:
            self.events.popitem(last=False)
        return allowed


class AccessControl:
    def __init__(self, settings):
        self.encoded = settings.access_password_hash
        if self.encoded and not re.fullmatch(r'scrypt:[a-f0-9]{32}:[a-f0-9]{64}', self.encoded):
            raise ValueError('ACCESS_PASSWORD_HASH must be created by python -m app.access')
        self.enabled = bool(self.encoded)
        self.fingerprint = hmac.new(settings.session_secret().encode(), self.encoded.encode(), hashlib.sha256).hexdigest()
        self.attempts = WindowLimit(8, 300)
        self.checks = asyncio.Semaphore(2)

    async def require(self, request: Request):
        if request.scope['path'] in ('/api/health', '/api/v1/access', '/api/v1/access/login', '/api/v1/access/logout'):
            return
        if self.enabled and not hmac.compare_digest(str(request.session.get('access', '')), self.fingerprint):
            raise HTTPException(401, 'Для доступа к рабочему пространству войдите с паролем.')

    def register(self, app):
        @app.get('/api/v1/access')
        async def status(request: Request):
            return {'enabled': self.enabled, 'authenticated': not self.enabled or hmac.compare_digest(str(request.session.get('access', '')), self.fingerprint)}

        @app.post('/api/v1/access/login')
        async def login(request: Request):
            if not self.enabled:
                return {'authenticated': True}
            # Do not trust client-supplied X-Forwarded-For. Behind nginx this is a conservative shared cap.
            peer = request.client.host if request.client else 'unknown'
            if not self.attempts.take(peer):
                raise HTTPException(429, 'Слишком много попыток входа. Подождите пять минут.', headers={'Retry-After': '300'})
            if self.checks.locked():
                raise HTTPException(429, 'Проверка входа занята. Повторите через несколько секунд.')
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 8192:
                    raise HTTPException(413, 'Запрос входа слишком большой.')
            try:
                body = json.loads(raw)
                password = body['password']
                if not isinstance(password, str) or not 1 <= len(password) <= 1024:
                    raise ValueError
            except (ValueError, KeyError, TypeError):
                raise HTTPException(422, 'Введите пароль рабочего пространства.') from None
            async with self.checks:
                valid = await asyncio.to_thread(verify_password, password, self.encoded)
            if not valid:
                raise HTTPException(401, 'Неверный пароль.')
            request.session.clear()
            request.session.update(id=secrets.token_urlsafe(32), access=self.fingerprint)
            return {'authenticated': True}

        @app.post('/api/v1/access/logout')
        async def logout(request: Request):
            request.session.clear()
            return {'authenticated': False}


if __name__ == '__main__':
    from getpass import getpass
    try:
        first = getpass('Новый пароль пространства (не менее 12 символов): ')
        second = getpass('Повторите пароль: ')
        if first != second:
            raise ValueError('Пароли не совпадают.')
        encoded = hash_password(first)
    except (ValueError, KeyboardInterrupt, EOFError) as error:
        raise SystemExit(str(error) or 'Отменено.') from None
    print('Добавьте следующую строку в локальный .env и пересоздайте API-контейнер:')
    print('ACCESS_PASSWORD_HASH=' + encoded)
