import path from 'node:path';
import { audit } from './db.js';
import { config } from './config.js';
import { extractInvoice } from './extract.js';
import { toAgorot } from './money.js';
import { DOC_TYPES, isValidDate, normalizeDocNumber, normalizeVatId } from './rules.js';

const MAX_ATTEMPTS = 3;

function clean(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/** Turns the model's raw answer into document columns (amounts in agorot). */
export function fieldsFromExtraction(raw, accounts) {
  const docType = DOC_TYPES[raw.doc_type] ? raw.doc_type : 'other';
  const docDate = isValidDate(raw.doc_date) ? raw.doc_date : null;
  const suggested = accounts.find((a) => a.code === clean(raw.suggested_account_code));
  return {
    supplier_name: clean(raw.supplier_name),
    supplier_vat_id: normalizeVatId(raw.supplier_vat_id),
    doc_type: docType,
    doc_number: clean(raw.doc_number),
    doc_number_norm: normalizeDocNumber(raw.doc_number),
    doc_date: docDate,
    amount_before_vat: toAgorot(raw.amount_before_vat),
    vat_amount: toAgorot(raw.vat_amount),
    total: toAgorot(raw.total),
    allocation_number: normalizeVatId(raw.allocation_number) ? clean(raw.allocation_number) : null,
    currency: clean(raw.currency)?.toUpperCase() || 'ILS',
    suggested_account_id: suggested ? suggested.id : null,
  };
}

const FIELD_COLUMNS = [
  'supplier_name', 'supplier_vat_id', 'doc_type', 'doc_number', 'doc_number_norm', 'doc_date',
  'amount_before_vat', 'vat_amount', 'total', 'allocation_number', 'currency', 'suggested_account_id',
];

export async function processDocument(db, doc, extract = extractInvoice) {
  const accounts = db
    .prepare("SELECT id, code, name FROM accounts WHERE client_id = ? AND type IN ('expense', 'asset') AND active = 1 ORDER BY code")
    .all(doc.client_id);
  const attempts = doc.attempts + 1;
  try {
    const raw = await extract({ filePath: path.join(config.uploadsDir, doc.stored_name), mime: doc.mime, accounts });
    const fields = fieldsFromExtraction(raw, accounts);
    db.prepare(
      `UPDATE documents SET ${FIELD_COLUMNS.map((c) => `${c} = ?`).join(', ')}, extracted_json = ?, extraction_error = NULL,
       status = 'pending_review', attempts = ?, processed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(...FIELD_COLUMNS.map((c) => fields[c]), JSON.stringify(raw), attempts, doc.id);
    audit(db, { clientId: doc.client_id, action: 'document.read', entityType: 'document', entityId: doc.id, details: { attempts } });
  } catch (err) {
    const message = err?.message || String(err);
    const retry = err?.retryable !== false && attempts < MAX_ATTEMPTS;
    if (retry) {
      db.prepare(
        `UPDATE documents SET status = 'received', attempts = ?, extraction_error = ?,
         next_attempt_at = datetime('now', ?), updated_at = datetime('now') WHERE id = ?`
      ).run(attempts, message, `+${attempts * 10} seconds`, doc.id);
    } else {
      // Reading failed for good: the document still goes to the queue to be typed in by hand.
      db.prepare(
        `UPDATE documents SET status = 'pending_review', attempts = ?, extraction_error = ?, processed_at = datetime('now'),
         updated_at = datetime('now') WHERE id = ?`
      ).run(attempts, message, doc.id);
      audit(db, { clientId: doc.client_id, action: 'document.read_failed', entityType: 'document', entityId: doc.id, details: { error: message, attempts } });
    }
  }
}

/** Claims the next documents waiting to be read. */
export function claimBatch(db, limit) {
  const rows = db
    .prepare(
      `SELECT * FROM documents WHERE status = 'received' AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
       ORDER BY id LIMIT ?`
    )
    .all(limit);
  const claim = db.prepare("UPDATE documents SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'received'");
  return rows.filter((r) => claim.run(r.id).changes === 1);
}

export function startWorker(db, { extract = extractInvoice, intervalMs = config.workerIntervalMs, concurrency = config.workerConcurrency } = {}) {
  // A restart in the middle of a read: put those documents back in line.
  db.prepare("UPDATE documents SET status = 'received' WHERE status = 'processing'").run();
  let running = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const free = concurrency - running;
    if (free > 0) {
      for (const doc of claimBatch(db, free)) {
        running++;
        processDocument(db, doc, extract)
          .catch((err) => console.error('worker', doc.id, err))
          .finally(() => {
            running--;
          });
      }
    }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
