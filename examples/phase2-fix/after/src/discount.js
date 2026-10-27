"use strict";

/**
 * Applies a discount to a total.
 *
 * Fixed: the rate is clamped to the [0, MAX_DISCOUNT] range before it is used.
 */
const MAX_DISCOUNT = 0.3;

function applyDiscount(total, rate) {
  if (!Number.isFinite(total) || total < 0) {
    throw new TypeError("total must be a non-negative number");
  }

  const safeRate = Math.min(Math.max(rate, 0), MAX_DISCOUNT);
  const discount = total * safeRate;
  return Math.round((total - discount) * 100) / 100;
}

module.exports = { applyDiscount, MAX_DISCOUNT };