// The ready-made chart of accounts every new client file starts with.
// Each file gets its own copy and can edit it. Supplier cards are created
// automatically (codes 21001 onwards) when a supplier's first invoice is approved.
export const VAT_INPUT_CODE = '1500';
export const SUPPLIER_CODE_BASE = 21000;

export const CHART_TEMPLATE = [
  { code: '1500', name: 'מע"מ תשומות', type: 'vat_input' },
  { code: '1700', name: 'ציוד, מחשבים וריהוט', type: 'asset' },
  { code: '6010', name: 'קניות סחורה וחומרים', type: 'expense' },
  { code: '6020', name: 'קבלני משנה', type: 'expense' },
  { code: '6100', name: 'שכר דירה', type: 'expense' },
  { code: '6110', name: 'חשמל', type: 'expense' },
  { code: '6120', name: 'מים וארנונה', type: 'expense' },
  { code: '6130', name: 'אחזקה ותיקונים', type: 'expense' },
  { code: '6200', name: 'טלפון נייד', type: 'expense', vat_deduction: 'two_thirds' },
  { code: '6210', name: 'טלפון קווי ואינטרנט', type: 'expense', vat_deduction: 'two_thirds' },
  { code: '6300', name: 'דלק', type: 'expense', vat_deduction: 'two_thirds' },
  { code: '6310', name: 'אחזקת רכב', type: 'expense', vat_deduction: 'two_thirds' },
  { code: '6320', name: 'חניה וכבישי אגרה', type: 'expense', vat_deduction: 'two_thirds' },
  { code: '6400', name: 'שירותים מקצועיים', type: 'expense' },
  { code: '6410', name: 'פרסום ושיווק', type: 'expense' },
  { code: '6420', name: 'תוכנה, אחסון ומנויים', type: 'expense' },
  { code: '6430', name: 'ציוד משרדי מתכלה ודפוס', type: 'expense' },
  { code: '6440', name: 'כיבוד למשרד', type: 'expense' },
  { code: '6450', name: 'אירוח ומתנות', type: 'expense', vat_deduction: 'none' },
  { code: '6460', name: 'נסיעות ותחבורה ציבורית', type: 'expense' },
  { code: '6470', name: 'השתלמויות וספרות מקצועית', type: 'expense' },
  { code: '6480', name: 'ביטוחים', type: 'expense' },
  { code: '6490', name: 'עמלות בנק וסליקה', type: 'expense' },
  { code: '6900', name: 'הוצאות שונות', type: 'expense' },
];

export const ACCOUNT_TYPES = {
  expense: 'הוצאה',
  asset: 'רכוש קבוע',
  vat_input: 'מע"מ תשומות',
  supplier: 'ספק',
  liability: 'התחייבות',
};
