CREATE TABLE property_models (
  property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  state TEXT NOT NULL CHECK (state IN ('queued','processing','ready','failed','needs_photos')),
  image_ids INTEGER[] NOT NULL DEFAULT '{}',
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  filename TEXT,
  camera JSONB,
  error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX property_models_queue_idx ON property_models(available_at) WHERE state IN ('queued','processing');
