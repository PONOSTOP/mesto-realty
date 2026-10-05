import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool, transaction } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { prepareImage, removeFiles } from "../server/uploads.js";
import { config } from "../server/config.js";
import { restoreDemoPhoto } from "./seed-media.js";

const objects = [
  {
    category: "office",
    deal: "rent",
    city: "Москва",
    district: "Пресненский",
    address: "Пресненская набережная, 12",
    title: "Офисный этаж в деловом центре",
    price: 650000,
    area: 280,
    buildingClass: "A",
    floor: 9,
    ceilingHeight: 3.6,
    powerKw: 80,
    parking: true,
    tax: "excluded",
    photo: 1,
    description:
      "Открытая планировка для команды, отдельные переговорные и серверная. Контроль доступа и центральная вентиляция. Условия отделки и срок аренды обсуждаются с представителем.",
  },
  {
    category: "retail",
    deal: "rent",
    city: "Санкт-Петербург",
    district: "Центральный",
    address: "Лиговский проспект, 56",
    title: "Торговое помещение с витринами",
    price: 240000,
    area: 120,
    floor: 1,
    ceilingHeight: 4.2,
    powerKw: 35,
    parking: false,
    tax: "included",
    photo: 2,
    description:
      "Первый этаж, отдельный вход и витринное остекление. Подходит для магазина или шоурума. Предусмотрены зона разгрузки и место для вывески; согласование назначения — с собственником.",
  },
  {
    category: "warehouse",
    deal: "rent",
    city: "Москва",
    district: "Южный",
    address: "Промышленная улица, 8",
    title: "Складской блок с погрузочными доками",
    price: 1350000,
    area: 1500,
    buildingClass: "A",
    floor: 1,
    ceilingHeight: 12,
    powerKw: 150,
    parking: true,
    tax: "excluded",
    photo: 3,
    description:
      "Отапливаемое складское помещение с зоной разгрузки и подъездом для грузового транспорта. Подходит для хранения и распределения товаров. Режим работы и нагрузку на пол уточняйте при осмотре.",
  },
  {
    category: "industrial",
    deal: "sale",
    city: "Казань",
    district: "Авиастроительный",
    address: "Техническая улица, 17",
    title: "Производственный корпус с мощностью 400 кВт",
    price: 99000000,
    area: 2200,
    floor: 1,
    ceilingHeight: 8,
    powerKw: 400,
    parking: true,
    tax: "included",
    photo: 4,
    description:
      "Производственное помещение с отдельной зоной приёмки сырья и складирования. Подъезд к воротам с территории комплекса. Возможность размещения оборудования обсуждается после технического осмотра.",
  },
  {
    category: "free_purpose",
    deal: "rent",
    city: "Сочи",
    district: "Центральный",
    address: "Улица Конституции, 18",
    title: "Пространство под клиентский офис",
    price: 270000,
    area: 180,
    buildingClass: "B",
    floor: 2,
    ceilingHeight: 3.8,
    powerKw: 45,
    parking: true,
    tax: "no_vat",
    photo: 5,
    description:
      "Помещение свободного назначения для услуг, клиентского офиса или учебного центра. Открытое пространство, возможность разделения на функциональные зоны. Разрешённое использование необходимо согласовать.",
  },
  {
    category: "office",
    deal: "sale",
    city: "Москва",
    district: "Басманный",
    address: "Нижняя Сыромятническая улица, 10",
    title: "Офисный блок в бизнес-квартале",
    price: 48000000,
    area: 240,
    buildingClass: "B",
    floor: 4,
    ceilingHeight: 3.4,
    powerKw: 60,
    parking: true,
    tax: "included",
    photo: 5,
    description:
      "Готовый офис для размещения компании. Несколько рабочих зон, переговорная и место для приёма посетителей. Вход через общую зону бизнес-центра, доступ к парковочным местам по отдельному соглашению.",
  },
  {
    category: "warehouse",
    deal: "sale",
    city: "Санкт-Петербург",
    district: "Невский",
    address: "Улица Седова, 37",
    title: "Складской комплекс для городской логистики",
    price: 135000000,
    area: 3000,
    buildingClass: "B",
    floor: 1,
    ceilingHeight: 9,
    powerKw: 200,
    parking: true,
    tax: "excluded",
    photo: 3,
    description:
      "Комплекс для хранения и комплектации заказов с отдельной административной зоной. Удобная организация движения грузового транспорта. Техническая документация предоставляется представителем при предметном обсуждении.",
  },
  {
    category: "retail",
    deal: "sale",
    city: "Казань",
    district: "Вахитовский",
    address: "Петербургская улица, 55",
    title: "Помещение для магазина в деловом квартале",
    price: 26500000,
    area: 145,
    floor: 1,
    ceilingHeight: 3.8,
    powerKw: 40,
    parking: false,
    tax: "no_vat",
    photo: 2,
    description:
      "Помещение на первом этаже с возможностью организации торгового зала и подсобной зоны. Отдельный вход для посетителей. Подходит для торговли непродовольственными товарами и шоурума.",
  },
  {
    category: "commercial_land",
    deal: "sale",
    city: "Казань",
    district: "Лаишевский",
    address: "Промышленная зона, участок 24",
    title: "Земля под агрологистический комплекс",
    price: 75000000,
    area: 15000,
    powerKw: 750,
    parking: false,
    tax: "unspecified",
    photo: 6,
    description:
      "Коммерческий земельный участок для проекта в сфере агрологистики. Площадь 1,5 га (15 000 м²). Категорию земли, разрешённое использование и технические условия нужно проверить по документам до принятия решения.",
  },
  {
    category: "office",
    deal: "rent",
    city: "Санкт-Петербург",
    district: "Петроградский",
    address: "Большая Разночинная улица, 25",
    title: "Офис для команды из 20 человек",
    price: 320000,
    area: 160,
    buildingClass: "B",
    floor: 5,
    ceilingHeight: 3.2,
    powerKw: 40,
    parking: true,
    tax: "included",
    photo: 1,
    description:
      "Офис с естественным освещением, зонами для совместной работы и встреч. Помещение готово к организации рабочих мест. Эксплуатационные расходы и состав услуг обсуждаются отдельно.",
  },
  {
    category: "industrial",
    deal: "rent",
    city: "Москва",
    district: "Печатники",
    address: "Улица Южнопортовая, 15",
    title: "Цех для сборки и лёгкого производства",
    price: 880000,
    area: 1100,
    floor: 1,
    ceilingHeight: 7,
    powerKw: 250,
    parking: true,
    tax: "excluded",
    photo: 4,
    description:
      "Помещение для сборочных операций или лёгкого производства. Выделенная электрическая мощность, зона хранения материалов и подъезд к воротам. Допустимые виды деятельности уточняются по техническим условиям комплекса.",
  },
  {
    category: "free_purpose",
    deal: "sale",
    city: "Москва",
    district: "Даниловский",
    address: "Автозаводская улица, 23",
    title: "Гибкое пространство для сервисного бизнеса",
    price: 39000000,
    area: 195,
    buildingClass: "B",
    floor: 1,
    ceilingHeight: 4,
    powerKw: 55,
    parking: true,
    tax: "included",
    photo: 5,
    description:
      "Помещение свободного назначения с отдельным входом. Возможна организация офиса продаж, сервисного центра или студии профессиональных услуг. Перепланировку и инженерные подключения согласовывают отдельно.",
  },
  {
    category: "retail",
    deal: "rent",
    city: "Сочи",
    district: "Адлерский",
    address: "Улица Кирова, 46",
    title: "Шоурум с отдельной входной группой",
    price: 190000,
    area: 95,
    floor: 1,
    ceilingHeight: 3.5,
    powerKw: 25,
    parking: false,
    tax: "no_vat",
    photo: 2,
    description:
      "Торговое пространство для презентации товаров и работы с посетителями. Витрины обращены к пешеходному маршруту. Условия размещения вывески, график доступа и разгрузки уточняются на встрече.",
  },
  {
    category: "warehouse",
    deal: "rent",
    city: "Казань",
    district: "Советский",
    address: "Сибирский тракт, 34",
    title: "Склад для регионального распределения",
    price: 480000,
    area: 800,
    buildingClass: "B",
    floor: 1,
    ceilingHeight: 8,
    powerKw: 100,
    parking: true,
    tax: "excluded",
    photo: 3,
    description:
      "Складской блок с площадкой для маневрирования транспорта и зоной комплектации заказов. Возможна организация рабочего места для логиста. Срок въезда и условия эксплуатации обсуждаются индивидуально.",
  },
  {
    category: "office",
    deal: "rent",
    city: "Казань",
    district: "Вахитовский",
    address: "Улица Спартаковская, 2",
    title: "Представительский офис с переговорной",
    price: 195000,
    area: 130,
    buildingClass: "A",
    floor: 6,
    ceilingHeight: 3.5,
    powerKw: 35,
    parking: true,
    tax: "included",
    photo: 1,
    description:
      "Офис для представительства или проектной команды. Рабочая зона, переговорная и пространство для приёма клиентов. Условия меблировки и подключения услуг согласовываются с представителем бизнес-центра.",
  },
];
objects.push(
  {
    category: "office",
    deal: "rent",
    city: "Москва",
    district: "Соколиная Гора",
    address: "Большая Семёновская улица, 42",
    title: "Офис 86 м² с кабинетами и переговорной",
    price: 154800,
    area: 86,
    buildingClass: "B",
    floor: 3,
    ceilingHeight: 3.1,
    powerKw: 20,
    parking: true,
    tax: "no_vat",
    photo: 1,
    description:
      "Офис для команды из 8–10 человек: два кабинета, переговорная и кухня. Выполнена отделка, установлены кондиционеры, разведена локальная сеть. В здании есть лифт и контроль доступа. Аренда — 154 800 ₽ в месяц, эксплуатационные расходы включены; электричество и интернет отдельно. Депозит — один месяц, договор от 11 месяцев. Парковочное место — 8 000 ₽ в месяц. Просмотр по договорённости.",
  },
  {
    category: "retail",
    deal: "rent",
    city: "Санкт-Петербург",
    district: "Приморский",
    address: "Комендантский проспект, 38",
    title: "Магазин 74 м² с витринами и входом с улицы",
    price: 148000,
    area: 74,
    floor: 1,
    ceilingHeight: 3.4,
    powerKw: 25,
    parking: false,
    tax: "no_vat",
    photo: 2,
    description:
      "Первый этаж жилого дома: торговый зал 52 м², подсобная зона 16 м² и санузел 6 м². Отдельный вход с проспекта, два витринных окна, место для вывески по согласованию. Подойдёт для магазина, оптики или шоурума. Есть вода и мощность 25 кВт; вытяжки для кухни нет. Ставка — 148 000 ₽ в месяц, коммунальные платежи по счётчикам. Депозит — один месяц. На подготовку помещения — две недели арендных каникул.",
  },
  {
    category: "warehouse",
    deal: "rent",
    city: "Казань",
    district: "Московский",
    address: "Улица Восстания, 100",
    title: "Тёплый склад 420 м² с воротами на уровне земли",
    price: 252000,
    area: 420,
    buildingClass: "B",
    floor: 1,
    ceilingHeight: 6,
    powerKw: 60,
    parking: true,
    tax: "excluded",
    photo: 3,
    description:
      "Отапливаемый склад для непродовольственных товаров. Бетонный пол, рабочая высота 6 м, ворота 4 × 4,2 м. Кабинет кладовщика 18 м² входит в общую площадь. Есть площадка для разворота грузового транспорта и круглосуточный доступ через пост охраны. Ставка — 600 ₽/м² в месяц, всего 252 000 ₽ без учёта НДС. Отопление включено, электричество по счётчику. Депозит — один месяц. Стеллажи и погрузочная техника не входят.",
  },
  {
    category: "industrial",
    deal: "rent",
    city: "Санкт-Петербург",
    district: "Колпинский",
    address: "Финляндская улица, 24",
    title: "Цех 650 м² для сборочного производства, 160 кВт",
    price: 390000,
    area: 650,
    floor: 1,
    ceilingHeight: 6.5,
    powerKw: 160,
    parking: true,
    tax: "excluded",
    photo: 4,
    description:
      "Производственный блок: зал 570 м² и бытовые помещения 80 м² с раздевалкой, санузлами и кабинетом мастера. Мощность 160 кВт, подключение 380 В, двое ворот. Есть отопление и общеобменная вентиляция. Подойдёт для сборки оборудования или упаковочного производства; процессы с выбросами требуют согласования. Аренда — 390 000 ₽ в месяц без учёта НДС, коммунальные услуги отдельно. Депозит — один месяц, договор от 12 месяцев.",
  },
  {
    category: "free_purpose",
    deal: "sale",
    city: "Сочи",
    district: "Хостинский",
    address: "Улица Яна Фабрициуса, 12",
    title: "Помещение 112 м² под студию или клиентский офис",
    price: 24640000,
    area: 112,
    floor: 1,
    ceilingHeight: 3.3,
    powerKw: 30,
    parking: false,
    tax: "no_vat",
    photo: 5,
    description:
      "Нежилое помещение с отдельным входом. Основной зал 76 м², два кабинета общей площадью 24 м², подсобная зона с санузлом 12 м². Сделана базовая отделка, подведены вода и канализация, установлены кондиционеры. Подойдёт для дизайн-студии или офиса продаж. Цена — 24 640 000 ₽, мебель и оборудование не входят. Выделенной парковки нет. План и документы предоставляются для проверки; возможность перепланировки уточняется отдельно.",
  },
  {
    category: "commercial_land",
    deal: "sale",
    city: "Казань",
    district: "Советский",
    address: "Промышленная площадка у улицы Аграрной, участок 7",
    title: "Участок 0,6 га под склад и площадку разгрузки",
    price: 24000000,
    area: 6000,
    powerKw: 150,
    parking: false,
    tax: "unspecified",
    photo: 6,
    description:
      "Участок 6 000 м² для складского проекта. Прямоугольная форма, ровный рельеф, подъезд по асфальтированной дороге, капитальных строений нет. Цена — 24 000 000 ₽ за весь участок. Ориентир по мощности — 150 кВт; возможность, стоимость и сроки подключения определяются техническими условиями и в цену земли не входят. До сделки необходимо проверить разрешённое использование и ограничения застройки. Кадастровые сведения и схема границ предоставляются для проверки. Налоговые условия обсуждаются отдельно.",
  },
);
let created = 0;
let restored = 0;
try {
  await migrate();
  const password =
    process.env.DEMO_PASSWORD || randomBytes(32).toString("base64url");
  if (Buffer.byteLength(password) > 72 || password.length < 10)
    throw new Error("DEMO_PASSWORD должен содержать 10–72 байта");
  const hash = await bcrypt.hash(password, 12);
  const companies = [
    ["Анна Миронова", "anna.demo@example.com", "Деловой квартал", "owner"],
    ["Михаил Волков", "mikhail.demo@example.com", "Контур Коммерц", "broker"],
    ["Елена Соколова", "elena.demo@example.com", "Парк Логистика", "owner"],
  ];
  const owners = [];
  for (const [name, email, company, role] of companies) {
    const result = await pool.query(
      `INSERT INTO users(name,email,password_hash,bio,company,business_role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO UPDATE SET company=CASE WHEN users.company='' THEN EXCLUDED.company ELSE users.company END RETURNING id`,
      [
        name,
        email,
        hash,
        "Демонстрационный профиль представителя коммерческой недвижимости. Все предложения иллюстративные.",
        company,
        role,
      ],
    );
    owners.push(result.rows[0].id);
  }
  for (const [index, object] of objects.entries()) {
    const seedKey = `mesto-b2b-${index + 1}`;
    const existing = await pool.query(
      "SELECT id FROM properties WHERE seed_key=$1",
      [seedKey],
    );
    if (existing.rowCount) {
      const covers = await pool.query(
        "SELECT filename FROM property_images WHERE property_id=$1 AND position=0",
        [existing.rows[0].id],
      );
      for (const { filename } of covers.rows) {
        if (
          await restoreDemoPhoto({
            filename,
            source: new URL(
              `../public/assets/property-${object.photo}.webp`,
              import.meta.url,
            ),
            uploadDir: config.uploadDir,
          })
        )
          restored++;
      }
      continue;
    }
    const files = [];
    try {
      const buffer = await readFile(
        new URL(
          `../public/assets/property-${object.photo}.webp`,
          import.meta.url,
        ),
      );
      files.push(await prepareImage({ buffer, mimetype: "image/webp" }));
      await transaction(async (client) => {
        const description = `${object.description}\n\nДемонстрационное предложение. Объект, адрес, цена, характеристики и контакты приведены для знакомства с площадкой. Фотография иллюстративная.`;
        const result = await client.query(
          `INSERT INTO properties(owner_id,title,deal,category,city,district,address,price,area,description,contact_name,contact_phone,status,seed_key,created_at,building_class,floor,ceiling_height,power_kw,parking,tax)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'published',$13,now()-($14::int * interval '2 hours'),$15,$16,$17,$18,$19,$20) RETURNING id`,
          [
            owners[index % owners.length],
            object.title,
            object.deal,
            object.category,
            object.city,
            object.district,
            object.address,
            object.price,
            object.area,
            description,
            companies[index % companies.length][0],
            "+70000000000",
            seedKey,
            index,
            object.buildingClass || "",
            object.floor ?? null,
            object.ceilingHeight ?? null,
            object.powerKw ?? null,
            object.parking,
            object.tax,
          ],
        );
        for (const [position, filename] of files.entries())
          await client.query(
            "INSERT INTO property_images(property_id,filename,position) VALUES($1,$2,$3)",
            [result.rows[0].id, filename, position],
          );
      });
      created++;
    } catch (error) {
      await removeFiles(files);
      throw error;
    }
  }
  console.log(
    `Создано коммерческих объектов: ${created}. Повторный запуск не создаёт дубликаты.`,
  );
  console.log(`Восстановлено отсутствующих демофотографий: ${restored}.`);
  console.log(
    process.env.DEMO_PASSWORD
      ? "Пароль новых демопрофилей взят из DEMO_PASSWORD."
      : "Для проверки зарегистрируйте собственный аккаунт компании.",
  );
} finally {
  await pool.end();
}
