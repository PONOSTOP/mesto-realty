import {
  state,
  api,
  esc,
  safeImage,
  categories,
  card,
  empty,
  wireFavorites,
  field,
  select,
  toast,
  authRequired,
  errors,
  busy,
} from "./core.js";
const main = document.querySelector("#main");
export function authPage(mode) {
  const register = mode === "register";
  main.innerHTML = `<div class="auth-wrap"><div class="eyebrow">Добро пожаловать в Место</div><h1>${register ? "Начнём вашу историю" : "С возвращением"}</h1><p>${register ? "Создайте аккаунт, чтобы сохранять и публиковать объявления." : "Войдите, чтобы вернуться к вашим объявлениям."}</p><form id="auth-form" class="stack">${register ? field("name", "Ваше имя", "", 'required minlength="2" maxlength="80" autocomplete="name"') : ""}${field("email", "Электронная почта", "", 'required type="email" autocomplete="email" maxlength="254" placeholder="you@example.ru"')}${field("password", "Пароль", "", 'required type="password" minlength="10" maxlength="72" autocomplete="' + (register ? "new-password" : "current-password") + '"' + (register ? ' placeholder="Не менее 8 символов"' : ""))}${register ? field("confirmPassword", "Повторите пароль", "", 'required type="password" minlength="10" autocomplete="new-password"') : ""}<div class="form-error" tabindex="-1" role="alert"></div><button class="button" type="submit">${register ? "Создать аккаунт" : "Войти"}</button><p class="form-note">${register ? "Уже есть аккаунт?" : "Ещё нет аккаунта?"} <a href="/${register ? "login" : "register"}${location.search}">${register ? "Войти" : "Зарегистрироваться"}</a></p></form></div>`;
  document.querySelector("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (register && values.password !== values.confirmPassword) {
      errors(form, new Error("Пароли не совпадают. Проверьте повторный ввод."));
      return;
    }
    delete values.confirmPassword;
    busy(form, true);
    try {
      const data = await api("/auth/" + mode, { method: "POST", body: values });
      state.user = data.user;
      const next = new URLSearchParams(location.search).get("next");
      location.href =
        next &&
        next.startsWith("/") &&
        !next.startsWith("//") &&
        !next.includes("\\")
          ? next
          : "/account";
    } catch (error) {
      errors(form, error);
      busy(form, false);
    }
  };
}
export async function accountPage() {
  if (!authRequired()) return;
  const tab = new URLSearchParams(location.search).get("tab") || "properties";
  main.innerHTML = `<div class="container page"><div class="section-heading"><div><h1>Личный кабинет</h1><p>Здравствуйте, ${esc(state.user.name)}</p></div><button id="logout" class="button secondary">Выйти</button></div><nav class="tabs" aria-label="Разделы кабинета">${Object.entries(
    {
      properties: "Мои объявления",
      favorites: "Избранное",
      profile: "Профиль",
    },
  )
    .map(
      ([key, label]) =>
        `<a class="${key === tab ? "active" : ""}" href="/account?tab=${key}">${label}</a>`,
    )
    .join(
      "",
    )}</nav><div id="account-content"><div class="loading">Загрузка…</div></div></div>`;
  document.querySelector("#logout").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api("/auth/logout", { method: "POST" });
      location.href = "/";
    } catch (error) {
      toast(error.message);
      e.currentTarget.disabled = false;
    }
  };
  const content = document.querySelector("#account-content");
  if (tab === "profile") {
    await profile(content);
    return;
  }
  const mine = tab !== "favorites";
  const params = new URLSearchParams(location.search);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const data = await api(
    (mine ? "/me/properties" : "/favorites") + "?limit=12&page=" + page,
  );
  content.innerHTML = `<div class="section-heading"><p>${mine ? "Ваши объявления" : "Сохранённые места"}: ${data.total}</p>${mine ? '<a class="button" href="/publish">+ Новое объявление</a>' : ""}</div>${data.items.length ? `<div class="grid">${data.items.map((p) => card(p, mine)).join("")}</div>` : empty(mine ? "Здесь начнётся новая история" : "Сохраните места, которые понравились", mine ? "Добавьте фотографии, расскажите о недвижимости — и найдите своего покупателя или арендатора." : "Нажимайте на сердечко в каталоге, чтобы вернуться к объявлению позже.", mine ? "/publish" : "/catalog", mine ? "Разместить объявление" : "Найти недвижимость")}<nav class="pagination" aria-label="Страницы">${Array.from({ length: data.pages }, (_, i) => `<a class="${i + 1 === data.page ? "active" : ""}" href="/account?tab=${mine ? "properties" : "favorites"}&page=${i + 1}">${i + 1}</a>`).join("")}</nav>`;
  wireFavorites(content);
  content.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          !confirm(
            "Удалить объявление и все его фотографии? Это действие нельзя отменить.",
          )
        )
          return;
        b.disabled = true;
        try {
          await api("/properties/" + encodeURIComponent(b.dataset.delete), {
            method: "DELETE",
          });
          await accountPage();
          toast("Объявление удалено");
        } catch (error) {
          toast(error.message);
          b.disabled = false;
        }
      }),
  );
  content.querySelectorAll("[data-archive]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await api("/properties/" + encodeURIComponent(b.dataset.archive), {
            method: "PATCH",
            body: { status: "archived" },
          });
          await accountPage();
          toast("Объявление перенесено в архив");
        } catch (error) {
          toast(error.message);
          b.disabled = false;
        }
      }),
  );
}
async function profile(content) {
  const { user } = await api("/profile");
  content.innerHTML = `<div class="form-sheet profile-layout"><form id="avatar-form" class="profile-avatar">${user.avatar ? `<img class="avatar" src="${safeImage(user.avatar)}" alt="Фото профиля">` : `<span class="avatar">${esc(user.name[0])}</span>`}<label class="field">Фото профиля<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" required></label><p class="muted">JPEG, PNG или WebP, до 8 МБ.</p><div class="form-error" role="alert" tabindex="-1"></div><button class="button secondary" type="submit">Загрузить фото</button></form><form id="profile-form" class="stack"><h2>О вас</h2>${field("name", "Имя", user.name, 'required minlength="2" maxlength="80" autocomplete="name"')}${field("phone", "Телефон", user.phone, 'type="tel" autocomplete="tel" placeholder="+7 900 000-00-00"')}<label class="field">Электронная почта<input value="${esc(user.email)}" disabled></label><label class="field">О себе<textarea name="bio" maxlength="1000" placeholder="Несколько слов о вас">${esc(user.bio)}</textarea><span class="field-error" data-error="bio"></span></label><div class="form-error" role="alert" tabindex="-1"></div><button class="button" type="submit">Сохранить изменения</button></form></div>`;
  document.querySelector("#profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, true);
    try {
      const data = await api("/profile", {
        method: "PATCH",
        body: Object.fromEntries(new FormData(form)),
      });
      state.user = data.user;
      toast("Изменения сохранены");
      errors(form, { message: "" });
    } catch (error) {
      errors(form, error);
    } finally {
      busy(form, false);
    }
  };
  document.querySelector("#avatar-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, true);
    try {
      validateFiles([...form.elements.avatar.files], 1);
      await api("/profile/avatar", {
        method: "POST",
        body: new FormData(form),
      });
      await profile(content);
      toast("Фото профиля обновлено");
    } catch (error) {
      errors(form, error);
      busy(form, false);
    }
  };
}
function validateFiles(files, max) {
  if (files.length > max)
    throw new Error(`Можно добавить не больше ${max} фото.`);
  for (const f of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type))
      throw new Error("Выберите фотографии JPEG, PNG или WebP.");
    if (f.size > 8 * 1024 * 1024)
      throw new Error(`Файл «${f.name}» больше 8 МБ.`);
  }
}
export async function editorPage(id) {
  if (!authRequired()) return;
  let p = {
    deal: "sale",
    category: "apartment",
    contactName: state.user.name,
    contactPhone: state.user.phone,
    status: "draft",
  };
  let images = [];
  if (id) {
    const data = await api("/properties/" + encodeURIComponent(id));
    p = data.property;
    images = data.images;
    if (String(p.ownerId) !== String(state.user.id))
      throw new Error("Вы можете редактировать только свои объявления.");
  }
  let propertyId = id;
  let pending = [];
  let urls = [];
  main.innerHTML = `<div class="container page"><div class="breadcrumb"><a href="/account">Личный кабинет</a> / ${id ? "Редактирование" : "Новое объявление"}</div><div class="page-intro"><h1>${id ? "Расскажите о вашем месте" : "У каждого места есть история"}</h1><p>${id ? "Обновите информацию и фотографии объявления." : "Добавьте недвижимость — поможем найти тех, кто её ищет."}</p></div><form id="editor" class="form-sheet"><section class="form-section"><h2>Основное</h2><div class="form-grid">${select("deal", "Тип сделки", { sale: "Продажа", rent: "Аренда" }, p.deal)}${select("category", "Тип недвижимости", categories, p.category)}<div class="full">${field("title", "Заголовок объявления", p.title, 'required minlength="5" maxlength="120" placeholder="Светлая квартира рядом с парком"')}</div>${field("price", "Цена, ₽", p.price, 'required type="number" min="1" max="999999999999" step="0.01"')}${field("area", "Площадь, м²", p.area, 'required type="number" min="0.01" max="99999999" step="0.01"')}${field("rooms", "Количество комнат", p.rooms, 'type="number" min="0" max="100" step="1"')}</div></section><section class="form-section"><h2>Расположение</h2><div class="form-grid">${field("city", "Город", p.city, 'required minlength="2" maxlength="120" placeholder="Москва"')}${field("district", "Район", p.district, 'maxlength="120" placeholder="Необязательно"')}<div class="full">${field("address", "Адрес", p.address, 'required minlength="5" maxlength="200" placeholder="Улица, номер дома"')}</div></div></section><section class="form-section"><h2>Фотографии</h2><div class="upload"><label class="field">Добавьте до 10 фотографий<input id="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="muted">JPEG, PNG или WebP, до 8 МБ каждое. Первое фото станет обложкой. Для публикации нужно хотя бы одно фото.</p></div><div id="photo-previews" class="preview-grid"></div><p id="photo-error" class="form-error" role="alert"></p></section><section class="form-section"><h2>О недвижимости</h2><label class="field">Описание<textarea name="description" required minlength="20" maxlength="10000" placeholder="Расскажите о планировке, ремонте и о том, что рядом. Не менее 20 символов.">${esc(p.description)}</textarea><span class="field-error" data-error="description"></span></label></section><section class="form-section"><h2>Контакты</h2><div class="form-grid">${field("contactName", "Контактное лицо", p.contactName, 'required minlength="2" maxlength="80" autocomplete="name"')}${field("contactPhone", "Телефон", p.contactPhone, 'required type="tel" autocomplete="tel" placeholder="+7 900 000-00-00"')}</div></section><div class="form-error" tabindex="-1" role="alert"></div><p id="save-progress" class="muted" aria-live="polite"></p><div class="form-actions"><button type="submit" class="button" name="intent" value="published">${p.status === "published" ? "Сохранить и опубликовать" : "Опубликовать"}</button><button type="submit" class="button secondary" name="intent" value="draft">Сохранить черновик</button><a class="button secondary" href="/account">В кабинет</a></div></form></div>`;
  const form = document.querySelector("#editor");
  const category = form.elements.category;
  const updateRooms = () => {
    const needed = ["apartment", "house", "room"].includes(category.value);
    form.elements.rooms.required = needed;
    form.elements.rooms.closest(".field").hidden = !needed;
    form.elements.rooms.disabled = !needed;
  };
  category.onchange = updateRooms;
  updateRooms();
  const renderPhotos = () => {
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    document.querySelector("#photo-previews").innerHTML =
      images
        .map(
          (im) =>
            `<div class="photo-preview"><img src="${safeImage(im.url)}" alt="Фото недвижимости"><button type="button" data-remove-image="${esc(im.id)}">Удалить фото</button></div>`,
        )
        .join("") +
      pending
        .map((file, i) => {
          const url = URL.createObjectURL(file);
          urls.push(url);
          return `<div class="photo-preview"><img src="${url}" alt="${esc(file.name)}"><button type="button" data-remove-pending="${i}">Убрать фото</button></div>`;
        })
        .join("");
    document.querySelectorAll("[data-remove-pending]").forEach(
      (b) =>
        (b.onclick = () => {
          pending.splice(Number(b.dataset.removePending), 1);
          renderPhotos();
        }),
    );
    document.querySelectorAll("[data-remove-image]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm("Удалить эту фотографию?")) return;
          b.disabled = true;
          try {
            await api(
              "/properties/" +
                encodeURIComponent(propertyId) +
                "/images/" +
                encodeURIComponent(b.dataset.removeImage),
              { method: "DELETE" },
            );
            images = images.filter(
              (im) => String(im.id) !== b.dataset.removeImage,
            );
            renderPhotos();
          } catch (error) {
            document.querySelector("#photo-error").textContent = error.message;
            b.disabled = false;
          }
        }),
    );
  };
  renderPhotos();
  document.querySelector("#photos").onchange = (e) => {
    try {
      const files = [...e.target.files];
      validateFiles([...pending, ...files], 10 - images.length);
      pending.push(...files);
      renderPhotos();
      document.querySelector("#photo-error").textContent = "";
    } catch (error) {
      document.querySelector("#photo-error").textContent = error.message;
    }
    e.target.value = "";
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const targetStatus = e.submitter?.value || "draft";
    const body = Object.fromEntries(new FormData(form));
    delete body.intent;
    if (
      !/^\+?[\d\s()\-]{7,25}$/.test(body.contactPhone) ||
      body.contactPhone.replace(/\D/g, "").length < 7 ||
      body.contactPhone.replace(/\D/g, "").length > 15
    ) {
      errors(
        form,
        new Error("Проверьте телефон: он должен содержать от 7 до 15 цифр."),
      );
      return;
    }
    if (targetStatus === "published" && !images.length && !pending.length) {
      errors(
        form,
        new Error("Добавьте хотя бы одну фотографию для публикации."),
      );
      return;
    }
    body.price = Number(body.price);
    body.area = Number(body.area);
    body.rooms =
      body.rooms !== undefined && body.rooms !== "" ? Number(body.rooms) : null;
    body.status = "draft";
    busy(form, true);
    form
      .querySelectorAll('input,select,textarea,button[type="button"]')
      .forEach((el) => (el.disabled = true));
    const progress = document.querySelector("#save-progress");
    let uploadStarted = false;
    try {
      errors(form, { message: "" });
      progress.textContent = "Сохраняем объявление…";
      const saved = await api(
        "/properties" +
          (propertyId ? "/" + encodeURIComponent(propertyId) : ""),
        { method: propertyId ? "PATCH" : "POST", body },
      );
      propertyId = saved.property.id;
      history.replaceState({}, "", "/edit/" + encodeURIComponent(propertyId));
      if (pending.length) {
        progress.textContent = "Загружаем фотографии…";
        uploadStarted = true;
        const data = new FormData();
        pending.forEach((f) => data.append("images", f));
        const uploaded = await api(
          "/properties/" + encodeURIComponent(propertyId) + "/images",
          { method: "POST", body: data },
        );
        pending = [];
        images = uploaded.images;
        renderPhotos();
        uploadStarted = false;
      }
      progress.textContent =
        targetStatus === "published"
          ? "Публикуем объявление…"
          : "Сохраняем черновик…";
      await api("/properties/" + encodeURIComponent(propertyId), {
        method: "PATCH",
        body: { status: targetStatus },
      });
      location.href =
        targetStatus === "published"
          ? "/property/" + encodeURIComponent(propertyId)
          : "/account";
    } catch (error) {
      if (uploadStarted) {
        if (!error.status) {
          pending = [];
          error.message =
            "Соединение прервалось при загрузке фото. Черновик сохранён. Откройте его заново из кабинета и проверьте фотографии перед повторной публикацией.";
        }
        try {
          const refreshed = await api(
            "/properties/" + encodeURIComponent(propertyId),
          );
          if (refreshed.images.length > images.length) {
            pending = [];
          }
          images = refreshed.images;
          renderPhotos();
        } catch {
          renderPhotos();
        }
      }
      progress.textContent = propertyId
        ? "Объявление сохранено как черновик. Исправьте ошибку и повторите сохранение."
        : "";
      errors(form, error);
      busy(form, false);
      form
        .querySelectorAll('input,select,textarea,button[type="button"]')
        .forEach((el) => (el.disabled = false));
      updateRooms();
    }
  };
}
