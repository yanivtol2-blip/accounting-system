import { audit, tx } from './db.js';
import { CHART_TEMPLATE, SUPPLIER_CODE_BASE, VAT_INPUT_CODE } from './chart-template.js';
import { toAgorot } from './money.js';
import {
  DOC_TYPES,
  buildProposal,
  computeFlags,
  hasBlocking,
  normalizeDocNumber,
  normalizeVatId,
} from './rules.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export function createClient(db, { name, taxId }, userId) {
  return tx(db, () => {
    const { lastInsertRowid: clientId } = db
      .prepare('INSERT INTO clients (name, tax_id) VALUES (?, ?)')
      .run(name, taxId || null);
    const insert = db.prepare(
      'INSERT INTO accounts (client_id, code, name, type, vat_deduction) VALUES (?, ?, ?, ?, ?)'
    );
    for (const a of CHART_TEMPLATE) insert.run(clientId, a.code, a.name, a.type, a.vat_deduction || 'full');
    audit(db, { clientId, userId, action: 'client.created', entityType: 'client', entityId: clientId, details: { name, taxId } });
    return Number(clientId);
  });
}

export const getAccount = (db, id) => (id ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) : null);

export function getVatAccount(db, clientId) {
  return (
    db.prepare("SELECT * FROM accounts WHERE client_id = ? AND type = 'vat_input' AND code = ?").get(clientId, VAT_INPUT_CODE) ||
    db.prepare("SELECT * FROM accounts WHERE client_id = ? AND type = 'vat_input' AND active = 1 ORDER BY code").get(clientId)
  );
}

export function findSupplierByVat(db, clientId, vatId) {
  const id = normalizeVatId(vatId);
  if (!id) return null;
  return db.prepare('SELECT * FROM suppliers WHERE client_id = ? AND vat_id = ?').get(clientId, id);
}

export function findDuplicates(db, doc) {
  const vatId = normalizeVatId(doc.supplier_vat_id);
  const num = normalizeDocNumber(doc.doc_number);
  if (!vatId || !num) return [];
  return db
    .prepare(
      `SELECT id, status FROM documents
       WHERE client_id = ? AND supplier_vat_id = ? AND doc_number_norm = ? AND id != ?
         AND status IN ('pending_review', 'posted')`
    )
    .all(doc.client_id, vatId, num, doc.id ?? 0);
}

const EDITABLE_TEXT = ['supplier_name', 'supplier_vat_id', 'doc_type', 'doc_number', 'doc_date', 'allocation_number'];
const EDITABLE_MONEY = ['amount_before_vat', 'vat_amount', 'total'];

// Applies corrections typed by the bookkeeper (amounts in shekels) and lists what changed.
export function applyEdits(doc, edits = {}) {
  const next = { ...doc };
  const changes = {};
  for (const key of EDITABLE_TEXT) {
    if (!(key in edits)) continue;
    let value = edits[key] == null ? null : String(edits[key]).trim() || null;
    if (key === 'supplier_vat_id') value = normalizeVatId(value);
    if (key === 'doc_type' && value && !DOC_TYPES[value]) throw new HttpError(400, 'סוג מסמך לא מוכר');
    if (value !== (doc[key] ?? null)) changes[key] = { from: doc[key] ?? null, to: value };
    next[key] = value;
  }
  for (const key of EDITABLE_MONEY) {
    if (!(key in edits)) continue;
    const value = toAgorot(edits[key]);
    if (edits[key] !== null && edits[key] !== '' && value === null) throw new HttpError(400, 'סכום לא תקין');
    if (value !== (doc[key] ?? null)) changes[key] = { from: doc[key] ?? null, to: value };
    next[key] = value;
  }
  next.doc_number_norm = normalizeDocNumber(next.doc_number);
  return { doc: next, changes };
}

/**
 * Everything the review screen shows next to the document: the flags, the
 * supplier card (if known), the expense account and the proposed entry.
 */
export function reviewModel(db, doc, { expenseAccountId } = {}) {
  const supplier = findSupplierByVat(db, doc.client_id, doc.supplier_vat_id);
  let accountId = expenseAccountId || null;
  let source = accountId ? 'manual' : null;
  if (!accountId && supplier?.expense_account_id) {
    accountId = supplier.expense_account_id;
    source = 'history';
  }
  if (!accountId && doc.suggested_account_id) {
    accountId = doc.suggested_account_id;
    source = 'model';
  }
  let expenseAccount = getAccount(db, accountId);
  if (expenseAccount && (expenseAccount.client_id !== doc.client_id || !['expense', 'asset'].includes(expenseAccount.type))) {
    expenseAccount = null;
    source = null;
  }
  const vatAccount = getVatAccount(db, doc.client_id);
  const supplierAccount = supplier ? getAccount(db, supplier.account_id) : null;

  const flags = computeFlags(doc, {
    duplicates: findDuplicates(db, doc),
    supplierKnown: Boolean(supplier),
  });
  if (!expenseAccount) flags.push({ code: 'no_account', level: 'blocking', message: 'יש לבחור סעיף הוצאה' });
  else if (!expenseAccount.active) flags.push({ code: 'inactive_account', level: 'blocking', message: 'הסעיף שנבחר אינו פעיל' });
  if (!vatAccount) flags.push({ code: 'no_vat_account', level: 'blocking', message: 'אין בתיק סעיף מע"מ תשומות' });

  const proposal = buildProposal({
    amountBeforeVat: doc.amount_before_vat,
    vatAmount: doc.vat_amount,
    total: doc.total,
    expenseAccount,
    vatAccount,
    supplierAccount: supplierAccount || {
      id: null,
      code: 'חדש',
      name: doc.supplier_name ? `${doc.supplier_name} (כרטיס ספק חדש)` : 'כרטיס ספק חדש',
      type: 'supplier',
    },
  });
  if (doc.total != null && doc.amount_before_vat != null && doc.vat_amount != null && !proposal.balanced) {
    if (!flags.some((f) => f.code === 'total_mismatch')) {
      flags.push({ code: 'unbalanced', level: 'blocking', message: 'הפקודה אינה מאוזנת' });
    }
  }

  return {
    flags,
    blocking: hasBlocking(flags),
    supplier: supplier ? { ...supplier, isNew: false } : null,
    expenseAccount,
    accountSource: source,
    proposal,
  };
}

function nextSupplierCode(db, clientId) {
  const row = db
    .prepare("SELECT MAX(CAST(code AS INTEGER)) AS max FROM accounts WHERE client_id = ? AND type = 'supplier' AND code GLOB '[0-9]*'")
    .get(clientId);
  return String(Math.max(Number(row.max || 0), SUPPLIER_CODE_BASE) + 1);
}

function insertEntry(db, { clientId, date, description, kind, documentId = null, reversesEntryId = null, userId, lines }) {
  const debits = lines.reduce((s, l) => s + l.debit, 0);
  const credits = lines.reduce((s, l) => s + l.credit, 0);
  if (debits !== credits || debits <= 0) throw new HttpError(400, 'הפקודה אינה מאוזנת');
  const { n } = db.prepare('SELECT COALESCE(MAX(entry_number), 0) + 1 AS n FROM journal_entries WHERE client_id = ?').get(clientId);
  const { lastInsertRowid: entryId } = db
    .prepare(
      `INSERT INTO journal_entries (client_id, entry_number, entry_date, description, kind, document_id, reverses_entry_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(clientId, n, date, description, kind, documentId, reversesEntryId, userId);
  const insertLine = db.prepare(
    'INSERT INTO journal_lines (entry_id, line_no, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)'
  );
  lines.forEach((l, i) => insertLine.run(entryId, i + 1, l.account_id, l.debit, l.credit, l.memo || null));
  return { entryId: Number(entryId), entryNumber: n };
}

const SAVE_COLUMNS = [
  'supplier_name', 'supplier_vat_id', 'doc_type', 'doc_number', 'doc_number_norm', 'doc_date',
  'amount_before_vat', 'vat_amount', 'total', 'allocation_number',
];

function saveDocFields(db, doc) {
  db.prepare(
    `UPDATE documents SET ${SAVE_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...SAVE_COLUMNS.map((c) => doc[c] ?? null), doc.id);
}

export function getDocument(db, id) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!doc) throw new HttpError(404, 'המסמך לא נמצא');
  return doc;
}

/** Approve (with optional corrections) and post. Only an approved entry is ever written. */
export function approveDocument(db, docId, { edits = {}, expenseAccountId } = {}, user) {
  return tx(db, () => {
    const current = getDocument(db, docId);
    if (current.status !== 'pending_review') throw new HttpError(409, 'אפשר לאשר רק מסמך שממתין לבדיקה');
    const { doc, changes } = applyEdits(current, edits);
    const review = reviewModel(db, doc, { expenseAccountId });
    if (review.blocking) throw new HttpError(422, 'יש סימונים שחוסמים את האישור', { flags: review.flags });

    saveDocFields(db, doc);
    if (Object.keys(changes).length) {
      audit(db, { clientId: doc.client_id, userId: user.id, action: 'document.corrected', entityType: 'document', entityId: doc.id, details: changes });
    }

    let supplier = review.supplier;
    if (!supplier) {
      const code = nextSupplierCode(db, doc.client_id);
      const { lastInsertRowid: accountId } = db
        .prepare("INSERT INTO accounts (client_id, code, name, type) VALUES (?, ?, ?, 'supplier')")
        .run(doc.client_id, code, doc.supplier_name);
      const { lastInsertRowid: supplierId } = db
        .prepare('INSERT INTO suppliers (client_id, vat_id, name, account_id, expense_account_id) VALUES (?, ?, ?, ?, ?)')
        .run(doc.client_id, doc.supplier_vat_id, doc.supplier_name, accountId, review.expenseAccount.id);
      supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);
      audit(db, {
        clientId: doc.client_id, userId: user.id, action: 'supplier.created', entityType: 'supplier', entityId: supplier.id,
        details: { name: supplier.name, vat_id: supplier.vat_id, account_code: code },
      });
    } else if (supplier.expense_account_id !== review.expenseAccount.id) {
      db.prepare('UPDATE suppliers SET expense_account_id = ? WHERE id = ?').run(review.expenseAccount.id, supplier.id);
      audit(db, {
        clientId: doc.client_id, userId: user.id, action: 'supplier.account_changed', entityType: 'supplier', entityId: supplier.id,
        details: { from: supplier.expense_account_id, to: review.expenseAccount.id },
      });
    }

    const lines = review.proposal.lines.map((l) => ({
      account_id: l.side === 'credit' ? supplier.account_id : l.account.id,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
    }));
    const description = `${DOC_TYPES[doc.doc_type]} ${doc.doc_number}, ${supplier.name}`;
    const { entryId, entryNumber } = insertEntry(db, {
      clientId: doc.client_id, date: doc.doc_date, description, kind: 'invoice', documentId: doc.id, userId: user.id, lines,
    });

    db.prepare(
      `UPDATE documents SET status = 'posted', entry_id = ?, expense_account_id = ?, reviewed_by = ?, reviewed_at = datetime('now'),
       return_note = NULL, updated_at = datetime('now') WHERE id = ?`
    ).run(entryId, review.expenseAccount.id, user.id, doc.id);
    audit(db, {
      clientId: doc.client_id, userId: user.id, action: 'document.approved', entityType: 'document', entityId: doc.id,
      details: { entry_id: entryId, entry_number: entryNumber, corrected: Object.keys(changes).length > 0, account_source: review.accountSource },
    });
    audit(db, { clientId: doc.client_id, userId: user.id, action: 'entry.posted', entityType: 'entry', entityId: entryId, details: { entry_number: entryNumber, document_id: doc.id } });
    return { entryId, entryNumber };
  });
}

export function returnDocument(db, docId, note, user) {
  if (!String(note || '').trim()) throw new HttpError(400, 'צריך לכתוב הערה ללקוח');
  return tx(db, () => {
    const doc = getDocument(db, docId);
    if (doc.status !== 'pending_review') throw new HttpError(409, 'אפשר להחזיר רק מסמך שממתין לבדיקה');
    db.prepare(
      `UPDATE documents SET status = 'returned', return_note = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(note.trim(), user.id, doc.id);
    audit(db, { clientId: doc.client_id, userId: user.id, action: 'document.returned', entityType: 'document', entityId: doc.id, details: { note: note.trim() } });
  });
}

export function markNotForPosting(db, docId, note, user) {
  return tx(db, () => {
    const doc = getDocument(db, docId);
    if (doc.status !== 'pending_review') throw new HttpError(409, 'אפשר לסמן רק מסמך שממתין לבדיקה');
    db.prepare(
      `UPDATE documents SET status = 'not_for_posting', return_note = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(String(note || '').trim() || null, user.id, doc.id);
    audit(db, { clientId: doc.client_id, userId: user.id, action: 'document.not_for_posting', entityType: 'document', entityId: doc.id, details: { note: note || null } });
  });
}

/**
 * A posted entry is never edited or deleted. To fix it: a reversal entry (same
 * date, sides swapped), and the document goes back to the queue for a new entry.
 */
export function reverseEntry(db, entryId, reason, user) {
  if (!String(reason || '').trim()) throw new HttpError(400, 'צריך לכתוב סיבה לביטול');
  return tx(db, () => {
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
    if (!entry) throw new HttpError(404, 'הפקודה לא נמצאה');
    if (entry.kind !== 'invoice') throw new HttpError(409, 'אי אפשר לבטל פקודת ביטול');
    const already = db.prepare('SELECT id FROM journal_entries WHERE reverses_entry_id = ?').get(entry.id);
    if (already) throw new HttpError(409, 'הפקודה כבר בוטלה');
    const lines = db.prepare('SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY line_no').all(entry.id);
    const result = insertEntry(db, {
      clientId: entry.client_id,
      date: entry.entry_date,
      description: `ביטול פקודה ${entry.entry_number}: ${reason.trim()}`,
      kind: 'reversal',
      documentId: entry.document_id,
      reversesEntryId: entry.id,
      userId: user.id,
      lines: lines.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo })),
    });
    if (entry.document_id) {
      db.prepare(
        `UPDATE documents SET status = 'pending_review', entry_id = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = datetime('now')
         WHERE id = ? AND entry_id = ?`
      ).run(entry.document_id, entry.id);
      audit(db, { clientId: entry.client_id, userId: user.id, action: 'document.reopened', entityType: 'document', entityId: entry.document_id, details: { reversed_entry: entry.entry_number } });
    }
    audit(db, {
      clientId: entry.client_id, userId: user.id, action: 'entry.reversed', entityType: 'entry', entityId: entry.id,
      details: { entry_number: entry.entry_number, reversal_entry_id: result.entryId, reversal_number: result.entryNumber, reason: reason.trim() },
    });
    return result;
  });
}

// ---- Books: chart of accounts with balances, journal, ledger card ----

export function accountsWithBalances(db, clientId) {
  return db
    .prepare(
      `SELECT a.*, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit,
              COALESCE(SUM(l.debit - l.credit), 0) AS balance, COUNT(l.id) AS line_count
       FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
       WHERE a.client_id = ? GROUP BY a.id ORDER BY a.code`
    )
    .all(clientId);
}

export function suppliersWithBalances(db, clientId) {
  return db
    .prepare(
      `SELECT s.*, a.code AS account_code, e.code AS expense_code, e.name AS expense_name,
              (SELECT COALESCE(SUM(credit - debit), 0) FROM journal_lines WHERE account_id = s.account_id) AS balance,
              (SELECT COUNT(*) FROM documents d WHERE d.client_id = s.client_id AND d.supplier_vat_id = s.vat_id AND d.status = 'posted') AS posted_count
       FROM suppliers s JOIN accounts a ON a.id = s.account_id LEFT JOIN accounts e ON e.id = s.expense_account_id
       WHERE s.client_id = ? ORDER BY s.name`
    )
    .all(clientId);
}

export function journal(db, clientId, { from, to } = {}) {
  const entries = db
    .prepare(
      `SELECT e.*, u.name AS created_by_name, r.entry_number AS reversed_by_number,
              o.entry_number AS reverses_number
       FROM journal_entries e
       JOIN users u ON u.id = e.created_by
       LEFT JOIN journal_entries r ON r.reverses_entry_id = e.id
       LEFT JOIN journal_entries o ON o.id = e.reverses_entry_id
       WHERE e.client_id = ? AND (? IS NULL OR e.entry_date >= ?) AND (? IS NULL OR e.entry_date <= ?)
       ORDER BY e.entry_date, e.entry_number`
    )
    .all(clientId, from || null, from || null, to || null, to || null);
  const linesStmt = db.prepare(
    `SELECT l.*, a.code, a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.line_no`
  );
  return entries.map((e) => ({ ...e, lines: linesStmt.all(e.id) }));
}

export function ledger(db, clientId, accountId, { from, to } = {}) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND client_id = ?').get(accountId, clientId);
  if (!account) throw new HttpError(404, 'הכרטיס לא נמצא');
  const opening = from
    ? db
        .prepare(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_id = ? AND e.entry_date < ?`
        )
        .get(accountId, from).b
    : 0;
  const rows = db
    .prepare(
      `SELECT l.id, l.debit, l.credit, l.memo, e.id AS entry_id, e.entry_number, e.entry_date, e.description, e.kind, e.document_id
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_id = ? AND (? IS NULL OR e.entry_date >= ?) AND (? IS NULL OR e.entry_date <= ?)
       ORDER BY e.entry_date, e.entry_number, l.line_no`
    )
    .all(accountId, from || null, from || null, to || null, to || null);
  let balance = opening;
  const lines = rows.map((r) => {
    balance += r.debit - r.credit;
    return { ...r, balance };
  });
  return { account, opening, lines, closing: balance };
}
