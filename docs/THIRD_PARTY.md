# Зависимости и лицензии

Это инженерный реестр, не юридическое заключение. Условия действуют для выбранных версий и их зависимостей. Перед распространением сборки проверять LICENSE/NOTICE конкретных пакетов и сохранять обязательные уведомления. Лицензии исходного кода и готовых бинарных образов не всегда совпадают.

| Компонент | Основная лицензия | Использование |
|---|---|---|
| React, Vite, TypeScript | MIT | Собственный web UI |
| Lucide | ISC | Иконки |
| PDF.js | Apache-2.0 | Локальный просмотр PDF, worker поставляется с frontend |
| FastAPI, python-pptx, itsdangerous | MIT / BSD-3-Clause для itsdangerous | HTTP, создание PPTX, cookie signing |
| pypdf | BSD-3-Clause | Структура/шифрование PDF |
| pypdfium2 | Apache-2.0 или BSD-3-Clause | Рендеринг; PDFium и встроенные компоненты имеют отдельные notices |
| Pillow | HPND | Изображения |
| ReportLab | BSD | Нумерация и текстовые штампы |
| Tesseract | Apache-2.0 | OCR, языковые данные отдельно |
| Gotenberg | MIT | HTTP-обёртка Office-экспорта |
| LibreOffice | MPL-2.0 и другие применимые условия | В составе Gotenberg, не код frontend |
| Nginx | BSD-подобная | Раздача и reverse proxy |

Первичные источники:

- https://github.com/mozilla/pdf.js/blob/master/LICENSE
- https://github.com/py-pdf/pypdf/blob/main/LICENSE
- https://github.com/pypdfium2-team/pypdfium2/blob/main/LICENSE
- https://github.com/scanny/python-pptx/blob/master/LICENSE
- https://github.com/gotenberg/gotenberg/blob/main/LICENSE
- https://www.libreoffice.org/about-us/licenses/
- https://github.com/tesseract-ocr/tesseract/blob/main/LICENSE
- https://github.com/lucide-icons/lucide/blob/main/LICENSE

Код платформы не скопирован из ConvertX, BentoPDF, Stirling PDF или Transmute. Это не освобождает от условий транзитивных зависимостей и системных пакетов Docker. Бесплатность движка не означает возможность удалить его лицензионные уведомления. UI может использовать собственный бренд; уведомления о стороннем ПО остаются частью дистрибутива.

Лицензия на собственный исходный код IMONSOFT в этой итерации не назначается автоматически. Решение остаётся за владельцем репозитория.
