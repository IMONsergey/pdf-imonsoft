import { useCallback, useEffect, useRef, useState } from 'react';
import { byId, bytes } from '../lib/catalog';
import { ApiError, cancelJob, clearHistory, deleteJob, getJob, getJobs } from '../lib/api';
import { useApp } from '../lib/context';
import type { Job } from '../lib/types';
import { Icon } from '../components/Icon';
import { JobStatus } from '../components/JobStatus';

type Filter = 'all' | 'active' | 'done' | 'issues';
const filters: { id: Filter; label: string }[] = [{ id: 'all', label: 'Все' }, { id: 'active', label: 'В работе' }, { id: 'done', label: 'Готовые' }, { id: 'issues', label: 'С замечаниями' }];
const activeJob = (job: Job) => job.state === 'queued' || job.state === 'running';
export function History() {
  const { notify } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const pending = useRef<AbortController | null>(null);
  const active = useRef(false);
  const lastRefresh = useRef(0);
  const reload = useCallback(async () => {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    try {
      const result = await getJobs(controller.signal);
      if (controller.signal.aborted) return;
      setJobs(result.jobs); active.current = result.jobs.some(activeJob); lastRefresh.current = Date.now(); setError('');
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить задачи.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    void reload();
    const visible = () => { if (!document.hidden) void reload(); };
    const timer = setInterval(() => { if (!document.hidden && (active.current || Date.now() - lastRefresh.current > 30000)) void reload(); }, 4000);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); pending.current?.abort(); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  async function remove(id: string) {
    if (confirm !== id) { setConfirm(id); return; }
    setDeleting(id);
    try { await deleteJob(id); notify('Файлы задачи удалены'); await reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось удалить файлы.'); }
    finally { setDeleting(''); setConfirm(''); }
  }
  async function clear() {
    if (!confirmAll || deleting) return;
    setDeleting('all');
    try { const result = await clearHistory(); notify(`Удалено завершённых задач: ${result.deleted}`); await reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось очистить историю.'); }
    finally { setDeleting(''); setConfirmAll(false); }
  }
  const visible = jobs.filter(job => {
    const matches = `${job.names.join(' ')} ${byId(job.tool)?.title || job.tool}`.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'));
    return matches && (filter === 'all' || (filter === 'active' ? activeJob(job) : filter === 'done' ? job.state === 'done' && !job.batch?.failed : !activeJob(job) && (job.state !== 'done' || Boolean(job.batch?.failed))));
  });
  const finished = jobs.filter(job => !activeJob(job)).length;
  return <>
    <header className="page-heading"><p className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><div className="heading-with-action"><h1>Мои задачи</h1><div className="heading-actions"><button type="button" className="button secondary" onClick={() => { void reload(); }}><Icon name="refresh" size={17} />Обновить</button><button type="button" className="button secondary" disabled={!finished || Boolean(deleting)} onClick={() => setConfirmAll(value => !value)}><Icon name="remove" size={16} />Очистить завершённые</button></div></div><p>Ход обработки и готовые файлы в текущем браузере.</p></header>
    {error && <div className="connection-notice" role="alert"><Icon name="alert" /><p>{error}</p></div>}
    {confirmAll && <div className="history-confirm" role="group" aria-label="Подтвердить очистку истории"><p>Результаты завершённых задач будут удалены. Активная обработка продолжится.</p><button type="button" className="button secondary" disabled={Boolean(deleting)} onClick={() => setConfirmAll(false)}>Оставить</button><button type="button" className="button primary" disabled={Boolean(deleting)} onClick={() => { void clear(); }}>Удалить результаты</button></div>}
    {jobs.length > 0 && <div className="history-toolbar"><label className="search-field"><Icon name="search" size={18} /><input type="search" aria-label="Поиск в задачах" placeholder="Файл или операция" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="category-tabs" role="group" aria-label="Состояние задач">{filters.map(item => <button type="button" key={item.id} className={filter === item.id ? 'selected' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div><span className="history-count">{visible.length} из {jobs.length}</span></div>}
    {loading ? <div className="empty-state"><Icon name="loading" className="spin" /><p>Загружаем задачи</p></div> : visible.length ? <div className="history-list">
      <div className="history-labels"><span>ФАЙЛ И ОПЕРАЦИЯ</span><span>СОСТОЯНИЕ</span><span>РЕЗУЛЬТАТ</span><span /></div>
      {visible.map(job => <article key={job.id} className="history-row">
        <a href={`#/jobs/${job.id}`} className="history-file"><span className="tool-icon"><Icon name={byId(job.tool)?.icon || 'files'} size={21} /></span><span><strong title={job.names.join(', ')}>{job.names[0]}{job.names.length > 1 && ` +${job.names.length - 1}`}</strong><small>{byId(job.tool)?.title || job.tool} · {new Date(job.createdAt * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small></span></a>
        <a className={`job-state-tag ${job.state} ${job.batch?.failed ? 'partial' : ''}`} href={`#/jobs/${job.id}`}><Icon name={job.batch?.failed || job.state === 'error' ? 'alert' : job.state === 'done' ? 'check' : job.state === 'cancelled' ? 'x' : 'loading'} size={15} className={job.state === 'running' ? 'spin' : ''} /><span>{job.batch?.failed ? 'Часть файлов' : job.state === 'done' ? 'Готово' : job.state === 'error' ? 'Ошибка' : job.state === 'cancelled' ? 'Отменено' : job.state === 'queued' ? 'В очереди' : 'Обработка'}</span></a>
        <span className="history-size">{bytes(job.outputSize)}</span>
        <div className="history-actions">{job.downloadUrl && <a className="icon-button" href={job.downloadUrl} download aria-label={`Скачать результат ${job.names[0]}`}><Icon name="download" size={18} /></a>}<button type="button" className={confirm === job.id ? 'delete-confirm' : 'icon-button'} disabled={Boolean(deleting)} onClick={() => { void remove(job.id); }} aria-label={`Удалить файлы ${job.names[0]}`}>{deleting === job.id ? <Icon name="loading" className="spin" size={17} /> : confirm === job.id ? 'Удалить?' : <Icon name="remove" size={17} />}</button>{confirm === job.id && <button type="button" className="icon-button" aria-label="Не удалять" onClick={() => setConfirm('')}><Icon name="x" size={16} /></button>}</div>
      </article>)}
    </div> : !error && <div className="empty-state history-empty"><span className="empty-icon"><Icon name="folder" size={36} /></span><h2>{jobs.length ? 'Задач с такими условиями нет' : 'Здесь появятся ваши задачи'}</h2><p>{jobs.length ? 'Измените запрос или выберите другое состояние.' : 'Выберите инструмент и загрузите файл. Статус и результат появятся здесь.'}</p>{jobs.length ? <button type="button" className="button secondary" onClick={() => { setQuery(''); setFilter('all'); }}>Сбросить фильтры</button> : <a className="button primary" href="#/">Выбрать инструмент <Icon name="arrow-right" size={18} /></a>}</div>}
    <p className="history-note"><Icon name="shield" size={17} />Здесь видны только задачи текущей сессии. После выхода, очистки cookies или истечения срока хранения доступ к ним пропадёт.</p>
  </>;
}

export function JobPage({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const value = await getJob(id, controller.signal);
        if (stopped) return;
        setJob(value); setError('');
        if (activeJob(value)) timer = setTimeout(() => { void load(); }, 1000);
      } catch (failure) {
        if (stopped) return;
        setError(failure instanceof Error ? failure.message : 'Не удалось загрузить задачу.');
        if (!(failure instanceof ApiError && [401, 404].includes(failure.status))) timer = setTimeout(() => { void load(); }, 4000);
      }
    }
    void load();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [id, revision]);
  async function cancel() {
    try { const next = await cancelJob(id); setJob(next); setRevision(value => value + 1); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось отменить задачу.'); }
  }
  return <><a href="#/history" className="back-link"><Icon name="arrow-left" size={17} />Мои задачи</a><header className="page-heading"><p className="eyebrow">ОБРАБОТКА ФАЙЛА</p><h1>{job ? byId(job.tool)?.title : 'Задача'}</h1><p className="job-filename">{job?.names.join(', ')}</p></header>
    <div className="job-detail-card">{job && <JobStatus job={job} onCancel={() => { void cancel(); }} onReset={() => { window.location.hash = `/tools/${job.tool}`; }} />}{error && <><p className="inline-error" role="alert">{error}</p><button type="button" className="text-button" onClick={() => setRevision(value => value + 1)}>Проверить снова</button></>}{!job && !error && <div className="loading-line"><Icon name="loading" className="spin" />Загружаем задачу</div>}</div></>;
}
