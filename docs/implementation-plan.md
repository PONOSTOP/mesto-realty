# Место — план реализации

Исторический план первой версии. Актуальное B2B-решение описано в [b2b-plan.md](b2b-plan.md), текущий API — в [README](../README.md).

Цель: русскоязычный сервис поиска и самостоятельной публикации недвижимости.

Архитектура: Node.js / Express 5, PostgreSQL, обычные HTML/CSS/ES modules. Единый origin. Все пользовательские данные сохраняются в PostgreSQL, изображения — в постоянном каталоге uploads. Серверные сессии в таблице sessions. Браузер не хранит авторизацию в localStorage.

Дизайн: фон #f7f9f8, белые поверхности, графит #172d29, зелёный #246b52, тонкие серые границы. Крупная фотография архитектуры на главной, заметный поиск, карточки в три колонки. Системная кириллическая типографика, заголовки Manrope при доступном локальном шрифте. Адаптивные формы и клавиатурная навигация.

## Этапы
- [x] Написать и запустить тесты контрактов валидации до реализации.
- [x] Создать схему PostgreSQL, миграции, конфигурацию, скрипт демоданных.
- [x] Реализовать API с bcrypt, серверными сессиями, CSRF, rate limit и проверкой владения объектами.
- [x] Добавить проверку и перекодирование JPEG/PNG/WebP через sharp, лимиты загрузки, приватный доступ к изображениям черновиков.
- [x] Собрать главную, каталог с URL-фильтрами, объект, авторизацию, кабинет и редактор.
- [x] Проверить интеграционные сценарии на реальном PostgreSQL: регистрация, вход, загрузка, публикация, поиск, избранное, редактирование, снятие, удаление, запрет чужих изменений.
- [x] Пройти пользовательский сценарий в браузере, проверить адаптивность, ошибки, консоль и сохранность после перезапуска.
- [x] Подготовить README, .env.example, Docker Compose, зафиксировать этапы в приватном GitHub-репозитории с SSH remote.

## Разделение файлов
- server/config.js, db.js, migrate.js: окружение, пул и миграции.
- server/validation.js: контракт полей и ошибок.
- server/auth.js, properties.js, profile.js, uploads.js: REST-маршруты и права.
- server/app.js, index.js: middleware и запуск.
- migrations/: транзакционные SQL-миграции.
- public/: HTML, CSS, JS и локальные ресурсы.
- scripts/seed.js: повторяемые демоданные.
- tests/: валидация, API и сценарий браузера.

## Контракт API
GET /api/auth/session → {user|null,csrfToken}; POST /api/auth/register, /login → {user,csrfToken}; POST /logout.
GET/PATCH /api/profile → {user}; POST /api/profile/avatar multipart avatar.
GET /api/properties → {items,total,page,pages}; query q,deal,category,minPrice,maxPrice,minArea,maxArea,rooms,sort,page,limit,owner.
GET /api/properties/:id → {property,owner,images,otherProperties}; POST/PATCH /api/properties[/ :id] → {property}; DELETE /api/properties/:id.
GET /api/me/properties; GET /api/favorites; POST/DELETE /api/favorites/:id.
POST /api/properties/:id/images multipart images; DELETE /api/properties/:id/images/:imageId.
GET /api/properties/:id/contact → {phone,contactName}.
Изменяющие запросы требуют X-CSRF-Token. Ошибка: {error,fields?}. Значения deal: sale/rent, category: apartment/house/room/land/commercial, status: draft/published/archived.
Объект: id,ownerId,title,deal,category,city,district,address,price,area,rooms,description,contactName,contactPhone,status,createdAt,updatedAt,cover,imageCount,isFavorite. Публичные ответы не включают email, хеш, внутренние поля сессий; телефон отдаётся отдельным endpoint.
