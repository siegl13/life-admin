-- Keep the name that identified the source document at extraction time.
-- attachment_id intentionally becomes NULL when the document is removed,
-- but a review must still say which document produced its suggestions.
ALTER TABLE extraction_runs ADD COLUMN source_filename TEXT NOT NULL DEFAULT '';
