import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, cancelJob, getJob, uploadJob, continueJob, resultFile } from '../lib/api';
import { bytes, formats, retention } from '../lib/catalog';
import { useApp } from '../lib/context';
import type { Job, Options, PickedFile, Tool } from '../lib/types';
import { Icon } from '../components/Icon';
import { PdfPreview } from '../components/PdfPreview';
import { PageOrganizer } from '../components/PageOrganizer';
import { PostProcess } from '../components/PostProcess';
import { defaultOptions, SettingsFields } from '../components/SettingsFields';
import { JobStatus } from '../components/JobStatus';
import { pageRangeError } from '../lib/pages';
import { CompressionCompare } from '../components/CompressionCompare';

function ImagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return <div className="image-preview"><img src={url} alt={`Предпросмотр: ${file.name}`} /></div>;
}

export function Workspace({ tool }: { tool: Tool }) {
  const { config, status, refresh, notify } = useApp();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [options, setOptions] = useState<Options>({ ...defaultOptions });
  const sourceId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('source');
  const [source, setSource] = useState<Job | null>(null);
  const [sourcePreview, setSourcePreview] = useState<PickedFile | null>(null);
  const [sourceLoading, setSourceLoading] = useState(Boolean(sourceId));
  const [previewId, setPreviewId] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const dragDepth = useRef(0);
  const maxFiles = config?.maxFiles || 20;
  const maxBytes = (config?.maxUploadMb || 50) * 1024 * 1024;
  const total = source?.outputSize || files.reduce((sum, entry) => sum + entry.file.size, 0);
  const preview = files.find(entry => entry.id === previewId) || files[0] || sourcePreview;
  const busy = uploading || job?.state === 'running' || job?.state === 'queued';
  const frozen = Boolean(busy || job?.state === 'done');
  const ready = status === 'online' && config?.tools.find(item => item.id === tool.id)?.available;
  const tooManyPages = !options.batch && pageCount > (config?.maxPages || 200);
  const enoughFiles = !sourceLoading && (Boolean(source) || files.length >= tool.minFiles);
  const multiple = tool.multiple || options.batch;
  const rangeError = tool.settings.includes('pages') ? pageRangeError(options.pages, options.batch ? 0 : pageCount) : '';
  const planMissing = tool.id === 'organize-pdf' && (options.page_plan.length === 0 || pageCount === 0);

  useEffect(() => () => uploadController.current?.abort(), []);
  useEffect(() => { setPageCount(0); }, [preview?.id]);
  useEffect(() => {
    if (!sourceId) return;
    const controller = new AbortController(); let cancelled = false;
    async function load() {
      const previous = await getJob(sourceId!, controller.signal);
      if (previous.state !== 'done' || !tool.accept.includes(previous.outputExtension || '') || tool.minFiles !== 1) throw new Error('Результат несовместим с этим инструментом.');
      if ((previous.outputSize || 0) > maxBytes) throw new Error('Результат превышает лимит входного файла.');
      if (cancelled) return;
      setSource(previous);
      if (/^\.(pdf|png|jpe?g|webp|bmp)$/.test(previous.outputExtension || '')) {
        const file = await resultFile(previous, controller.signal);
        if (!cancelled) setSourcePreview({ id: `source-${previous.id}`, file });
      }
    }
    void load().catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Не удалось открыть результат.'); }).finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [sourceId, tool.id, maxBytes]);
  useEffect(() => {
    if (tool.engine !== 'ocr' || !config) return;
    const languages = config.engines.ocrLanguages;
    const language = languages.includes('eng') && languages.includes('rus') ? 'eng+rus' : languages[0] || 'eng';
    setOptions(previous => ({ ...previous, language }));
  }, [config?.engines.ocrLanguages.join(','), tool.engine]);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.state)) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController(); const id = job.id;
    async function poll() {
      try {
        const next = await getJob(id, controller.signal);
        if (stopped) return;
        setJob(next); setPollError('');
        if (next.state === 'done') { notify('Файл обработан. Результат готов к скачиванию.'); return; }
        if (next.state === 'error' || next.state === 'cancelled') return;
        timer = setTimeout(() => { void poll(); }, 1000);
      } catch (failure) {
        if (stopped) return;
        if (failure instanceof ApiError && failure.status === 404) {
          setJob(current => current ? { ...current, state: 'error', stage: 'Задача недоступна', error: failure.message } : null); return;
        }
        setPollError('Не удалось обновить статус. Повторяем подключение…');
        timer = setTimeout(() => { void poll(); }, 4000);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [job?.id, job?.state, notify]);

  function add(incoming: FileList | File[]) {
    if (frozen) return;
    const additions = Array.from(incoming); if (!additions.length) return;
    const unsupported = additions.filter(file => !tool.accept.includes('.' + (file.name.split('.').pop() || '').toLowerCase()));
    if (unsupported.length) { setError(`Не подходит формат файла «${unsupported[0].name}». Допустимы: ${formats(tool)}.`); return; }
    if (!tool.multiple && !tool.batch && additions.length > 1) { setError('Для этой операции выберите один файл.'); return; }
    const batch = !tool.multiple && tool.batch && (options.batch || additions.length > 1);
    const entries = additions.map(file => ({ id: crypto.randomUUID(), file }));
    const next = tool.multiple || batch ? [...files, ...entries] : entries;
    if (next.length > maxFiles) { setError(`За один раз можно загрузить не более ${maxFiles} файлов.`); return; }
    if (next.some(entry => entry.file.size === 0)) { setError('Пустой файл обработать нельзя.'); return; }
    if (next.reduce((sum, entry) => sum + entry.file.size, 0) > maxBytes) { setError(`Суммарный размер превышает ${config?.maxUploadMb || 50} МБ.`); return; }
    if (tool.id === 'organize-pdf') { setOptions(previous => ({ ...previous, page_plan: [] })); setPageCount(0); }
    setFiles(next); setSource(null); setSourcePreview(null); setError(''); setJob(null);
    if (batch) setOptions(previous => ({ ...previous, batch: true }));
    if (!multiple) setPreviewId(next[0].id);
  }
  function move(index: number, direction: number) {
    const next = [...files];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setFiles(next); notify('Порядок файлов изменён');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy || submitting.current || !enoughFiles || tooManyPages || rangeError || planMissing) return;
    submitting.current = true;
    setError(''); setPollError(''); setUploading(true); setUploadPercent(0); setJob(null);
    const controller = new AbortController(); uploadController.current = controller;
    try {
      const keys = [...tool.settings];
      if (tool.postprocess) {
        keys.push('postprocess');
        if (options.postprocess === 'watermark') keys.push('text', 'watermark_opacity', 'watermark_angle');
        if (options.postprocess === 'number') keys.push('start');
        if (options.postprocess === 'compress') keys.push('compression', 'compression_dpi', 'compression_quality');
      }
      const relevant = Object.fromEntries(keys.map(key => [key, options[key]]));
      if (tool.batch) relevant.batch = options.batch && !source;
      const created = source ? await continueJob(source.id, tool.id, relevant, controller.signal) : await uploadJob(tool.id, relevant, files.map(entry => entry.file), setUploadPercent, controller.signal);
      setJob(created); setOptions(previous => ({ ...previous, new_password: '' }));
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить файл.');
    } finally { setUploading(false); uploadController.current = null; submitting.current = false; }
  }
  async function cancel() {
    if (uploading) { uploadController.current?.abort(); notify('Загрузка отменена'); return; }
    if (!job) return;
    try { setJob(await cancelJob(job.id)); notify('Обработка отменена'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось отменить задачу.'); }
  }
  function reset() {
    if (sourceId && job?.state === 'done') { window.location.hash = `/tools/${tool.id}`; return; }
    if (job?.state === 'done') { setSource(null); setSourcePreview(null); setFiles([]); setPageCount(0); setOptions(previous => ({ ...defaultOptions, language: previous.language })); }
    setJob(null); setError(''); setPollError('');
  }
  return <>
    <a href="#/" className="back-link"><Icon name="arrow-left" size={17} />Все инструменты</a>
    <header className="workspace-heading"><span className="tool-icon heading-icon"><Icon name={tool.icon} size={29} /></span><div><p className="eyebrow">{formats(tool)} <span>→</span> {tool.output}</p><h1>{tool.title}</h1><p>{tool.description}</p></div></header>
    {!ready && <div className="connection-notice"><Icon name="alert" size={20} /><div><strong>{status === 'checking' ? 'Проверяем доступность сервера' : status === 'offline' ? 'Сервер обработки не подключён' : 'Движок этого инструмента недоступен'}</strong><p>{status === 'offline' ? 'Файл можно выбрать для предпросмотра. Для конвертации нужен запущенный API.' : tool.engine === 'office' ? 'Для преобразования Office-документов должен работать Gotenberg.' : 'Обработка станет доступна после подключения движка.'}</p></div><button type="button" className="icon-button" onClick={() => { void refresh(); }} aria-label="Проверить подключение"><Icon name="refresh" size={19} /></button></div>}
    <form className="workspace-grid" onSubmit={event => { void submit(event); }}>
      <section className="workspace-files" aria-labelledby="files-heading">
        <div className="panel-heading"><h2 id="files-heading"><span className="step-number">01</span>Ваши файлы</h2><span>{source ? `Результат · ${bytes(total)}` : files.length ? `${files.length} файл. · ${bytes(total)}` : 'Начните с загрузки'}</span></div>
        {sourceLoading && <div className="loading-line"><Icon name="loading" className="spin" />Открываем предыдущий результат</div>}
        {source && <div className="source-result"><Icon name="history" size={20} /><div><strong>{source.names[0]}</strong><p>Готовый {source.outputExtension?.slice(1).toUpperCase()} · новая загрузка не потребуется</p></div><button type="button" className="icon-button" disabled={frozen} aria-label="Убрать предыдущий результат" onClick={() => { window.location.hash = `/tools/${tool.id}`; }}><Icon name="x" size={18} /></button></div>}
        {tool.batch && !source && <label className="batch-mode"><input type="checkbox" checked={options.batch} disabled={frozen || files.length > 1} onChange={event => setOptions({ ...options, batch: event.target.checked })} /><span><strong>Пакетная обработка</strong><small>Одинаковые параметры для каждого файла, отдельные результаты в ZIP.</small></span></label>}
        {!source && <fieldset disabled={frozen} className="file-fieldset">
          <div className={`dropzone ${drag ? 'dragging' : ''} ${files.length ? 'compact' : ''}`}
            onDragEnter={event => { event.preventDefault(); dragDepth.current++; setDrag(true); }}
            onDragOver={event => event.preventDefault()}
            onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDrag(false); }}
            onDrop={event => { event.preventDefault(); setDrag(false); dragDepth.current = 0; add(event.dataTransfer.files); }}>
            <input ref={input} type="file" data-testid="file-input" className="visually-hidden" tabIndex={-1} accept={tool.accept.join(',')} multiple={tool.multiple || tool.batch} onChange={event => { if (event.target.files) add(event.target.files); event.target.value = ''; }} aria-label="Выбрать файлы" />
            <button type="button" className="drop-target" onClick={() => input.current?.click()}><span className="upload-symbol"><Icon name={files.length ? 'plus' : 'upload'} size={files.length ? 21 : 29} /></span><strong>{files.length ? multiple ? 'Добавить файлы' : 'Выбрать другой файл' : 'Перетащите файл сюда'}</strong><span>{files.length ? formats(tool) : <>или <em>выберите на устройстве</em></>}</span>{!files.length && <small>{formats(tool)} · до {config?.maxUploadMb || 50} МБ{tool.multiple || tool.batch ? ` · до ${maxFiles} файлов` : ''}</small>}</button>
          </div>
          {files.length > 0 && <div className="picked-files">{files.map((entry, index) => <div className={`picked-file ${preview?.id === entry.id ? 'selected' : ''}`} key={entry.id}>
            <span className="file-sequence">{String(index + 1).padStart(2, '0')}</span>
            <button type="button" className="file-info" onClick={() => setPreviewId(entry.id)} title={entry.file.name}><strong>{entry.file.name}</strong><span>{bytes(entry.file.size)}{preview?.id === entry.id && pageCount > 0 ? ` · ${pageCount} стр.` : ''}</span></button>
            <div className="file-actions">{multiple && <><button type="button" className="icon-button" aria-label={`Переместить файл ${index + 1} выше`} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="arrow-up" size={16} /></button><button type="button" className="icon-button" aria-label={`Переместить файл ${index + 1} ниже`} disabled={index === files.length - 1} onClick={() => move(index, 1)}><Icon name="arrow-down" size={16} /></button></>}
              <button type="button" className="icon-button" aria-label={`Убрать ${entry.file.name}`} onClick={() => { setFiles(files.filter(item => item.id !== entry.id)); setError(''); }}><Icon name="x" size={17} /></button></div>
          </div>)}</div>}
        </fieldset>}
        {files.length > 0 && !enoughFiles && <p className="file-hint"><Icon name="info" size={16} />Добавьте ещё файл: для объединения нужно минимум два.</p>}
        {tooManyPages && <p className="inline-error">В документе {pageCount} страниц. Лимит сервера — {config?.maxPages || 200}.</p>}
        {preview && preview.file.name.toLowerCase().endsWith('.pdf') && (tool.id === 'organize-pdf'
          ? <PageOrganizer key={preview.id} file={preview.file} password={options.password} value={options.page_plan} onChange={plan => setOptions(previous => ({ ...previous, page_plan: plan }))} onCount={setPageCount} disabled={frozen} />
          : <PdfPreview key={preview.id} file={preview.file} password={options.password} onCount={setPageCount} />)}
        {tool.id === 'compress-pdf' && job?.state === 'done' && !job.batch && preview && <CompressionCompare key={job.id} original={preview.file} password={options.password} job={job} />}
        {preview && /\.(png|jpe?g|webp|bmp)$/i.test(preview.file.name) && <ImagePreview file={preview.file} />}
        {!files.length && !source && <div className="file-privacy"><Icon name="shield" size={18} /><p>Исходный файл не меняется.<br /><span>Отправка на сервер начнётся только после нажатия «Обработать».</span></p></div>}
      </section>
      <aside className="workspace-options">
        <div className="settings-panel"><div className="panel-heading"><h2><span className="step-number">02</span>Параметры</h2><Icon name="sliders" size={18} /></div>
          {job ? <JobStatus job={job} onCancel={() => { void cancel(); }} onReset={reset} onRetry={tool.id === 'compress-pdf' ? () => { setJob(null); setError(''); setPollError(''); } : undefined} /> : <>
            <fieldset disabled={Boolean(busy)} className="settings-fieldset"><SettingsFields tool={tool} options={options} setOptions={setOptions} />{tool.postprocess && <PostProcess options={options} setOptions={setOptions} />}</fieldset>
            {tool.notice && <div className={`operation-notice ${tool.id === 'pdf-to-pptx' ? 'important' : ''}`}><Icon name="info" size={17} /><div>{tool.id === 'pdf-to-pptx' && <strong>Слайды в виде изображений</strong>}<p>{tool.notice}</p></div></div>}
            <div className="submit-area">
              {uploading ? <><div className="upload-state" role="status"><span>{source ? 'Подготавливаем следующую задачу' : 'Загрузка на сервер'}</span>{!source && <strong>{uploadPercent}%</strong>}</div><div className={`progress-track ${source ? 'indeterminate' : ''}`}><span style={{ width: source ? '35%' : `${uploadPercent}%` }} /></div>{!source && <button type="button" className="button secondary full" onClick={() => { void cancel(); }}>Отменить загрузку</button>}</> : <button type="submit" className="button primary full" disabled={!enoughFiles || !ready || tooManyPages || Boolean(rangeError) || planMissing}><span>Обработать{multiple && files.length ? ` · ${files.length}` : ''}</span><Icon name="arrow-right" size={19} /></button>}
              <p className="submit-caption">{!files.length && !source ? 'Сначала выберите файл' : !enoughFiles ? 'Подготовьте исходные файлы' : !ready ? 'Ожидаем подключения движка' : options.batch ? 'Отдельные результаты и отчёт в ZIP' : 'Создадим отдельный файл результата'}</p>
            </div>
          </>}
          {rangeError && <p className="inline-error" role="alert">{rangeError}</p>}
          {error && <p className="inline-error" role="alert"><Icon name="alert" size={17} />{error}</p>}
          {pollError && <p className="inline-error" role="status">{pollError}</p>}
        </div>
        <div className="storage-note"><Icon name="history" size={18} /><p><strong>{config ? `Автоудаление через ${retention(config.retentionSeconds)}` : 'Временное хранение'}</strong><span>Срок отсчитывается от загрузки. Удалить результат раньше можно в «Моих задачах».</span></p></div>
        <a className="workspace-history-link" href="#/history">Перейти к моим задачам <Icon name="arrow-up-right" size={16} /></a>
      </aside>
    </form>
    {(tool.accept.includes('.pdf') || tool.output === 'PDF') && <div className="workspace-footnote">Изменение PDF может сделать существующую цифровую подпись недействительной. Сохраняйте оригинал подписанного документа.</div>}
  </>;
}
