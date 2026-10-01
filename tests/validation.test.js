import { test } from "node:test";
import assert from "node:assert/strict";
import {
  propertySchema,
  registrationSchema,
  searchSchema,
  profileSchema,
} from "../server/validation.js";

const valid = {
  title: "Офис в деловом центре",
  deal: "sale",
  category: "office",
  city: "Москва",
  district: "Хамовники",
  address: "Улица Льва Толстого, 10",
  price: 12500000,
  area: 55.5,
  buildingClass: "A",
  floor: 5,
  ceilingHeight: 3.6,
  powerKw: 40,
  parking: true,
  tax: "included",
  description: "Офисный блок с переговорной и выделенной серверной.",
  contactName: "Анна",
  contactPhone: "+7 (999) 123-45-67",
  status: "draft",
};

test("property accepts numeric values and normalizes phone", () => {
  const result = propertySchema.parse(valid);
  assert.equal(result.area, 55.5);
  assert.equal(result.contactPhone, "+79991234567");
});
test("only six commercial categories are accepted and none needs rooms", () => {
  for (const category of [
    "office",
    "retail",
    "warehouse",
    "industrial",
    "free_purpose",
    "commercial_land",
  ])
    assert.equal(
      propertySchema.safeParse({ ...valid, category }).success,
      true,
      category,
    );
  for (const category of ["apartment", "house", "room", "land", "commercial"])
    assert.equal(
      propertySchema.safeParse({ ...valid, category }).success,
      false,
      category,
    );
  assert.equal("rooms" in propertySchema.parse(valid), false);
});
test("validates commercial specifications and search filters", () => {
  const result = propertySchema.parse(valid);
  assert.equal(result.buildingClass, "A");
  assert.equal(result.ceilingHeight, 3.6);
  assert.equal(result.parking, true);
  for (const patch of [
    { buildingClass: "luxury" },
    { floor: 999 },
    { ceilingHeight: -1 },
    { powerKw: 0 },
    { parking: "false" },
    { tax: "free" },
  ])
    assert.equal(
      propertySchema.safeParse({ ...valid, ...patch }).success,
      false,
    );
  assert.equal(
    searchSchema.parse({ parking: "false", minCeilingHeight: "6" }).parking,
    false,
  );
  assert.equal(searchSchema.safeParse({ rooms: 2 }).success, false);
});
test("reject invalid numbers and injected enum values", () => {
  for (const value of [-1, 0, NaN, Infinity, "abc", "", null]) {
    assert.equal(
      propertySchema.safeParse({ ...valid, price: value }).success,
      false,
    );
  }
  assert.equal(
    propertySchema.safeParse({ ...valid, status: "admin" }).success,
    false,
  );
});
test("registration enforces password byte limit and normalized email", () => {
  assert.equal(
    registrationSchema.parse({
      name: "Анна",
      email: "ANNA@Example.com ",
      password: "A-secure-pass-123",
    }).email,
    "anna@example.com",
  );
  assert.equal(
    registrationSchema.safeParse({
      name: "Анна",
      email: "a@b.ru",
      password: "я".repeat(40),
    }).success,
    false,
  );
  assert.equal(
    registrationSchema.safeParse({ name: "А", email: "bad", password: "123" })
      .success,
    false,
  );
});
test("search limits pagination and validates ranges", () => {
  assert.equal(searchSchema.parse({}).page, 1);
  assert.equal(searchSchema.safeParse({ limit: 999 }).success, false);
  assert.equal(
    searchSchema.safeParse({ minPrice: 100, maxPrice: 10 }).success,
    false,
  );
  assert.equal(
    searchSchema.safeParse({ sort: "price;DROP TABLE users" }).success,
    false,
  );
});
test("profile allowlist strips protected keys", () => {
  const result = profileSchema.parse({
    name: "Анна",
    phone: "",
    bio: "",
    id: 20,
    email: "attacker@x.com",
    passwordHash: "anything",
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "bio",
    "businessRole",
    "company",
    "name",
    "phone",
  ]);
});
