import { useEffect, useState } from 'react';
import { bytes } from '../lib/catalog';
import type { Job } from '../lib/types';
import { Icon } from './Icon';

export function JobStatus({ job, onCancel, onReset }: { job: Job; onCancel?: () => void; onReset?: () => void }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now() / 1000), 15000); return () => clearInterval(timer); }, []);
  const busy = job.state === 'running' || job.state === 'queued';
  const expired = now >= job.expiresAt;
  const remaining = Math.max(1, Math.ceil((job.expiresAt - now) / 60));
  const saved = job.outputSize && job.outputSize < job.inputSize ? Math.round(100 * (1 - job.outputSize / job.inputSize)) : null;
  return <section className={`job-status ${job.state}`} aria-label="Результат обработки">
    <div className="job-state-icon"><Icon name={busy ? 'loading' : job.state === 'done' ? 'success' : job.state === 'error' ? 'alert' : 'x'} size={28} className={busy ? 'spin' : ''} /></div>
    <div className="job-status-heading" role="status" aria-live="polite"><h3>{job.stage}</h3>
      <p>{busy ? 'Можно перейти в «Мои задачи» — обработка продолжится.' : job.state === 'done' ? 'Результат готов к скачиванию.' : job.error || 'Исходный файл не изменён.'}</p>
    </div>
    {busy && <><div className={`progress-track ${job.progress == null ? 'indeterminate' : ''}`} role="progressbar" aria-label={job.stage} aria-valuenow={job.progress ?? undefined} aria-valuemin={0} aria-valuemax={100}><span style={{ width: job.progress == null ? '35%' : `${job.progress}%` }} /></div>
      {onCancel && <button type="button" className="button secondary full" onClick={onCancel}>Отменить обработку</button>}</>}
    {job.state === 'done' && <>
      <div className="result-meta"><span>Размер результата</span><strong>{bytes(job.outputSize)} {saved != null && saved > 0 && <em>−{saved}%</em>}</strong></div>
      {job.warnings.map((warning, index) => <p key={index} className="result-warning"><Icon name="info" size={16} />{warning}</p>)}
      {expired ? <p className="inline-error">Срок хранения истёк. Загрузите исходный файл повторно.</p> : <>
        <a href={job.downloadUrl || undefined} className="button primary full" download><Icon name="download" size={19} />Скачать {job.outputExtension?.slice(1).toUpperCase()}</a>
        <p className="result-expiry"><Icon name="history" size={14} />Удаление через {remaining} мин</p>
      </>}
    </>}
    {!busy && onReset && <button type="button" className="button secondary full" onClick={onReset}>{job.state === 'done' ? 'Обработать другой файл' : 'Вернуться к файлу'}</button>}
  </section>;
}
