import { useEffect, useRef, useState } from 'react';
import type { PageSpec } from '../lib/types';
import { useApp } from '../lib/context';
import { PdfCanvas, usePdfDocument } from './PdfPreview';
import { Icon } from './Icon';

const WINDOW = 24;
export function PageOrganizer({ file, password, value, onChange, onCount, disabled }: {
  file: File; password: string; value: PageSpec[]; onChange: (value: PageSpec[]) => void;
  onCount: (count: number) => void; disabled: boolean;
}) {
  const { pdf, error } = usePdfDocument(file, password, onCount);
  const { config, notify } = useApp();
  const [windowIndex, setWindowIndex] = useState(0);
  const [dragged, setDragged] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const past = useRef<PageSpec[][]>([]);
  const future = useRef<PageSpec[][]>([]);
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const maxPages = config?.maxPages || 200;
  useEffect(() => {
    if (!pdf || pdf.numPages > maxPages) return;
    changeRef.current(Array.from({ length: pdf.numPages }, (_, index) => ({ page: index + 1, rotation: 0 })));
    past.current = []; future.current = []; setWindowIndex(0); setRevision(v => v + 1);
  }, [pdf, maxPages]);
  useEffect(() => { setWindowIndex(index => Math.min(index, Math.max(0, Math.ceil(value.length / WINDOW) - 1))); }, [value.length]);
  function apply(next: PageSpec[], message: string) {
    if (disabled || !next.length) return;
    past.current = [...past.current.slice(-39), value]; future.current = [];
    onChange(next); setRevision(v => v + 1); notify(message);
  }
  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
    const next = [...value]; const [entry] = next.splice(from, 1); next.splice(to, 0, entry);
    apply(next, `Страница ${entry.page}: позиция ${to + 1}`);
  }
  function undo() {
    const previous = past.current.pop(); if (!previous || disabled) return;
    future.current.push(value); onChange(previous); setRevision(v => v + 1); notify('Изменение отменено');
  }
  function redo() {
    const next = future.current.pop(); if (!next || disabled) return;
    past.current.push(value); onChange(next); setRevision(v => v + 1); notify('Изменение повторено');
  }
  if (error) return <p className="inline-error" role="alert">{error}</p>;
  if (!pdf) return <div className="loading-line"><Icon name="loading" className="spin" />Открываем страницы</div>;
  if (pdf.numPages > maxPages) return <p className="inline-error">В документе больше {maxPages} страниц. Выберите меньший файл.</p>;
  const visible = value.slice(windowIndex * WINDOW, (windowIndex + 1) * WINDOW);
  return <section className="page-organizer" aria-label="Редактор порядка страниц" data-revision={revision}>
    <div className="organizer-toolbar"><span><strong>{value.length}</strong> из {pdf.numPages} страниц</span><div className="organizer-history">
      <button type="button" className="button secondary compact-button" disabled={disabled || !past.current.length} onClick={undo}>Отменить</button>
      <button type="button" className="button secondary compact-button" disabled={disabled || !future.current.length} onClick={redo}>Повторить</button>
    </div></div>
    <p className="organizer-hint">Перетащите миниатюры для изменения порядка. На телефоне или с клавиатуры используйте стрелки под страницей.</p>
    <div className="organizer-quick-actions">
      <button type="button" className="text-button" disabled={disabled || value.length < 2} onClick={() => apply([...value].reverse(), 'Порядок страниц изменён на обратный')}>Обратный порядок</button>
      <button type="button" className="text-button" disabled={disabled} onClick={() => apply(Array.from({ length: pdf.numPages }, (_, index) => ({ page: index + 1, rotation: 0 })), 'Исходный порядок восстановлен')}>Вернуть исходные</button>
    </div>
    <div className="page-grid">{visible.map((item, position) => {
      const index = windowIndex * WINDOW + position;
      return <article className={`page-tile ${dragged === item.page ? 'dragged' : ''}`} key={item.page} data-page={item.page} draggable={!disabled}
        onDragStart={event => { if (disabled) { event.preventDefault(); return; } event.dataTransfer.setData('application/x-imonsoft-page', String(item.page)); event.dataTransfer.effectAllowed = 'move'; setDragged(item.page); }}
        onDragEnd={() => setDragged(null)} onDragOver={event => { if (!disabled && event.dataTransfer.types.includes('application/x-imonsoft-page')) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); if (disabled) return; const from = value.findIndex(entry => entry.page === Number(event.dataTransfer.getData('application/x-imonsoft-page'))); reorder(from, index); setDragged(null); }}>
        <div className="page-thumbnail"><PdfCanvas pdf={pdf} page={item.page} rotation={item.rotation} width={320} label={`Миниатюра страницы ${item.page}`} /></div>
        <div className="page-tile-label"><strong>Страница {item.page}</strong><span>{index + 1}{item.rotation ? ` · +${item.rotation}°` : ''}</span></div>
        <div className="page-tile-actions">
          <button type="button" className="icon-button" disabled={disabled || index === 0} aria-label={`Страница ${item.page}: переместить выше`} onClick={() => reorder(index, index - 1)}><Icon name="arrow-left" size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled || index === value.length - 1} aria-label={`Страница ${item.page}: переместить ниже`} onClick={() => reorder(index, index + 1)}><Icon name="arrow-right" size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled} aria-label={`Повернуть страницу ${item.page}`} onClick={() => apply(value.map(entry => entry.page === item.page ? { ...entry, rotation: ((entry.rotation + 90) % 360) as PageSpec['rotation'] } : entry), `Страница ${item.page} повёрнута`)}><Icon name="rotate" size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled || value.length === 1} aria-label={`Удалить страницу ${item.page}`} onClick={() => apply(value.filter(entry => entry.page !== item.page), `Страница ${item.page} исключена`)}><Icon name="remove" size={16} /></button>
        </div>
      </article>;
    })}</div>
    {value.length > WINDOW && <div className="preview-controls"><button type="button" className="icon-button" disabled={windowIndex === 0} aria-label="Предыдущие миниатюры" onClick={() => setWindowIndex(windowIndex - 1)}><Icon name="chevron-left" /></button><span>{windowIndex * WINDOW + 1}–{Math.min(value.length, (windowIndex + 1) * WINDOW)} / {value.length}</span><button type="button" className="icon-button" disabled={(windowIndex + 1) * WINDOW >= value.length} aria-label="Следующие миниатюры" onClick={() => setWindowIndex(windowIndex + 1)}><Icon name="chevron-right" /></button></div>}
  </section>;
}
