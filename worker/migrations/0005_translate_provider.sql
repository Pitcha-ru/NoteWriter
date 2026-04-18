ALTER TABLE settings ADD COLUMN translate_provider TEXT DEFAULT 'openai';
ALTER TABLE settings ADD COLUMN translate_model TEXT DEFAULT 'gpt-4o-mini';
