import type { Job, Options, ServerConfig } from './types';

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); this.name = 'ApiError'; }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init,
      headers: { 'X-IMONSOFT-Client': 'web', ...init.headers },
      signal: init.signal || AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Нет соединения с сервером. Проверьте подключение и повторите попытку.');
  }
  if (!response.ok) {
    let message = `Ошибка сервера (${response.status}).`;
    try { const body = await response.json(); if (typeof body.detail === 'string') message = body.detail; } catch { /* Non-JSON gateway errors */ }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new ApiError('Сервер вернул некорректный ответ. Проверьте подключение API.'); }
}
export const getConfig = (signal?: AbortSignal) => request<ServerConfig>('/api/v1/config', { signal });
export const getJobs = (signal?: AbortSignal) => request<{ jobs: Job[] }>('/api/v1/jobs', { signal });
export const getJob = (id: string, signal?: AbortSignal) => request<Job>(`/api/v1/jobs/${encodeURIComponent(id)}`, { signal });
export const cancelJob = (id: string) => request<Job>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export const deleteJob = (id: string) => request<void>(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });

export function uploadJob(tool: string, options: Options, files: File[], onProgress: (percent: number) => void, signal: AbortSignal): Promise<Job> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('tool', tool); body.append('options', JSON.stringify(options));
    files.forEach(file => body.append('files', file, file.name));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/jobs');
    xhr.setRequestHeader('X-IMONSOFT-Client', 'web');
    xhr.withCredentials = true; xhr.timeout = 180000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(100 * event.loaded / event.total)); };
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => signal.removeEventListener('abort', abort);
    xhr.onerror = () => { cleanup(); reject(new ApiError('Загрузка прервана. Проверьте соединение с сервером.')); };
    xhr.ontimeout = () => { cleanup(); reject(new ApiError('Превышено время загрузки. Попробуйте файл меньшего размера.')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('Загрузка отменена', 'AbortError')); };
    xhr.onload = () => {
      cleanup();
      let parsed: unknown;
      try { parsed = JSON.parse(xhr.responseText); }
      catch { reject(new ApiError(`Некорректный ответ сервера (${xhr.status}).`)); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        const detail = (parsed as { detail?: unknown }).detail;
        reject(new ApiError(typeof detail === 'string' ? detail : `Ошибка загрузки (${xhr.status}).`, xhr.status));
      } else { resolve(parsed as Job); }
    };
    if (signal.aborted) { reject(new DOMException('Загрузка отменена', 'AbortError')); return; }
    xhr.send(body);
  });
}
