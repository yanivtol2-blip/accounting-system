import assert from 'node:assert/strict';
import test from 'node:test';
import { allocationThreshold, buildProposal, computeFlags, hasBlocking, isValidIsraeliId, normalizeDocNumber, splitVat } from '../src/rules.js';

const doc = (over = {}) => ({
  supplier_name: 'ספק', supplier_vat_id: '520031931', doc_type: 'tax_invoice', doc_number: '100', doc_date: '2026-09-01',
  amount_before_vat: 100000, vat_amount: 18000, total: 118000, allocation_number: null, currency: 'ILS', ...over,
});
const codes = (flags) => flags.map((f) => f.code);

test('VAT deduction share: full, 2/3, 1/4', () => {
  assert.deepEqual(splitVat(18000, 'full'), { deductible: 18000, nonDeductible: 0 });
  assert.deepEqual(splitVat(6102, 'two_thirds'), { deductible: 4068, nonDeductible: 2034 });
  assert.deepEqual(splitVat(1800, 'quarter'), { deductible: 450, nonDeductible: 1350 });
});

test('the proposal is balanced and the non-deductible VAT goes to the expense', () => {
  const p = buildProposal({
    amountBeforeVat: 33898, vatAmount: 6102, total: 40000,
    expenseAccount: { id: 1, vat_deduction: 'two_thirds' }, vatAccount: { id: 2 }, supplierAccount: { id: 3 },
  });
  assert.equal(p.balanced, true);
  assert.deepEqual(p.lines.map((l) => [l.debit, l.credit]), [[35932, 0], [4068, 0], [0, 40000]]);
});

test('allocation number threshold: 10,000 until 31.5.2026, 5,000 from 1.6.2026', () => {
  assert.equal(allocationThreshold('2026-05-31'), 1000000);
  assert.equal(allocationThreshold('2026-06-01'), 500000);
  assert.ok(codes(computeFlags(doc({ amount_before_vat: 600000, vat_amount: 108000, total: 708000 }))).includes('allocation_missing'));
  assert.ok(!codes(computeFlags(doc({ doc_date: '2026-05-20', amount_before_vat: 600000, vat_amount: 108000, total: 708000 }))).includes('allocation_missing'));
  assert.ok(!codes(computeFlags(doc({ amount_before_vat: 600000, vat_amount: 108000, total: 708000, allocation_number: '123456789' }))).includes('allocation_missing'));
  assert.ok(!codes(computeFlags(doc({ amount_before_vat: 500000, vat_amount: 90000, total: 590000 }))).includes('allocation_missing'));
});

test('a total that is not amount + VAT blocks the approval', () => {
  const flags = computeFlags(doc({ total: 117000 }));
  assert.ok(codes(flags).includes('total_mismatch'));
  assert.ok(hasBlocking(flags));
});

test('only a tax invoice and a tax invoice receipt are posted', () => {
  assert.ok(!hasBlocking(computeFlags(doc({ doc_type: 'tax_invoice_receipt' }))));
  for (const type of ['receipt', 'transaction_invoice', 'credit_note', 'other']) {
    assert.ok(codes(computeFlags(doc({ doc_type: type }))).includes('not_postable'), type);
  }
});

test('a duplicate already posted blocks, one still waiting warns', () => {
  const posted = computeFlags(doc(), { duplicates: [{ id: 1, status: 'posted' }] }).find((f) => f.code === 'duplicate');
  const waiting = computeFlags(doc(), { duplicates: [{ id: 1, status: 'pending_review' }] }).find((f) => f.code === 'duplicate');
  assert.equal(posted.level, 'blocking');
  assert.equal(waiting.level, 'warning');
});

test('document numbers and VAT ids are compared in a normal form', () => {
  assert.equal(normalizeDocNumber('084-512 007'), normalizeDocNumber('84512007'));
  assert.equal(isValidIsraeliId('520031931'), true);
  assert.equal(isValidIsraeliId('520031932'), false);
});
