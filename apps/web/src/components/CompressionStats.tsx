import { bytes } from '../lib/catalog';
import type { CompressionReport } from '../lib/types';
import { Icon } from './Icon';

const modes: Record<string, string> = { balanced: 'Оптимальное', strong: 'Сильное', lossless: 'Без потерь', custom: 'Свои настройки' };
const reasons: Record<string, string> = {
  'pixel-limit': 'Размер изображения превышает безопасный лимит',
  'special-color-or-bitdepth': 'Специальный цветовой профиль или глубина цвета',
  'special-mask-or-decode': 'Особая маска прозрачности или интерпретация цвета',
  'already-small': 'Маленькие изображения',
  'jpeg-preserved': 'JPEG уже имеет достаточное сжатие',
  'no-image-gain': 'Перекодирование не давало выигрыша в размере',
  'untracked-placement': 'Нельзя надёжно определить масштаб на странице',
  'unsupported-image': 'Неподдерживаемая структура изображения',
};

export function CompressionStats({ report }: { report: CompressionReport }) {
  return <section className={`compression-stats ${report.unchanged ? 'unchanged' : ''}`} aria-label="Результат сжатия PDF">
    <div className="compression-gain"><strong>{report.unchanged ? 'Без изменений' : report.reductionPercent < .1 ? '<0,1%' : `−${report.reductionPercent.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`}</strong><span>{report.unchanged ? 'Возвращён исходный PDF' : `Сэкономлено ${bytes(report.savedBytes)}`}</span></div>
    <div className="compression-sizes"><dl><dt>До сжатия</dt><dd>{bytes(report.inputBytes)}</dd></dl><Icon name="arrow-right" size={18} /><dl><dt>После сжатия</dt><dd>{bytes(report.outputBytes)}</dd></dl></div>
    <div className="compression-summary"><span>{modes[report.mode] || report.mode}</span><span>{report.targetDpi ? `${report.targetDpi} DPI · JPEG ${report.jpegQuality}` : 'Без снижения качества'}</span></div>
    <p className="compression-image-summary">{report.imagesFound ? `Оптимизировано изображений: ${report.imagesOptimized} из ${report.imagesFound}.` : 'Подходящих растровых изображений не найдено.'}{report.imagesDownsampled > 0 ? ` Уменьшено разрешение: ${report.imagesDownsampled}.` : ''}</p>
    {(Object.keys(report.skipReasons).length > 0 || report.duplicatesRemoved > 0) && <details className="compression-diagnostics"><summary>Подробности обработки</summary>
      {report.duplicatesRemoved > 0 && <p>Объединено одинаковых изображений: {report.duplicatesRemoved}.</p>}
      {Object.entries(report.skipReasons).map(([key, count]) => <p key={key}>{reasons[key] || 'Сохранено без перекодирования'}: {count}.</p>)}
      <p>Сложные цветовые профили и неподдерживаемые маски не заменяются приблизительной картинкой.</p>
    </details>}
  </section>;
}
