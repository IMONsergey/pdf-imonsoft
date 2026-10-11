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

## Дополнения 0.2

`python-docx` 1.2.0 (MIT) используется для текстового DOCX-экспорта: https://github.com/python-openxml/python-docx/blob/master/LICENSE. Инструмент экспортирует текстовый слой, не восстанавливает исходную вёрстку PDF.

`@axe-core/playwright` и axe-core используются только в тестовом окружении. Их лицензии следует проверять в установленных package directories вместе с зафиксированными версиями; они не добавляются в runtime JavaScript приложения. Playwright применяется для автоматических браузерных проверок.

`services/api/requirements.lock` и `requirements-dev.lock` фиксируют транзитивные Python-пакеты и допустимые хеши. Node использует package-lock.json. Скрипт `apps/web/scripts/collect-notices.mjs` собирает лицензии runtime frontend-пакетов в `public/THIRD_PARTY_NOTICES.txt`, который публикуется со сборкой. Этот файл не заменяет уведомления PDFium, LibreOffice, языковых данных OCR и системных пакетов при распространении Docker-образа.

## PDF compression 0.3

`pikepdf` 10.12.0 (MPL-2.0) и его QPDF-движок используются серверным компрессором для операций со структурой PDF. Pillow выполняет обработку допустимых изображений. Платный API не подключается; Ghostscript и PyMuPDF не добавлялись.

Версия pikepdf зафиксирована на 10.12.0, поскольку её готовые бинарные wheels доступны как для Linux, так и для используемого Intel Mac/Python 3.13. Более новая 10.16.0 на этом Mac требует сборки из исходников; системную среду компилятора ради неё не меняли. Хеши пакетов зафиксированы в requirements.lock и requirements-dev.lock. Это выбор совместимости, а не обещание бессрочного отсутствия уязвимостей.

Официальные первичные источники условий: https://github.com/pikepdf/pikepdf и https://github.com/qpdf/qpdf. При распространении контейнера необходимо сохранить лицензии/уведомления pikepdf, QPDF и бинарных зависимостей; наличие собственного интерфейса их не отменяет. Лицензия собственного кода IMONSOFT не менялась.
