# Imperial Toolkit

Community-built calculators for [Imperial](https://imperial.trade) (Solana perps). Built from public pages only.
**Not affiliated with Imperial.**

- **Points + fees**: exact 0.01% open/close fee, optional builder fee (up to 0.10%), weekly 250x open-interest volume cap. No points estimate: Imperial has not published a conversion.
- **Liquidation + funding**: live data from Imperial's public API. Liquidation price is an estimate; funding cost assumes today's rate holds.

Live: https://imperial-tools.sites.tab.bot/

## Run
Static site in `site/` (open `site/index.html` or deploy with Vercel, root directory `site`). Tests: `node test/calc.test.js`.

by @iamlogtun
