// Money travels as shekels in the API (a number or a string such as "1,234.50")
// and is stored as integer agorot.

export function toAgorot(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }
  const cleaned = String(value).replace(/[₪,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function toShekels(agorot) {
  return agorot === null || agorot === undefined ? null : agorot / 100;
}

export function formatShekels(agorot) {
  if (agorot === null || agorot === undefined) return '';
  return (agorot / 100).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
