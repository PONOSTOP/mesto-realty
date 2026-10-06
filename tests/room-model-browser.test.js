import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

// A synthetic PLY verifies browser rendering and CSP, not reconstruction quality.
function fixturePly() {
  const fields = [
    "x",
    "y",
    "z",
    "nx",
    "ny",
    "nz",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ];
  const count = 64;
  const header = Buffer.from(
    `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${fields.map((field) => `property float ${field}\n`).join("")}end_header\n`,
  );
  const data = Buffer.alloc(count * fields.length * 4);
  for (let i = 0; i < count; i++) {
    const values = [
      ((i % 8) - 3.5) * 0.18,
      (Math.floor(i / 8) - 3.5) * 0.18,
      0,
      0,
      0,
      0,
      1,
      0.2,
      -0.2,
      4,
      -2.5,
      -2.5,
      -2.5,
      1,
      0,
      0,
      0,
    ];
    values.forEach((value, j) =>
      data.writeFloatLE(value, (i * fields.length + j) * 4),
    );
  }
  return Buffer.concat([header, data]);
}

let server, browser, base;
const pageErrors = [];
const requests = [];
before(async () => {
  server = createServer(async (req, res) => {
    requests.push(req.url);
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'",
    );
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(
        '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main class="container page"><div id="host"></div></main><script type="module" src="/harness.js"></script></body></html>',
      );
    }
    if (req.url === "/editor") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(
        '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="main"></main><script type="module" src="/editor-harness.js"></script></body></html>',
      );
    }
    if (req.url === "/editor-harness.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(
        `import {state} from '/js/core.js'; import {editorPage} from '/js/forms.js'; state.user={id:9,name:'Автор',phone:'+79991112233'}; state.csrfToken='test'; await editorPage('12');`,
      );
    }
    if (req.url === "/harness.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(`import { mountRoomModel } from '/js/room-model.js';
        window.model = { state: 'ready', revision: 1, url: '/models/12/1/scene.ply', camera: {position:[0,0,3],target:[0,0,0],up:[0,1,0]} };
        window.cleanup = mountRoomModel(document.querySelector('#host'), '12', true, async () => ({ model: window.model }));`);
    }
    if (req.url === "/models/12/1/scene.ply") {
      res.setHeader("Content-Type", "application/octet-stream");
      return res.end(fixturePly());
    }
    if (
      /^\/(js\/(core|room-model|forms)\.js|styles\.css|assets\/vendor\/room-viewer\.js|assets\/manrope(-latin)?\.woff2)$/.test(
        req.url,
      )
    ) {
      try {
        res.setHeader(
          "Content-Type",
          req.url.endsWith(".js")
            ? "text/javascript"
            : req.url.endsWith(".css")
              ? "text/css"
              : "font/woff2",
        );
        return res.end(
          await readFile(new URL("../public" + req.url, import.meta.url)),
        );
      } catch {
        /* Fall through to 404. */
      }
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    args: ["--enable-unsafe-swiftshader"],
  });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test("local PLY viewer opens lazily, supports controls, mobile and disposal under CSP", async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Открыть 3D-просмотр" }).waitFor();
  assert.equal(requests.includes("/assets/vendor/room-viewer.js"), false);
  await page.getByRole("button", { name: "Открыть 3D-просмотр" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-room-message]")?.textContent ===
      "3D-просмотр готов",
    undefined,
    { timeout: 20000 },
  );
  assert.equal(await page.locator(".room-canvas canvas").count(), 1);
  await page.locator(".room-canvas").press("ArrowRight");
  await page.locator(".room-canvas").press("+");
  await page.getByRole("button", { name: "Сбросить ракурс" }).click();
  await page.getByRole("button", { name: "На весь экран" }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.evaluate(() => document.exitFullscreen());
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.evaluate(() => window.cleanup());
  await page.waitForFunction(
    () => document.querySelectorAll(".room-canvas canvas").length === 0,
  );
  assert.deepEqual(pageErrors, []);
  await page.close();
});

test("photo editor fetches threshold, hides land guidance and preserves batch success for retry", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const images = [{ id: "1", url: "/assets/placeholder.svg" }];
  const property = {
    id: "12",
    ownerId: 9,
    title: "Офис для проверки загрузки",
    category: "office",
    deal: "rent",
    price: 100000,
    area: 50,
    city: "Москва",
    address: "Тестовая улица, 12",
    description: "Просторное помещение для проверки последовательной загрузки.",
    contactName: "Автор",
    contactPhone: "+79991112233",
    status: "draft",
  };
  const batchSizes = [];
  let failOnce = true;
  let releaseSecondBatch;
  const secondBatchGate = new Promise((resolve) => {
    releaseSecondBatch = resolve;
  });
  await page.route("**/api/properties/12/model", (route) =>
    route.fulfill({
      json: { model: { state: "needs_photos", minPhotos: 27, imageCount: 1 } },
    }),
  );
  await page.route("**/api/properties/12", (route) =>
    route.fulfill({ json: { property, images } }),
  );
  await page.route("**/api/properties/12/images", async (route) => {
    const count = (
      route
        .request()
        .postDataBuffer()
        .toString()
        .match(/name="images"/g) || []
    ).length;
    batchSizes.push(count);
    if (batchSizes.length === 2 && failOnce) {
      await secondBatchGate;
      failOnce = false;
      return route.fulfill({
        status: 400,
        json: { error: "Ошибка второй партии" },
      });
    }
    for (let i = 0; i < count; i++)
      images.push({
        id: String(images.length + 1),
        url: "/assets/placeholder.svg",
      });
    await route.fulfill({ json: { images } });
  });
  await page.goto(base + "/editor");
  await page.locator("#room-photo-guidance").waitFor();
  assert.match(
    await page.locator("#room-photo-guidance").textContent(),
    /от 27 фото/,
  );
  assert.match(await page.locator(".upload label").textContent(), /200/);
  await page.getByLabel("Тип недвижимости").selectOption("commercial_land");
  assert.equal(await page.locator("#room-photo-guidance").isHidden(), true);
  await page.getByLabel("Тип недвижимости").selectOption("office");
  await page.locator("#photos").setInputFiles(
    Array.from({ length: 25 }, (_, i) => ({
      name: `photo-${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from("fixture"),
    })),
  );
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-remove-image]").length === 11,
  );
  try {
    assert.equal(await page.locator("[data-remove-image]:enabled").count(), 0);
    assert.equal(
      await page.locator("[data-remove-pending]:enabled").count(),
      0,
    );
    // A synthetic event also must not mutate pending while the batch is in flight.
    await page.locator("[data-remove-pending]").first().dispatchEvent("click");
    assert.equal(await page.locator("[data-remove-pending]").count(), 15);
  } finally {
    releaseSecondBatch();
  }
  await page.waitForFunction(() =>
    document
      .querySelector("#editor > .form-error")
      .textContent.includes("Ошибка второй партии"),
  );
  assert.deepEqual(batchSizes, [10, 10]);
  assert.equal(await page.locator("[data-remove-image]").count(), 11);
  assert.equal(await page.locator("[data-remove-pending]").count(), 15);
  assert.equal(await page.locator("[data-remove-image]:enabled").count(), 11);
  assert.equal(await page.locator("[data-remove-pending]:enabled").count(), 15);
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await page.waitForURL("**/account");
  assert.deepEqual(batchSizes, [10, 10, 10, 5]);
  await page.close();
});

test("unsupported WebGL produces useful feedback and retries remain available", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === "webgl2" ? null : original.call(this, type, ...args);
    };
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Открыть 3D-просмотр" }).click();
  assert.match(
    await page.locator("[data-room-message]").textContent(),
    /WebGL2/,
  );
  assert.equal(
    await page.getByRole("button", { name: "Открыть 3D-просмотр" }).isEnabled(),
    true,
  );
  await page.close();
});
