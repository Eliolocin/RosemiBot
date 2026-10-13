CREATE TABLE IF NOT EXISTS decision_models (
  decision_model_id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  codename TEXT NOT NULL,
  descriptions JSONB,
  is_scoped_registration BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_deprecated BOOLEAN NOT NULL DEFAULT false,
  input_token_limit INT NOT NULL CHECK (input_token_limit BETWEEN 512 AND 10000000),
  sees_images BOOLEAN NOT NULL DEFAULT false,
  supported_primitives JSONB NOT NULL DEFAULT '["predicate"]'::jsonb
    CHECK (supported_primitives = '["predicate"]'::jsonb),
  input_price_per_million NUMERIC CHECK (input_price_per_million >= 0),
  output_price_per_million NUMERIC CHECK (output_price_per_million >= 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, codename)
);
CREATE INDEX IF NOT EXISTS idx_decision_models_provider ON decision_models(provider);

SELECT add_column_if_not_exists('scoped_model_registrations', 'decision_model_id', 'INT');
DO $$
DECLARE old_check RECORD;
BEGIN
  FOR old_check IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'scoped_model_registrations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%'
  LOOP
    EXECUTE format('ALTER TABLE scoped_model_registrations DROP CONSTRAINT %I', old_check.conname);
  END LOOP;
  ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_one_model
    CHECK (num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id, decision_model_id) = 1);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'scoped_model_registrations'::regclass
                 AND conname = 'scoped_model_registrations_decision_model_id_fkey') THEN
    ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_decision_model_id_fkey
      FOREIGN KEY (decision_model_id) REFERENCES decision_models(decision_model_id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scoped_model_registrations_server_decision
  ON scoped_model_registrations(server_id, decision_model_id) WHERE user_id IS NULL AND decision_model_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scoped_model_registrations_user_decision
  ON scoped_model_registrations(user_id, decision_model_id) WHERE server_id IS NULL AND decision_model_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scoped_model_registrations_decision ON scoped_model_registrations(decision_model_id);
