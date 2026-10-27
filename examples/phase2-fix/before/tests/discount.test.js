"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { applyDiscount, MAX_DISCOUNT } = require("../src/discount");

test("rejects a negative total", () => {
  assert.throws(() => applyDiscount(-1, 0.1), TypeError);
});

test("never discounts more than MAX_DISCOUNT", () => {
  // Fails before the fix: a rate of 0.9 is applied in full.
  assert.equal(applyDiscount(100, 0.9), 70);
});

test("applies a rate below the cap unchanged", () => {
  assert.equal(applyDiscount(200, MAX_DISCOUNT), 140);
});