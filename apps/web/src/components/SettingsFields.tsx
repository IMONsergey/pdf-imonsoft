import type { Options, Tool } from '../lib/types';
import { useApp } from '../lib/context';
import { Icon } from './Icon';
import { CompressionOptions } from './CompressionOptions';

export const defaultOptions: Options = { pages: '', angle: 90, dpi: 144, password: '', new_password: '', text: '', start: 1, format: 'webp', quality: 85, width: 1920, height: 1080, page_size: 'original', language: 'eng+rus', page_plan: [], batch: false, postprocess: 'none', split_every: 1, crop_top: 5, crop_right: 5, crop_bottom: 5, crop_left: 5, watermark_opacity: 0.22, watermark_angle: 30, flip: 'horizontal', compression: 'balanced', compression_dpi: 160, compression_quality: 82 };
export function SettingsFields({ tool, options, setOptions }: { tool: Tool; options: Options; setOptions: (value: Options) => void }) {
  const { config } = useApp();
  const set = (key: string, value: string | number) => setOptions({ ...options, [key]: value });
  const number = (key: string, label: string, min: number, max: number) => <label className="field" key={key}><span>{label}</span><input type="number" min={min} max={max} step={1} required value={String(options[key])} onChange={event => set(key, event.target.value === '' ? '' : Number(event.target.value))} /></label>;
  return <div className="settings-fields">{tool.settings.filter(key => key !== 'password' && key !== 'page_plan' && !['compression_dpi', 'compression_quality'].includes(key)).map(key => {
    if (key === 'compression') return <CompressionOptions key={key} options={options} setOptions={setOptions} />;
    if (key === 'pages') return <label className="field" key={key}><span>{tool.id === 'remove-pages' ? 'Какие страницы удалить' : 'Страницы'}</span><input value={options.pages} onChange={event => set(key, event.target.value)} placeholder="Например: 1–3, 5" maxLength={8000} required={['extract-pages', 'remove-pages'].includes(tool.id)} /><small>{tool.id === 'extract-pages' ? 'Порядок сохраняется: 3, 1–2 переместит третью страницу в начало.' : tool.id === 'remove-pages' ? 'Остальные страницы останутся на своих местах.' : 'Оставьте пустым, чтобы обработать все страницы.'}</small></label>;
    if (key === 'angle') return <div className="field" key={key}><span id="angle-label">Поворот по часовой стрелке</span><div className="segmented" role="group" aria-labelledby="angle-label">{[90, 180, 270].map(value => <button key={value} type="button" aria-pressed={options.angle === value} className={options.angle === value ? 'selected' : ''} onClick={() => set(key, value)}>{value}°</button>)}</div></div>;
    if (key === 'dpi') return <label className="field" key={key}><span>Качество изображений</span><select value={options.dpi} onChange={event => set(key, Number(event.target.value))}><option value={96}>Стандартное · 96 DPI</option><option value={144}>Высокое · 144 DPI</option><option value={192}>Максимальное · 192 DPI</option></select><small>Выше качество — больше размер результата.</small></label>;
    if (key === 'new_password') return <label className="field" key={key}><span>Новый пароль</span><input type="password" autoComplete="new-password" value={options.new_password} onChange={event => set(key, event.target.value)} minLength={8} maxLength={128} required placeholder="Не менее 8 символов" /><small>Сохраните пароль: восстановить его здесь нельзя.</small></label>;
    if (key === 'text') return <label className="field" key={key}><span>Текст водяного знака</span><input value={options.text} onChange={event => set(key, event.target.value)} maxLength={120} required placeholder="Например: Для согласования" /></label>;
    if (key === 'split_every') return number(key, 'Страниц в каждой части', 1, 200);
    if (key.startsWith('crop_')) return number(key, ({ crop_top: 'Поле сверху, %', crop_right: 'Поле справа, %', crop_bottom: 'Поле снизу, %', crop_left: 'Поле слева, %' } as Record<string, string>)[key], 0, 45);
    if (key === 'watermark_opacity') return <label className="field" key={key}><span>Непрозрачность <strong>{Math.round(options.watermark_opacity * 100)}%</strong></span><input type="range" min={5} max={100} step={1} value={Math.round(options.watermark_opacity * 100)} onChange={event => set(key, Number(event.target.value) / 100)} /></label>;
    if (key === 'watermark_angle') return number(key, 'Угол водяного знака, °', -180, 180);
    if (key === 'flip') return <label className="field" key={key}><span>Направление отражения</span><select value={options.flip} onChange={event => set(key, event.target.value)}><option value="horizontal">Горизонтально</option><option value="vertical">Вертикально</option></select></label>;
    if (key === 'start') return number(key, 'Начать нумерацию с', 1, 100000);
    if (key === 'width') return number(key, 'Максимальная ширина, px', 16, 8000);
    if (key === 'height') return number(key, 'Максимальная высота, px', 16, 8000);
    if (key === 'format') return <label className="field" key={key}><span>Формат результата</span><select value={options.format} onChange={event => set(key, event.target.value)}><option value="webp">WebP</option><option value="jpg">JPG</option><option value="png">PNG</option></select></label>;
    if (key === 'quality') return <label className="field" key={key}><span>Качество сжатия <strong>{options.quality}%</strong></span><input type="range" min={30} max={100} step={1} value={options.quality} disabled={options.format === 'png'} onChange={event => set(key, Number(event.target.value))} /><small>{options.format === 'png' ? 'Для PNG используется сжатие без потерь.' : 'Рекомендуем 80–90% для баланса размера и качества.'}</small></label>;
    if (key === 'page_size') return <label className="field" key={key}><span>Размер страниц</span><select value={options.page_size} onChange={event => set(key, event.target.value)}><option value="original">По пропорциям изображения</option><option value="a4">A4 с полями</option></select></label>;
    if (key === 'language') {
      const languages = config?.engines.ocrLanguages || ['eng', 'rus'];
      return <label className="field" key={key}><span>Язык документа</span><select value={options.language} onChange={event => set(key, event.target.value)}>{languages.includes('eng') && languages.includes('rus') && <option value="eng+rus">Русский и английский</option>}{languages.includes('rus') && <option value="rus">Русский</option>}{languages.includes('eng') && <option value="eng">Английский</option>}</select></label>;
    }
    return null;
  })}
    {tool.settings.includes('password') && <label className="field password-field"><span><Icon name="lock" size={14} />{tool.id === 'unlock-pdf' ? 'Пароль документа' : 'Пароль исходного PDF'}{tool.id !== 'unlock-pdf' && <span className="optional">необязательно</span>}</span><input type="password" autoComplete="off" value={options.password} onChange={event => set('password', event.target.value)} maxLength={128} placeholder="Только для защищённого файла" /><small>Используется для обработки и не сохраняется в истории.</small></label>}
    {tool.settings.length === 0 && !tool.postprocess && <div className="no-settings"><Icon name="check" size={18} /><p>Всё готово к запуску.<br /><span>Дополнительные параметры не нужны.</span></p></div>}
  </div>;
}
