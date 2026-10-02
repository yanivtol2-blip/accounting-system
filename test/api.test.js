import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'api-test-'));
process.env.WORKER_ENABLED = '0';
const { config } = await import('../src/config.js');
const { openDb } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth.js');
const { createClient } = await import('../src/books.js');
const { claimBatch, processDocument } = await import('../src/worker.js');

fs.mkdirSync(config.uploadsDir, { recursive: true });
const db = openDb(':memory:');
const addUser = (email, role, clientId = null) =>
  db.prepare('INSERT INTO users (email, name, password_hash, role, client_id) VALUES (?, ?, ?, ?, ?)').run(email, email, hashPassword('password1'), role, clientId);
addUser('office@t', 'staff');
const staffId = 1;
const danaFile = createClient(db, { name: 'דנה' }, staffId);
const mosheFile = createClient(db, { name: 'משה' }, staffId);
addUser('dana@t', 'client', danaFile);
addUser('moshe@t', 'client', mosheFile);

const server = createApp(db).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

async function login(email) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ email, password: 'password1' }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (method, url, body) => {
    const headers = { cookie, 'X-Requested-With': 'fetch' };
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const r = await fetch(`${base}${url}`, { method, headers, body: payload });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
}

// Stands in for the model: what it "reads" from each uploaded file.
const READS = {
  'bezeq-1.pdf': { doc_number: '1001', amount_before_vat: 200, vat_amount: 36, total: 236, suggested_account_code: '6210' },
  'bezeq-2.pdf': { doc_number: '1002', amount_before_vat: 100, vat_amount: 18, total: 118, suggested_account_code: '6900' },
  'bezeq-again.pdf': { doc_number: '01001', amount_before_vat: 200, vat_amount: 36, total: 236, suggested_account_code: '6210' },
  'bad-sum.pdf': { supplier_vat_id: '513255893', doc_number: '7', amount_before_vat: 100, vat_amount: 18, total: 120, suggested_account_code: '6430' },
  'big.pdf': { supplier_vat_id: '520040338', doc_number: '55', amount_before_vat: 7400, vat_amount: 1332, total: 8732, suggested_account_code: '6010' },
};
const fakeExtract = async ({ filePath }) => {
  const doc = db.prepare('SELECT original_name FROM documents WHERE stored_name = ?').get(path.basename(filePath));
  return {
    supplier_name: 'בזק', supplier_vat_id: '520031931', doc_type: 'tax_invoice', doc_date: '2026-09-10',
    allocation_number: null, currency: 'ILS', ...READS[doc.original_name],
  };
};
async function readAll() {
  for (const doc of claimBatch(db, 10)) await processDocument(db, doc, fakeExtract);
}
async function upload(as, names, clientId) {
  const fd = new FormData();
  if (clientId) fd.append('client_id', String(clientId));
  for (const n of names) fd.append('files', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), n);
  const r = await as('POST', '/api/documents', fd);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.ids;
}

let office, dana, moshe;
test.before(async () => {
  office = await login('office@t');
  dana = await login('dana@t');
  moshe = await login('moshe@t');
});

test('a client uploads several invoices; they are read and reach the queue as balanced entries', async () => {
  const [id] = await upload(dana, ['bezeq-1.pdf']);
  assert.equal((await dana('GET', `/api/documents/${id}`)).data.document.status_label, 'התקבל');
  await readAll();
  const q = await office('GET', '/api/queue');
  const item = q.data.documents.find((d) => d.id === id);
  assert.equal(item.supplier_name, 'בזק');
  assert.equal(item.total, 23600);
  const detail = await office('GET', `/api/documents/${id}`);
  assert.equal(detail.data.review.proposal.balanced, true);
  assert.equal(detail.data.review.blocking, false);
  assert.equal((await dana('GET', `/api/documents/${id}`)).data.document.status_label, 'ממתין לבדיקה');
});

test('approval posts it and the client sees "נרשם"; the next invoice of the supplier gets the same account', async () => {
  const q = await office('GET', '/api/queue');
  const first = q.data.documents.find((d) => d.doc_number === '1001');
  const r = await office('POST', `/api/documents/${first.id}/approve`, { edits: {}, expense_account_id: first.account.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await dana('GET', `/api/documents/${first.id}`)).data.document.status_label, 'נרשם');

  const journal = await office('GET', `/api/clients/${danaFile}/journal`);
  assert.equal(journal.data.entries.length, 1);
  const suppliers = await office('GET', `/api/clients/${danaFile}/suppliers`);
  assert.equal(suppliers.data.suppliers[0].balance, 23600);

  const [second] = await upload(dana, ['bezeq-2.pdf']);
  await readAll();
  const item = (await office('GET', '/api/queue')).data.documents.find((d) => d.id === second);
  assert.equal(item.account.code, first.account.code);
  assert.equal(item.account_source, 'history');
});

test('duplicates, sums that do not add up and a missing allocation number are flagged', async () => {
  const [dup, bad] = await upload(dana, ['bezeq-again.pdf', 'bad-sum.pdf']);
  const [big] = await upload(office, ['big.pdf'], mosheFile);
  await readAll();
  const flagsOf = async (id) => (await office('GET', `/api/documents/${id}`)).data.review.flags.map((f) => `${f.code}:${f.level}`);
  assert.ok((await flagsOf(dup)).includes('duplicate:blocking'));
  assert.ok((await flagsOf(bad)).includes('total_mismatch:blocking'));
  assert.ok((await flagsOf(big)).includes('allocation_missing:warning'));
  const r = await office('POST', `/api/documents/${dup}/approve`, {});
  assert.equal(r.status, 422);
  assert.ok(r.data.flags.some((f) => f.code === 'duplicate'));
});

test('a client never sees another client\'s documents', async () => {
  const mosheDocs = (await moshe('GET', '/api/documents')).data.documents;
  assert.ok(mosheDocs.length > 0);
  const fileOf = (d) => db.prepare('SELECT client_id FROM documents WHERE id = ?').get(d.id).client_id;
  const danaDocs = (await dana('GET', '/api/documents')).data.documents;
  assert.ok(danaDocs.length > 0 && danaDocs.every((d) => fileOf(d) === danaFile));
  // asking for the other file explicitly is ignored
  assert.ok((await dana('GET', `/api/documents?client_id=${mosheFile}`)).data.documents.every((d) => fileOf(d) === danaFile));
  const other = mosheDocs[0].id;
  assert.equal((await dana('GET', `/api/documents/${other}`)).status, 404);
  assert.equal((await dana('GET', `/api/documents/${other}/file`)).status, 404);
  assert.equal((await dana('GET', `/api/documents/${other}/history`)).status, 404);
  assert.equal((await dana('GET', '/api/queue')).status, 403);
  assert.equal((await dana('GET', `/api/clients/${mosheFile}`)).status, 404);
  assert.equal((await dana('GET', `/api/clients/${danaFile}/journal`)).status, 403);
  assert.equal((await dana('POST', `/api/documents/${other}/approve`, {})).status, 403);
});

test('a client cannot upload into another client\'s file', async () => {
  const [id] = await upload(dana, ['x.pdf'], mosheFile);
  assert.equal(db.prepare('SELECT client_id FROM documents WHERE id = ?').get(id).client_id, danaFile);
});

test('a request without the same-origin header is refused', async () => {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});
