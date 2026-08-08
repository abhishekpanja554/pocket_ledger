-- Ledgerly D1 schema. Every statement is idempotent: applying this file to an
-- existing database never destroys data.

CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  merchant    TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Needs review',
  amount      REAL NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('expense','income')),
  account     TEXT NOT NULL DEFAULT 'Imported account',
  tags        TEXT NOT NULL DEFAULT '[]',
  receipt     INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  createdAt   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category);

CREATE TABLE IF NOT EXISTS tags (
  name      TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id        TEXT PRIMARY KEY,
  whenText  TEXT NOT NULL,
  thenText  TEXT NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key       TEXT PRIMARY KEY,
  value     TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id        TEXT PRIMARY KEY,
  filename  TEXT NOT NULL,
  mimeType  TEXT NOT NULL,
  size      INTEGER NOT NULL,
  objectKey TEXT NOT NULL UNIQUE,
  status    TEXT NOT NULL,
  source    TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_created ON documents (createdAt DESC);
