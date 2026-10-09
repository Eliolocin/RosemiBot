-- The rollback runner commits each statement, so keep the guards and DDL in one atomic block.
DO $$
BEGIN
  LOCK TABLE decision_models, scoped_model_registrations,
    custom_endpoint_connections, server_chat_configs IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM decision_models WHERE is_scoped_registration = true) OR
     EXISTS (SELECT 1 FROM scoped_model_registrations WHERE decision_model_id IS NOT NULL) OR
     EXISTS (SELECT 1 FROM custom_endpoint_connections WHERE capability = 'decision') THEN
    RAISE EXCEPTION 'Remove decision registrations and endpoint connections before downgrading';
  END IF;
  -- Manual forward migrations can run before startup adds the response selection column.
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'server_chat_configs'::regclass
               AND attname = 'response_decision_model_id' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM server_chat_configs WHERE response_decision_model_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Clear saved response Decision selections before downgrading';
    END IF;
  END IF;
  ALTER TABLE server_chat_configs DROP COLUMN IF EXISTS response_decision_model_id;
  ALTER TABLE scoped_model_registrations DROP CONSTRAINT IF EXISTS scoped_model_registrations_one_model;
  ALTER TABLE scoped_model_registrations DROP COLUMN IF EXISTS decision_model_id;
  ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_check1
    CHECK (num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id) = 1);
  DROP TABLE decision_models;
END $$;
