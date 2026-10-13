DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pluralbuddy_oauth_connections) THEN
    RAISE EXCEPTION 'Cannot roll back PluralBuddy OAuth while connections exist';
  END IF;
END $$;

DROP TABLE pluralbuddy_oauth_connections;
DROP FUNCTION validate_pluralbuddy_oauth_connection();
