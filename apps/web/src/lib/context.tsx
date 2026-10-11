import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getConfig } from './api';
import type { ServerConfig } from './types';

type Status = 'checking' | 'online' | 'offline';
interface AppContext {
  config: ServerConfig | null; status: Status;
  refresh: () => Promise<void>; notify: (text: string) => void;
}
const Context = createContext<AppContext | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [status, setStatus] = useState<Status>('checking');
  const [toast, setToast] = useState('');
  const refresh = useCallback(async () => {
    try { setConfig(await getConfig()); setStatus('online'); }
    catch { setStatus('offline'); }
  }, []);
  useEffect(() => { void refresh(); const id = setInterval(() => { void refresh(); }, 30000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 2600); return () => clearTimeout(id); }, [toast]);
  const notify = useCallback((text: string) => setToast(text), []);
  return <Context.Provider value={{ config, status, refresh, notify }}>
    {children}<div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast}</div>
  </Context.Provider>;
}
export function useApp() { const value = useContext(Context); if (!value) throw new Error('AppProvider required'); return value; }
