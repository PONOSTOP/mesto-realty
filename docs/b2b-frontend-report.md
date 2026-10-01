# B2B frontend implementation

Implemented commercial-only frontend across home, catalog, detail, auth, account, profile and editor. Uses existing vanilla modules and API/session handling. Design: light corporate palette, local Manrope, architectural split hero, overlapping search, six purpose-specific category links, commercial cards with total and per-area prices, business profiles, responsive layouts and reduced-motion support.

## Functional changes

- Six commercial categories; rent default on home and new editor.
- Removes room controls/data. Old rooms and unsupported category URL parameters stripped before fetching catalog.
- Catalog supports class, ceiling height, power, parking, decimal price/area, preserved sorting and pagination.
- Editor adds buildingClass, floor, ceilingHeight, powerKw, parking, tax. Land hides/disables building attributes; warehouse/industrial hide class/floor. Hidden values stay in DOM, excluded from submission, and PATCH preserves previously stored omitted fields.
- Company and business role editable on signup/profile; detail shows organization, contact person and role.
- Upload ownership, safe return path, escaping, image URL validation, favorite state and uncertain-create duplicate protection retained.
- Failed initial PATCH no longer falsely reports that a draft was saved.
- Explicit accessible select labels prevent option text from polluting exact accessible names.

## Browser labels

Header: Разместить объект. Home submit: Найти объект (arrow aria-hidden). Catalog: Назначение объекта, Класс здания, Потолки от, м, Мощность от, кВт, Парковка, Показать объявления. Editor: Тип недвижимости, Класс здания, Этаж, Высота потолков, м, Мощность, кВт, НДС, Парковка. Signup/profile: Компания, Ваша роль. Account heading: Кабинет компании. Editor heading: Разместить коммерческий объект / Редактирование объекта. Existing publish/save/contact/favorite labels retained.

## Verification

node --check passed for all three JS modules; Prettier completed for HTML/CSS/JS. Static search found no residential labels or room control/data accesses; only removal of legacy rooms query remains. Parent owns live browser tests and screenshots. Assets supplied by parent at unchanged URLs.
