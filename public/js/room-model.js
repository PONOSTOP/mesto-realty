import { esc } from "./core.js";

export const validModelUrl = (url) =>
  typeof url === "string" &&
  /^\/models\/[a-zA-Z0-9_-]+\/[1-9]\d*\/scene\.ply$/.test(url);

export function modelMarkup(model, owner = false) {
  if (!model || (model.state !== "ready" && !owner)) return "";
  if (model.state === "ready") {
    if (!validModelUrl(model.url)) return "";
    return `<section class="room-model" aria-labelledby="room-model-title"><div class="section-heading"><div><span class="eyebrow">Пространство в деталях</span><h2 id="room-model-title">3D-просмотр помещения</h2></div></div><p class="muted">Осмотрите помещение с разных ракурсов. Модель восстановлена по фотографиям: отдельные детали могут отсутствовать.</p><button type="button" class="button" data-room-open>Открыть 3D-просмотр</button><p data-room-message role="status" aria-live="polite"></p><div class="room-stage" hidden><div class="room-canvas" tabindex="0" role="region" aria-label="3D-модель помещения" aria-describedby="room-help"></div><div class="room-controls"><button type="button" class="button secondary" data-room-reset>Сбросить ракурс</button><button type="button" class="button secondary" data-room-fullscreen>На весь экран</button></div><p id="room-help" class="room-help">Мышь: перетаскивание — поворот, правая кнопка — перемещение, колесо — масштаб. На телефоне: один палец — поворот, два — перемещение и масштаб. Клавиатура: стрелки — поворот, + / − — масштаб, R — сброс. Escape — выйти из полного экрана.</p></div></section>`;
  }
  const count = Number.isInteger(model.imageCount) ? model.imageCount : 0;
  const minimum = Number.isInteger(model.minPhotos) ? model.minPhotos : 20;
  const messages = {
    queued:
      "Фотографии добавлены в очередь. 3D-просмотр появится здесь после обработки.",
    processing:
      "Восстанавливаем помещение по фотографиям. Обработка может занять некоторое время.",
    needs_photos: `Для автоматической попытки нужно не менее ${minimum} фотографий. Сейчас: ${count}. Добавьте снимки помещения с перекрывающимися ракурсами.`,
    unavailable:
      "Автоматическая обработка пока недоступна. Фотографии сохранены; 3D-просмотр появится после подключения обработки.",
    failed:
      model.errorCode === "insufficient_overlap"
        ? "Не удалось совместить фотографии. Добавьте последовательные снимки одной комнаты с большим перекрытием."
        : "Не удалось восстановить помещение. Добавьте резкие снимки одной комнаты с большим перекрытием и сохраните объект ещё раз.",
    none: "Добавьте последовательную серию фотографий помещения, чтобы автоматически создать 3D-просмотр.",
  };
  return `<section class="room-model room-model-status" aria-labelledby="room-model-title"><h2 id="room-model-title">3D-просмотр помещения</h2><p role="status" aria-live="polite">${esc(messages[model.state] || messages.none)}</p><a href="${locationPath(model)}" class="room-edit-link">Добавить фотографии ↗</a></section>`;
}

function locationPath(model) {
  return "/edit/" + encodeURIComponent(model.propertyId || "");
}

export async function uploadPhotoBatches(pending, upload, completed) {
  while (pending.length) {
    const batch = pending.slice(0, 10);
    const data = new FormData();
    batch.forEach((file) => data.append("images", file));
    const result = await upload(data);
    pending.splice(0, batch.length);
    completed(result);
  }
}

export { mountArchitecturalModel as mountRoomModel } from "./architectural-model.js";
