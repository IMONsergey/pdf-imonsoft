import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, getConfig } from './api';
import type { ServerConfig } from './types';

type Status = 'checking' | 'online' | 'offline' | 'locked';
interface AppContext {
  config: ServerConfig | null; status: Status;
  refresh: () => Promise<void>; notify: (text: string) => void;
}
const Context = createContext<AppContext | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [status, setStatus] = useState<Status>('checking');
  const [toast, setToast] = useState({ text: '', revision: 0 });
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    try {
      const next = await getConfig(controller.signal);
      if (!controller.signal.aborted) { setConfig(next); setStatus('online'); }
    } catch (error) {
      if (controller.signal.aborted) return;
      const locked = error instanceof ApiError && error.status === 401;
      if (locked) setConfig(null);
      setStatus(locked ? 'locked' : 'offline');
    }
  }, []);
  useEffect(() => {
    const visibleRefresh = () => { if (!document.hidden) void refresh(); };
    const locked = () => { pending.current?.abort(); setConfig(null); setStatus('locked'); };
    void refresh(); const timer = setInterval(visibleRefresh, 30000);
    document.addEventListener('visibilitychange', visibleRefresh);
    window.addEventListener('online', visibleRefresh); window.addEventListener('imonsoft:locked', locked);
    return () => {
      clearInterval(timer); pending.current?.abort(); document.removeEventListener('visibilitychange', visibleRefresh);
      window.removeEventListener('online', visibleRefresh); window.removeEventListener('imonsoft:locked', locked);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast.text) return;
    const timer = setTimeout(() => setToast(current => ({ ...current, text: '' })), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = useCallback((text: string) => setToast(current => ({ text, revision: current.revision + 1 })), []);
  return <Context.Provider value={{ config, status, refresh, notify }}>
    {children}<div className={`toast ${toast.text ? 'visible' : ''}`} role="status" aria-live="polite">{toast.text}</div>
  </Context.Provider>;
}
export function useApp() { const value = useContext(Context); if (!value) throw new Error('AppProvider required'); return value; }
