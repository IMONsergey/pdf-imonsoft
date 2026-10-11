import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { brand } from '../lib/brand';
import { useApp } from '../lib/context';
import { Icon } from './Icon';
import { retention } from '../lib/catalog';

const sections = [
  { path: '/', label: 'Все инструменты', icon: 'grid' },
  { path: '/category/pdf', label: 'PDF', icon: 'files' },
  { path: '/category/presentations', label: 'Презентации', icon: 'presentation' },
  { path: '/category/documents', label: 'Документы', icon: 'text' },
  { path: '/category/images', label: 'Изображения', icon: 'image' },
];
function Brand() {
  return <a className="brand" href="#/" aria-label="IMONSOFT Files — главная">
    <span className="brand-mark"><span /><span /></span>
    <span className="brand-word">{brand.name}<span>{brand.product}</span></span>
  </a>;
}
function Navigation({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return <>
    <p className="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</p>
    <nav className="navigation" aria-label="Основная навигация">
      {sections.map(item => <a key={item.path} href={`#${item.path}`} onClick={onNavigate} className={path === item.path ? 'active' : ''} aria-current={path === item.path ? 'page' : undefined}>
        <Icon name={item.icon} size={19} /><span>{item.label}</span>{item.path === '/' && <span className="nav-dot" />}
      </a>)}
      <div className="nav-divider" />
      <a href="#/history" onClick={onNavigate} className={path.startsWith('/history') || path.startsWith('/jobs') ? 'active' : ''}><Icon name="history" size={19} /><span>Мои задачи</span></a>
    </nav>
  </>;
}
export function Layout({ path, title, children }: { path: string; title: string; children: ReactNode }) {
  const { config, status, refresh } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  useEffect(() => { dialog.current?.close(); window.scrollTo({ top: 0 }); }, [path]);
  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem('imonsoft-theme', next); } catch { /* Private mode */ }
  }
  return <div className="app-layout">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Перейти к содержимому</a>
    <aside className="sidebar"><Brand /><Navigation path={path} />
      <div className="sidebar-bottom"><div className="private-space"><Icon name="shield" size={20} /><span>Ваши файлы.<br /><strong>Ваш сервер.</strong></span></div>
        <a href="#/about" className="sidebar-about"><span>Как это работает</span><Icon name="arrow-up-right" size={15} /></a>
        <div className="sidebar-version"><span>IMONSOFT ECOSYSTEM</span><span>0.1</span></div>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div className="topbar-left"><button type="button" className="icon-button mobile-menu" onClick={() => dialog.current?.showModal()} aria-label="Открыть меню"><Icon name="menu" /></button>
          <span className="breadcrumb-root">Files</span><span className="breadcrumb-divider">/</span><span className="breadcrumb-current">{title}</span>
        </div>
        <div className="topbar-actions"><button type="button" className={`server-badge ${status}`} onClick={() => { void refresh(); }} title="Проверить соединение с сервером"><span className={`status-dot ${status === 'offline' ? 'warning' : ''}`} /><span>{status === 'online' ? 'Сервер подключён' : status === 'checking' ? 'Подключение' : 'Нет соединения'}</span></button>
          <span className="topbar-rule" /><button type="button" className="icon-button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={19} /></button>
        </div>
      </header>
      <main id="main-content" className="content" tabIndex={-1}>{children}</main>
      <footer className="footer"><span>{brand.name}<span className="footer-slash">/</span>FILES</span><span>{config ? `Результаты хранятся ${retention(config.retentionSeconds)} после загрузки` : 'Обработка на вашем сервере'}</span></footer>
    </div>
    <dialog ref={dialog} className="mobile-nav-dialog" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="mobile-nav-inner"><div className="mobile-nav-head"><Brand /><button type="button" className="icon-button" onClick={() => dialog.current?.close()} aria-label="Закрыть меню"><Icon name="x" /></button></div>
        <Navigation path={path} onNavigate={() => dialog.current?.close()} /><a className="sidebar-about" href="#/about" onClick={() => dialog.current?.close()}>Как это работает <Icon name="arrow-up-right" size={16} /></a>
      </div>
    </dialog>
  </div>;
}
