/* Points + fee maths. Pure functions, no DOM. Every constant cites Imperial's public docs. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImperialCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // docs.imperial.space/trading/fees: "Trading fee 0.01% (1 bp) of notional, on open and on close"
  var TRADING_FEE_RATE = 0.0001;
  // docs.imperial.space/trading/fees: builder fee "up to 0.10%", only via a third-party app that sets one
  var BUILDER_FEE_MAX_RATE = 0.001;
  // docs.imperial.space/rewards/points: weekly pools
  var WEEKLY_TRADING_POOL = 15000;
  var WEEKLY_REFERRAL_POOL = 5000;
  // docs.imperial.space/rewards/points: "Eligible volume is capped at 250x your average open interest"
  var VOLUME_CAP_MULTIPLE_OF_OI = 250;

  function num(v, name) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) throw new Error(name + ' must be a number');
    return n;
  }

  // inputs: { notional (USD, opening fill), exitNotional (USD, closing fill; defaults to notional),
  //           roundTripsPerWeek (count), avgOpenInterest (USD, optional) }
  function feeBreakdown(input) {
    var notional = num(input.notional, 'Trade size');
    if (notional <= 0) throw new Error('Trade size must be above 0');
    var exitNotional = input.exitNotional == null || input.exitNotional === '' ? notional : num(input.exitNotional, 'Exit size');
    if (exitNotional <= 0) throw new Error('Exit size must be above 0');
    var trips = input.roundTripsPerWeek == null || input.roundTripsPerWeek === '' ? 1 : num(input.roundTripsPerWeek, 'Round trips');
    if (trips < 0 || Math.floor(trips) !== trips) throw new Error('Round trips per week must be a whole number, 0 or more');

    var openFee = notional * TRADING_FEE_RATE;
    var closeFee = exitNotional * TRADING_FEE_RATE;
    var roundTrip = openFee + closeFee;
    // Volume per round trip: the open fill and the close fill (assumption, stated in the UI).
    var weeklyVolume = trips * (notional + exitNotional);
    var out = {
      openFee: openFee,
      closeFee: closeFee,
      roundTrip: roundTrip,
      builderFeeMaxPerFill: notional * BUILDER_FEE_MAX_RATE,
      roundTripsPerWeek: trips,
      weeklyVolume: weeklyVolume,
      weeklyFees: trips * roundTrip,
      eligibleVolumeCap: null,
      eligibleVolume: null
    };
    if (input.avgOpenInterest != null && input.avgOpenInterest !== '') {
      var oi = num(input.avgOpenInterest, 'Average open interest');
      if (oi < 0) throw new Error('Average open interest cannot be negative');
      out.eligibleVolumeCap = VOLUME_CAP_MULTIPLE_OF_OI * oi;
      out.eligibleVolume = Math.min(weeklyVolume, out.eligibleVolumeCap);
    }
    return out;
  }

  return {
    TRADING_FEE_RATE: TRADING_FEE_RATE,
    BUILDER_FEE_MAX_RATE: BUILDER_FEE_MAX_RATE,
    WEEKLY_TRADING_POOL: WEEKLY_TRADING_POOL,
    WEEKLY_REFERRAL_POOL: WEEKLY_REFERRAL_POOL,
    VOLUME_CAP_MULTIPLE_OF_OI: VOLUME_CAP_MULTIPLE_OF_OI,
    feeBreakdown: feeBreakdown
  };
});
