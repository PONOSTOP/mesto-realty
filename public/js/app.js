import {
  state,
  api,
  esc,
  money,
  safeImage,
  categories,
  card,
  empty,
  wireFavorites,
  field,
  select,
  toast,
  authRequired,
} from "./core.js";
import { authPage, accountPage, editorPage } from "./forms.js";
const main = document.querySelector("#main");
function header() {
  document.querySelector("#header").innerHTML =
    `<div class="container header-inner"><a class="logo" href="/" aria-label="Место — главная">место<span>.</span></a><nav class="main-nav" aria-label="Основная навигация"><a href="/catalog?deal=sale">Купить</a><a href="/catalog?deal=rent">Снять</a><a href="/catalog?category=house">Дома</a></nav><div class="header-actions"><a class="favorite-nav" href="/account?tab=favorites">♡ &nbsp;Избранное</a><a href="${state.user ? "/account" : "/login"}">${state.user ? "Кабинет" : "Войти"}</a><a class="button" href="/publish">+ Разместить объявление</a></div></div>`;
}
const options = { "": "Любая недвижимость", ...categories };
async function home() {
  main.innerHTML = `<div class="container hero-wrap"><section class="hero"><div class="hero-content"><div class="eyebrow">Недвижимость для вашей жизни</div><h1>Место, где начинается<br>ваша история</h1><p>Квартира с видом. Дом с садом.<br>Найдите пространство, которое станет вашим.</p></div><span class="hero-note">Ближе к дому. Ближе к себе.</span></section><form class="search-panel" action="/catalog"><div class="deal-tabs"><label><input type="radio" name="deal" value="sale" checked>Купить</label><label><input type="radio" name="deal" value="rent">Снять</label></div><div class="search-row">${field("q", "Город или район", "", 'placeholder="Где вы хотите жить?"')}${select("category", "Тип недвижимости", options)}${field("maxPrice", "Бюджет до, ₽", "", 'type="number" min="1" placeholder="Не важно"')}<button class="button" type="submit">Найти недвижимость ↗</button></div></form><nav class="categories" aria-label="Тип недвижимости">${Object.entries(
    categories,
  )
    .map(
      ([key, label], i) =>
        `<a class="category-link" href="/catalog?category=${key}"><span class="category-mark" aria-hidden="true">${["▥", "⌂", "▤", "◇", "▦"][i]}</span>${label}<span aria-hidden="true">↗</span></a>`,
    )
    .join(
      "",
    )}</nav><section><div class="section-heading"><div><h2>Новые места для жизни</h2><p>Свежие объявления, к которым стоит присмотреться</p></div><a href="/catalog">Все объявления ↗</a></div><div id="home-listings" class="grid"><div class="loading">Загружаем объявления…</div></div></section><section class="city-section"><div class="section-heading"><div><h2>Ваш город. Ваше место.</h2><p>Начните поиск там, где хочется жить</p></div></div><div class="city-grid">${["Москва", "Санкт-Петербург", "Казань", "Сочи"].map((city) => `<a class="city-link" href="/catalog?q=${encodeURIComponent(city)}">${city}<span>↗</span></a>`).join("")}</div></section><section class="publish-banner"><div><h2>У вашего места будет новая история</h2><p>Расскажите о своей недвижимости тем, кто её ищет.</p></div><a class="button" href="/publish">Разместить объявление ↗</a></section></div>`;
  try {
    const data = await api("/properties?sort=newest&limit=6");
    document.querySelector("#home-listings").innerHTML = data.items.length
      ? data.items.map((p) => card(p)).join("")
      : empty(
          "Первые объявления уже близко",
          "Разместите свою недвижимость и начните новую историю.",
          "/publish",
          "Разместить объявление",
        );
    wireFavorites();
  } catch (e) {
    document.querySelector("#home-listings").innerHTML =
      `<div class="error-panel full"><p>${esc(e.message)}</p><a class="button secondary" href="/">Повторить</a></div>`;
  }
}
async function catalog() {
  const q = new URLSearchParams(location.search);
  for (const [key, value] of [...q]) if (!value) q.delete(key);
  main.innerHTML = `<div class="container page"><div class="breadcrumb"><a href="/">Главная</a> / Недвижимость</div><div class="page-intro"><h1>Найдите своё место</h1><p>Выбирайте пространство под свой ритм жизни</p></div><div class="catalog-layout"><form class="filters" action="/catalog"><h3 class="full">Параметры поиска</h3>${field("q", "Город, район или адрес", q.get("q"), 'placeholder="Например, Москва"')}${select("deal", "Сделка", { "": "Любая", sale: "Купить", rent: "Снять" }, q.get("deal"))}${select("category", "Недвижимость", options, q.get("category"))}<div class="pair">${field("minPrice", "Цена от, ₽", q.get("minPrice"), 'type="number" min="0"')}${field("maxPrice", "Цена до, ₽", q.get("maxPrice"), 'type="number" min="0"')}</div><div class="pair">${field("minArea", "Площадь от, м²", q.get("minArea"), 'type="number" min="0"')}${field("maxArea", "До, м²", q.get("maxArea"), 'type="number" min="0"')}</div>${select("rooms", "Комнаты", { "": "Не важно", 0: "Студия", 1: "1 комната", 2: "2 комнаты", 3: "3 комнаты", 4: "4 комнаты", 5: "5 комнат" }, q.get("rooms"))}<input type="hidden" name="sort" value="${esc(q.get("sort") || "newest")}">${q.get("owner") ? `<input type="hidden" name="owner" value="${esc(q.get("owner"))}">` : ""}<button class="button" type="submit">Показать объявления</button><a class="muted" href="/catalog">Сбросить фильтры</a></form><section class="catalog-content"><div class="result-bar"><span id="result-count">Ищем объявления…</span><label> <span class="sr-only">Сортировка</span><select id="sort" aria-label="Сортировка"><option value="newest">Сначала новые</option><option value="price_asc">Сначала дешевле</option><option value="price_desc">Сначала дороже</option></select></label></div><div id="results" class="grid"><div class="loading">Загрузка…</div></div><nav class="pagination" aria-label="Страницы"></nav></section></div></div>`;
  document.querySelector("#sort").value = q.get("sort") || "newest";
  document.querySelector("#sort").onchange = (e) => {
    q.set("sort", e.target.value);
    q.delete("page");
    location.href = "/catalog?" + q;
  };
  const data = await api("/properties?" + q);
  document.querySelector("#result-count").textContent =
    `Найдено объявлений: ${data.total}`;
  const results = document.querySelector("#results");
  results.innerHTML = data.items.length
    ? data.items.map((p) => card(p)).join("")
    : empty(
        "Пока ничего не нашлось",
        "Попробуйте увеличить бюджет или выбрать другой район.",
        "/catalog",
        "Сбросить фильтры",
      );
  for (let p = 1; p <= data.pages; p++) {
    if (
      data.pages > 9 &&
      Math.abs(p - data.page) > 2 &&
      p !== 1 &&
      p !== data.pages
    )
      continue;
    const params = new URLSearchParams(q);
    params.set("page", p);
    document
      .querySelector(".pagination")
      .insertAdjacentHTML(
        "beforeend",
        `<a class="${p === data.page ? "active" : ""}" ${p === data.page ? 'aria-current="page"' : ""} href="/catalog?${esc(params.toString())}">${p}</a>`,
      );
  }
  wireFavorites();
}
async function detail(id) {
  const {
    property: p,
    owner,
    images,
    otherProperties,
  } = await api("/properties/" + encodeURIComponent(id));
  document.title = p.title + " — Место";
  main.innerHTML = `<div class="container page"><div class="breadcrumb"><a href="/">Главная</a> / <a href="/catalog">Недвижимость</a> / ${esc(p.city)}</div><h1>${esc(p.title)}</h1><p class="muted detail-address">${esc(p.city)}, ${esc(p.district ? p.district + ", " : "")}${esc(p.address)}</p><div class="detail-layout"><div><img class="gallery-main" src="${safeImage(images[0]?.url)}" alt="${esc(p.title)}" width="900" height="620">${images.length > 1 ? `<div class="thumbnails" aria-label="Фотографии">${images.map((im, i) => `<button class="${i === 0 ? "selected" : ""}" data-photo="${safeImage(im.url)}" aria-label="Фото ${i + 1}"><img src="${safeImage(im.url)}" alt="Фото ${i + 1}" width="100" height="72"></button>`).join("")}</div>` : ""}<div class="detail-facts"><div><strong>${esc(p.area)} м²</strong><span class="muted">Общая площадь</span></div>${p.rooms !== null && p.rooms !== undefined ? `<div><strong>${p.rooms === 0 ? "Студия" : esc(p.rooms)}</strong><span class="muted">Комнаты</span></div>` : ""}<div><strong>${p.deal === "rent" ? "Аренда" : "Продажа"}</strong><span class="muted">Тип сделки</span></div></div><h2>О пространстве</h2><p class="description">${esc(p.description)}</p></div><aside class="contact-panel"><div class="detail-price">${money(p.price)}${p.deal === "rent" ? '<span class="muted"> / месяц</span>' : ""}</div><p class="muted">${p.deal === "sale" ? money(Math.round(p.price / p.area)) + " за м²" : "Долгосрочная аренда"}</p>${p.status !== "published" ? `<p class="muted">${p.status === "draft" ? "Черновик" : "Объявление в архиве"}</p>` : ""}<button id="reveal" class="button">Показать телефон</button><button class="button secondary" id="detail-favorite">${p.isFavorite ? "Убрать из избранного" : "♡ Сохранить в избранное"}</button><div class="owner">${owner.avatar ? `<img class="avatar" src="${safeImage(owner.avatar)}" alt="${esc(owner.name)}">` : `<span class="avatar">${esc(owner.name?.[0] || "М")}</span>`}<div><strong>${esc(owner.name)}</strong><p>Автор объявления</p></div></div>${owner.bio ? `<p class="muted owner-bio">${esc(owner.bio)}</p>` : ""}<a class="button secondary" href="/catalog?owner=${encodeURIComponent(owner.id)}">Объявления автора ↗</a>${state.user?.id === p.ownerId ? `<a class="button secondary" href="/edit/${encodeURIComponent(p.id)}">Редактировать</a>` : ""}</aside></div>${otherProperties?.length ? `<section class="detail-more"><div class="section-heading"><h2>Другие объявления автора</h2></div><div class="grid">${otherProperties.map((item) => card(item)).join("")}</div></section>` : ""}</div>`;
  document.querySelectorAll("[data-photo]").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelector(".gallery-main").src = b.dataset.photo;
        document
          .querySelectorAll("[data-photo]")
          .forEach((x) => x.classList.toggle("selected", x === b));
      }),
  );
  document.querySelector("#reveal").onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const data = await api(
        "/properties/" + encodeURIComponent(id) + "/contact",
      );
      const link = document.createElement("a");
      link.className = "button";
      link.href = "tel:" + String(data.phone).replace(/[^+\d]/g, "");
      link.textContent = data.phone;
      b.replaceWith(link);
    } catch (error) {
      toast(error.message);
      b.disabled = false;
    }
  };
  document.querySelector("#detail-favorite").onclick = async (e) => {
    if (!authRequired()) return;
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await api("/favorites/" + encodeURIComponent(id), {
        method: p.isFavorite ? "DELETE" : "POST",
      });
      p.isFavorite = !p.isFavorite;
      b.textContent = p.isFavorite
        ? "Убрать из избранного"
        : "♡ Сохранить в избранное";
    } catch (error) {
      toast(error.message);
    } finally {
      b.disabled = false;
    }
  };
  wireFavorites();
}
document.addEventListener("submit", (e) => {
  if (e.target.matches('form[action="/catalog"]')) {
    e.preventDefault();
    const params = new URLSearchParams(new FormData(e.target));
    for (const [key, value] of [...params]) if (!value) params.delete(key);
    location.href = "/catalog?" + params;
  }
});
try {
  const session = await api("/auth/session");
  Object.assign(state, session);
  header();
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (path === "/") await home();
  else if (path === "/catalog") await catalog();
  else if (/^\/property\/[^/]+$/.test(path)) await detail(path.split("/")[2]);
  else if (path === "/login" || path === "/register") authPage(path.slice(1));
  else if (path === "/account") await accountPage();
  else if (path === "/publish" || /^\/edit\/[^/]+$/.test(path))
    await editorPage(path.startsWith("/edit/") ? path.split("/")[2] : null);
  else
    main.innerHTML = `<div class="container page">${empty("Такого места пока нет", "Вернитесь к поиску — там обязательно найдётся что-то интересное.")}</div>`;
} catch (error) {
  header();
  main.innerHTML = `<div class="container page"><div class="error-panel"><h1>Не удалось открыть страницу</h1><p>${esc(error.message)}</p><a class="button" href="${esc(location.pathname + location.search)}">Попробовать ещё раз</a> <a class="button secondary" href="/catalog">В каталог</a></div></div>`;
}
