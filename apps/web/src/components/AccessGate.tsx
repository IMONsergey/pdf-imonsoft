import { useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { useApp } from '../lib/context';
import { login } from '../lib/api';
import { brand } from '../lib/brand';
import { Icon } from './Icon';

export function AccessGate({ children }: { children: ReactNode }) {
  const { status, refresh } = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !password) return;
    setBusy(true); setError('');
    try { await login(password); setPassword(''); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось войти.'); }
    finally { setBusy(false); }
  }
  if (status !== 'locked') return children;
  return <main className="access-screen"><div className="access-card"><p className="eyebrow">{brand.name} / FILES</p><Icon name="lock" size={32} /><h1>Ваше рабочее пространство</h1><p>Введите пароль для доступа к инструментам и обработке файлов.</p>
    <form onSubmit={event => { void submit(event); }}><label className="field"><span>Пароль</span><input autoFocus type="password" autoComplete="current-password" required maxLength={1024} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      {error && <p className="inline-error" role="alert">{error}</p>}<button type="submit" className="button primary full" disabled={busy || !password}>{busy ? 'Входим…' : 'Войти'}<Icon name={busy ? 'loading' : 'arrow-right'} className={busy ? 'spin' : ''} size={18} /></button>
    </form><p className="access-note">Пароль устанавливает владелец сервера. Это закрытое пространство, а не регистрация в стороннем сервисе.</p>
  </div></main>;
}
