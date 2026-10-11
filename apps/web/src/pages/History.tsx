import { useCallback, useEffect, useState } from 'react';
import { byId, bytes } from '../lib/catalog';
import { cancelJob, deleteJob, getJob, getJobs } from '../lib/api';
import { useApp } from '../lib/context';
import type { Job } from '../lib/types';
import { Icon } from '../components/Icon';
import { JobStatus } from '../components/JobStatus';

export function History() {
  const { notify } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const [confirm, setConfirm] = useState('');
  const reload = useCallback(async () => {
    try { const result = await getJobs(); setJobs(result.jobs); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось загрузить задачи.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); const timer = setInterval(() => { void reload(); }, 4000); return () => clearInterval(timer); }, [reload]);
  async function remove(id: string) {
    if (confirm !== id) { setConfirm(id); return; }
    setDeleting(id);
    try { await deleteJob(id); setJobs(current => current.filter(job => job.id !== id)); notify('Файлы задачи удалены'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось удалить файлы.'); }
    finally { setDeleting(''); setConfirm(''); }
  }
  return <>
    <header className="page-heading"><p className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><div className="heading-with-action"><h1>Мои задачи</h1><button type="button" className="button secondary" onClick={() => { void reload(); }}><Icon name="refresh" size={17} />Обновить</button></div><p>Ход обработки и готовые файлы в текущем браузере.</p></header>
    {error && <div className="connection-notice" role="alert"><Icon name="alert" /><p>{error}</p></div>}
    {loading ? <div className="empty-state"><Icon name="loading" className="spin" /><p>Загружаем задачи</p></div> : jobs.length ? <div className="history-list">
      <div className="history-labels"><span>ФАЙЛ И ОПЕРАЦИЯ</span><span>СОСТОЯНИЕ</span><span>РЕЗУЛЬТАТ</span><span /></div>
      {jobs.map(job => <article key={job.id} className="history-row">
        <a href={`#/jobs/${job.id}`} className="history-file"><span className="tool-icon"><Icon name={byId(job.tool)?.icon || 'files'} size={21} /></span><span><strong title={job.names[0]}>{job.names[0]}{job.names.length > 1 && ` +${job.names.length - 1}`}</strong><small>{byId(job.tool)?.title || job.tool} · {new Date(job.createdAt * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small></span></a>
        <a className={`job-state-tag ${job.state}`} href={`#/jobs/${job.id}`}><Icon name={job.state === 'done' ? 'check' : job.state === 'error' ? 'alert' : job.state === 'cancelled' ? 'x' : 'loading'} size={15} className={job.state === 'running' ? 'spin' : ''} /><span>{job.state === 'done' ? 'Готово' : job.state === 'error' ? 'Ошибка' : job.state === 'cancelled' ? 'Отменено' : job.state === 'queued' ? 'В очереди' : 'Обработка'}</span></a>
        <span className="history-size">{bytes(job.outputSize)}</span>
        <div className="history-actions">{job.downloadUrl && <a className="icon-button" href={job.downloadUrl} download aria-label={`Скачать результат ${job.names[0]}`}><Icon name="download" size={18} /></a>}
          <button type="button" className={confirm === job.id ? 'delete-confirm' : 'icon-button'} disabled={deleting === job.id} onClick={() => { void remove(job.id); }} aria-label={`Удалить файлы ${job.names[0]}`}>{deleting === job.id ? <Icon name="loading" className="spin" size={17} /> : confirm === job.id ? 'Удалить?' : <Icon name="remove" size={17} />}</button>
          {confirm === job.id && <button type="button" className="icon-button" aria-label="Не удалять" onClick={() => setConfirm('')}><Icon name="x" size={16} /></button>}
        </div>
      </article>)}
    </div> : !error && <div className="empty-state history-empty"><span className="empty-icon"><Icon name="folder" size={36} /></span><h2>Здесь появятся ваши задачи</h2><p>Выберите инструмент и загрузите файл.<br />Статус обработки и результат будут доступны здесь.</p><a className="button primary" href="#/">Выбрать инструмент <Icon name="arrow-right" size={18} /></a></div>}
    <p className="history-note"><Icon name="shield" size={17} />Здесь видны только задачи текущей сессии. После очистки cookies или истечения срока хранения доступ к ним пропадёт.</p>
  </>;
}

export function JobPage({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const value = await getJob(id, controller.signal);
        if (stopped) return;
        setJob(value); setError('');
        if (['queued', 'running'].includes(value.state)) timer = setTimeout(() => { void load(); }, 1000);
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить задачу.'); }
    }
    void load();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [id]);
  return <><a href="#/history" className="back-link"><Icon name="arrow-left" size={17} />Мои задачи</a><header className="page-heading"><p className="eyebrow">ОБРАБОТКА ФАЙЛА</p><h1>{job ? byId(job.tool)?.title : 'Задача'}</h1><p className="job-filename">{job?.names.join(', ')}</p></header>
    <div className="job-detail-card">{job && <JobStatus job={job} onCancel={() => { void cancelJob(id).then(setJob).catch(failure => setError(failure.message)); }} onReset={() => { window.location.hash = `/tools/${job.tool}`; }} />}{error && <p className="inline-error" role="alert">{error}</p>}{!job && !error && <div className="loading-line"><Icon name="loading" className="spin" />Загружаем задачу</div>}</div></>;
}
