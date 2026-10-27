"use strict";

/**
 * Applies a discount to a total.
 *
 * BUG (before the fix): the rate is never clamped to MAX_DISCOUNT, so a caller
 * can discount almost the whole price.
 */
const MAX_DISCOUNT = 0.3;

function applyDiscount(total, rate) {
  if (!Number.isFinite(total) || total < 0) {
    throw new TypeError("total must be a non-negative number");
  }

  const discount = total * rate;
  return Math.round((total - discount) * 100) / 100;
}

module.exports = { applyDiscount, MAX_DISCOUNT };