import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { Catalog } from './pages/Catalog';
import { Workspace } from './pages/Workspace';
import { History, JobPage } from './pages/History';
import { About } from './pages/About';
import { AppProvider } from './lib/context';
import { byId, categories } from './lib/catalog';
import { brand } from './lib/brand';
import { Icon } from './components/Icon';

function currentPath() { return window.location.hash.slice(1).split('?')[0].replace(/\/$/, '') || '/'; }
export default function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => { const changed = () => setPath(currentPath()); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  let title = 'Все инструменты';
  let page;
  if (path === '/') page = <Catalog key="all" />;
  else if (path.startsWith('/category/')) {
    const category = categories.find(item => item.id === path.split('/')[2]);
    if (category) { title = category.label; page = <Catalog key={category.id} category={category.id} />; }
  } else if (path.startsWith('/tools/')) {
    const tool = byId(path.split('/')[2]);
    if (tool) { title = tool.title; page = <Workspace key={tool.id} tool={tool} />; }
  } else if (path === '/history') { title = 'Мои задачи'; page = <History />; }
  else if (/^\/jobs\/[a-f0-9]{32}$/.test(path)) { title = 'Мои задачи'; page = <JobPage key={path} id={path.split('/')[2]} />; }
  else if (path === '/about') { title = 'Как это работает'; page = <About />; }
  if (!page) { title = 'Страница не найдена'; page = <div className="empty-state"><Icon name="files" size={34} /><h1>Такой страницы нет</h1><p>Инструмент мог переехать. Откройте общий каталог.</p><a className="button primary" href="#/">Все инструменты</a></div>; }
  useEffect(() => { document.title = `${title} — ${brand.title}`; }, [title]);
  return <AppProvider><Layout path={path} title={title}>{page}</Layout></AppProvider>;
}
