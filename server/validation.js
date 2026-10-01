import { z } from "zod";

const text = (min, max, label) =>
  z
    .string({ error: `Укажите ${label}` })
    .trim()
    .min(min, `${label}: минимум ${min} символов`)
    .max(max, `${label}: максимум ${max} символов`);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s()-]{7,25}$/, "Укажите корректный телефон")
  .transform((v) => v.replace(/[^\d+]/g, ""))
  .refine(
    (v) => /^\+?\d{7,15}$/.test(v),
    "В телефоне должно быть от 7 до 15 цифр",
  );
const positive = (max) =>
  z.coerce
    .number()
    .positive("Значение должно быть больше нуля")
    .max(max, "Слишком большое значение")
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.001,
      "Не более двух знаков после запятой",
    );
const optionalNumber = (schema) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    schema.optional(),
  );
export const commercialCategories = [
  "office",
  "retail",
  "warehouse",
  "industrial",
  "free_purpose",
  "commercial_land",
];
const companyFields = {
  company: text(0, 120, "Компания").default(""),
  businessRole: z
    .enum(["owner", "broker", "tenant"], { error: "Выберите роль на площадке" })
    .default("owner"),
};
export const registrationSchema = z.object({
  ...companyFields,
  name: text(2, 80, "Имя"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Укажите корректный email")
    .max(254),
  password: z
    .string()
    .min(10, "Пароль: минимум 10 символов")
    .refine(
      (v) => Buffer.byteLength(v, "utf8") <= 72,
      "Пароль: максимум 72 байта UTF-8",
    ),
});
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Укажите корректный email")
    .max(254),
  password: z.string().min(1, "Введите пароль").max(200),
});
export const profileSchema = z.object({
  ...companyFields,
  name: text(2, 80, "Имя"),
  phone: z.union([z.literal(""), phone]).default(""),
  bio: text(0, 1000, "Описание").default(""),
});
export const propertySchema = z
  .object({
    title: text(5, 120, "Заголовок"),
    deal: z.enum(["sale", "rent"], { error: "Выберите покупку или аренду" }),
    category: z.enum(commercialCategories, {
      error: "Выберите тип коммерческой недвижимости",
    }),
    city: text(2, 80, "Город"),
    district: text(0, 100, "Район").default(""),
    address: text(5, 200, "Адрес"),
    price: positive(999999999999),
    area: positive(99999999),
    rooms: z
      .never({ error: "Комнаты не используются для коммерческой недвижимости" })
      .optional(),
    buildingClass: z.enum(["", "A", "B", "C"]).default(""),
    floor: optionalNumber(z.coerce.number().int().min(-5).max(150)).transform(
      (v) => v ?? null,
    ),
    ceilingHeight: optionalNumber(positive(50)).transform((v) => v ?? null),
    powerKw: optionalNumber(positive(100000)).transform((v) => v ?? null),
    parking: z.boolean().default(false),
    tax: z
      .enum(["included", "excluded", "no_vat", "unspecified"])
      .default("unspecified"),
    description: text(20, 10000, "Описание"),
    contactName: text(2, 80, "Контактное имя"),
    contactPhone: phone,
    status: z.enum(["draft", "published", "archived"]).default("draft"),
  })
  .transform((v) =>
    v.category === "commercial_land"
      ? { ...v, buildingClass: "", floor: null, ceilingHeight: null }
      : v,
  );
export const statusSchema = z
  .object({ status: z.enum(["draft", "published", "archived"]) })
  .strict();
export const searchSchema = z
  .object({
    q: text(0, 100, "Поиск").default(""),
    deal: z.enum(["sale", "rent"]).optional(),
    category: z.enum(commercialCategories).optional(),
    minPrice: optionalNumber(z.coerce.number().min(0).max(999999999999)),
    maxPrice: optionalNumber(z.coerce.number().min(0).max(999999999999)),
    minArea: optionalNumber(z.coerce.number().min(0).max(99999999)),
    maxArea: optionalNumber(z.coerce.number().min(0).max(99999999)),
    rooms: z
      .never({ error: "Фильтр комнат больше не поддерживается" })
      .optional(),
    buildingClass: z.enum(["A", "B", "C"]).optional(),
    minCeilingHeight: optionalNumber(z.coerce.number().min(0).max(50)),
    minPowerKw: optionalNumber(z.coerce.number().min(0).max(100000)),
    parking: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    owner: optionalNumber(z.coerce.number().int().positive().max(2147483647)),
    sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(12),
  })
  .superRefine((v, ctx) => {
    for (const [a, b] of [
      ["minPrice", "maxPrice"],
      ["minArea", "maxArea"],
    ]) {
      if (v[a] !== undefined && v[b] !== undefined && v[a] > v[b])
        ctx.addIssue({
          code: "custom",
          path: [b],
          message: "Максимум должен быть не меньше минимума",
        });
    }
  });
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = Object.fromEntries(
    result.error.issues.map((i) => [i.path[0] ?? "form", i.message]),
  );
  throw Object.assign(new Error("Проверьте заполненные поля"), {
    status: 422,
    fields,
  });
}
export function id(value) {
  if (
    !/^\d+$/.test(String(value)) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    throw Object.assign(new Error("Объект не найден"), { status: 404 });
  return Number(value);
}
