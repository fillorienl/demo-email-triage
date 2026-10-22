-- The draft step now returns a question for the reviewer separately from the email body.

ALTER TABLE drafts ADD COLUMN reviewer_note TEXT;
ALTER TABLE seed_ai_cache ADD COLUMN reviewer_note_template TEXT;

-- Cached drafts were written before the split and may carry reviewer notes inside the body.
DELETE FROM seed_ai_cache;
