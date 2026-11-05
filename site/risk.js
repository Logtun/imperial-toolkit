/* Liquidation + funding maths. Pure functions, no DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImperialRisk = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // docs.imperial.space/trading/funding-rates: "The rate can't exceed 0.05% per hour in either direction."
  var FUNDING_CAP_PER_HOUR_PCT = 0.05;
  // Periods the UI shows (hours).
  var FUNDING_PERIODS_H = { '8h': 8, '24h': 24, '7d': 168 };

  // Approximate liquidation price, isolated margin.
  // Basis (docs.imperial.space/trading/liquidation and /trading/margin): a position is liquidated when
  // equity (collateral + unrealised PnL at mark - funding owed) falls below maintenance margin, which is
  // the market's maintenance rate times notional. This estimate uses entry notional, and ignores fees
  // and funding, so the real trigger sits a little closer to entry.
  //   long:  liq = entry * (1 - (1/L - mmr))
  //   short: liq = entry * (1 + (1/L - mmr))
  // inputs: { side: 'long'|'short', entry, leverage (L), mmr (fraction, e.g. 0.002) }
  function approxLiquidationPrice(i) {
    var entry = Number(i.entry), L = Number(i.leverage), mmr = Number(i.mmr);
    if (!(entry > 0)) throw new Error('Entry price must be above 0');
    if (!(L >= 1)) throw new Error('Leverage must be at least 1x');
    if (!(mmr >= 0)) throw new Error('Maintenance rate missing');
    var move = 1 / L - mmr;
    if (move <= 0) return { price: null, reason: 'Leverage is too high for this market\'s maintenance rate: it would liquidate on entry.' };
    var price = i.side === 'short' ? entry * (1 + move) : entry * (1 - move);
    return { price: price, reason: null };
  }

  // Distance from the current mark to the liquidation price, in % of mark.
  function distanceToLiquidationPct(mark, liq) {
    return Math.abs(mark - liq) / mark * 100;
  }

  // Funding cost over `hours`. Returns the amount YOU pay (negative = you receive).
  // docs.imperial.space/trading/funding-rates: positive rate => longs pay shorts; charged on entry notional.
  // inputs: { side, notional (USD), ratePerHourPct (percent per hour, signed), hours }
  function fundingPaid(i) {
    var n = Number(i.notional), r = Number(i.ratePerHourPct), h = Number(i.hours);
    var paidIfLong = n * (r / 100) * h;
    return i.side === 'short' ? -paidIfLong : paidIfLong;
  }

  return {
    FUNDING_CAP_PER_HOUR_PCT: FUNDING_CAP_PER_HOUR_PCT,
    FUNDING_PERIODS_H: FUNDING_PERIODS_H,
    approxLiquidationPrice: approxLiquidationPrice,
    distanceToLiquidationPct: distanceToLiquidationPct,
    fundingPaid: fundingPaid
  };
});
