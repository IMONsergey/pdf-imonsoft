export function pageRangeError(value: string, count: number): string {
  if (!value.trim()) return '';
  const seen = new Set<number>();
  for (const part of value.replace(/[–—]/g, '-').split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) return 'Неверная запись страниц. Пример: 1–3, 5.';
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(last) || first < 1 || last < first || last > 1000 || (count > 0 && last > count)) return count ? `В документе ${count} стр. Проверьте диапазон.` : 'Допустимы номера страниц от 1 до 1000.';
    for (let page = first; page <= last; page++) {
      if (seen.has(page)) return 'Номера страниц не должны повторяться.';
      seen.add(page);
    }
  }
  return '';
}
