import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const scene = {
  version: 1,
  width: 12,
  depth: 8,
  height: 3,
  floors: [
    {
      points: [
        [0, 0],
        [12, 0],
        [12, 8],
        [0, 8],
      ],
      tone: "warm",
    },
  ],
  walls: [
    { id: "s", start: [0, 0], end: [12, 0], thickness: 0.2, exterior: true },
    { id: "n", start: [0, 8], end: [12, 8], thickness: 0.2, exterior: true },
    { id: "e", start: [12, 0], end: [12, 8], thickness: 0.2, exterior: true },
    { id: "w", start: [0, 0], end: [0, 8], thickness: 0.2, exterior: true },
  ],
  openings: [
    {
      wallId: "s",
      kind: "window",
      offset: 2,
      width: 3,
      bottom: 0.9,
      height: 1.5,
    },
  ],
  columns: [{ position: [3, 4], width: 0.4, depth: 0.4, height: 3 }],
  furniture: [
    {
      kind: "sofa",
      position: [3, 2],
      width: 2,
      depth: 0.8,
      height: 0.8,
      rotation: 0,
    },
  ],
  warnings: ["Размеры мебели приблизительные"],
};
let server, browser, base;
const requests = [];
const writes = [];
let failPlan = false;
const property = {
  id: 12,
  ownerId: 9,
  title: "Офис для проверки планировки",
  deal: "sale",
  category: "office",
  price: 100000,
  area: 96,
  city: "Москва",
  district: "Центр",
  address: "Улица Проверочная, дом 12",
  description: "Просторное помещение с окнами и отдельным входом.",
  contactName: "Автор",
  contactPhone: "+79991112233",
  status: "draft",
  ceilingHeight: 3,
};
before(async () => {
  server = createServer(async (req, res) => {
    requests.push(req.url);
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'",
    );
    const json = (value) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (req.url === "/" || req.url === "/inputs" || req.url === "/editor") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(
        `<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="main" class="container page"><div id="host"></div><form id="form"><select name="category"><option value="office">Офис</option><option value="commercial_land">Участок</option></select><input name="ceilingHeight" value="3"></form></main><script type="module" src="${req.url === "/inputs" ? "/inputs-harness.js" : req.url === "/editor" ? "/editor-harness.js" : "/harness.js"}"></script></body></html>`,
      );
    }
    if (req.url === "/harness.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(
        `import {mountRoomModel} from '/js/room-model.js'; import {api} from '/js/core.js'; window.cleanup=mountRoomModel(document.querySelector('#host'),'12',true,api,{pollMs:50});`,
      );
    }
    if (req.url === "/inputs-harness.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(
        `import {mountArchitecturalInputs} from '/js/architectural-inputs.js';import {state} from '/js/core.js';state.csrfToken='test';window.inputs=mountArchitecturalInputs(document.querySelector('#form'),'12');window.save=()=>window.inputs.save('12').then(()=>({ok:true}),error=>({error:error.message}));`,
      );
    }
    if (req.url === "/editor-harness.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(
        `import {state} from '/js/core.js';import {editorPage} from '/js/forms.js';state.user={id:9,name:'Автор',phone:'+79991112233'};state.csrfToken='test';await editorPage('12');`,
      );
    }
    if (req.url === "/api/properties/12" && req.method === "GET")
      return json({ property, images: [] });
    if (req.url === "/api/properties/12" && req.method === "PATCH") {
      let body = "";
      for await (const chunk of req) body += chunk;
      writes.push({ path: req.url, method: req.method, body });
      return json({ property });
    }
    if (req.url === "/api/properties/12/images" && req.method === "POST") {
      for await (const _chunk of req) {
      }
      writes.push({ path: req.url, method: req.method });
      return json({ images: [{ id: 1, url: "/assets/placeholder.svg" }] });
    }
    if (req.url === "/api/properties/12/architecture" && req.method === "GET")
      return json({
        model: {
          state: "ready",
          revision: 1,
          url: "/architectural-models/12/1/scene.json",
          warnings: scene.warnings,
        },
        inputs: {
          hasPlan: false,
          planUrl: null,
          width: 12,
          depth: 8,
          height: 3,
        },
      });
    if (req.url === "/architectural-models/12/1/scene.json") return json(scene);
    if (
      req.url.startsWith("/api/properties/12/architecture/") &&
      req.method !== "GET"
    ) {
      let body = "";
      for await (const chunk of req) body += chunk;
      writes.push({
        path: req.url,
        method: req.method,
        body,
        csrf: req.headers["x-csrf-token"],
      });
      if (req.url.endsWith("/plan") && failPlan) {
        res.statusCode = 503;
        return json({ error: "План не сохранён" });
      }
      return json({ ok: true });
    }
    if (
      /^\/(js\/[a-z-]+\.js|styles\.css|assets\/vendor\/architectural-viewer\.js|assets\/manrope(-latin)?\.woff2)$/.test(
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
      } catch {}
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test("architecture loads only on action and supports top, interior, mobile navigation and disposal under strict CSP", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.text().includes("violates")) errors.push(message.text());
  });
  await page.goto(base);
  await page.locator("[data-architecture-open]").waitFor();
  assert.equal(
    requests.includes("/assets/vendor/architectural-viewer.js"),
    false,
  );
  await page.locator("[data-architecture-open]").click();
  await page.locator(".architectural-canvas canvas").waitFor();
  assert.equal(
    await page.locator(".architectural-canvas").getAttribute("data-mode"),
    "top",
  );
  await page.locator('[data-architecture-mode="inside"]').click();
  assert.equal(
    await page.locator(".architectural-canvas").getAttribute("data-mode"),
    "inside",
  );
  await page.locator('[data-walk="forward"]').click();
  await page.locator(".architectural-canvas").press("ArrowUp");
  await mkdir(
    new URL("../.local/architectural/screenshots/", import.meta.url),
    {
      recursive: true,
    },
  );
  await page.screenshot({
    path: new URL(
      "../.local/architectural/screenshots/mobile-inside.png",
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    fullPage: true,
  });
  await page.locator("[data-architecture-reset]").click();
  await page.locator('[data-architecture-mode="top"]').click();
  assert.equal(
    await page.locator(".architectural-canvas").getAttribute("data-mode"),
    "top",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mkdir(
    new URL("../.local/architectural/screenshots/", import.meta.url),
    { recursive: true },
  );
  await page.screenshot({
    path: new URL(
      "../.local/architectural/screenshots/mobile-top.png",
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    fullPage: true,
  });
  await page.locator("[data-architecture-fullscreen]").click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.locator("[data-architecture-fullscreen]").click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(() => window.cleanup());
  assert.equal(await page.locator("canvas").count(), 0);
  assert.deepEqual(errors, []);
  assert.equal(
    requests.some(
      (url) => url.includes("scene.ply") || url.includes("room-viewer.js"),
    ),
    false,
  );
  await page.close();
});

test("owner dimensions survive a plan failure and retry avoids duplicate successful writes", async () => {
  writes.length = 0;
  failPlan = true;
  const page = await browser.newPage();
  await page.goto(base + "/inputs");
  await page.locator('[name="architectureWidth"]').waitFor();
  await page.locator('[name="architectureWidth"]').fill("13");
  await page.locator('[name="architecturePlan"]').setInputFiles({
    name: "plan.png",
    mimeType: "image/png",
    buffer: Buffer.from("plan-fixture"),
  });
  const failed = await page.evaluate(() => window.save());
  assert.ok(failed.error);
  assert.equal(writes.filter((w) => w.path.endsWith("/input")).length, 1);
  failPlan = false;
  assert.deepEqual(await page.evaluate(() => window.save()), { ok: true });
  assert.equal(writes.filter((w) => w.path.endsWith("/input")).length, 1);
  assert.equal(writes.filter((w) => w.path.endsWith("/plan")).length, 2);
  assert.equal(
    writes.every((w) => w.csrf === "test"),
    true,
  );
  await page.locator('[name="category"]').selectOption("commercial_land");
  assert.equal(await page.locator(".architectural-inputs").isVisible(), false);
  await page.evaluate(() => window.inputs.dispose());
  await page.close();
});

test("malformed scenes never create a renderer and safe retry remains available", async () => {
  const page = await browser.newPage();
  await page.route("**/architectural-models/12/1/scene.json", (route) =>
    route.fulfill({
      json: { ...scene, width: Infinity, furniture: [{ kind: "script" }] },
    }),
  );
  await page.goto(base);
  await page.locator("[data-architecture-open]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-architecture-message]")
      ?.textContent.includes("Не удалось"),
  );
  assert.equal(await page.locator("canvas").count(), 0);
  assert.equal(
    await page.locator("[data-architecture-open]").isEnabled(),
    true,
  );
  await page.close();
});

test("editor uploads photos before architecture writes and excludes model inputs from the property payload", async () => {
  writes.length = 0;
  failPlan = true;
  const page = await browser.newPage();
  await page.goto(base + "/editor");
  await page.locator('[name="architectureWidth"]').waitFor();
  await page.locator('[name="architectureWidth"]').fill("13");
  await page.locator("#photos").setInputFiles({
    name: "room.png",
    mimeType: "image/png",
    buffer: Buffer.from("photo-fixture"),
  });
  await page.locator('[name="architecturePlan"]').setInputFiles({
    name: "plan.png",
    mimeType: "image/png",
    buffer: Buffer.from("plan-fixture"),
  });
  await page.locator('[name="intent"][value="published"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector("#editor").getAttribute("aria-busy") !== "true",
  );
  assert.deepEqual(
    writes.map((w) => w.path),
    [
      "/api/properties/12",
      "/api/properties/12/images",
      "/api/properties/12/architecture/input",
      "/api/properties/12/architecture/plan",
    ],
  );
  assert.equal(
    Object.keys(JSON.parse(writes[0].body)).some((key) =>
      key.startsWith("architecture"),
    ),
    false,
  );
  assert.equal(JSON.parse(writes[0].body).status, "draft");
  assert.equal(await page.locator("#photo-previews .photo-preview").count(), 1);
  await page.close();
});

test("saving an unchanged failed model explicitly requests a new generation", async () => {
  writes.length = 0;
  failPlan = false;
  const page = await browser.newPage();
  await page.route("**/api/properties/12/architecture", (route) =>
    route.fulfill({
      json: {
        model: { state: "failed", revision: 2 },
        inputs: {
          hasPlan: true,
          planUrl: "/property-plans/12/abc.webp",
          width: 12,
          depth: 8,
          height: 3,
        },
      },
    }),
  );
  await page.goto(base + "/inputs");
  await page.locator('[name="architectureWidth"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.save()), { ok: true });
  assert.equal(
    writes.filter((write) => write.path.endsWith("/input")).length,
    1,
  );
  assert.deepEqual(await page.evaluate(() => window.save()), { ok: true });
  assert.equal(
    writes.filter((write) => write.path.endsWith("/input")).length,
    1,
  );
  await page.close();
});
