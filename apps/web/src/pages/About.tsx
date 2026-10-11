import { useApp } from '../lib/context';
import { retention } from '../lib/catalog';
import { Icon } from '../components/Icon';

export function About() {
  const { config } = useApp();
  return <>
    <header className="page-heading"><p className="eyebrow">БЕЗ НЕЯСНЫХ ОБЕЩАНИЙ</p><h1>Как работают файлы</h1><p>Где обрабатываются документы, что сохраняется и чего ожидать от результата.</p></header>
    <div className="about-grid">
      <section className="about-card"><Icon name="shield" size={25} /><h2>Ваш сервер, не чужое облако</h2><p>Конвертация происходит на сервере, где развёрнут IMONSOFT Files. Выбранный файл отправляется туда только после запуска обработки. Предпросмотр PDF открывается локально в браузере.</p><p>Для работы инструментов не нужны платные API конвертации.</p></section>
      <section className="about-card"><Icon name="history" size={25} /><h2>Временные файлы</h2><p>Исходники удаляются с сервера после завершения или отмены задачи. Результаты и история доступны {config ? retention(config.retentionSeconds) : 'в течение срока, заданного сервером'} после загрузки; очистка выполняется периодически.</p><p>В разделе «Мои задачи» файлы можно удалить раньше. Не используйте сервис как постоянное хранилище.</p></section>
      <section className="about-card"><Icon name="presentation" size={25} /><h2>Презентации — в обе стороны</h2><p>PPT/PPTX → PDF выполняется через LibreOffice. При отсутствии исходного шрифта или сложных эффектах оформление может измениться.</p><p>PDF → PowerPoint создаёт слайд-изображение из каждой страницы. Это сохранение внешнего вида, а не восстановление редактируемых текстов и объектов.</p></section>
      <section className="about-card"><Icon name="settings" size={25} /><h2>Понятные ограничения</h2><p>Один запуск: до {config?.maxUploadMb || 50} МБ, до {config?.maxFiles || 20} файлов и до {config?.maxPages || 200} страниц PDF. Некоторые операции принимают только один документ.</p><p>OCR может ошибаться. Удаление метаданных не означает обезличивание, а водяной знак не заменяет электронную подпись.</p></section>
    </div>
    <p className="muted"><a href="./THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Лицензии сторонних компонентов</a></p>
    <div className="about-bottom"><div><h2>Сначала сохраните оригинал.</h2><p>Любая операция создаёт отдельный файл. Проверяйте результат перед публикацией и передачей клиентам.</p></div><a className="button primary" href="#/">К инструментам <Icon name="arrow-right" size={18} /></a></div>
  </>;
}
