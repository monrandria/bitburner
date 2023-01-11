export const STOCK_PORT = 13;

// static data to be run once (per reset) and written to a file:
// - spread (* 1000)
// - max position
// - vol (*10000)
//     calibrating vol requires a tick to see a set of price changes

const STOCKS_FILE = "/d/stocks.txt";

async function get_static_stock_data(ns) {
	let ret = {}, p = {};
	for (let ticker of ns.stock.getSymbols()) {
		let p0 = p[ticker] = ns.stock.getPrice(ticker);
		ret[ticker] = {
			s : Math.round(1000 * (ns.stock.getAskPrice(ticker) / p0 - 1)),
			mp : ns.stock.getMaxShares(ticker),
		}
	}
	wait_tick:
	while (true) {
		await ns.sleep(1000);
		for (let ticker in ret)
			if (ns.stock.getPrice(ticker) !== p[ticker])
				break wait_tick;
	}
	// convert p to (absolute) returns
	for (let ticker in p) {
		let p0 = p[ticker], p1 = ns.stock.getPrice(ticker);
		p[ticker] = (p1 > p0) ? p1 / p0 - 1 : p0 / p1 - 1
	}
	// ECP vol is from 40..50 / 100
	next_draw:
	for (let i=40; i<=50; ++i) {
		let draw = p["ECP"]/(i / 10000);
		for (let ticker in p) {
			let vol = ret[ticker].vol = Math.round(p[ticker] * 10000 / draw);
			if (Math.abs(p[ticker] - draw * vol / 10000) > 1e-6)
			continue next_draw;
		}
		return ret;
	}
	throw "unable to calibrate vol";
}

export function load_static_stock_data(ns) {
	return JSON.parse(ns.read(STOCKS_FILE));
}

export async function write_static_stock_data(ns) {
	ns.write(STOCKS_FILE, JSON.stringify(await get_static_stock_data(ns)), "w");
}

/** @param {NS} ns */
export async function main(ns) {
	await write_static_stock_data(ns);
}
