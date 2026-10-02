// Fills an EMPTY database with a demo office: one bookkeeper, two client files,
// a client user for each, and invoices that show every flag in the review queue.
//
//   npm run demo
//
// Logins (password for all: demo1234):
//   office@demo.local   (office staff)
//   dana@demo.local     (client: דנה עיצובים)
//   moshe@demo.local    (client: משה שיפוצים)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../src/auth.js';
import { approveDocument, createClient } from '../src/books.js';
import { config } from '../src/config.js';
import { audit, openDb } from '../src/db.js';
import { normalizeDocNumber } from '../src/rules.js';

const db = openDb();
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.error('The database already has users. The demo only fills an empty database (delete data/ to start over).');
  process.exit(1);
}
fs.mkdirSync(config.uploadsDir, { recursive: true });

const PASSWORD = 'demo1234';
const addUser = (email, name, role, clientId = null) =>
  Number(
    db.prepare('INSERT INTO users (email, name, password_hash, role, client_id) VALUES (?, ?, ?, ?, ?)')
      .run(email, name, hashPassword(PASSWORD), role, clientId).lastInsertRowid
  );

const staffId = addUser('office@demo.local', 'יניב (משרד)', 'staff');
const dana = createClient(db, { name: 'דנה עיצובים בע"מ', taxId: '515000008' }, staffId);
const moshe = createClient(db, { name: 'משה שיפוצים', taxId: '032145674' }, staffId);
const danaUser = addUser('dana@demo.local', 'דנה כהן', 'client', dana);
const mosheUser = addUser('moshe@demo.local', 'משה לוי', 'client', moshe);

// A one-page PDF in plain Latin text, standing in for a scanned invoice.
function demoPdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 20 : 12} Tf 60 ${760 - i * 26} Td (${esc(l)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

const accountId = (clientId, code) => db.prepare('SELECT id FROM accounts WHERE client_id = ? AND code = ?').get(clientId, code).id;

function addDoc(clientId, userId, f) {
  const stored = `${crypto.randomUUID()}.pdf`;
  const pdf = demoPdf([
    f.title,
    `Supplier: ${f.supplierLatin}   VAT ID ${f.vat}`,
    `Number: ${f.number}   Date: ${f.date.split('-').reverse().join('/')}`,
    `Amount before VAT: ${f.before.toFixed(2)}`,
    `VAT 18%: ${f.vatAmount.toFixed(2)}`,
    `Total: ${f.total.toFixed(2)}`,
    f.allocation ? `Allocation number: ${f.allocation}` : 'Allocation number: none',
    '(demo document)',
  ]);
  fs.writeFileSync(path.join(config.uploadsDir, stored), pdf);
  const raw = {
    supplier_name: f.supplier, supplier_vat_id: f.vat, doc_type: f.type, doc_number: f.number, doc_date: f.date,
    amount_before_vat: f.before, vat_amount: f.vatAmount, total: f.total, allocation_number: f.allocation || null,
    currency: 'ILS', suggested_account_code: f.suggest,
  };
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO documents (client_id, uploaded_by, original_name, stored_name, mime, size, status, attempts, extracted_json,
         supplier_name, supplier_vat_id, doc_type, doc_number, doc_number_norm, doc_date, amount_before_vat, vat_amount, total,
         allocation_number, currency, suggested_account_id, processed_at)
       VALUES (?, ?, ?, ?, 'application/pdf', ?, 'pending_review', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ILS', ?, datetime('now'))`
    )
    .run(
      clientId, userId, f.file, stored, pdf.length, JSON.stringify(raw), f.supplier, f.vat, f.type, f.number,
      normalizeDocNumber(f.number), f.date, Math.round(f.before * 100), Math.round(f.vatAmount * 100), Math.round(f.total * 100),
      f.allocation || null, f.suggest ? accountId(clientId, f.suggest) : null
    );
  const id = Number(lastInsertRowid);
  audit(db, { clientId, userId, action: 'document.uploaded', entityType: 'document', entityId: id, details: { name: f.file } });
  audit(db, { clientId, action: 'document.read', entityType: 'document', entityId: id, details: { attempts: 1 } });
  return id;
}

const staff = { id: staffId };

// Dana: Bezeq, approved and posted. Its next invoice should get the same account.
const bezeq1 = addDoc(dana, danaUser, {
  file: 'bezeq-august.pdf', title: 'TAX INVOICE', supplier: 'בזק החברה הישראלית לתקשורת בע"מ', supplierLatin: 'Bezeq',
  vat: '520031931', type: 'tax_invoice', number: '84512007', date: '2026-08-31', before: 250, vatAmount: 45, total: 295, suggest: '6210',
});
approveDocument(db, bezeq1, {}, staff);
addDoc(dana, danaUser, {
  file: 'bezeq-september.pdf', title: 'TAX INVOICE', supplier: 'בזק החברה הישראלית לתקשורת בע"מ', supplierLatin: 'Bezeq',
  vat: '520031931', type: 'tax_invoice', number: '84599120', date: '2026-09-30', before: 250, vatAmount: 45, total: 295, suggest: '6900',
});
// The same Bezeq invoice uploaded twice.
addDoc(dana, danaUser, {
  file: 'IMG_2231.pdf', title: 'TAX INVOICE', supplier: 'בזק החברה הישראלית לתקשורת בע"מ', supplierLatin: 'Bezeq',
  vat: '520031931', type: 'tax_invoice', number: '084512007', date: '2026-08-31', before: 250, vatAmount: 45, total: 295, suggest: '6210',
});
// A total that does not add up.
addDoc(dana, danaUser, {
  file: 'office-depot.pdf', title: 'TAX INVOICE RECEIPT', supplier: 'אופיס דיפו ישראל בע"מ', supplierLatin: 'Office Depot',
  vat: '513255893', type: 'tax_invoice_receipt', number: '33017', date: '2026-09-14', before: 420, vatAmount: 75.6, total: 459.6, suggest: '6430',
});

// Moshe: above 5,000 before VAT from 1.6.2026 without an allocation number.
addDoc(moshe, mosheUser, {
  file: 'ace-tools.pdf', title: 'TAX INVOICE', supplier: 'אייס קבוצת רשתות בע"מ', supplierLatin: 'ACE',
  vat: '520040338', type: 'tax_invoice', number: '1200455', date: '2026-09-02', before: 7400, vatAmount: 1332, total: 8732, suggest: '6010',
});
// A fuel invoice: car expenses deduct 2/3 of the VAT.
addDoc(moshe, mosheUser, {
  file: 'paz-fuel.pdf', title: 'TAX INVOICE RECEIPT', supplier: 'פז חברת נפט בע"מ', supplierLatin: 'Paz',
  vat: '510216054', type: 'tax_invoice_receipt', number: '5521-889', date: '2026-09-21', before: 338.98, vatAmount: 61.02, total: 400, suggest: '6300',
});
// A receipt alone is not posted.
addDoc(moshe, mosheUser, {
  file: 'kabala.pdf', title: 'RECEIPT', supplier: 'אייס קבוצת רשתות בע"מ', supplierLatin: 'ACE',
  vat: '520040338', type: 'receipt', number: '77801', date: '2026-09-05', before: 7400, vatAmount: 1332, total: 8732, suggest: '6010',
});

console.log('Demo data created. Log in with password demo1234 as office@demo.local, dana@demo.local or moshe@demo.local');
