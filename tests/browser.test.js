import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Set TEST_DATABASE_URL to a separate _test database");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_ORIGIN = "http://localhost:3101";
process.env.UPLOAD_DIR = await mkdtemp(
  path.join(os.tmpdir(), "mesto-browser-"),
);
const { createApp } = await import("../server/app.js");
const { migrate } = await import("../server/migrate.js");
const { pool } = await import("../server/db.js");
await migrate();
const instance = createApp();
const server = instance.app.listen(3101);
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(10000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const email = `e2e-${Date.now()}@example.com`;
const password = "Browser-scenario-123!";
const base = process.env.APP_ORIGIN;
await mkdir("output/playwright", { recursive: true });
after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await pool.query("DELETE FROM users WHERE email=$1", [email]);
  instance.close();
  await pool.end();
  const cleanupDir = path.resolve(process.env.UPLOAD_DIR);
  if (
    path.dirname(cleanupDir) !== path.resolve(os.tmpdir()) ||
    !path.basename(cleanupDir).startsWith("mesto-browser-")
  )
    throw new Error("Unsafe cleanup");
  await rm(cleanupDir, { recursive: true, force: true });
});
async function fillProperty(title = "Квартира для проверки браузера") {
  await page.getByLabel("Заголовок объявления").fill(title);
  await page.getByLabel("Цена, ₽", { exact: true }).fill("13500000");
  await page.getByLabel("Площадь, м²", { exact: true }).fill("63.5");
  await page.getByLabel("Количество комнат").fill("2");
  await page.getByLabel("Город", { exact: true }).fill("Москва");
  await page.getByLabel("Район", { exact: true }).fill("Браузерный район");
  await page.getByLabel("Адрес", { exact: true }).fill("Тестовая улица, 24");
  await page
    .getByLabel("Описание", { exact: true })
    .fill(
      "Светлая квартира для сквозной проверки. <img src=x onerror=alert(1)>",
    );
  await page.getByLabel("Телефон", { exact: true }).fill("+79991112233");
}
test("browser: account, listing lifecycle, responsiveness and recovery", async (t) => {
  let propertyUrl;
  await t.test("registration then logout and login", async () => {
    await page.goto(base + "/register");
    await page.getByLabel("Ваше имя").fill("Браузерный владелец");
    await page.getByLabel("Электронная почта").fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByLabel("Повторите пароль").fill(password);
    await page
      .getByRole("button", { name: "Создать аккаунт", exact: true })
      .click();
    await page.waitForURL("**/account");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL(base + "/");
    await page.getByRole("link", { name: "Войти", exact: true }).click();
    await page.getByLabel("Электронная почта").fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL("**/account");
  });
  await t.test(
    "two photos, publish, gallery, phone and safe text",
    async () => {
      await page
        .getByRole("link", { name: "+ Новое объявление", exact: true })
        .click();
      await fillProperty();
      await page
        .getByLabel("Добавьте до 10 фотографий")
        .setInputFiles([
          "public/assets/property-1.webp",
          "public/assets/property-2.webp",
        ]);
      assert.equal(await page.locator(".photo-preview").count(), 2);
      await page
        .getByRole("button", { name: "Опубликовать", exact: true })
        .click();
      await page.waitForURL("**/property/*");
      propertyUrl = page.url();
      await page.locator(".gallery-main").waitFor();
      assert.equal(await page.locator(".description img").count(), 0);
      assert.match(
        await page.locator(".description").innerText(),
        /<img src=x/,
      );
      const before = await page.locator(".gallery-main").getAttribute("src");
      await page.getByRole("button", { name: "Фото 2", exact: true }).click();
      assert.notEqual(
        await page.locator(".gallery-main").getAttribute("src"),
        before,
      );
      await page
        .getByRole("button", { name: "Показать телефон", exact: true })
        .click();
      await page.locator('a[href="tel:+79991112233"]').waitFor();
    },
  );
  await t.test("URL search and persisted favorites", async () => {
    await page.goto(
      base + "/catalog?q=" + encodeURIComponent("Браузерный район"),
    );
    await page.locator("#result-count").filter({ hasText: "1" }).waitFor();
    assert.equal(await page.locator('select[name="rooms"]').inputValue(), "");
    await page
      .getByRole("button", { name: "Добавить в избранное", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Убрать из избранного", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("button", { name: "Убрать из избранного", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Город, район или адрес").inputValue(),
      "Браузерный район",
    );
    await page.goto(base + "/account?tab=favorites");
    await page
      .locator(".card-title")
      .filter({ hasText: "Квартира для проверки браузера" })
      .waitFor();
    assert.equal(await page.locator(".property-card").count(), 1);
  });
  await t.test("edit price and photos, archive and republish", async () => {
    await page.goto(propertyUrl);
    await page
      .getByRole("link", { name: "Редактировать", exact: true })
      .click();
    await page.getByLabel("Заголовок объявления").fill("Обновлённая квартира");
    await page.getByLabel("Цена, ₽", { exact: true }).fill("12900000");
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Удалить фото", exact: true })
      .last()
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-remove-image]").length === 1,
    );
    await page
      .getByRole("button", { name: "Сохранить и опубликовать", exact: true })
      .click();
    await page.waitForURL(propertyUrl);
    await page
      .getByRole("heading", { name: "Обновлённая квартира", exact: true })
      .waitFor();
    assert.match(
      await page.locator(".detail-price").innerText(),
      /12\s900\s000/,
    );
    await page.goto(base + "/account");
    await page.getByRole("button", { name: "В архив", exact: true }).click();
    await page.locator(".status").filter({ hasText: "В архиве" }).waitFor();
    await page.locator(".manage a").filter({ hasText: "Изменить" }).click();
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await page.waitForURL(propertyUrl);
  });
  await t.test("profile and avatar persist", async () => {
    await page.goto(base + "/account?tab=profile");
    await page.getByLabel("Имя", { exact: true }).fill("Анна Браузерная");
    await page.getByLabel("Телефон", { exact: true }).fill("+79998887766");
    await page
      .getByLabel("О себе", { exact: true })
      .fill("Описание профиля из браузера.");
    await page
      .getByRole("button", { name: "Сохранить изменения", exact: true })
      .click();
    await page
      .locator("#toast")
      .filter({ hasText: "Изменения сохранены" })
      .waitFor();
    await page
      .getByLabel("Фото профиля", { exact: true })
      .setInputFiles("public/assets/property-3.webp");
    await page
      .getByRole("button", { name: "Загрузить фото", exact: true })
      .click();
    await page.locator("#avatar-form img").waitFor();
    await page.reload();
    await page.getByLabel("Имя", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("Имя", { exact: true }).inputValue(),
      "Анна Браузерная",
    );
  });
  await t.test(
    "mobile, tablet and desktop layouts do not overflow",
    async () => {
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of [
          "/",
          "/catalog",
          new URL(propertyUrl).pathname,
          "/account?tab=profile",
          "/publish",
        ]) {
          await page.goto(base + route);
          await page.locator("#header a").first().waitFor();
          await page.waitForFunction(
            () => !document.querySelector("#main .loading"),
          );
          const excess = await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          );
          assert.ok(
            excess <= 1,
            `${route} overflows ${excess}px at ${width}px`,
          );
        }
        await page.screenshot({
          path: `output/playwright/editor-${width}.png`,
          fullPage: true,
        });
      }
    },
  );
  await t.test(
    "uncertain committed create prevents duplicate retry",
    async () => {
      await page.goto(base + "/publish");
      await fillProperty("Черновик с потерянным ответом");
      await page.route("**/api/properties", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fetch(); // Server commits; browser deliberately loses the response.
        await route.abort("failed");
      });
      await page
        .getByRole("button", { name: "Сохранить черновик", exact: true })
        .click();
      await page
        .locator("#editor > .form-error")
        .filter({ hasText: "Возможно, черновик уже сохранён" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Сохранить черновик", exact: true })
          .isDisabled(),
        true,
      );
      await page.unroute("**/api/properties");
      await page.getByRole("link", { name: "В кабинет", exact: true }).click();
      await page
        .locator(".card-title")
        .filter({ hasText: "Черновик с потерянным ответом" })
        .waitFor();
      assert.equal(
        await page
          .locator(".card-title")
          .filter({ hasText: "Черновик с потерянным ответом" })
          .count(),
        1,
      );
    },
  );
  await t.test("failed logout can be retried", async () => {
    await page.route("**/api/auth/logout", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page
      .locator("#toast")
      .filter({ hasText: "Не удалось связаться" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Выйти", exact: true })
        .isEnabled(),
      true,
    );
    await page.unroute("**/api/auth/logout");
  });
  await t.test("delete own objects and favorites disappear", async () => {
    await page.goto(base + "/account");
    await page.locator(".manage").first().waitFor();
    while (await page.locator("[data-delete]").count()) {
      page.once("dialog", (d) => d.accept());
      const button = page.locator("[data-delete]").first();
      const id = await button.getAttribute("data-delete");
      await button.click();
      await page
        .locator(`[data-delete="${id}"]`)
        .waitFor({ state: "detached" });
      await page.waitForFunction(() => {
        const content = document.querySelector("#account-content");
        return content && !content.querySelector(".loading");
      });
    }
    await page
      .getByRole("heading", {
        name: "Здесь начнётся новая история",
        exact: true,
      })
      .waitFor();
    await page.goto(base + "/account?tab=favorites");
    await page
      .getByRole("heading", {
        name: "Сохраните места, которые понравились",
        exact: true,
      })
      .waitFor();
    assert.deepEqual(pageErrors, []);
  });
});
