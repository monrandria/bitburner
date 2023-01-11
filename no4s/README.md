# no4s
bitburner fitting without 4s access

common.js 
- STOCK_PORT (set to whatever)
- some (static) initialization that should be run before anything else

fit.js is the fitting daemon.  publishes to the configured STOCK_PORT.
-   tick: market tick counter
-   sync: where it thinks the market-cycle boundary ("flip") occurs
-   ttf: ticks-to-flip.  how many ticks remaining until the next flip.
-   dll0: confidence value on sync being precisely the correct tick.  should be roughly chi-squared distribution
-   dll1: confidence value on sync being +/- 1 tick.
-   a table of tickers:
-     p: price
-     f: forecast estimate
-     se_f: standard error on the forecast

internally, fit.js: a) fits the global "sync" and b) has a bayesian estimate of the individual ticker forecasts.
the "sync" is first fit after 149 ticks (15m) and every 75 ticks thereafter (7.5m).  once it reaches a critical
threshold on the sync (dll0) it stops fitting sync and only updates the ticker forecasts.

trade.js is a sample trading daemon.
  - It waits until dll1 reaches some threshold before trading (presently set to 6).
  -   This takes a random amount of time, but generally seems to be ~40m after fit.js is started.
  - It liquidates when individual forecasts are unclear in their direction: usually this happens right before the "flip"
  - For acquisition, it requires that it has a strong confidence in the directionality of the forecast (4 std-dev confident),
  -   computes a "score" incorporating estimated return, cost, and risk

watch.js watches the performance.
  - Keeps an EMA on total return.  
  -   Generally seems to be around ~0.15% / tick (~2.5x / hr)
  -   This obviously varies widely (portfolio size, market manipulation, ...)
  - If 4S data is available, prints the forecast-estimates and actual estimates side-by-side for comparison
