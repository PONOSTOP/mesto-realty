import { pool } from './db.js';

// Only explicit public columns; contact_phone is read separately for owners/contact reveal.
export const publicColumns = `p.id,p.owner_id,p.title,p.deal,p.category,p.city,p.district,p.address,p.price,p.area,p.rooms,p.description,p.contact_name,p.status,p.created_at,p.updated_at`;
export const imageColumns = `(SELECT filename FROM property_images WHERE property_id=p.id ORDER BY position,id LIMIT 1) AS cover,
  (SELECT count(*)::int FROM property_images WHERE property_id=p.id) AS image_count`;
export function propertyView(row) {
  const value = {
    id: row.id, ownerId: row.owner_id, title: row.title, deal: row.deal, category: row.category,
    city: row.city, district: row.district, address: row.address, price: row.price, area: row.area, rooms: row.rooms,
    description: row.description, contactName: row.contact_name, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at,
    cover: row.cover ? `/media/${row.cover}` : null, imageCount: row.image_count ?? 0, isFavorite: row.is_favorite ?? false,
  };
  if (row.contact_phone !== undefined) value.contactPhone = row.contact_phone;
  return value;
}
export const imageView = row => ({ id: row.id, url: `/media/${row.filename}`, position: row.position });

export async function listProperties(filters, userId, scope = 'public', executor = pool) {
  const values = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  const where = [];
  if (scope === 'own') where.push(`p.owner_id=${bind(userId)}`);
  else where.push("p.status='published'");
  if (scope === 'favorites') where.push(`EXISTS (SELECT 1 FROM favorites f WHERE f.property_id=p.id AND f.user_id=${bind(userId)})`);
  if (filters.q) {
    const pattern = bind(`%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(p.city ILIKE ${pattern} OR p.district ILIKE ${pattern} OR p.address ILIKE ${pattern} OR p.title ILIKE ${pattern})`);
  }
  for (const [key, column, op] of [['deal', 'deal', '='], ['category', 'category', '='], ['owner', 'owner_id', '='], ['rooms', 'rooms', '='], ['minPrice', 'price', '>='], ['maxPrice', 'price', '<='], ['minArea', 'area', '>='], ['maxArea', 'area', '<=']]) {
    if (filters[key] !== undefined) where.push(`p.${column} ${op} ${bind(filters[key])}`);
  }
  const clause = where.join(' AND ');
  const total = Number((await executor.query(`SELECT count(*) FROM properties p WHERE ${clause}`, values)).rows[0].count);
  const currentUser = bind(userId || null);
  const limit = bind(filters.limit), offset = bind((filters.page - 1) * filters.limit);
  const sort = { newest: 'p.created_at DESC,p.id DESC', price_asc: 'p.price ASC,p.id DESC', price_desc: 'p.price DESC,p.id DESC' }[filters.sort];
  const { rows } = await executor.query(`SELECT ${publicColumns},${imageColumns}, EXISTS(SELECT 1 FROM favorites f WHERE f.property_id=p.id AND f.user_id=${currentUser}) AS is_favorite FROM properties p WHERE ${clause} ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`, values);
  return { items: rows.map(propertyView), total, page: filters.page, pages: Math.ceil(total / filters.limit) };
}
