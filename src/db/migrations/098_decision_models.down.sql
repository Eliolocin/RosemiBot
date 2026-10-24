-- The rollback runner commits each statement, so keep the guards and DDL in one atomic block.
DO $$
BEGIN
  LOCK TABLE decision_models, scoped_model_registrations,
    custom_endpoint_connections, server_chat_configs, server_model_configs IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM decision_models WHERE is_scoped_registration = true) OR
     EXISTS (SELECT 1 FROM scoped_model_registrations WHERE decision_model_id IS NOT NULL) OR
     EXISTS (SELECT 1 FROM custom_endpoint_connections WHERE capability = 'decision') THEN
    RAISE EXCEPTION 'Remove decision registrations and endpoint connections before downgrading';
  END IF;
  -- Manual forward migrations can run before startup adds either selection column.
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'server_chat_configs'::regclass
               AND attname = 'response_decision_model_id' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM server_chat_configs WHERE response_decision_model_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Clear saved response Decision selections before downgrading';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'server_model_configs'::regclass
               AND attname = 'decision_model_id' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM server_model_configs WHERE decision_model_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Clear saved server Decision selections before downgrading';
    END IF;
  END IF;
  -- Natural Nudges may already be rolled back, so the table is looked up without a cast that would fail.
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = to_regclass('server_natural_nudge_configs')
               AND attname = 'checker_decision_model_id' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM server_natural_nudge_configs WHERE checker_decision_model_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Clear saved Active Nudge Checker Decision selections before downgrading';
    END IF;
    ALTER TABLE server_natural_nudge_configs DROP CONSTRAINT IF EXISTS server_natural_nudge_configs_one_checker;
    ALTER TABLE server_natural_nudge_configs DROP COLUMN checker_decision_model_id;
  END IF;
  ALTER TABLE server_chat_configs DROP COLUMN IF EXISTS response_decision_model_id;
  ALTER TABLE server_model_configs DROP COLUMN IF EXISTS decision_model_id;
  ALTER TABLE scoped_model_registrations DROP CONSTRAINT IF EXISTS scoped_model_registrations_one_model;
  ALTER TABLE scoped_model_registrations DROP COLUMN IF EXISTS decision_model_id;
  ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_check1
    CHECK (num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id) = 1);
  DROP TABLE decision_models;
END $$;
