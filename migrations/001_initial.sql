CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  phone VARCHAR(20) NOT NULL DEFAULT '',
  bio VARCHAR(1000) NOT NULL DEFAULT '',
  avatar_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE properties (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  deal VARCHAR(10) NOT NULL CHECK (deal IN ('sale','rent')),
  category VARCHAR(20) NOT NULL CHECK (category IN ('apartment','house','room','land','commercial')),
  city VARCHAR(80) NOT NULL,
  district VARCHAR(100) NOT NULL DEFAULT '',
  address VARCHAR(200) NOT NULL,
  price NUMERIC(14,2) NOT NULL CHECK (price > 0),
  area NUMERIC(10,2) NOT NULL CHECK (area > 0),
  rooms SMALLINT CHECK (rooms BETWEEN 0 AND 100),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 20 AND 10000),
  contact_name VARCHAR(80) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  seed_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (category IN ('land','commercial') OR rooms IS NOT NULL)
);
CREATE TABLE property_images (
  id SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  filename TEXT NOT NULL UNIQUE,
  position SMALLINT NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, property_id)
);
CREATE TABLE sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions(expire);
CREATE INDEX properties_owner_idx ON properties(owner_id, created_at DESC);
CREATE INDEX properties_public_date_idx ON properties(created_at DESC, id DESC) WHERE status='published';
CREATE INDEX properties_public_filters_idx ON properties(deal, category, price, id) WHERE status='published';
CREATE INDEX properties_public_area_idx ON properties(area) WHERE status='published';
CREATE INDEX properties_public_city_idx ON properties(lower(city), lower(district)) WHERE status='published';
CREATE INDEX images_property_idx ON property_images(property_id, position, id);
CREATE INDEX favorites_property_idx ON favorites(property_id);
