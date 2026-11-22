'use strict';

var test = require('node:test').test;
var assert = require('node:assert/strict');

var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

function item(overrides) {
  return Object.assign({
    id: 1,
    sku: 'RICE-1',
    name: 'Rice',
    hsn: '1006',
    price: 1000,
    qty: 1
  }, overrides || {});
}

function orderFromPricing(items, coupon) {
  var totals = pricing.computeTotals(items, coupon);
  return {
    id: 1001,
    date: '22/11/2026',
    customer: 'Test customer',
    status: 'completed',
    paymentMode: 'cash',
    items: items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
}

test('CURRENT BEHAVIOUR: order pricing applies the HSN rate after the coupon discount', function () {
  var totals = pricing.computeTotals([item()], 'SAVE10');

  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.discount, 100);
  assert.equal(totals.taxable, 900);
  assert.equal(totals.tax, 45);
  assert.equal(totals.cgst, 22.5);
  assert.equal(totals.sgst, 22.5);
  assert.equal(totals.total, 945);
  assert.deepEqual(totals.lines[0], {
    id: 1,
    name: 'Rice',
    hsn: '1006',
    gstPercent: 5,
    gross: 1000,
    discount: 100,
    taxable: 900,
    tax: 45,
    net: 945
  });
});

test('invoice figures match the billed total, GST breakdown, and discounted line', function () {
  var items = [item({ price: 640 })];
  var placedOrder = orderFromPricing(items, 'SAVE10');
  var figures = invoice.computeInvoiceFigures(placedOrder);

  assert.equal(figures.subtotal, placedOrder.subtotal);
  assert.equal(figures.discount, placedOrder.discount);
  assert.equal(figures.tax, placedOrder.tax);
  assert.equal(figures.cgst + figures.sgst, placedOrder.tax);
  assert.equal(figures.total, placedOrder.total);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].discount, 64);
  assert.equal(figures.rows[0].taxable, 576);
  assert.equal(figures.rows[0].lineTax, 28.8);

  var html = invoice.render(placedOrder);
  assert.match(html, /<td>Taxable Value<\/td><td class="r">₹576\.00<\/td>/);
  assert.match(html, /<td>CGST<\/td><td class="r">₹14\.40<\/td>/);
  assert.match(html, /<td>SGST<\/td><td class="r">₹14\.40<\/td>/);
  assert.match(html, /<td class="r">₹604\.80<\/td>/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('CURRENT BEHAVIOUR: invoice uses the HSN rate and post-discount taxable line', function () {
  var placedOrder = orderFromPricing([item()], 'SAVE10');
  var figures = invoice.computeInvoiceFigures(placedOrder);

  assert.equal(placedOrder.total, 945);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].discount, 100);
  assert.equal(figures.rows[0].taxable, 900);
  assert.equal(figures.rows[0].lineTax, 45);
  assert.equal(figures.tax, 45);
  assert.equal(figures.cgst, 22.5);
  assert.equal(figures.sgst, 22.5);
  assert.equal(figures.discount, 100);
  assert.equal(figures.total, 945);
});

test('CURRENT BEHAVIOUR: invoice percentage coupon honors the order discount cap', function () {
  var placedOrder = orderFromPricing([item({ price: 3000 })], 'SAVE10');
  var figures = invoice.computeInvoiceFigures(placedOrder);

  assert.equal(placedOrder.discount, 150);
  assert.equal(placedOrder.tax, 142.5);
  assert.equal(placedOrder.total, 2992.5);
  assert.equal(figures.tax, 142.5);
  assert.equal(figures.discount, 150);
  assert.equal(figures.total, 2992.5);
});

test('CURRENT BEHAVIOUR: invoice ignores an inactive coupon as order pricing does', function () {
  var placedOrder = orderFromPricing([item()], 'DIWALI20');
  var figures = invoice.computeInvoiceFigures(placedOrder);

  assert.equal(placedOrder.discount, 0);
  assert.equal(placedOrder.tax, 50);
  assert.equal(placedOrder.total, 1050);
  assert.equal(figures.tax, 50);
  assert.equal(figures.discount, 0);
  assert.equal(figures.total, 1050);
});

test('CURRENT BEHAVIOUR: GST reconciliation matches invoice figures and excludes cancelled orders', function () {
  var placedOrder = orderFromPricing([item()], 'SAVE10');
  var result = reports.getGstReconciliation({
    orders: [placedOrder, Object.assign({}, placedOrder, { id: 1002, status: 'cancelled' })]
  });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].ledgerTax, 45);
  assert.equal(result.rows[0].invoiceTax, 45);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});
