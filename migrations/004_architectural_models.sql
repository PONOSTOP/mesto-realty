CREATE TABLE architectural_inputs (
 property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
 plan_filename TEXT,
 width DOUBLE PRECISION CHECK(width > 0 AND width <= 200),
 depth DOUBLE PRECISION CHECK(depth > 0 AND depth <= 200),
 height DOUBLE PRECISION CHECK(height >= 0.5 AND height <= 50),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE architectural_models (
 property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 state TEXT NOT NULL CHECK(state IN ('needs_inputs','queued','processing','ready','failed')),
 image_ids INTEGER[] NOT NULL DEFAULT '{}',
 plan_filename TEXT,
 dimensions JSONB,
 available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token UUID,
 lease_until TIMESTAMPTZ,
 started_at TIMESTAMPTZ,
 filename TEXT,
 previous_filename TEXT,
 error_code TEXT,
 warnings JSONB NOT NULL DEFAULT '[]',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX architectural_models_queue ON architectural_models(available_at) WHERE state IN ('queued','processing');
