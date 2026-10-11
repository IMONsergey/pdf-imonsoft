import { useState } from 'react';
import { tools } from '../lib/catalog';
import type { Job } from '../lib/types';
import { useApp } from '../lib/context';
import { Icon } from './Icon';

export function NextStep({ job }: { job: Job }) {
  const { config } = useApp();
  const [selected, setSelected] = useState('');
  const compatible = tools.filter(tool => tool.accept.includes(job.outputExtension || '') && tool.minFiles === 1 && config?.tools.some(item => item.id === tool.id && item.available));
  if (!compatible.length || (job.outputSize || 0) > (config?.maxUploadMb || 50) * 1024 * 1024) return null;
  return <div className="result-next"><label className="field"><span>Продолжить с этим результатом</span><select aria-label="Следующий инструмент" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Выберите операцию</option>{compatible.map(tool => <option key={tool.id} value={tool.id}>{tool.title}</option>)}</select><small>Результат будет передан следующему инструменту на сервере. Повторная загрузка не нужна.</small></label>
    <button type="button" className="button secondary full" disabled={!selected} onClick={() => { window.location.hash = `/tools/${selected}?source=${job.id}`; }}>Продолжить<Icon name="arrow-right" size={17} /></button>
  </div>;
}
