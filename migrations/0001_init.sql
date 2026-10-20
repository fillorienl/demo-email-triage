-- Reference data (customers, products, orders) lives in code: seed/reference.ts.
-- Everything a visitor changes carries a sandbox_id.

CREATE TABLE sandboxes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,           -- e.g. VEL-7K3, put in the subject of a live email
  rma_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  seed_no INTEGER,                      -- 1..11 for seed emails
  source TEXT NOT NULL,                 -- seed | compose | live
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  received_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',   -- new | processing | triaged | sent | archived | error
  error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX emails_sandbox ON emails(sandbox_id, received_at);

CREATE TABLE triage_results (
  email_id TEXT PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL,
  read_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  lane TEXT NOT NULL,                   -- ready | needs_look | escalated | archived
  rule_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  route_to TEXT,
  lang TEXT NOT NULL,
  ai_mode TEXT NOT NULL,                -- live | cached | fixture
  model TEXT,
  ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX triage_sandbox ON triage_results(sandbox_id);

CREATE TABLE drafts (
  email_id TEXT PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  sandbox_id TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- reply | holding | suggested
  body TEXT NOT NULL,
  grounding_json TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX outbox_sandbox ON outbox(sandbox_id, sent_at);

CREATE TABLE rmas (
  sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  rma_number TEXT NOT NULL,
  email_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sandbox_id, rma_number)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  email_id TEXT,
  actor TEXT NOT NULL,                  -- ai | code | person | system
  action TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX audit_sandbox ON audit_log(sandbox_id, at);

-- Seed emails replay these after the first real run, so casual visitors cost nothing.
-- draft_template has {{fact}} placeholders, filled from today's facts on replay.
CREATE TABLE seed_ai_cache (
  seed_no INTEGER NOT NULL,
  model_key TEXT NOT NULL,
  read_json TEXT NOT NULL,
  draft_template TEXT,
  model TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (seed_no, model_key)
);

CREATE TABLE usage_counters (
  key TEXT NOT NULL,                    -- global_ai_calls | sandbox_live:<id> | inbound_unmatched | sandboxes_created
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
);
