// sample trading engine for use with no4s/fit.js

import { STOCK_PORT, load_static_stock_data } from "stock/no4s/common.js";

// take no action until we have accumulated this much confidence on dll1
const DLL1_THRESH = 6;
// liquidate if confidence below this
const LIQUIDATION_SHARPE_THRESH = 1;
// don't acquire unless confidence greater than this
const ACQUISITION_SHARPE_THRESH = 4;
// risk lambda for score calculation
const LAMBDA = 1;

function trading_capital(ns) {
	let balance = ns.getServerMoneyAvailable("home");
	// start trading at $10M
	if (balance > 1e7) return balance;
}

function tick(ns, stocks, S) {
	if (S.dll1 > DLL1_THRESH) {
		/***************************
		  * LIQUIDATION, and calculation of acquisition scores
		 */
		let targets = {};
		for (let ticker in stocks) {
			let [long, , short, ] = ns.stock.getPosition(ticker), 
				f = S.S[ticker].f, 
				sharpe = (f - .5) / S.S[ticker].se_f, 
				mv = stocks[ticker].vol / 10000;
			if (long && !(sharpe > LIQUIDATION_SHARPE_THRESH)) {
				ns.stock.sellStock(ticker, 1 / 0);
				ns.print(`SLD ${long} ${ticker}`);
			}
			if (short && !(sharpe < -LIQUIDATION_SHARPE_THRESH)) {
				ns.stock.sellShort(ticker, 1 / 0);
				ns.print(`SLD SHORT ${short} ${ticker}`);
			}

			if (Math.abs(sharpe) > ACQUISITION_SHARPE_THRESH) {
				let E = Math.pow(f + f * mv / 2 + (1 - f) * (mv > 0 ? Math.log(1 + mv) / mv : 1), S.ttf),
					E2 = Math.pow(f / 3 * (3 + mv * (3 + mv)) + (1 - f) / (1 + mv), S.ttf),
					ret75 = E - 1,
					cost = 2 * stocks[ticker].s / 1000,					
					sd75 = Math.sqrt(E2 - E * E),
					score = Math.abs(ret75) - cost - LAMBDA * sd75;
				if (score > 0)
					targets[ticker] = { ret75, sd75, cost, score };
			}
		}

		/*************************
		 * ACQUISITION
		 */
		for (let ticker of Object.keys(targets).sort((a, b) => targets[b].score - targets[a].score)) {
			ns.print(`${ticker}: score=${targets[ticker].score} ret75=${targets[ticker].ret75} cost=${targets[ticker].cost} sd75=${targets[ticker].sd75}`);
			let capital = trading_capital(ns);

			if (S.S[ticker].f > .5) {
				let ap = S.S[ticker].p * (1 + stocks[ticker].s / 1000), 
					pos = ns.stock.getPosition(ticker)[0],
					Q = Math.floor(Math.min(stocks[ticker].mp - pos, (capital - 1e5) / ap));
				if (Q > 0) {
					if (ns.stock.buyStock(ticker, Q))
						ns.print(`BOT ${Q} ${ticker}`);
					else
						ns.tprint(`ERROR: failed to buy ${Q} ${ticker} capital=${capital} ap=${ap}`);
				}
			} else {
				let bp = S.S[ticker].p * (1 - stocks[ticker].s / 1000), 
					pos = ns.stock.getPosition(ticker)[2],
					Q = Math.floor(Math.min(stocks[ticker].mp - pos, (capital - 1e5) / bp));
				if (Q > 0) {
					if (ns.stock.buyShort(ticker, Q))
						ns.print(`BOT SHORT ${Q} ${ticker}`);
					else
						ns.tprint(`ERROR: failed to buyShort ${Q} ${ticker} capital=${capital} bp=${bp}`);
				}
			}
		}
	} else {
		for (let ticker in stocks) {
			ns.stock.sellStock(ticker, 1 / 0);
			ns.stock.sellShort(ticker, 1 / 0);
		}
	}
}

/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");
	let stocks = load_static_stock_data(ns), S = {};
	while (true) {
		let str = ns.peek(STOCK_PORT);
		if (str !== "NULL PORT DATA") {
			let S2 = JSON.parse(str);
			if (S2.tick != S.tick) {
				S = S2;
				tick(ns, stocks, S);
			}
		}
		await ns.sleep(1000);
	}
}
