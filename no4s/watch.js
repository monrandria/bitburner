// small subscriber to no4s/fit.js,
// monitors forecasts (if we have 4s data prints side-by-side comparison)
// and trading performance of no4s/trade.js

import { STOCK_PORT, load_static_stock_data } from "stock/no4s/common.js";

// 300 ticks (30m) half-life
const WEIGHT = 1 - 1 / (1800/6);

function format_num(val) {
	if (val > 1e15) return (val/1e15).toPrecision(3) + "q";
	else if (val > 1e12) return (val/1e12).toPrecision(3) + "t";
	else if (val > 1e9) return (val/1e9).toPrecision(3) + "b";
	else if (val > 1e6) return (val/1e6).toPrecision(3) + "m";
	else if (val > 1e3) return (val/1e3).toPrecision(3) + "k";
	else if (val > 0) return val.toFixed();
	else return "";
}

/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");

	let data = {}, stocks = load_static_stock_data(ns);
	let lv, wret = 0, wret2 = 0, w = 0;
	while (true) {
		let str = ns.peek(STOCK_PORT);
		if (str != "NULL PORT DATA") {
			let data2 = JSON.parse(str);
			if (data2.tick != data.tick) {
				data = data2;

				let lv1 = ns.getServerMoneyAvailable("home"), 
					sorted = Object.keys(data.S),
					has_4s = false;
				try {
					ns.stock.getForecast("ECP");
					has_4s = true;
				} catch { }

				if (has_4s) {
					for (let ticker of sorted)
						data.S[ticker].f2 = ns.stock.getForecast(ticker);
					sorted.sort((a,b) => data.S[b].f2 - data.S[a].f2);
				} else
					sorted.sort((a,b) => data.S[b].f - data.S[a].f);
				for (let ticker of sorted) {
					let { f, se_f, p } = data.S[ticker],
						bp = p * (1 - stocks[ticker].s / 1000), 
						ap = p * (1 + stocks[ticker].s / 1000), 
						Q = ns.stock.getPosition(ticker), 
						lv = 0;
					if (Q[0]) lv += Q[0] * bp - 1e5;
					if (Q[2]) lv += Q[2] * (2 * Q[3] - ap) - 1e5;
					lv1 += lv;
					if (has_4s) {
						let f2 = data.S[ticker].f2, 
							err = (f - f2) / se_f;
						ns.printf("%5s: %.1f%% (%.1f%%)\t%10s\t%.1f%%\t%.2f", ticker, 100*f, 100*se_f, format_num(lv), 100*f2, err);
					} else {
						ns.printf("%5s: %.1f%% (%.1f%%)\t%10s", ticker, 100*f, 100*se_f, format_num(lv));
					}
				}
				if (lv) {
					wret2 *= WEIGHT; wret *= WEIGHT; w *= WEIGHT;
					let ret = Math.log(lv1) - Math.log(lv);
					wret2 += ret*ret; wret += ret; w += 1;
				}
				lv = lv1;
				let ret = wret / w, ret2 = wret2 / w, sd_ret = Math.sqrt(ret2 - ret * ret), se_ret = sd_ret/Math.sqrt(w);
				ns.printf("tick=%d lv=%s ret=%.3f%% (%.3f%%) sd_ret=%.3f%% ttf=%d sync=%d dll0=%.1f dll1=%.1f", data.tick, format_num(lv), 100*ret, 100*se_ret, 100*sd_ret, data.ttf, data.sync, data.dll0, data.dll1);
			}
		}
		await ns.sleep(1000);
	}
}
