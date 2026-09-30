export const state = { user: null, csrfToken: "" };
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const safeImage = (u) =>
  typeof u === "string" &&
  /^\/(assets|media)\/[a-zA-Z0-9_./-]+$/.test(u) &&
  !u.includes("..")
    ? u
    : "/assets/placeholder.svg";
export const money = (v) =>
  new Intl.NumberFormat("ru-RU").format(Number(v) || 0) + " ₽";
export const categories = {
  apartment: "Квартиры",
  house: "Дома",
  room: "Комнаты",
  land: "Участки",
  commercial: "Коммерция",
};
export const statuses = {
  draft: "Черновик",
  published: "Опубликовано",
  archived: "В архиве",
};
export async function api(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(options.method && options.method !== "GET"
      ? { "X-CSRF-Token": state.csrfToken }
      : {}),
    ...options.headers,
  };
  let response;
  try {
    response = await fetch("/api" + path, {
      credentials: "same-origin",
      ...options,
      headers,
      body:
        options.body && !(options.body instanceof FormData)
          ? JSON.stringify(options.body)
          : options.body,
    });
  } catch {
    throw new Error(
      "Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.",
    );
  }
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Не удалось выполнить действие");
    error.fields = data.fields;
    error.status = response.status;
    throw error;
  }
  if (data.csrfToken) state.csrfToken = data.csrfToken;
  return data;
}
export function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 4500);
}
export function authRequired() {
  if (state.user) return true;
  location.href =
    "/login?next=" + encodeURIComponent(location.pathname + location.search);
  return false;
}
export const field = (name, label, value = "", attrs = "") =>
  `<label class="field">${label}<input name="${name}" value="${esc(value)}" ${attrs}><span class="field-error" data-error="${name}"></span></label>`;
export const select = (name, label, options, value = "") =>
  `<label class="field">${label}<select name="${name}">${Object.entries(options)
    .map(
      ([k, v]) =>
        `<option value="${esc(k)}" ${String(value) === k ? "selected" : ""}>${esc(v)}</option>`,
    )
    .join(
      "",
    )}</select><span class="field-error" data-error="${name}"></span></label>`;
export function errors(form, error) {
  const box = form.querySelector(".form-error");
  if (box) {
    box.textContent = error.message;
    box.focus();
  }
  form.querySelectorAll("[data-error]").forEach((el) => {
    const message = error.fields?.[el.dataset.error];
    el.textContent = Array.isArray(message)
      ? message.join(", ")
      : message || "";
  });
}
export function busy(form, on) {
  form
    .querySelectorAll('button[type="submit"]')
    .forEach((b) => (b.disabled = on));
  form.setAttribute("aria-busy", String(on));
}
export function card(p, manage = false) {
  return `<article class="property-card"><div class="card-photo"><a href="/property/${encodeURIComponent(p.id)}"><img src="${safeImage(p.cover)}" alt="${esc(p.title)}" loading="lazy" width="600" height="420"></a><span class="badge">${p.deal === "rent" ? "Аренда" : "Продажа"}</span><button class="heart ${p.isFavorite ? "active" : ""}" data-favorite="${esc(p.id)}" data-active="${!!p.isFavorite}" aria-label="${p.isFavorite ? "Убрать из избранного" : "Добавить в избранное"}" aria-pressed="${!!p.isFavorite}">${p.isFavorite ? "♥" : "♡"}</button></div><div class="card-body"><div class="card-price">${money(p.price)}${p.deal === "rent" ? "<small> / месяц</small>" : ""}</div><a class="card-title" href="/property/${encodeURIComponent(p.id)}">${esc(p.title)}</a><p class="card-address">${esc(p.city)} · ${esc(p.address)}</p><div class="card-meta"><span>${esc(p.area)} м²</span>${p.rooms !== null && p.rooms !== undefined ? `<span>${Number(p.rooms) === 0 ? "Студия" : esc(p.rooms) + " комн."}</span>` : ""}<span>${esc(categories[p.category] || "Недвижимость")}</span></div>${manage ? `<div class="manage"><span class="status">${esc(statuses[p.status])}</span><a href="/edit/${encodeURIComponent(p.id)}">Изменить</a>${p.status === "published" ? `<button data-archive="${esc(p.id)}">В архив</button>` : ""}<button class="danger-link" data-delete="${esc(p.id)}">Удалить</button></div>` : ""}</div></article>`;
}
export const empty = (
  title,
  body,
  href = "/catalog",
  label = "Открыть каталог",
) =>
  `<div class="empty"><span class="empty-mark">место.</span><h2>${esc(title)}</h2><p>${esc(body)}</p><a class="button" href="${href}">${label}</a></div>`;
export function wireFavorites(root = document) {
  root.querySelectorAll("[data-favorite]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!authRequired()) return;
      b.disabled = true;
      try {
        const active = b.dataset.active === "true";
        await api("/favorites/" + encodeURIComponent(b.dataset.favorite), {
          method: active ? "DELETE" : "POST",
        });
        b.dataset.active = String(!active);
        b.classList.toggle("active", !active);
        b.textContent = active ? "♡" : "♥";
        b.setAttribute("aria-pressed", String(!active));
        b.setAttribute(
          "aria-label",
          active ? "Добавить в избранное" : "Убрать из избранного",
        );
        toast(active ? "Удалено из избранного" : "Сохранено в избранное");
      } catch (e) {
        toast(e.message);
      } finally {
        b.disabled = false;
      }
    }),
  );
}
