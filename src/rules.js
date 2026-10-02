// The bookkeeping rules of the approved spec, as pure functions.

export const VAT_RATE = 0.18;

export const POSTABLE_DOC_TYPES = ['tax_invoice', 'tax_invoice_receipt'];

export const DOC_TYPES = {
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס קבלה',
  receipt: 'קבלה',
  transaction_invoice: 'חשבון עסקה',
  credit_note: 'חשבונית זיכוי',
  quote_or_order: 'הצעת מחיר או הזמנה',
  other: 'מסמך אחר',
};

// Share of the input VAT that may be deducted (VAT regulation 18 for car and phone).
export const VAT_DEDUCTION = {
  full: { label: 'מלא', num: 1, den: 1 },
  two_thirds: { label: 'שני שלישים', num: 2, den: 3 },
  quarter: { label: 'רבע', num: 1, den: 4 },
  none: { label: 'ללא ניכוי', num: 0, den: 1 },
};

// An allocation number (מספר הקצאה) is required above this amount before VAT.
// Spec: above 10,000 ILS until 31.5.2026, above 5,000 ILS from 1.6.2026.
export function allocationThreshold(docDate) {
  return docDate && docDate >= '2026-06-01' ? 500000 : 1000000;
}

export function normalizeDocNumber(value) {
  if (!value) return null;
  const s = String(value).replace(/[\s\-/\\.]/g, '').replace(/^0+(?=.)/, '');
  return s || null;
}

export function normalizeVatId(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits || null;
}

// Israeli business / ID numbers: 9 digits with a check digit.
export function isValidIsraeliId(value) {
  const id = normalizeVatId(value);
  if (!id || id.length > 9) return false;
  const padded = id.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(padded[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function splitVat(vatAgorot, deduction = 'full') {
  const rule = VAT_DEDUCTION[deduction] || VAT_DEDUCTION.full;
  const deductible = Math.round((vatAgorot * rule.num) / rule.den);
  return { deductible, nonDeductible: vatAgorot - deductible };
}

/**
 * The proposed journal entry for an expense invoice:
 *   Dr expense (amount before VAT + the part of the VAT that is not deductible)
 *   Dr input VAT (the deductible part)
 *   Cr supplier (the invoice total)
 * It is balanced only when total = amount before VAT + VAT.
 */
export function buildProposal({ amountBeforeVat, vatAmount, total, expenseAccount, vatAccount, supplierAccount }) {
  const before = amountBeforeVat ?? 0;
  const vat = vatAmount ?? 0;
  const tot = total ?? 0;
  const { deductible, nonDeductible } = splitVat(vat, expenseAccount?.vat_deduction);
  const lines = [];
  if (before + nonDeductible > 0) {
    lines.push({
      side: 'debit',
      account: expenseAccount || null,
      debit: before + nonDeductible,
      credit: 0,
      memo: nonDeductible > 0 ? 'כולל מע"מ שאינו מנוכה' : null,
    });
  }
  if (deductible > 0) {
    lines.push({ side: 'debit', account: vatAccount || null, debit: deductible, credit: 0, memo: null });
  }
  if (tot > 0) {
    lines.push({ side: 'credit', account: supplierAccount || null, debit: 0, credit: tot, memo: null });
  }
  const debits = lines.reduce((s, l) => s + l.debit, 0);
  const credits = lines.reduce((s, l) => s + l.credit, 0);
  return {
    lines,
    debits,
    credits,
    balanced: debits === credits && debits > 0,
    vatDeductible: deductible,
    vatNonDeductible: nonDeductible,
  };
}

/**
 * Flags shown before approval. `blocking` flags stop the approval.
 * ctx: { duplicates: [{id, status}], supplierKnown: bool }
 */
export function computeFlags(doc, ctx = {}) {
  const flags = [];
  const add = (code, level, message) => flags.push({ code, level, message });

  if (doc.extraction_error) add('extraction_failed', 'info', `הקריאה האוטומטית לא הצליחה: ${doc.extraction_error}`);

  const missing = [];
  if (!doc.supplier_name) missing.push('שם הספק');
  if (!doc.supplier_vat_id) missing.push('מספר עוסק');
  if (!doc.doc_type) missing.push('סוג המסמך');
  if (!doc.doc_number) missing.push('מספר המסמך');
  if (!doc.doc_date) missing.push('תאריך');
  if (doc.amount_before_vat == null) missing.push('סכום לפני מע"מ');
  if (doc.vat_amount == null) missing.push('מע"מ');
  if (doc.total == null) missing.push('סה"כ');
  if (missing.length) add('missing_fields', 'blocking', `חסרים פרטים: ${missing.join(', ')}`);

  if (doc.doc_date && !isValidDate(doc.doc_date)) add('bad_date', 'blocking', 'התאריך אינו תקין');

  if (doc.doc_type && !POSTABLE_DOC_TYPES.includes(doc.doc_type)) {
    add('not_postable', 'blocking', `לא לרישום: ${DOC_TYPES[doc.doc_type] || doc.doc_type}. נרשמות רק חשבונית מס וחשבונית מס קבלה`);
  }

  const dups = ctx.duplicates || [];
  if (dups.length) {
    const posted = dups.filter((d) => d.status === 'posted');
    const ids = dups.map((d) => `#${d.id}`).join(', ');
    if (posted.length) add('duplicate', 'blocking', `חשבונית כפולה: אותו ספק ואותו מספר כבר נרשמו (מסמך ${ids})`);
    else add('duplicate', 'warning', `חשבונית כפולה: אותו ספק ואותו מספר ממתינים גם במסמך ${ids}`);
  }

  if (doc.amount_before_vat != null && doc.vat_amount != null && doc.total != null) {
    const diff = doc.total - (doc.amount_before_vat + doc.vat_amount);
    if (diff !== 0) {
      add('total_mismatch', 'blocking', `הסה"כ שונה מהסכום ועוד המע"מ בהפרש של ${(Math.abs(diff) / 100).toFixed(2)} ש"ח`);
    }
  }

  if (doc.amount_before_vat != null && doc.vat_amount != null && doc.amount_before_vat > 0) {
    const expected = Math.round(doc.amount_before_vat * VAT_RATE);
    if (Math.abs(expected - doc.vat_amount) > 5) {
      add('vat_rate', 'warning', `המע"מ אינו 18% מהסכום (צפוי ${(expected / 100).toFixed(2)} ש"ח)`);
    }
  }

  const postable = !doc.doc_type || POSTABLE_DOC_TYPES.includes(doc.doc_type);
  if (postable && doc.amount_before_vat != null && doc.doc_date) {
    const threshold = allocationThreshold(doc.doc_date);
    if (doc.amount_before_vat > threshold && !String(doc.allocation_number || '').trim()) {
      add('allocation_missing', 'warning', `מספר הקצאה חסר: הסכום לפני מע"מ מעל ${(threshold / 100).toLocaleString('he-IL')} ש"ח`);
    }
  }

  if (doc.supplier_vat_id && !isValidIsraeliId(doc.supplier_vat_id)) {
    add('vat_id_invalid', 'warning', 'מספר העוסק אינו תקין (ספרת ביקורת)');
  }

  if (doc.currency && doc.currency !== 'ILS') add('currency', 'warning', `המסמך במטבע ${doc.currency}`);

  if (doc.supplier_vat_id && ctx.supplierKnown === false) {
    add('new_supplier', 'info', 'ספק חדש: הסעיף הוא הצעה ויש לבדוק אותו');
  }

  return flags;
}

export const hasBlocking = (flags) => flags.some((f) => f.level === 'blocking');
