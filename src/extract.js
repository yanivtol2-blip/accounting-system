import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { DOC_TYPES } from './rules.js';

export const SUPPORTED_FOR_READING = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class ExtractionError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'supplier_name', 'supplier_vat_id', 'doc_type', 'doc_number', 'doc_date', 'amount_before_vat',
    'vat_amount', 'total', 'allocation_number', 'currency', 'suggested_account_code',
  ],
  properties: {
    supplier_name: nullable('string'),
    supplier_vat_id: nullable('string'),
    doc_type: { type: 'string', enum: Object.keys(DOC_TYPES) },
    doc_number: nullable('string'),
    doc_date: nullable('string'),
    amount_before_vat: nullable('number'),
    vat_amount: nullable('number'),
    total: nullable('number'),
    allocation_number: nullable('string'),
    currency: { type: 'string' },
    suggested_account_code: nullable('string'),
  },
};

const SYSTEM = `You read Israeli expense invoices for a bookkeeping office and return their fields as JSON.
The document belongs to the client (the buyer). Read the SELLER's details, never the buyer's.

Fields:
- supplier_name: the seller's business name as printed.
- supplier_vat_id: the seller's ח.פ. / ע.מ. / עוסק מורשה number, digits only.
- doc_type: tax_invoice = "חשבונית מס"; tax_invoice_receipt = "חשבונית מס קבלה" (or "חשבונית מס/קבלה");
  receipt = "קבלה" alone; transaction_invoice = "חשבון עסקה" or "דרישת תשלום"; credit_note = "חשבונית זיכוי";
  quote_or_order = "הצעת מחיר", "הזמנה", "proforma"; other = anything else. A copy marked "העתק" keeps its type.
- doc_number: the document's own number (not the allocation number, not an order number).
- doc_date: the issue date as YYYY-MM-DD. Israeli dates are written day/month/year.
- amount_before_vat, vat_amount, total: in the document's currency, numbers without separators.
  amount_before_vat is the total before VAT including any VAT-exempt lines; total is the amount to pay including VAT.
  Read them exactly as printed; do not fix or recompute a document that does not add up.
- allocation_number: "מספר הקצאה" / "מספר אישור" from the Tax Authority, usually 9 digits, or null if absent.
- currency: ISO code, "ILS" for shekels.
- suggested_account_code: the code from the chart of accounts below that best fits what was bought, or null.
Use null for any field that is not on the document or cannot be read with confidence. Never guess a number.`;

let client = null;
function getClient() {
  if (!config.anthropicApiKey) {
    throw new ExtractionError('הקריאה האוטומטית לא מוגדרת (חסר ANTHROPIC_API_KEY)', { retryable: false });
  }
  client ||= new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2, timeout: 90_000 });
  return client;
}

/**
 * Reads one invoice (PDF or image) and returns the raw fields in shekels.
 * accounts: [{code, name}] of the client's expense and asset accounts.
 */
export async function extractInvoice({ filePath, mime, accounts }) {
  if (!SUPPORTED_FOR_READING.includes(mime)) {
    throw new ExtractionError(`סוג הקובץ ${mime} לא נתמך לקריאה. יש להעלות PDF או צילום JPG/PNG`, { retryable: false });
  }
  const data = fs.readFileSync(filePath).toString('base64');
  const fileBlock =
    mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data } };
  const chart = accounts.map((a) => `${a.code} ${a.name}`).join('\n');

  let response;
  try {
    response = await getClient().beta.messages.create({
      model: config.extractionModel,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: config.extractionEffort, format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: `Chart of accounts (code name):\n${chart}\n\nRead this document.` }],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ExtractionError('מפתח הקריאה האוטומטית נדחה', { retryable: false });
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new ExtractionError(`הקובץ לא התקבל לקריאה: ${err.message}`, { retryable: false });
    }
    throw new ExtractionError(`שירות הקריאה לא זמין כרגע: ${err.message}`);
  }

  if (response.stop_reason === 'refusal') throw new ExtractionError('שירות הקריאה סירב לקרוא את המסמך', { retryable: false });
  if (response.stop_reason === 'max_tokens') throw new ExtractionError('התשובה נקטעה');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new ExtractionError('התשובה לא הייתה בפורמט הצפוי');
  }
}
