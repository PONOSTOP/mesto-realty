import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool, transaction } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { prepareImage, removeFiles } from "../server/uploads.js";

// Deterministic seed keys make repeat runs non-destructive and idempotent.
const objects = [
  [
    "apartment",
    "sale",
    "Москва",
    "Хамовники",
    "Усачёва улица, 11",
    "Светлая квартира у парка",
    24500000,
    68,
    2,
    1,
  ],
  [
    "apartment",
    "rent",
    "Москва",
    "Пресненский",
    "Шмитовский проезд, 16",
    "Пространство с видом на город",
    95000,
    54,
    2,
    2,
  ],
  [
    "house",
    "sale",
    "Сочи",
    "Хостинский",
    "Звёздная улица, 8",
    "Дом, в котором хочется остаться",
    32800000,
    185,
    4,
    4,
  ],
  [
    "apartment",
    "sale",
    "Санкт-Петербург",
    "Петроградский",
    "Большая Монетная улица, 12",
    "Тихая квартира на Петроградской",
    18200000,
    76,
    3,
    3,
  ],
  [
    "apartment",
    "rent",
    "Казань",
    "Вахитовский",
    "Улица Щапова, 9",
    "Уютная студия в центре Казани",
    42000,
    32,
    0,
    5,
  ],
  [
    "commercial",
    "rent",
    "Москва",
    "Басманный",
    "Нижняя Сыромятническая улица, 10",
    "Офис с большими окнами",
    180000,
    120,
    null,
    6,
  ],
  [
    "house",
    "rent",
    "Санкт-Петербург",
    "Курортный",
    "Лесная улица, 14",
    "Загородный дом среди сосен",
    150000,
    160,
    4,
    4,
  ],
  [
    "room",
    "rent",
    "Москва",
    "Сокол",
    "Улица Алабяна, 8",
    "Отдельная комната рядом с метро",
    28000,
    18,
    1,
    5,
  ],
  [
    "land",
    "sale",
    "Казань",
    "Советский",
    "Садовая улица, участок 24",
    "Участок для вашего будущего дома",
    4200000,
    1200,
    null,
    4,
  ],
  [
    "apartment",
    "sale",
    "Сочи",
    "Центральный",
    "Виноградная улица, 5",
    "Квартира в пяти минутах от моря",
    15700000,
    48,
    2,
    2,
  ],
  [
    "apartment",
    "sale",
    "Москва",
    "Даниловский",
    "Автозаводская улица, 23",
    "Современная квартира с террасой",
    29700000,
    89,
    3,
    1,
  ],
  [
    "commercial",
    "sale",
    "Казань",
    "Вахитовский",
    "Петербургская улица, 55",
    "Пространство для вашего бизнеса",
    21000000,
    145,
    null,
    6,
  ],
  [
    "room",
    "sale",
    "Санкт-Петербург",
    "Центральный",
    "Кирочная улица, 19",
    "Комната в историческом центре",
    3900000,
    21,
    1,
    3,
  ],
  [
    "apartment",
    "rent",
    "Москва",
    "Раменки",
    "Мичуринский проспект, 26",
    "Семейная квартира рядом с парком",
    120000,
    82,
    3,
    1,
  ],
  [
    "house",
    "sale",
    "Казань",
    "Приволжский",
    "Солнечная улица, 7",
    "Свой дом с зелёным садом",
    19800000,
    148,
    4,
    4,
  ],
];
let created = 0;
try {
  await migrate();
  const password =
    process.env.DEMO_PASSWORD || randomBytes(32).toString("base64url");
  if (Buffer.byteLength(password) > 72 || password.length < 10)
    throw new Error("DEMO_PASSWORD должен содержать 10–72 байта");
  const hash = await bcrypt.hash(password, 12);
  const owners = [];
  for (const [name, email] of [
    ["Анна Миронова", "anna.demo@example.com"],
    ["Михаил Волков", "mikhail.demo@example.com"],
    ["Елена Соколова", "elena.demo@example.com"],
  ]) {
    const result = await pool.query(
      `INSERT INTO users(name,email,password_hash,bio) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id`,
      [
        name,
        email,
        hash,
        "Демонстрационный профиль. Объекты и контактные данные приведены для знакомства с сервисом.",
      ],
    );
    owners.push(result.rows[0].id);
  }
  for (const [index, item] of objects.entries()) {
    const seedKey = `mesto-demo-${index + 1}`;
    if (
      (
        await pool.query("SELECT 1 FROM properties WHERE seed_key=$1", [
          seedKey,
        ])
      ).rowCount
    )
      continue;
    const [
      category,
      deal,
      city,
      district,
      address,
      title,
      price,
      area,
      rooms,
      photo,
    ] = item;
    const files = [];
    try {
      for (const photoId of [photo, photo === 1 ? 2 : 1]) {
        const buffer = await readFile(
          new URL(`../public/assets/property-${photoId}.webp`, import.meta.url),
        );
        files.push(await prepareImage({ buffer, mimetype: "image/webp" }));
      }
      await transaction(async (client) => {
        const ownerId = owners[index % owners.length];
        const contactName = [
          "Анна Миронова",
          "Михаил Волков",
          "Елена Соколова",
        ][index % owners.length];
        const description = `Демонстрационное объявление: ${title.toLowerCase()}.\n\n${category === "land" ? "Ровный участок в спокойном районе. Площадь указана в квадратных метрах. Удобный подъезд, магазины и остановка неподалёку. Фотографии иллюстративные." : "Продуманное пространство, естественный свет и спокойная атмосфера. Рядом магазины, прогулочные маршруты и удобный транспорт. Можно представить, как здесь начинается новый день."}\n\nОбъект, адрес, цена и телефон вымышлены для демонстрации работы сервиса. Фотографии носят иллюстративный характер.`;
        const result = await client.query(
          `INSERT INTO properties(owner_id,title,deal,category,city,district,address,price,area,rooms,description,contact_name,contact_phone,status,seed_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'published',$14,now()-($15::int * interval '2 hours')) RETURNING id`,
          [
            ownerId,
            title,
            deal,
            category,
            city,
            district,
            address,
            price,
            area,
            rooms,
            description,
            contactName,
            "+70000000000",
            seedKey,
            index,
          ],
        );
        for (const [position, filename] of files.entries())
          await client.query(
            "INSERT INTO property_images(property_id,filename,position) VALUES($1,$2,$3)",
            [result.rows[0].id, filename, position],
          );
      });
      created++;
    } catch (err) {
      await removeFiles(files);
      throw err;
    }
  }
  console.log(
    `Создано объектов: ${created}. Повторный запуск не дублирует объявления.`,
  );
  console.log(
    process.env.DEMO_PASSWORD
      ? "Пароль новых демопрофилей взят из DEMO_PASSWORD."
      : "Демопрофили созданы со случайным неизвестным паролем. Для проверки зарегистрируйте собственный аккаунт.",
  );
} finally {
  await pool.end();
}
