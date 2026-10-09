CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_id_server ON personas(persona_id, server_id);

CREATE TABLE IF NOT EXISTS custom_expressions (
  custom_expression_id UUID PRIMARY KEY,
  server_id INT NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  name_key TEXT NOT NULL CHECK (char_length(name_key) > 0),
  description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  emotion_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('link', 'upload')),
  delivery_kind TEXT NOT NULL CHECK (delivery_kind IN ('link', 'stored')),
  original_link TEXT,
  storage_reference TEXT,
  mime_type TEXT,
  extension TEXT,
  byte_size INT CHECK (byte_size BETWEEN 1 AND 10485760),
  restricted BOOLEAN NOT NULL DEFAULT false,
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (server_id, name_key),
  UNIQUE (custom_expression_id, server_id),
  CHECK ((source_kind = 'link' AND original_link IS NOT NULL) OR
         (source_kind = 'upload' AND original_link IS NULL)),
  CHECK ((delivery_kind = 'link' AND source_kind = 'link' AND storage_reference IS NULL) OR
         (delivery_kind = 'stored' AND storage_reference IS NOT NULL AND mime_type IS NOT NULL
          AND extension IS NOT NULL AND byte_size IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS custom_expression_personas (
  custom_expression_id UUID NOT NULL,
  server_id INT NOT NULL,
  persona_id INT NOT NULL,
  PRIMARY KEY (custom_expression_id, persona_id),
  FOREIGN KEY (custom_expression_id, server_id)
    REFERENCES custom_expressions(custom_expression_id, server_id) ON DELETE CASCADE,
  FOREIGN KEY (persona_id, server_id) REFERENCES personas(persona_id, server_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_expression_personas_persona ON custom_expression_personas(persona_id);

DROP TRIGGER IF EXISTS update_custom_expressions_timestamp ON custom_expressions;
CREATE TRIGGER update_custom_expressions_timestamp
BEFORE UPDATE ON custom_expressions
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
