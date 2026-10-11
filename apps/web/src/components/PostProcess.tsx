import type { Options } from '../lib/types';
export function PostProcess({ options, setOptions }: { options: Options; setOptions: (options: Options) => void }) {
  return <div className="post-process"><label className="field"><span>После конвертации</span><select value={options.postprocess} onChange={event => setOptions({ ...options, postprocess: event.target.value })}><option value="none">Без дополнительных действий</option><option value="compress">Оптимизировать PDF</option><option value="watermark">Добавить водяной знак</option><option value="number">Пронумеровать страницы</option></select><small>Выполним следом, в рамках одной задачи.</small></label>
    {options.postprocess === 'watermark' && <label className="field"><span>Текст водяного знака</span><input required value={options.text} maxLength={120} placeholder="Для согласования" onChange={event => setOptions({ ...options, text: event.target.value })} /></label>}
    {options.postprocess === 'number' && <label className="field"><span>Начать нумерацию с</span><input required type="number" min={1} max={100000} value={options.start} onChange={event => setOptions({ ...options, start: Number(event.target.value) })} /></label>}
  </div>;
}
