import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// All money is stored as an integer number of agorot (1 ILS = 100).
const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  tax_id      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('staff', 'client')),
  client_id      INTEGER REFERENCES clients(id),
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((role = 'client') = (client_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id             INTEGER PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id),
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('expense', 'asset', 'vat_input', 'supplier', 'liability')),
  vat_deduction  TEXT NOT NULL DEFAULT 'full' CHECK (vat_deduction IN ('full', 'two_thirds', 'quarter', 'none')),
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, code)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id                  INTEGER PRIMARY KEY,
  client_id           INTEGER NOT NULL REFERENCES clients(id),
  vat_id              TEXT NOT NULL,
  name                TEXT NOT NULL,
  account_id          INTEGER NOT NULL REFERENCES accounts(id),
  expense_account_id  INTEGER REFERENCES accounts(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, vat_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id                    INTEGER PRIMARY KEY,
  client_id             INTEGER NOT NULL REFERENCES clients(id),
  uploaded_by           INTEGER NOT NULL REFERENCES users(id),
  original_name         TEXT NOT NULL,
  stored_name           TEXT NOT NULL,
  mime                  TEXT NOT NULL,
  size                  INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received', 'processing', 'pending_review', 'posted', 'returned', 'not_for_posting')),
  attempts              INTEGER NOT NULL DEFAULT 0,
  next_attempt_at       TEXT,
  extraction_error      TEXT,
  extracted_json        TEXT,
  supplier_name         TEXT,
  supplier_vat_id       TEXT,
  doc_type              TEXT,
  doc_number            TEXT,
  doc_number_norm       TEXT,
  doc_date              TEXT,
  amount_before_vat     INTEGER,
  vat_amount            INTEGER,
  total                 INTEGER,
  allocation_number     TEXT,
  currency              TEXT,
  suggested_account_id  INTEGER REFERENCES accounts(id),
  expense_account_id    INTEGER REFERENCES accounts(id),
  return_note           TEXT,
  entry_id              INTEGER REFERENCES journal_entries(id),
  reviewed_by           INTEGER REFERENCES users(id),
  reviewed_at           TEXT,
  processed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS documents_status ON documents(status, id);
CREATE INDEX IF NOT EXISTS documents_client ON documents(client_id, id);
CREATE INDEX IF NOT EXISTS documents_dup ON documents(client_id, supplier_vat_id, doc_number_norm);

CREATE TABLE IF NOT EXISTS journal_entries (
  id                 INTEGER PRIMARY KEY,
  client_id          INTEGER NOT NULL REFERENCES clients(id),
  entry_number       INTEGER NOT NULL,
  entry_date         TEXT NOT NULL,
  description        TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('invoice', 'reversal')),
  document_id        INTEGER REFERENCES documents(id),
  reverses_entry_id  INTEGER UNIQUE REFERENCES journal_entries(id),
  created_by         INTEGER NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, entry_number)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id          INTEGER PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES journal_entries(id),
  line_no     INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  debit       INTEGER NOT NULL DEFAULT 0,
  credit      INTEGER NOT NULL DEFAULT 0,
  memo        TEXT,
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND debit + credit > 0)
);
CREATE INDEX IF NOT EXISTS journal_lines_account ON journal_lines(account_id);

-- A posted entry is final: corrections are made with a reversal entry and a new one.
CREATE TRIGGER IF NOT EXISTS journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'posted journal entries cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'posted journal entries cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'posted journal lines cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'posted journal lines cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY,
  client_id    INTEGER REFERENCES clients(id),
  user_id      INTEGER REFERENCES users(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER,
  details      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_client ON audit_log(client_id, id);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
`;

export function openDb(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

// Runs fn inside one transaction; nested calls join the outer one.
export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function audit(db, { clientId = null, userId = null, action, entityType, entityId = null, details = null }) {
  db.prepare(
    'INSERT INTO audit_log (client_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(clientId, userId, action, entityType, entityId, details == null ? null : JSON.stringify(details));
}
