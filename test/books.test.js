import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'books-test-'));
const { openDb } = await import('../src/db.js');
const { approveDocument, createClient, journal, ledger, reverseEntry, reviewModel, getDocument } = await import('../src/books.js');

const db = openDb(':memory:');
const staffId = Number(db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES ('s@t', 'משרד', 'x', 'staff')").run().lastInsertRowid);
const staff = { id: staffId };
const clientId = createClient(db, { name: 'תיק בדיקה', taxId: null }, staffId);
const account = (code) => db.prepare('SELECT * FROM accounts WHERE client_id = ? AND code = ?').get(clientId, code);

function addDoc(over = {}) {
  const f = {
    supplier_name: 'בזק', supplier_vat_id: '520031931', doc_type: 'tax_invoice', doc_number: '1', doc_number_norm: '1',
    doc_date: '2026-09-01', amount_before_vat: 25000, vat_amount: 4500, total: 29500, suggested_account_id: account('6210').id, ...over,
  };
  return Number(
    db.prepare(
      `INSERT INTO documents (client_id, uploaded_by, original_name, stored_name, mime, size, status, supplier_name, supplier_vat_id,
        doc_type, doc_number, doc_number_norm, doc_date, amount_before_vat, vat_amount, total, suggested_account_id)
       VALUES (?, ?, 'a.pdf', 'a.pdf', 'application/pdf', 1, 'pending_review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(clientId, staffId, f.supplier_name, f.supplier_vat_id, f.doc_type, f.doc_number, f.doc_number_norm, f.doc_date,
      f.amount_before_vat, f.vat_amount, f.total, f.suggested_account_id).lastInsertRowid
  );
}

test('approval posts a balanced entry on the invoice date, to the journal, the supplier card and the ledgers', () => {
  const id = addDoc();
  const { entryId } = approveDocument(db, id, {}, staff);
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  assert.equal(entry.entry_date, '2026-09-01');
  const lines = db.prepare('SELECT * FROM journal_lines WHERE entry_id = ?').all(entryId);
  assert.equal(lines.reduce((s, l) => s + l.debit, 0), lines.reduce((s, l) => s + l.credit, 0));
  assert.equal(getDocument(db, id).status, 'posted');
  const supplier = db.prepare('SELECT * FROM suppliers WHERE client_id = ? AND vat_id = ?').get(clientId, '520031931');
  assert.equal(supplier.expense_account_id, account('6210').id);
  assert.equal(ledger(db, clientId, supplier.account_id).closing, -29500);
  // phone (6210) deducts two thirds of the VAT by default: 3,000 to input VAT, 1,500 added to the expense
  assert.equal(account('6210').vat_deduction, 'two_thirds');
  assert.equal(ledger(db, clientId, account('6210').id).closing, 26500);
  assert.equal(ledger(db, clientId, account('1500').id).closing, 3000);
});

test('the second invoice of the same supplier gets the account approved last, not the model suggestion', () => {
  const id = addDoc({ doc_number: '2', doc_number_norm: '2', suggested_account_id: account('6900').id });
  const review = reviewModel(db, getDocument(db, id));
  assert.equal(review.accountSource, 'history');
  assert.equal(review.expenseAccount.code, '6210');
  assert.ok(!review.flags.some((f) => f.code === 'new_supplier'));
});

test('the same supplier and number again is flagged as a duplicate and blocked', () => {
  const id = addDoc({ doc_number: '0001', doc_number_norm: '1' });
  const review = reviewModel(db, getDocument(db, id));
  assert.ok(review.flags.some((f) => f.code === 'duplicate' && f.level === 'blocking'));
  assert.throws(() => approveDocument(db, id, {}, staff), (err) => err.status === 422);
});

test('a posted entry can be neither edited nor deleted', () => {
  assert.throws(() => db.prepare('UPDATE journal_lines SET debit = 1').run());
  assert.throws(() => db.prepare('DELETE FROM journal_lines').run());
  assert.throws(() => db.prepare('UPDATE journal_entries SET entry_date = ?').run('2026-01-01'));
  assert.throws(() => db.prepare('DELETE FROM journal_entries').run());
  assert.throws(() => db.prepare('DELETE FROM audit_log').run());
});

test('a fix is a reversal entry plus a new entry', () => {
  const id = addDoc({ doc_number: '3', doc_number_norm: '3' });
  const first = approveDocument(db, id, {}, staff);
  const reversal = reverseEntry(db, first.entryId, 'סעיף שגוי', staff);
  assert.equal(getDocument(db, id).status, 'pending_review');
  const second = approveDocument(db, id, { expenseAccountId: account('6900').id }, staff);
  assert.ok(second.entryNumber > reversal.entryNumber);
  const entries = journal(db, clientId);
  const original = entries.find((e) => e.id === first.entryId);
  assert.equal(original.reversed_by_number, reversal.entryNumber);
  assert.equal(ledger(db, clientId, account('6900').id).closing, 25000);
  assert.throws(() => reverseEntry(db, first.entryId, 'שוב', staff), (err) => err.status === 409);
});

test('car expenses deduct two thirds of the VAT, the rest goes to the expense', () => {
  const id = addDoc({ supplier_name: 'פז', supplier_vat_id: '510216054', doc_number: '9', doc_number_norm: '9', amount_before_vat: 33898, vat_amount: 6102, total: 40000, suggested_account_id: account('6300').id });
  const review = reviewModel(db, getDocument(db, id));
  assert.equal(review.proposal.vatDeductible, 4068);
  assert.equal(review.proposal.lines[0].debit, 35932);
  assert.equal(review.proposal.balanced, true);
});

test('every action is recorded with who did it', () => {
  const rows = db.prepare("SELECT * FROM audit_log WHERE action IN ('document.approved', 'entry.reversed')").all();
  assert.ok(rows.length >= 3);
  assert.ok(rows.every((r) => r.user_id === staffId && r.created_at));
});
