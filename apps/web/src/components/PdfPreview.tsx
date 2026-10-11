import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Icon } from './Icon';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export function usePdfDocument(file: File, password = '', onCount?: (count: number) => void) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const onCountRef = useRef(onCount); onCountRef.current = onCount;
  useEffect(() => {
    let cancelled = false;
    let loading: { destroy: () => Promise<void> } | undefined;
    setPdf(null); setError(''); onCountRef.current?.(0);
    async function open() {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const data = await file.arrayBuffer();
      if (cancelled) return;
      const task = pdfjs.getDocument({ data, password });
      loading = task;
      task.onPassword = () => {
        if (!cancelled) setError('Нужен верный пароль PDF. Введите его в параметрах — предпросмотр откроется локально.');
        void task.destroy().catch(() => {});
      };
      const document = await task.promise;
      if (cancelled) { await task.destroy(); return; }
      setPdf(document); onCountRef.current?.(document.numPages);
    }
    // Avoid reopening an encrypted document for every keystroke.
    const timer = setTimeout(() => { void open().catch(() => {
      if (!cancelled) setError(value => value || 'Не удалось открыть предпросмотр. Проверьте файл и пароль.');
    }); }, password ? 350 : 0);
    return () => { cancelled = true; clearTimeout(timer); void loading?.destroy().catch(() => {}); };
  }, [file, password]);
  return { pdf, error };
}

export function PdfCanvas({ pdf, page, rotation = 0, width = 1000, label }: {
  pdf: PDFDocumentProxy; page: number; rotation?: number; width?: number; label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const lastRender = useRef<RenderTask | null>(null);
  useEffect(() => {
    let cancelled = false;
    let render: RenderTask | undefined;
    setError(false);
    async function draw() {
      await lastRender.current?.promise.catch(() => {});
      if (cancelled) return;
      const selected = await pdf.getPage(page);
      if (cancelled || !canvas.current) return;
      const angle = (selected.rotate + rotation) % 360;
      const natural = selected.getViewport({ scale: 1, rotation: angle });
      if (!(natural.width > 0 && natural.height > 0)) throw new Error('Invalid page geometry');
      const viewport = selected.getViewport({ scale: Math.min(width / natural.width, width / natural.height, 3), rotation: angle });
      const target = canvas.current;
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      render = selected.render({ canvas: target, canvasContext: target.getContext('2d')!, viewport });
      lastRender.current = render;
      await render.promise;
    }
    void draw().catch(failure => { if (!cancelled && failure?.name !== 'RenderingCancelledException') setError(true); });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, page, rotation, width]);
  return error ? <p className="preview-error">Не удалось отобразить страницу {page}.</p> : <canvas ref={canvas} role="img" aria-label={label || `Страница ${page}`} />;
}

export function PdfPreview({ file, password = '', onCount }: { file: File; password?: string; onCount: (count: number) => void }) {
  const { pdf, error } = usePdfDocument(file, password, onCount);
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState('1');
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setPage(1); }, [file]);
  useEffect(() => setJump(String(page)), [page]);
  useEffect(() => { if (expanded) dialog.current?.showModal(); else dialog.current?.close(); }, [expanded]);
  function commitJump() {
    const next = Number(jump);
    setPage(Number.isInteger(next) && next >= 1 && next <= (pdf?.numPages || 1) ? next : page);
    if (!Number.isInteger(next) || next < 1 || next > (pdf?.numPages || 1)) setJump(String(page));
  }
  return <section className="pdf-preview" aria-label="Предпросмотр PDF">
    <div className="preview-heading"><span><Icon name="eye" size={16} />Предпросмотр</span><span>Локально в браузере</span>
      {pdf && <button type="button" className="icon-button" aria-label="Увеличить предпросмотр" onClick={() => setExpanded(true)}><Icon name="resize" size={17} /></button>}
    </div>
    <div className="preview-canvas">{error ? <p className="preview-error"><Icon name="info" />{error}</p> : pdf ? <PdfCanvas pdf={pdf} page={page} /> : <div className="loading-line"><Icon name="loading" className="spin" />Открываем документ</div>}</div>
    {pdf && !error && <div className="preview-controls">
      <button type="button" className="icon-button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Предыдущая страница"><Icon name="chevron-left" size={17} /></button>
      <label className="page-jump"><span className="visually-hidden">Перейти к странице</span><input type="number" min={1} max={pdf.numPages} value={jump} onChange={event => setJump(event.target.value)} onBlur={commitJump} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitJump(); } }} /><span>/ {pdf.numPages}</span></label>
      <button type="button" className="icon-button" disabled={page >= pdf.numPages} onClick={() => setPage(page + 1)} aria-label="Следующая страница"><Icon name="chevron-right" size={17} /></button>
    </div>}
    <dialog ref={dialog} className="preview-dialog" aria-label="Увеличенный предпросмотр PDF" onClose={() => setExpanded(false)} onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
      <div className="preview-dialog-content"><div className="preview-dialog-heading"><span>{file.name} · {page} / {pdf?.numPages}</span><button type="button" className="icon-button" aria-label="Закрыть предпросмотр" onClick={() => setExpanded(false)}><Icon name="x" /></button></div>
        {expanded && pdf && <><PdfCanvas pdf={pdf} page={page} width={1700} label={`Увеличенная страница ${page}`} />
          <div className="preview-controls"><button type="button" className="icon-button" disabled={page <= 1} aria-label="Предыдущая страница" onClick={() => setPage(value => value - 1)}><Icon name="chevron-left" /></button><span>{page} / {pdf.numPages}</span><button type="button" className="icon-button" disabled={page >= pdf.numPages} aria-label="Следующая страница" onClick={() => setPage(value => value + 1)}><Icon name="chevron-right" /></button></div>
        </>}
      </div>
    </dialog>
  </section>;
}
