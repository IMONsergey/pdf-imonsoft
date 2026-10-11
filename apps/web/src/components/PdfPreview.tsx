import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Icon } from './Icon';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export function PdfPreview({ file, onCount }: { file: File; onCount: (count: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const document = useRef<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const onCountRef = useRef(onCount); onCountRef.current = onCount;
  useEffect(() => {
    let cancelled = false;
    let loading: { destroy: () => Promise<void> } | undefined;
    setPage(1); setReady(false); setError('');
    async function open() {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const data = await file.arrayBuffer();
      if (cancelled) return;
      const task = pdfjs.getDocument({ data });
      loading = task;
      // Protected files remain usable through the server's password option.
      task.onPassword = () => { setError('Предпросмотр защищённого PDF недоступен. Укажите пароль в параметрах.'); void task.destroy(); };
      const pdf = await task.promise;
      if (cancelled) { await task.destroy(); return; }
      document.current = pdf; setCount(pdf.numPages); onCountRef.current(pdf.numPages); setReady(true);
    }
    void open().catch(() => { if (!cancelled) setError(current => current || 'Не удалось открыть предпросмотр. Файл можно проверить при обработке.'); });
    return () => { cancelled = true; document.current = null; void loading?.destroy().catch(() => {}); };
  }, [file]);
  useEffect(() => {
    if (!ready || !document.current || !canvas.current) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    const pdf = document.current;
    async function draw() {
      const selected = await pdf.getPage(page);
      if (cancelled || !canvas.current) return;
      const natural = selected.getViewport({ scale: 1 });
      const viewport = selected.getViewport({ scale: Math.min(2, 920 / natural.width, 660 / natural.height) });
      const target = canvas.current;
      target.width = viewport.width; target.height = viewport.height;
      render = selected.render({ canvas: target, canvasContext: target.getContext('2d')!, viewport });
      await render.promise;
    }
    void draw().catch(error => { if (!cancelled && error?.name !== 'RenderingCancelledException') setError('Ошибка отображения страницы.'); });
    return () => { cancelled = true; render?.cancel(); };
  }, [ready, page]);
  return <section className="pdf-preview" aria-label="Предпросмотр PDF">
    <div className="preview-heading"><span><Icon name="eye" size={16} /> Предпросмотр</span><span>Локально в браузере</span></div>
    <div className="preview-canvas">
      {error ? <p className="preview-error"><Icon name="info" />{error}</p> : <>
        {!ready && <div className="loading-line"><Icon name="loading" className="spin" />Открываем документ</div>}
        <canvas ref={canvas} aria-label={`Страница ${page}`} hidden={!ready} />
      </>}
    </div>
    {ready && !error && <div className="preview-controls">
      <button type="button" className="icon-button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Предыдущая страница"><Icon name="chevron-left" size={17} /></button>
      <span>{page} <span className="muted">/ {count}</span></span>
      <button type="button" className="icon-button" disabled={page >= count} onClick={() => setPage(page + 1)} aria-label="Следующая страница"><Icon name="chevron-right" size={17} /></button>
    </div>}
  </section>;
}
