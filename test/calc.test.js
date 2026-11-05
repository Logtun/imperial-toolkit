const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calc = require('../site/calc.js');
const risk = require('../site/risk.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);

test('fees match Imperial docs table (1 bp open and close)', () => {
  // docs.imperial.space/trading/fees "What 1 bp costs": $10k -> $1 open, $2 round trip; $100k -> $10, $20; $1m -> $100, $200
  for (const [size, open, rt] of [[10000, 1, 2], [100000, 10, 20], [1000000, 100, 200]]) {
    const r = calc.feeBreakdown({ notional: size });
    close(r.openFee, open); close(r.roundTrip, rt);
  }
});

test('asymmetric exit size is charged on exit notional', () => {
  const r = calc.feeBreakdown({ notional: 50000, exitNotional: 80000 });
  close(r.openFee, 5); close(r.closeFee, 8); close(r.roundTrip, 13);
});

test('weekly fees scale with round trips', () => {
  const r = calc.feeBreakdown({ notional: 10000, roundTripsPerWeek: 5 });
  close(r.weeklyFees, 10);
  close(r.weeklyVolume, 5 * 20000);
});

test('eligible volume is capped at 250x average open interest', () => {
  const capped = calc.feeBreakdown({ notional: 100000, roundTripsPerWeek: 10, avgOpenInterest: 1000 });
  close(capped.eligibleVolumeCap, 250000);
  close(capped.eligibleVolume, 250000);            // weekly volume 2,000,000 capped
  const under = calc.feeBreakdown({ notional: 1000, roundTripsPerWeek: 2, avgOpenInterest: 1000000 });
  close(under.eligibleVolume, under.weeklyVolume); // 4,000 < cap
  const none = calc.feeBreakdown({ notional: 1000 });
  assert.equal(none.eligibleVolumeCap, null);       // no OI given: no cap shown
});

test('builder fee maximum is 0.10% per fill and is never added to fees', () => {
  const r = calc.feeBreakdown({ notional: 100000 });
  close(r.builderFeeMaxPerFill, 100);
  close(r.roundTrip, 20);
});

test('invalid input is refused, not guessed', () => {
  assert.throws(() => calc.feeBreakdown({ notional: 0 }));
  assert.throws(() => calc.feeBreakdown({ notional: 'abc' }));
  assert.throws(() => calc.feeBreakdown({ notional: 1000, roundTripsPerWeek: 1.5 }));
  assert.throws(() => calc.feeBreakdown({ notional: 1000, avgOpenInterest: -1 }));
});

test('approximate liquidation: 250x BTC long sits 0.2% below entry (docs: "about 0.2%")', () => {
  // 1/250 = 0.4%, minus 0.2% maintenance = 0.2% move
  const r = risk.approxLiquidationPrice({ side: 'long', entry: 80000, leverage: 250, mmr: 0.002 });
  close(r.price, 80000 * (1 - 0.002), 1e-6);
});

test('approximate liquidation: 10x long and short are mirror images around entry', () => {
  const L = risk.approxLiquidationPrice({ side: 'long', entry: 80000, leverage: 10, mmr: 0.002 });
  const S = risk.approxLiquidationPrice({ side: 'short', entry: 80000, leverage: 10, mmr: 0.002 });
  close(L.price, 80000 * 0.902, 1e-6);   // 1/10 - 0.002 = 0.098 move
  close(S.price, 80000 * 1.098, 1e-6);
  close(risk.distanceToLiquidationPct(80000, L.price), 9.8, 1e-6);
});

test('approximate liquidation: maintenance-rate sanity against docs rule of thumb', () => {
  // docs.imperial.space/trading/margin: liq ~ where the move equals initial margin minus maintenance margin
  const r = risk.approxLiquidationPrice({ side: 'long', entry: 100, leverage: 20, mmr: 0.03 });
  close(r.price, 100 * (1 - (0.05 - 0.03)), 1e-9); // 98
});

test('approximate liquidation refuses leverage that liquidates on entry', () => {
  const r = risk.approxLiquidationPrice({ side: 'long', entry: 100, leverage: 500, mmr: 0.002 });
  assert.equal(r.price, null);
  assert.match(r.reason, /too high/);
});

test('funding: positive rate, long pays; short receives (docs: longs pay shorts when positive)', () => {
  // docs example: $20,000 at +0.001%/h for 24 h = $4.80
  close(risk.fundingPaid({ side: 'long', notional: 20000, ratePerHourPct: 0.001, hours: 24 }), 4.8, 1e-9);
  close(risk.fundingPaid({ side: 'short', notional: 20000, ratePerHourPct: 0.001, hours: 24 }), -4.8, 1e-9);
});

test('funding: negative rate flips who pays', () => {
  close(risk.fundingPaid({ side: 'long', notional: 1000, ratePerHourPct: -0.002, hours: 8 }), -0.16, 1e-12);
});

test('funding periods are 8h, 24h, 7d', () => {
  assert.deepEqual(risk.FUNDING_PERIODS_H, { '8h': 8, '24h': 24, '7d': 168 });
});

test('the reference numbers in the page match the constants the maths uses', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.match(html, /0\.01%/);
  assert.match(html, /15,000/);
  assert.match(html, /5,000/);
  assert.match(html, /250x/);
  assert.match(html, /0\.05%/);
  assert.equal(calc.TRADING_FEE_RATE, 0.0001);
  assert.equal(calc.WEEKLY_TRADING_POOL, 15000);
  assert.equal(calc.WEEKLY_REFERRAL_POOL, 5000);
  assert.equal(calc.VOLUME_CAP_MULTIPLE_OF_OI, 250);
  assert.equal(risk.FUNDING_CAP_PER_HOUR_PCT, 0.05);
});

test('page carries the required footer and disclaimer, and no forbidden lines', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.ok(html.includes('by @iamlogtun · Not affiliated with Imperial · Built from public pages'));
  assert.ok(html.includes('Not financial advice. Check Imperial\'s own app before trading.'));
  for (const bad of ['Follow @iamlogtun', 'Unofficial', 'share button', 'share card', 'username']) {
    assert.ok(!new RegExp(bad, 'i').test(html), `forbidden text: ${bad}`);
  }
});
