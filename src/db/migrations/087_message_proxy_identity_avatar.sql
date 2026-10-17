ALTER TABLE message_proxy_identities ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Existing generated nicknames matched the service snapshot. Clear only those values so
-- subsequent changes follow the service; distinct local nicknames remain user choices.
-- A manually chosen nickname equal to that snapshot is indistinguishable and also clears.
UPDATE user_personalization_configs upc
SET user_nickname = NULL
FROM users u
JOIN external_identities ei ON ei.user_id = u.user_id
JOIN message_proxy_identities mpi ON mpi.external_identity_id = ei.external_identity_id
WHERE upc.user_id = u.user_id AND upc.user_nickname = mpi.display_name;
