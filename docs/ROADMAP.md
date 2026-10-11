# Следующие этапы

## Уже реализовано

23 операции; единый каталог; responsive UI; темы; PDF preview; backend job queue; engine capabilities; session isolation; cancellation; expiry; Docker configuration; automated tests.

## Следующий инженерный этап

- Матрица качества на реальных презентациях: Bounded/IBM Plex и другие легально установленные шрифты, SVG, таблицы, прозрачность, диаграммы, сложные master layouts. Шрифты не коммитить.
- Опциональные пресеты качества и drag-reorder страниц с thumbnails (сейчас есть диапазоны, порядок файлов и просмотр страницы).
- Batch для одиночных операций и цепочки: Office → PDF → watermark/compress.
- SSO/user ownership/API keys/квоты, отдельные worker containers и масштабируемая очередь.
- Server-side rate limiting, storage quotas, audit events и observability.
- Отдельный branding config для сборок разных продуктов, интернационализация.

## Не выдавать за готовое

- PDF → редактируемый PPTX/DOCX: исследование качества, отдельная экспериментальная ветка и ограничения. Не переименовывать image-only конвертацию в editable.
- Полный PDF text editor, цифровые подписи, профессиональное редактирование форм.
- Видео/аудио/архивы/3D — отдельные адаптеры после проверки лицензий и sandbox. Не обещать «1000 форматов» по числу расширений.
- Публичный многопользовательский SaaS, платежи или надёжный distributed queue.

На этой стадии продукт полезен как личная/командная файловая утилита. Статус production-ready требует отдельной проверки, а не только успешной сборки.
