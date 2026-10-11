import raw from '../../../../shared/tools.json';
import type { Category, Tool } from './types';

export const tools = raw as Tool[];
export const categories: { id: Category; label: string; description: string }[] = [
  { id: 'all', label: 'Все инструменты', description: 'Конвертируйте, объединяйте и приводите файлы в порядок.' },
  { id: 'pdf', label: 'PDF', description: 'Страницы, защита, изображения и повседневные операции с PDF.' },
  { id: 'presentations', label: 'Презентации', description: 'Из PowerPoint в PDF и обратно — с понятным результатом.' },
  { id: 'documents', label: 'Документы', description: 'Word, таблицы, текстовые слои и распознавание сканов.' },
  { id: 'images', label: 'Изображения', description: 'Размер, формат и оптимизация графики без лишних действий.' },
];
export const byId = (id: string) => tools.find(tool => tool.id === id);
export const formats = (tool: Tool) => tool.accept.map(ext => ext.slice(1).toUpperCase()).join(', ');
export function bytes(size: number | null | undefined): string {
  if (size == null) return '—';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} КБ`;
  return `${(size / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
}
export function retention(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes === 60 ? '1 час' : `${minutes} мин`;
}
