import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propertySchema, registrationSchema, searchSchema, profileSchema } from '../server/validation.js';

const valid = { title: 'Светлая квартира', deal: 'sale', category: 'apartment', city: 'Москва', district: 'Хамовники', address: 'Улица Льва Толстого, 10', price: 12500000, area: 55.5, rooms: 2, description: 'Просторная квартира с большими окнами и отдельной кухней.', contactName: 'Анна', contactPhone: '+7 (999) 123-45-67', status: 'draft' };

test('property accepts numeric values and normalizes phone', () => {
  const result = propertySchema.parse(valid);
  assert.equal(result.area, 55.5);
  assert.equal(result.contactPhone, '+79991234567');
});
test('land does not need rooms; apartment does', () => {
  assert.equal(propertySchema.safeParse({ ...valid, category: 'land', rooms: null }).success, true);
  assert.equal(propertySchema.safeParse({ ...valid, rooms: null }).success, false);
});
test('reject invalid numbers and injected enum values', () => {
  for (const value of [-1, 0, NaN, Infinity, 'abc', '', null]) {
    assert.equal(propertySchema.safeParse({ ...valid, price: value }).success, false);
  }
  assert.equal(propertySchema.safeParse({ ...valid, status: 'admin' }).success, false);
});
test('registration enforces password byte limit and normalized email', () => {
  assert.equal(registrationSchema.parse({ name: 'Анна', email: 'ANNA@Example.com ', password: 'A-secure-pass-123' }).email, 'anna@example.com');
  assert.equal(registrationSchema.safeParse({ name: 'Анна', email: 'a@b.ru', password: 'я'.repeat(40) }).success, false);
  assert.equal(registrationSchema.safeParse({ name: 'А', email: 'bad', password: '123' }).success, false);
});
test('search limits pagination and validates ranges', () => {
  assert.equal(searchSchema.parse({}).page, 1);
  assert.equal(searchSchema.safeParse({ limit: 999 }).success, false);
  assert.equal(searchSchema.safeParse({ minPrice: 100, maxPrice: 10 }).success, false);
  assert.equal(searchSchema.safeParse({ sort: 'price;DROP TABLE users' }).success, false);
});
test('profile allowlist strips protected keys', () => {
  const result = profileSchema.parse({ name: 'Анна', phone: '', bio: '', id: 20, email: 'attacker@x.com', passwordHash: 'anything' });
  assert.deepEqual(Object.keys(result).sort(), ['bio', 'name', 'phone']);
});
