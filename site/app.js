/* Imperial Toolkit UI. Reads Imperial's public API (CORS open, no key). Never invents a figure:
   if the read fails, the page says so. */
(function () {
  'use strict';
  var API = 'https://api.imperial.trade/api/v1';
  var markets = [];
  var bySymbol = {};
  var phaseBySymbol = {};
  var readAt = null;
  var loadError = null;

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) {
    var abs = Math.abs(n);
    var s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '$') + s;
  };
  var price = function (n, dp) {
    if (!isFinite(n)) return '—';
    var d = typeof dp === 'number' ? dp : 2;
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  var pct = function (n, d) { return (isFinite(n) ? n.toFixed(d == null ? 2 : d) : '—') + '%'; };
  var utc = function (d) { return d.toISOString().slice(11, 19) + ' UTC'; };

  // ---- tabs ----
  var tabs = [$('tab-points'), $('tab-risk')];
  var panels = [$('panel-points'), $('panel-risk')];
  function show(i) {
    tabs.forEach(function (t, j) {
      t.setAttribute('aria-selected', j === i ? 'true' : 'false');
      t.tabIndex = j === i ? 0 : -1;
      panels[j].hidden = j !== i;
    });
    if (i === 0) tabs[0].focus(); else tabs[1].focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { show(i); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { show(i === 0 ? 1 : 0); }
    });
  });

  // ---- small DOM helpers (textContent only) ----
  function rowEl(label, value, note, cls) {
    var r = document.createElement('div');
    r.className = 'row' + (cls ? ' ' + cls : '');
    var l = document.createElement('div'); l.className = 'k'; l.textContent = label;
    var v = document.createElement('div'); v.className = 'v'; v.textContent = value;
    r.appendChild(l); r.appendChild(v);
    if (note) { var n = document.createElement('div'); n.className = 'n'; n.textContent = note; r.appendChild(n); }
    return r;
  }
  function card(title, rows, tag) {
    var c = document.createElement('div'); c.className = 'card result';
    var h = document.createElement('h3'); h.textContent = title; c.appendChild(h);
    if (tag) { var t = document.createElement('span'); t.className = 'tag'; t.textContent = tag; h.appendChild(t); }
    rows.forEach(function (r) { c.appendChild(r); });
    return c;
  }
  function errBox(msg) {
    var e = document.createElement('div'); e.className = 'card error'; e.setAttribute('role', 'alert');
    e.textContent = msg; return e;
  }
  function fill(el, nodes) { el.replaceChildren.apply(el, nodes); }

  // ---- points + fees ----
  function renderPoints() {
    var out = $('points-out');
    var notional = parseFloat($('p-notional').value);
    var exitRaw = $('p-exit').value;
    var trips = $('p-trips').value === '' ? 0 : parseFloat($('p-trips').value);
    var oi = $('p-oi').value;
    try {
      var r = ImperialCalc.feeBreakdown({
        notional: notional,
        exitNotional: exitRaw === '' ? null : parseFloat(exitRaw),
        roundTripsPerWeek: trips,
        avgOpenInterest: oi === '' ? null : parseFloat(oi)
      });
      var fees = card('Fees', [
        rowEl('Open fee', money(r.openFee), '0.01% of trade size (docs: trading/fees)'),
        rowEl('Close fee', money(r.closeFee), '0.01% of exit size'),
        rowEl('Round trip', money(r.roundTrip), 'open + close'),
        rowEl('Builder fee, max', money(r.builderFeeMaxPerFill) + ' per fill', 'Only via a third-party app that sets one. Not included above.')
      ], 'from Imperial’s fee table');
      var weekly = card('This week', [
        rowEl('Round trips', String(r.roundTripsPerWeek), null),
        rowEl('Fees for the week', money(r.weeklyFees), 'round trips × round trip'),
        rowEl('Trading volume', money(r.weeklyVolume), 'assumes each open and close counts (see note below)')
      ]);
      var cap;
      if (r.eligibleVolumeCap == null) {
        cap = rowEl('Eligible volume', 'add your open interest', 'Cap is 250x your average open interest (docs: rewards/points).');
      } else {
        cap = rowEl('Volume cap (250x avg open interest)', money(r.eligibleVolumeCap), null);
        weekly.appendChild(cap);
        weekly.appendChild(rowEl('Eligible volume this week', money(r.eligibleVolume), r.eligibleVolume < r.weeklyVolume ? 'capped: volume above the cap earns nothing extra' : 'under the cap'));
      }
      var pts = card('Points', [
        rowEl('Points estimate', 'not shown', 'Imperial hasn’t published how points convert from volume, or the week’s total volume. This tool won’t guess a rate.')
      ]);
      pts.appendChild(rowEl('Weekly pool', '15,000 trading · 5,000 referral', 'shared by share of volume (docs: rewards/points)'));
      fill(out, [fees, weekly, pts]);
    } catch (e) {
      fill(out, [errBox(e.message)]);
    }
  }

  // ---- liquidation + funding ----
  function findMarket(sym) {
    return bySymbol[(sym || '').trim().toUpperCase()] || null;
  }

  function renderRisk() {
    var out = $('risk-out');
    var sym = $('r-market').value;
    var m = findMarket(sym);
    var hint = $('r-maxhint');
    if (!m) {
      hint.textContent = loadError ? '' : '';
      fill(out, [errBox(loadError ? 'Market data unavailable right now, so no figures are shown.' : 'Pick a market from the list. "' + sym + '" isn’t one Imperial lists.')]);
      return;
    }
    var side = document.querySelector('input[name="side"]:checked').value;
    var mark = m.markPrice;
    var entryRaw = $('r-entry').value;
    var entry = entryRaw === '' ? mark : parseFloat(entryRaw);
    var size = parseFloat($('r-size').value);
    var lev = parseFloat($('r-lev').value);
    var maxLev = m.maxLeverage;
    hint.textContent = '(max ' + maxLev + 'x isolated on ' + m.symbol + ')';
    try {
      if (!(size > 0)) throw new Error('Position size must be above 0');
      if (!(lev >= 1)) throw new Error('Leverage must be at least 1x');
      if (lev > maxLev) throw new Error('Leverage is above ' + m.symbol + '’s isolated max of ' + maxLev + 'x (from Imperial’s market list)');
      var dp = m.priceDecimals;
      var liq = ImperialRisk.approxLiquidationPrice({ side: side, entry: entry, leverage: lev, mmr: m.mmr });
      var collateral = size / lev;
      var fundingPct = m.imperialFundingRate1hPct;
      var rateRows = [
        rowEl('Imperial funding now', (fundingPct >= 0 ? '+' : '') + fundingPct.toFixed(5) + '% per hour', fundingPct > 0 ? 'positive: longs pay shorts' : fundingPct < 0 ? 'negative: shorts pay longs' : 'zero: nobody pays')
      ];
      ['8h', '24h', '7d'].forEach(function (k) {
        var paid = ImperialRisk.fundingPaid({ side: side, notional: size, ratePerHourPct: fundingPct, hours: ImperialRisk.FUNDING_PERIODS_H[k] });
        var words = Math.abs(paid) < 0.005 ? '≈ $0.00' : (paid > 0 ? 'you pay ' : 'you receive ') + money(Math.abs(paid));
        rateRows.push(rowEl('Over ' + k, words, 'at today’s rate, on entry size'));
      });
      var phase = phaseBySymbol[m.symbol];
      var rows = [
        rowEl('Mark price', price(mark, dp), readAt ? 'live, read ' + utc(readAt) : null),
        rowEl('Entry used', price(entry, dp), entryRaw === '' ? 'current mark' : 'your entry'),
        rowEl('Collateral needed', money(collateral), 'size ÷ leverage (isolated)'),
        rowEl('Maintenance rate', pct(m.mmr * 100, 2), 'from Imperial’s market list; fixed when you open')
      ];
      if (liq.price == null) {
        rows.push(rowEl('Approx. liquidation price', 'n/a', liq.reason));
      } else {
        var dist = ImperialRisk.distanceToLiquidationPct(mark, liq.price);
        rows.push(rowEl('Approx. liquidation price', price(liq.price, dp), 'estimate · isolated margin · ignores fees and funding'));
        rows.push(rowEl('Distance from current mark', pct(dist, 2), 'move against you that liquidates it (estimate)'));
      }
      if (phase) rows.push(rowEl('Market status', phase.phase, phase.note));
      var risk = card('Position', rows, 'estimate');
      var funding = card('Funding', rateRows, 'live rate');
      fill(out, [risk, funding]);
    } catch (e) {
      fill(out, [errBox(e.message)]);
    }
  }

  // ---- data load ----
  function getJSON(path) {
    return fetch(API + path, { headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function load() {
    $('live-line').textContent = 'Loading Imperial’s market data…';
    Promise.all([getJSON('/armada/markets'), getJSON('/armada/status').catch(function () { return null; })])
      .then(function (res) {
        var list = res[0];
        if (!Array.isArray(list) || !list.length) throw new Error('empty market list');
        markets = list;
        bySymbol = {};
        var dl = $('markets'); dl.replaceChildren();
        list.slice().sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; }).forEach(function (m) {
          bySymbol[m.symbol.toUpperCase()] = m;
          var o = document.createElement('option'); o.value = m.symbol; dl.appendChild(o);
        });
        phaseBySymbol = {};
        var st = res[1];
        if (st && Array.isArray(st.markets)) st.markets.forEach(function (x) {
          phaseBySymbol[x.market] = { phase: x.phase, note: x.hedgeVenue ? 'hedge venue: ' + x.hedgeVenue : 'from Imperial’s status feed' };
        });
        readAt = new Date(); loadError = null;
        $('live-line').textContent = 'Live from Imperial’s API, read ' + utc(readAt) + ' · ' + list.length + ' markets';
        renderRisk();
      })
      .catch(function (e) {
        loadError = e.message || 'error';
        $('live-line').replaceChildren();
        var t = document.createElement('span'); t.textContent = 'Couldn’t reach Imperial’s market data just now (' + loadError + '). No figures are shown from old data. ';
        var b = document.createElement('button'); b.type = 'button'; b.className = 'retry'; b.textContent = 'Try again';
        b.addEventListener('click', load);
        $('live-line').appendChild(t); $('live-line').appendChild(b);
        renderRisk();
      });
  }

  // ---- wiring ----
  $('points-form').addEventListener('input', renderPoints);
  $('points-form').addEventListener('submit', function (e) { e.preventDefault(); renderPoints(); });
  $('risk-form').addEventListener('input', renderRisk);
  $('risk-form').addEventListener('submit', function (e) { e.preventDefault(); renderRisk(); });
  renderPoints();
  load();
})();
