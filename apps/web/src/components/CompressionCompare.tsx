import { useEffect, useRef, useState } from 'react';
import type { Job } from '../lib/types';
import { resultFile } from '../lib/api';
import { bytes } from '../lib/catalog';
import { Icon } from './Icon';
import { PdfCanvas, usePdfDocument } from './PdfPreview';

function ComparisonPages({ original, result, password, job }: { original: File; result: File; password: string; job: Job }) {
  const before = usePdfDocument(original, password);
  const after = usePdfDocument(result, password);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [mobileView, setMobileView] = useState<'before' | 'after'>('after');
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const syncFrame = useRef<number | null>(null);
  useEffect(() => () => { if (syncFrame.current !== null) cancelAnimationFrame(syncFrame.current); }, []);
  useEffect(() => { for (const pane of [left.current, right.current]) pane?.scrollTo(0, 0); }, [page, zoom]);
  function synchronize(from: HTMLDivElement, to: HTMLDivElement | null) {
    if (!to || syncFrame.current !== null) return;
    to.scrollTop = from.scrollTop; to.scrollLeft = from.scrollLeft;
    syncFrame.current = requestAnimationFrame(() => { syncFrame.current = null; });
  }
  if (before.error || after.error) return <p className="inline-error" role="alert">{before.error || after.error}</p>;
  if (!before.pdf || !after.pdf) return <div className="loading-line"><Icon name="loading" className="spin" />Открываем исходник и результат</div>;
  const total = Math.min(before.pdf.numPages, after.pdf.numPages);
  return <>
    <div className="comparison-toolbar"><div className="preview-controls"><button type="button" className="icon-button" aria-label="Предыдущая страница сравнения" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><Icon name="chevron-left" /></button><span>Страница {page} / {total}</span><button type="button" className="icon-button" aria-label="Следующая страница сравнения" disabled={page >= total} onClick={() => setPage(value => value + 1)}><Icon name="chevron-right" /></button></div>
      <label className="comparison-zoom"><span>Масштаб</span><select aria-label="Масштаб сравнения" value={zoom} onChange={event => setZoom(Number(event.target.value))}><option value={1}>По ширине</option><option value={2}>Увеличить ×2</option><option value={3}>Увеличить ×3</option></select></label>
    </div>
    <div className="comparison-mobile-switch" role="group" aria-label="Показать версию"><button type="button" aria-pressed={mobileView === 'before'} onClick={() => setMobileView('before')}>До сжатия</button><button type="button" aria-pressed={mobileView === 'after'} onClick={() => setMobileView('after')}>После сжатия</button></div>
    <div className={`comparison-grid mobile-${mobileView}`}>
      <figure className="comparison-before"><figcaption><strong>До сжатия</strong><span>{bytes(original.size)}</span></figcaption><div className="comparison-scroll" tabIndex={0} role="region" aria-label="Просмотр исходника" ref={left} onScroll={event => synchronize(event.currentTarget, right.current)}><div style={{ width: `${zoom * 100}%` }}><PdfCanvas pdf={before.pdf} page={page} width={1800} label={`Исходник, страница ${page}`} /></div></div></figure>
      <figure className="comparison-after"><figcaption><strong>После сжатия</strong><span>{bytes(job.outputSize)}</span></figcaption><div className="comparison-scroll" tabIndex={0} role="region" aria-label="Просмотр результата" ref={right} onScroll={event => synchronize(event.currentTarget, left.current)}><div style={{ width: `${zoom * 100}%` }}><PdfCanvas pdf={after.pdf} page={page} width={1800} label={`Результат, страница ${page}`} /></div></div></figure>
    </div>
    <p className="comparison-note">Проверьте мелкие детали и текст внутри изображений. На увеличенном масштабе прокрутка двух версий синхронизирована.</p>
  </>;
}

export function CompressionCompare({ original, password, job }: { original: File; password: string; job: Job }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    if (result) return;
    const next = new AbortController(); controller.current = next;
    void resultFile(job, next.signal).then(file => { if (!next.signal.aborted) setResult(file); }).catch(failure => {
      if (!next.signal.aborted) setError(failure instanceof Error ? failure.message : 'Не удалось открыть результат.');
    });
    return () => next.abort();
  }, [open, result, job.id]);
  return <div className="compression-compare-entry"><button type="button" className="button secondary full" onClick={() => { setError(''); setOpen(true); }}><Icon name="eye" size={18} />Сравнить до и после</button><p>Исходник остаётся в браузере. Для сравнения загрузим только готовый результат.</p>
    <dialog ref={dialog} className="compression-compare-dialog" aria-label="Сравнение качества сжатия PDF" onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <header className="comparison-heading"><div><h2>До и после сжатия</h2><p>{original.name}</p></div><button type="button" className="icon-button" aria-label="Закрыть сравнение" onClick={() => setOpen(false)}><Icon name="x" /></button></header>
      {open && (error ? <p className="inline-error" role="alert">{error}</p> : result ? <ComparisonPages original={original} result={result} password={password} job={job} /> : <div className="loading-line"><Icon name="loading" className="spin" />Загружаем результат для сравнения</div>)}
    </dialog>
  </div>;
}
