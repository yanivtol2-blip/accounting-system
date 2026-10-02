import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { audit } from './db.js';
import {
  HttpError,
  accountsWithBalances,
  approveDocument,
  applyEdits,
  createClient,
  getDocument,
  journal,
  ledger,
  markNotForPosting,
  returnDocument,
  reverseEntry,
  reviewModel,
  suppliersWithBalances,
} from './books.js';
import {
  assertClientAccess,
  checkLoginThrottle,
  clearLoginFailures,
  createSession,
  destroySession,
  hashPassword,
  loadUser,
  recordLoginFailure,
  requireSameOrigin,
  requireStaff,
  requireUser,
  sessionCookie,
  sessionToken,
  validatePassword,
  verifyPassword,
} from './auth.js';
import { ACCOUNT_TYPES } from './chart-template.js';
import { DOC_TYPES, VAT_DEDUCTION } from './rules.js';

const UPLOAD_TYPES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

const STATUS_LABELS = {
  received: 'התקבל',
  processing: 'התקבל',
  pending_review: 'ממתין לבדיקה',
  posted: 'נרשם',
  returned: 'הוחזר עם הערה',
  not_for_posting: 'לא לרישום',
};

const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'לא נמצא');
  return n;
};

const trimmed = (v) => (v == null ? '' : String(v).trim());

// What a client user may see of a document: the status and the reviewer's note.
function clientDocView(d) {
  return {
    id: d.id,
    original_name: d.original_name,
    mime: d.mime,
    status: d.status,
    status_label: STATUS_LABELS[d.status],
    return_note: d.status === 'returned' || d.status === 'not_for_posting' ? d.return_note : null,
    supplier_name: d.status === 'posted' ? d.supplier_name : null,
    doc_number: d.status === 'posted' ? d.doc_number : null,
    total: d.status === 'posted' ? d.total : null,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

function staffDocView(d) {
  const { extracted_json, stored_name, ...rest } = d;
  return { ...rest, status_label: STATUS_LABELS[d.status] };
}

export function createApp(db) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' blob: data:; object-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  app.use(loadUser(db));
  app.use('/api', requireSameOrigin);

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadsDir,
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${UPLOAD_TYPES[file.mimetype] || ''}`),
    }),
    limits: { fileSize: config.maxUploadBytes, files: config.maxFilesPerUpload },
    fileFilter: (_req, file, cb) => {
      if (UPLOAD_TYPES[file.mimetype]) return cb(null, true);
      cb(new HttpError(415, `הקובץ "${file.originalname}" אינו PDF או תמונה`));
    },
  });

  // ---- session ----

  app.post('/api/login', (req, res) => {
    const email = trimmed(req.body?.email).toLowerCase();
    const password = String(req.body?.password || '');
    const key = `${req.ip}|${email}`;
    checkLoginThrottle(key);
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordLoginFailure(key);
      throw new HttpError(401, 'הדוא"ל או הסיסמה שגויים');
    }
    clearLoginFailures(key);
    const token = createSession(db, user.id);
    audit(db, { clientId: user.client_id, userId: user.id, action: 'user.login', entityType: 'user', entityId: user.id });
    res.set('Set-Cookie', sessionCookie(token)).json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    destroySession(db, sessionToken(req));
    res.set('Set-Cookie', sessionCookie('', 0)).json({ ok: true });
  });

  app.get('/api/me', requireUser, (req, res) => res.json({ user: req.user }));

  app.post('/api/me/password', requireUser, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.current || ''), row.password_hash)) throw new HttpError(400, 'הסיסמה הנוכחית שגויה');
    validatePassword(req.body?.next);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.next), req.user.id);
    audit(db, { clientId: req.user.client_id, userId: req.user.id, action: 'user.password_changed', entityType: 'user', entityId: req.user.id });
    res.json({ ok: true });
  });

  app.get('/api/meta', requireUser, (_req, res) => {
    res.json({
      docTypes: DOC_TYPES,
      vatDeduction: Object.fromEntries(Object.entries(VAT_DEDUCTION).map(([k, v]) => [k, v.label])),
      accountTypes: ACCOUNT_TYPES,
      statusLabels: STATUS_LABELS,
    });
  });

  // ---- client files and users (office staff) ----

  app.get('/api/clients', requireStaff, (_req, res) => {
    res.json({
      clients: db
        .prepare(
          `SELECT c.*,
             (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id AND d.status = 'pending_review') AS pending,
             (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id AND d.status IN ('received', 'processing')) AS reading,
             (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id) AS documents
           FROM clients c ORDER BY c.name`
        )
        .all(),
    });
  });

  app.post('/api/clients', requireStaff, (req, res) => {
    const name = trimmed(req.body?.name);
    if (!name) throw new HttpError(400, 'צריך שם לתיק');
    const clientId = createClient(db, { name, taxId: trimmed(req.body?.tax_id) || null }, req.user.id);
    res.status(201).json({ id: clientId });
  });

  app.get('/api/clients/:cid', requireUser, (req, res) => {
    const clientId = id(req.params.cid);
    assertClientAccess(req.user, clientId);
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!client) throw new HttpError(404, 'התיק לא נמצא');
    res.json({ client });
  });

  app.get('/api/users', requireStaff, (_req, res) => {
    res.json({
      users: db
        .prepare(
          `SELECT u.id, u.email, u.name, u.role, u.client_id, u.active, u.created_at, c.name AS client_name
           FROM users u LEFT JOIN clients c ON c.id = u.client_id ORDER BY u.role DESC, u.name`
        )
        .all(),
    });
  });

  app.post('/api/users', requireStaff, (req, res) => {
    const name = trimmed(req.body?.name);
    const email = trimmed(req.body?.email).toLowerCase();
    const role = req.body?.role === 'staff' ? 'staff' : 'client';
    const clientId = role === 'client' ? id(req.body?.client_id) : null;
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'צריך שם ודוא"ל תקין');
    validatePassword(req.body?.password);
    if (clientId && !db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) throw new HttpError(400, 'התיק לא נמצא');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'כבר יש משתמש עם הדוא"ל הזה');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (email, name, password_hash, role, client_id) VALUES (?, ?, ?, ?, ?)')
      .run(email, name, hashPassword(req.body.password), role, clientId);
    audit(db, { clientId, userId: req.user.id, action: 'user.created', entityType: 'user', entityId: Number(lastInsertRowid), details: { email, role } });
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.patch('/api/users/:id', requireStaff, (req, res) => {
    const userId = id(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new HttpError(404, 'המשתמש לא נמצא');
    if ('active' in (req.body || {})) {
      if (userId === req.user.id && !req.body.active) throw new HttpError(400, 'אי אפשר לחסום את עצמך');
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, userId);
      if (!req.body.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      audit(db, { clientId: user.client_id, userId: req.user.id, action: req.body.active ? 'user.activated' : 'user.deactivated', entityType: 'user', entityId: userId });
    }
    if (req.body?.password) {
      validatePassword(req.body.password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      audit(db, { clientId: user.client_id, userId: req.user.id, action: 'user.password_reset', entityType: 'user', entityId: userId });
    }
    res.json({ ok: true });
  });

  // ---- documents ----

  app.post('/api/documents', requireUser, upload.array('files', config.maxFilesPerUpload), (req, res) => {
    const files = req.files || [];
    const clientId = req.user.role === 'client' ? req.user.client_id : id(req.body?.client_id);
    try {
      if (!files.length) throw new HttpError(400, 'לא נבחרו קבצים');
      if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) throw new HttpError(400, 'התיק לא נמצא');
    } catch (err) {
      for (const f of files) fs.rm(f.path, { force: true }, () => {});
      throw err;
    }
    const insert = db.prepare(
      'INSERT INTO documents (client_id, uploaded_by, original_name, stored_name, mime, size) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const ids = files.map((f) => {
      // Browsers send UTF-8 file names; multer reads them as latin1.
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const docId = Number(insert.run(clientId, req.user.id, name, f.filename, f.mimetype, f.size).lastInsertRowid);
      audit(db, { clientId, userId: req.user.id, action: 'document.uploaded', entityType: 'document', entityId: docId, details: { name } });
      return docId;
    });
    res.status(201).json({ ids });
  });

  app.get('/api/documents', requireUser, (req, res) => {
    const clientId = req.user.role === 'client' ? req.user.client_id : req.query.client_id ? id(req.query.client_id) : null;
    const status = req.query.status && STATUS_LABELS[req.query.status] ? req.query.status : null;
    const rows = db
      .prepare(
        `SELECT d.*, c.name AS client_name FROM documents d JOIN clients c ON c.id = d.client_id
         WHERE (? IS NULL OR d.client_id = ?) AND (? IS NULL OR d.status = ?)
         ORDER BY d.id DESC LIMIT 500`
      )
      .all(clientId, clientId, status, status);
    res.json({ documents: rows.map(req.user.role === 'client' ? clientDocView : staffDocView) });
  });

  app.get('/api/queue', requireStaff, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT d.*, c.name AS client_name FROM documents d JOIN clients c ON c.id = d.client_id
         WHERE d.status = 'pending_review' ORDER BY d.created_at, d.id`
      )
      .all();
    const { reading } = db.prepare("SELECT COUNT(*) AS reading FROM documents WHERE status IN ('received', 'processing')").get();
    res.json({
      reading,
      documents: rows.map((d) => {
        const review = reviewModel(db, d);
        return { ...staffDocView(d), flags: review.flags, blocking: review.blocking, account: review.expenseAccount, account_source: review.accountSource };
      }),
    });
  });

  function loadDocFor(req) {
    const doc = getDocument(db, id(req.params.id));
    assertClientAccess(req.user, doc.client_id);
    return doc;
  }

  function reviewPayload(doc, opts) {
    const review = reviewModel(db, doc, opts);
    const accounts = db
      .prepare("SELECT id, code, name, type, vat_deduction, active FROM accounts WHERE client_id = ? AND type IN ('expense', 'asset') ORDER BY code")
      .all(doc.client_id);
    const entry = doc.entry_id
      ? journal(db, doc.client_id).find((e) => e.id === doc.entry_id) || null
      : null;
    const entries = db
      .prepare('SELECT id, entry_number, kind, entry_date, reverses_entry_id, created_at FROM journal_entries WHERE document_id = ? ORDER BY id')
      .all(doc.id);
    return { document: staffDocView(doc), review, accounts, entry, entries };
  }

  app.get('/api/documents/:id', requireUser, (req, res) => {
    const doc = loadDocFor(req);
    if (req.user.role === 'client') return res.json({ document: clientDocView(doc) });
    const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(doc.client_id);
    res.json({ ...reviewPayload(doc), client });
  });

  app.get('/api/documents/:id/file', requireUser, (req, res) => {
    const doc = loadDocFor(req);
    const file = path.join(config.uploadsDir, path.basename(doc.stored_name));
    res.set({
      'Content-Type': doc.mime,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`,
      'Cache-Control': 'private, max-age=3600',
    });
    res.sendFile(file);
  });

  app.get('/api/documents/:id/history', requireUser, (req, res) => {
    const doc = loadDocFor(req);
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.details, a.created_at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.entity_type = 'document' AND a.entity_id = ? ORDER BY a.id`
      )
      .all(doc.id);
    const visible = req.user.role === 'client'
      ? rows.filter((r) => ['document.uploaded', 'document.approved', 'document.returned', 'document.not_for_posting'].includes(r.action))
      : rows;
    res.json({ history: visible.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })) });
  });

  app.post('/api/documents/:id/preview', requireStaff, (req, res) => {
    const current = loadDocFor(req);
    const { doc } = applyEdits(current, req.body?.edits || {});
    res.json({ review: reviewModel(db, doc, { expenseAccountId: req.body?.expense_account_id ? id(req.body.expense_account_id) : null }) });
  });

  app.post('/api/documents/:id/approve', requireStaff, (req, res) => {
    const doc = loadDocFor(req);
    const result = approveDocument(
      db,
      doc.id,
      { edits: req.body?.edits || {}, expenseAccountId: req.body?.expense_account_id ? id(req.body.expense_account_id) : null },
      req.user
    );
    res.json(result);
  });

  app.post('/api/documents/:id/return', requireStaff, (req, res) => {
    const doc = loadDocFor(req);
    returnDocument(db, doc.id, req.body?.note, req.user);
    res.json({ ok: true });
  });

  app.post('/api/documents/:id/not-for-posting', requireStaff, (req, res) => {
    const doc = loadDocFor(req);
    markNotForPosting(db, doc.id, req.body?.note, req.user);
    res.json({ ok: true });
  });

  // ---- books (office staff) ----

  function staffClient(req) {
    const clientId = id(req.params.cid);
    if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) throw new HttpError(404, 'התיק לא נמצא');
    return clientId;
  }

  app.get('/api/clients/:cid/accounts', requireStaff, (req, res) => {
    res.json({ accounts: accountsWithBalances(db, staffClient(req)) });
  });

  app.post('/api/clients/:cid/accounts', requireStaff, (req, res) => {
    const clientId = staffClient(req);
    const code = trimmed(req.body?.code);
    const name = trimmed(req.body?.name);
    const type = ['expense', 'asset', 'liability'].includes(req.body?.type) ? req.body.type : null;
    const deduction = VAT_DEDUCTION[req.body?.vat_deduction] ? req.body.vat_deduction : 'full';
    if (!/^\d{2,8}$/.test(code) || !name || !type) throw new HttpError(400, 'צריך מספר סעיף (ספרות), שם וסוג');
    if (db.prepare('SELECT id FROM accounts WHERE client_id = ? AND code = ?').get(clientId, code)) throw new HttpError(409, 'מספר הסעיף כבר קיים');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO accounts (client_id, code, name, type, vat_deduction) VALUES (?, ?, ?, ?, ?)')
      .run(clientId, code, name, type, deduction);
    audit(db, { clientId, userId: req.user.id, action: 'account.created', entityType: 'account', entityId: Number(lastInsertRowid), details: { code, name, type, vat_deduction: deduction } });
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.patch('/api/clients/:cid/accounts/:id', requireStaff, (req, res) => {
    const clientId = staffClient(req);
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND client_id = ?').get(id(req.params.id), clientId);
    if (!account) throw new HttpError(404, 'הסעיף לא נמצא');
    const changes = {};
    if ('name' in (req.body || {})) {
      const name = trimmed(req.body.name);
      if (!name) throw new HttpError(400, 'צריך שם לסעיף');
      if (name !== account.name) changes.name = { from: account.name, to: name };
    }
    if ('vat_deduction' in (req.body || {})) {
      if (!VAT_DEDUCTION[req.body.vat_deduction]) throw new HttpError(400, 'אחוז ניכוי לא מוכר');
      if (req.body.vat_deduction !== account.vat_deduction) changes.vat_deduction = { from: account.vat_deduction, to: req.body.vat_deduction };
    }
    if ('active' in (req.body || {})) {
      const active = req.body.active ? 1 : 0;
      if (!active && account.type === 'vat_input') throw new HttpError(400, 'אי אפשר להשבית את סעיף מע"מ התשומות');
      if (active !== account.active) changes.active = { from: account.active, to: active };
    }
    for (const [key, { to }] of Object.entries(changes)) {
      db.prepare(`UPDATE accounts SET ${key} = ? WHERE id = ?`).run(to, account.id);
    }
    if (Object.keys(changes).length) {
      audit(db, { clientId, userId: req.user.id, action: 'account.updated', entityType: 'account', entityId: account.id, details: { code: account.code, ...changes } });
    }
    res.json({ ok: true });
  });

  app.get('/api/clients/:cid/suppliers', requireStaff, (req, res) => {
    res.json({ suppliers: suppliersWithBalances(db, staffClient(req)) });
  });

  app.patch('/api/clients/:cid/suppliers/:id', requireStaff, (req, res) => {
    const clientId = staffClient(req);
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND client_id = ?').get(id(req.params.id), clientId);
    if (!supplier) throw new HttpError(404, 'הספק לא נמצא');
    const changes = {};
    if ('name' in (req.body || {})) {
      const name = trimmed(req.body.name);
      if (!name) throw new HttpError(400, 'צריך שם לספק');
      if (name !== supplier.name) {
        changes.name = { from: supplier.name, to: name };
        db.prepare('UPDATE suppliers SET name = ? WHERE id = ?').run(name, supplier.id);
        db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, supplier.account_id);
      }
    }
    if ('expense_account_id' in (req.body || {})) {
      const accountId = id(req.body.expense_account_id);
      const account = db.prepare("SELECT id FROM accounts WHERE id = ? AND client_id = ? AND type IN ('expense', 'asset')").get(accountId, clientId);
      if (!account) throw new HttpError(400, 'הסעיף לא נמצא');
      if (accountId !== supplier.expense_account_id) {
        changes.expense_account_id = { from: supplier.expense_account_id, to: accountId };
        db.prepare('UPDATE suppliers SET expense_account_id = ? WHERE id = ?').run(accountId, supplier.id);
      }
    }
    if (Object.keys(changes).length) {
      audit(db, { clientId, userId: req.user.id, action: 'supplier.updated', entityType: 'supplier', entityId: supplier.id, details: changes });
    }
    res.json({ ok: true });
  });

  const dateParam = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

  app.get('/api/clients/:cid/journal', requireStaff, (req, res) => {
    res.json({ entries: journal(db, staffClient(req), { from: dateParam(req.query.from), to: dateParam(req.query.to) }) });
  });

  app.get('/api/clients/:cid/ledger/:accountId', requireStaff, (req, res) => {
    res.json(ledger(db, staffClient(req), id(req.params.accountId), { from: dateParam(req.query.from), to: dateParam(req.query.to) }));
  });

  app.post('/api/entries/:id/reverse', requireStaff, (req, res) => {
    res.json(reverseEntry(db, id(req.params.id), req.body?.reason, req.user));
  });

  app.get('/api/clients/:cid/audit', requireStaff, (req, res) => {
    const clientId = staffClient(req);
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.client_id = ? ORDER BY a.id DESC LIMIT 500`
      )
      .all(clientId);
    res.json({ audit: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })) });
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'לא נמצא')));

  // ---- the web app ----
  app.use(express.static(path.join(config.root, 'public'), { index: 'index.html', maxAge: '1h' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'קובץ גדול מדי (עד 20MB)' : err.code === 'LIMIT_FILE_COUNT' ? 'יותר מדי קבצים בבת אחת' : 'ההעלאה נכשלה';
      return res.status(413).json({ error: message });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, flags: err.flags });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'בקשה לא תקינה' });
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשרת' });
  });

  return app;
}
