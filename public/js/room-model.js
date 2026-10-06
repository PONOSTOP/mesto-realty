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

export function mountRoomModel(host, propertyId, owner, request, options = {}) {
  let disposed = false;
  let timer;
  let viewer;
  let currentKey;
  let loading = false;
  let generation = 0;
  let requestVersion = 0;
  const controller = new AbortController();
  const loadLibrary =
    options.loadLibrary || (() => import("/assets/vendor/room-viewer.js"));
  const alive = () => !disposed && host.isConnected;
  async function disposeViewer(expected = viewer) {
    if (expected !== viewer) return;
    const old = viewer;
    viewer = null;
    if (old) {
      try {
        await old.dispose();
      } catch {
        /* Navigating must still release the host. */
      }
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (owner && alive()) timer = setTimeout(refresh, 15000);
  }
  async function refresh() {
    if (!alive()) return;
    if (document.hidden) {
      schedule();
      return;
    }
    const requestedVersion = ++requestVersion;
    try {
      const { model } = await request(
        "/properties/" + encodeURIComponent(propertyId) + "/model",
        { signal: controller.signal },
      );
      if (!alive() || requestedVersion !== requestVersion) return;
      const key = JSON.stringify(model);
      if (key !== currentKey) {
        currentKey = key;
        generation++;
        loading = false;
        await disposeViewer();
        if (!alive() || requestedVersion !== requestVersion) return;
        host.innerHTML = modelMarkup({ ...model, propertyId }, owner);
        host.hidden = !host.innerHTML;
        if (model.state === "ready" && validModelUrl(model.url))
          wireViewer(model);
      }
    } catch {
      if (
        alive() &&
        requestedVersion === requestVersion &&
        owner &&
        currentKey === undefined
      ) {
        host.hidden = false;
        host.innerHTML =
          '<p class="room-model muted" role="status">Не удалось проверить 3D-просмотр. Попробуем ещё раз автоматически.</p>';
      }
    } finally {
      if (requestedVersion === requestVersion) schedule();
    }
  }
  function wireViewer(model) {
    const open = host.querySelector("[data-room-open]");
    if (!open) return;
    open.onclick = async () => {
      if (loading || viewer) return;
      loading = true;
      const revision = generation;
      const message = host.querySelector("[data-room-message]");
      const stage = host.querySelector(".room-stage");
      const canvas = host.querySelector(".room-canvas");
      const valid = () => alive() && revision === generation;
      let instance;
      open.disabled = true;
      message.textContent = "Загружаем 3D-просмотр…";
      try {
        const probe = document.createElement("canvas");
        const gl = probe.getContext("webgl2");
        if (!gl)
          throw new Error(
            "Для 3D-просмотра нужен браузер с WebGL2. Попробуйте обновить браузер или открыть объект на другом устройстве.",
          );
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        const library = await loadLibrary();
        if (!valid()) return;
        stage.hidden = false;
        const camera = model.camera || {};
        viewer = new library.Viewer({
          rootElement: canvas,
          cameraUp: camera.up || [0, 1, 0],
          initialCameraPosition: camera.position || [0, 0, 5],
          initialCameraLookAt: camera.target || [0, 0, 0],
          sharedMemoryForWorkers: false,
          gpuAcceleratedSort: false,
          enableSIMDInSort: false,
          integerBasedSort: false,
          dynamicScene: false,
          showLoadingUI: false,
          sphericalHarmonicsDegree: 0,
        });
        instance = viewer;
        await instance.addSplatScene(model.url, {
          showLoadingUI: false,
          progressiveLoad: false,
          splatAlphaRemovalThreshold: 5,
        });
        if (!valid()) {
          await disposeViewer(instance);
          return;
        }
        instance.start();
        open.hidden = true;
        message.textContent = "3D-просмотр готов";
        const reset = () => {
          instance.camera.position.fromArray(camera.position || [0, 0, 5]);
          instance.camera.up.fromArray(camera.up || [0, 1, 0]);
          instance.controls.target.fromArray(camera.target || [0, 0, 0]);
          instance.controls.update();
          instance.forceRenderNextFrame();
        };
        host.querySelector("[data-room-reset]").onclick = reset;
        const full = host.querySelector("[data-room-fullscreen]");
        full.hidden = !stage.requestFullscreen;
        full.onclick = async () => {
          try {
            if (document.fullscreenElement === stage)
              await document.exitFullscreen();
            else await stage.requestFullscreen();
          } catch {
            message.textContent =
              "Полноэкранный режим недоступен в этом браузере.";
          }
        };
        canvas.onkeydown = (event) => {
          if (
            ![
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "+",
              "=",
              "-",
              "r",
              "R",
            ].includes(event.key)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key.toLowerCase() === "r") {
            reset();
            return;
          }
          const offset = instance.camera.position
            .clone()
            .sub(instance.controls.target);
          if (["+", "=", "-"].includes(event.key))
            offset.multiplyScalar(event.key === "-" ? 1.12 : 0.88);
          else {
            const axis =
              event.key === "ArrowLeft" || event.key === "ArrowRight"
                ? instance.camera.up.clone().normalize()
                : offset.clone().cross(instance.camera.up).normalize();
            offset.applyAxisAngle(
              axis,
              ["ArrowLeft", "ArrowUp"].includes(event.key) ? 0.08 : -0.08,
            );
          }
          instance.camera.position.copy(instance.controls.target).add(offset);
          instance.controls.update();
          instance.forceRenderNextFrame();
        };
        canvas.focus();
      } catch (error) {
        if (instance) await disposeViewer(instance);
        if (valid()) {
          stage.hidden = true;
          canvas.replaceChildren();
          message.textContent = error.message?.includes("WebGL2")
            ? error.message
            : "Не удалось загрузить 3D-просмотр. Проверьте соединение и попробуйте ещё раз. Фотографии объекта доступны выше.";
          open.disabled = false;
        }
      } finally {
        if (valid()) loading = false;
      }
    };
  }
  const visibility = () => {
    if (!document.hidden) {
      clearTimeout(timer);
      refresh();
    }
  };
  const cleanup = (event) => {
    if (disposed) return;
    disposed = true;
    generation++;
    clearTimeout(timer);
    controller.abort();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", cleanup);
    disposeViewer();
    if (event?.persisted) {
      window.addEventListener(
        "pageshow",
        () => {
          host.replaceChildren();
          mountRoomModel(host, propertyId, owner, request, options);
        },
        { once: true },
      );
    }
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", cleanup);
  refresh();
  return cleanup;
}
