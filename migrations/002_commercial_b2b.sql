-- Commercial-only transition. Back up the existing database before applying.
-- Remove previous demo catalog and residential stock, cascading images/favorites.
DELETE FROM properties
WHERE category IN ('apartment','house','room','land')
   OR seed_key LIKE 'mesto-demo-%';

ALTER TABLE properties DROP CONSTRAINT properties_category_check;
ALTER TABLE properties DROP COLUMN rooms;
UPDATE properties SET category='free_purpose' WHERE category='commercial';
ALTER TABLE properties ADD CONSTRAINT properties_category_check
  CHECK (category IN ('office','retail','warehouse','industrial','free_purpose','commercial_land'));

ALTER TABLE properties
  ADD COLUMN building_class VARCHAR(1) NOT NULL DEFAULT '' CHECK (building_class IN ('','A','B','C')),
  ADD COLUMN floor SMALLINT CHECK (floor BETWEEN -5 AND 150),
  ADD COLUMN ceiling_height NUMERIC(4,2) CHECK (ceiling_height > 0 AND ceiling_height <= 50),
  ADD COLUMN power_kw NUMERIC(8,2) CHECK (power_kw > 0 AND power_kw <= 100000),
  ADD COLUMN parking BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN tax VARCHAR(15) NOT NULL DEFAULT 'unspecified' CHECK (tax IN ('included','excluded','no_vat','unspecified'));

ALTER TABLE users
  ADD COLUMN company VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN business_role VARCHAR(10) NOT NULL DEFAULT 'owner' CHECK (business_role IN ('owner','broker','tenant'));

CREATE INDEX properties_public_class_idx ON properties(building_class,category) WHERE status='published';
CREATE INDEX properties_public_technical_idx ON properties(ceiling_height,power_kw) WHERE status='published';
