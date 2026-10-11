import { useEffect, useMemo, useRef, useState } from 'react';
import { categories, tools } from '../lib/catalog';
import { useApp } from '../lib/context';
import type { Category } from '../lib/types';
import { Icon } from '../components/Icon';
import { ToolCard } from '../components/ToolCard';

export function Catalog({ category = 'all' }: { category?: Category }) {
  const { config, status } = useApp();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const categoryInfo = categories.find(item => item.id === category) || categories[0];
  const visible = useMemo(() => {
    const words = query.toLocaleLowerCase('ru-RU').trim().split(/\s+/).filter(Boolean);
    return tools.filter(tool => (category === 'all' || tool.category === category) && words.every(word => `${tool.title} ${tool.description} ${tool.keywords} ${tool.accept.join(' ')} ${tool.output}`.toLocaleLowerCase('ru-RU').includes(word)));
  }, [category, query]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); search.current?.focus(); }
    }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const unavailable = (id: string) => status === 'online' && config?.tools.find(tool => tool.id === id)?.available === false;
  return <>
    <section className={`catalog-hero ${category !== 'all' ? 'category-hero' : ''}`}>
      <div className="hero-copy"><p className="eyebrow">{category === 'all' ? 'ПРОСТО РАБОТАТЬ С ФАЙЛАМИ' : 'ИНСТРУМЕНТЫ / ' + categoryInfo.label.toUpperCase()}</p>
        <h1>{category === 'all' ? <>Файлы — в нужном<br />формате.</> : categoryInfo.label}</h1>
        <p className="hero-description">{category === 'all' ? 'Конвертируйте, объединяйте, редактируйте страницы.\nВсе необходимые инструменты — в одном месте.' : categoryInfo.description}</p>
        <div className="hero-caption"><Icon name="shield" size={16} /><span>Без подписок на конвертацию. На вашем сервере.</span></div>
      </div>
      {category === 'all' && <div className="file-composition" aria-hidden="true">
        <div className="composition-line horizontal" /><div className="composition-line vertical" />
        <div className="format-paper paper-back"><span>PPTX</span><div className="paper-chart"><i /><i /><i /></div><div className="paper-lines"><i /><i /></div></div>
        <div className="format-paper paper-front"><div className="paper-corner" /><span>PDF</span><div className="paper-mini-heading" /><div className="paper-lines"><i /><i /><i /></div><div className="paper-photo"><span /><span /></div></div>
        <div className="conversion-symbol"><Icon name="arrow-right" size={26} /></div>
        <span className="composition-caption">ОДИН ФАЙЛ. БОЛЬШЕ ВОЗМОЖНОСТЕЙ.</span>
      </div>}
    </section>
    {category === 'all' && !query && <section className="featured-section" aria-labelledby="featured-heading">
      <div className="section-heading"><h2 id="featured-heading">Начните с главного</h2><span>ТРИ ЧАСТЫЕ ЗАДАЧИ</span></div>
      <div className="featured-grid">{tools.filter(tool => tool.featured).map(tool => <ToolCard key={tool.id} tool={tool} featured unavailable={unavailable(tool.id)} />)}</div>
    </section>}
    <section className="catalog-section" aria-labelledby="catalog-heading">
      <div className="catalog-toolbar"><div className="section-title"><h2 id="catalog-heading">{category === 'all' ? 'Все инструменты' : 'Выберите инструмент'}</h2><span className="count-pill">{visible.length}</span></div>
        <label className="search-field"><Icon name="search" size={19} /><input ref={search} type="search" placeholder="Найти инструмент или формат" value={query} onChange={event => setQuery(event.target.value)} aria-label="Поиск инструментов" /><kbd>/</kbd></label>
      </div>
      <nav className="category-tabs" aria-label="Категории инструментов">{categories.map(item => <a href={item.id === 'all' ? '#/' : `#/category/${item.id}`} className={category === item.id ? 'selected' : ''} aria-current={category === item.id ? 'page' : undefined} key={item.id}>{item.label === 'Все инструменты' ? 'Все' : item.label}</a>)}</nav>
      <div className="tool-grid">{visible.map(tool => <ToolCard key={tool.id} tool={tool} unavailable={unavailable(tool.id)} />)}</div>
      {!visible.length && <div className="empty-state"><Icon name="search" size={30} /><h3>Ничего не нашлось</h3><p>Попробуйте другой формат или более короткий запрос.</p><button type="button" className="button secondary" onClick={() => setQuery('')}>Сбросить поиск</button></div>}
    </section>
    <div className="catalog-bottom"><Icon name="info" size={18} /><p>Файлы отправляются только после запуска обработки. Предпросмотр PDF работает локально в браузере.</p><a href="#/about">Подробнее <Icon name="arrow-up-right" size={15} /></a></div>
  </>;
}
