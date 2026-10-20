-- Counts consecutive recurring occurrences whose generation failed, so a reminder can stop retrying a
-- provider that keeps failing and be removed once nothing reaches its channel either.
SELECT add_column_if_not_exists('reminders', 'failed_occurrence_count', 'INTEGER', '0', 'NOT NULL');
