import { useId } from 'react';
import type { Options } from '../lib/types';

const presets = [
  { id: 'balanced', title: 'Оптимальное', description: '160 DPI · JPEG 82. Для отправки и просмотра.' },
  { id: 'strong', title: 'Сильное', description: '96 DPI · JPEG 60. Меньше вес, заметнее потеря деталей.' },
  { id: 'lossless', title: 'Без потерь', description: 'Без снижения разрешения и качества изображений.' },
  { id: 'custom', title: 'Свои настройки', description: 'Выберите разрешение и качество изображений.' },
];

export function CompressionOptions({ options, setOptions }: { options: Options; setOptions: (value: Options) => void }) {
  const id = useId();
  return <div className="compression-options">
    <fieldset className="compression-presets"><legend>Режим сжатия</legend>{presets.map(preset =>
      <label key={preset.id} className={`compression-preset ${options.compression === preset.id ? 'selected' : ''}`}>
        <input type="radio" name={id} value={preset.id} checked={options.compression === preset.id} onChange={() => setOptions({ ...options, compression: preset.id })} />
        <span><strong>{preset.title}</strong><small>{preset.description}</small></span>
      </label>)}
    </fieldset>
    {options.compression === 'custom' && <div className="compression-custom">
      <label className="field"><span>Предельное разрешение изображений</span><select value={options.compression_dpi} onChange={event => setOptions({ ...options, compression_dpi: Number(event.target.value) })}>
        {[72, 96, 120, 144, 160, 180, 200, 240, 300, 450, 600].map(value => <option key={value} value={value}>{value} DPI</option>)}
      </select><small>Маленькие изображения не увеличиваются. Для печати начните с 300 DPI.</small></label>
      <label className="field"><span>Качество JPEG <strong>{options.compression_quality}</strong></span><input type="range" aria-label="Качество JPEG" min={40} max={95} step={1} value={options.compression_quality} onChange={event => setOptions({ ...options, compression_quality: Number(event.target.value) })} /><small>Это параметр изображений, а не обещанный процент уменьшения PDF.</small></label>
    </div>}
    <p className="compression-promise">{options.compression === 'lossless' ? 'Структурная упаковка и сжатие без потерь. Для уже оптимизированного PDF эффект может быть небольшим.' : 'Текст и векторы остаются объектами PDF. Качество фотографий и сканированных страниц может снизиться.'}</p>
  </div>;
}
