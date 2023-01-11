// fit forecasts and publish, only using ns.stock.getPrice [ no 4s api ]

import { STOCK_PORT, load_static_stock_data } from "stock/no4s/common.js";

// stop retaining history & fitting sync once we reach this confidence level on the sync
//const STOP_FITTING_SYNC_DLL0 = 1/0;
const STOP_FITTING_SYNC_DLL0 = 25;
// discretization of forecast buckets
// stderr at extreme ends seems to saturate ~1.5%; this value has ~30 buckets per dev (could be coarser)
const FORECAST_BUCKETS = 2000;

function process_tick(ns, data, keep_history) {
	for (let ticker in data) {
		let p0 = data[ticker].p;
		let p1 = data[ticker].p = ns.stock.getPrice(ticker);
		// this is a SIGNED quantity: the source code generates an unsigned value, then a coin toss
		// (based on forecast) for direction; here we combine the two.
		// Math.abs() should represent the av value in the source, sign indicates direction
		let av = (p1 > p0) ? p1 / p0 - 1 : 1 - p0 / p1;
		if (keep_history)
			data[ticker].av.unshift(av);
		else
			data[ticker].av = [ av ];
	}
}

function fit_cycle(ns, data, tick) {
	let lls = Array(75).fill(0), N=Math.floor((tick-74)/75), M = 75*N;
	for (let sync=0; sync < 75; ++sync) {
		for (let ticker in data) {
			let j=tick-sync, i=j-75, total=0;
			for (let k=0; k<N; ++k) {
				let M=0;
				for (let l=i; l<j; ++l)
					if (data[ticker].av[l] > 0) ++M;
				total += Math.max(M, 75-M);
				j = i;
				i = j-75;
			}
			let p = total / M;
			if (p>0 && p<1)
				lls[sync] += total * Math.log(p) + (M - total) * Math.log(1-p);
		}
	}
	return lls;
}

// bayesian update of estimators for +/-
function init_forecast_estimators(ns, data) {
	for (let ticker in data)
		data[ticker].f = Array(FORECAST_BUCKETS+1).fill(1 / (FORECAST_BUCKETS+1));
}

function update_forecast_estimators(ns, data, ind) {
	for (let ticker in data) {
		for (let i=0; i<=FORECAST_BUCKETS; ++i) {
			let p = i / FORECAST_BUCKETS;
			data[ticker].f[i] *= data[ticker].av[ind] > 0 ? p : 1-p;
		}
	}
}

function diffuse_forecast_estimators(ns, data, ind) {
	for (let ticker in data) {
		let av = Math.abs(data[ticker].av[ind]), f = Array(FORECAST_BUCKETS+1).fill(0);
		for (let i=0; i<=FORECAST_BUCKETS; ++i) {
			let otlkMag = Math.abs(100*(i / FORECAST_BUCKETS) - 50);
			let otlkMagChange = otlkMag * av;
			if (otlkMag < 5) {
				if (otlkMag <= 1) {
					otlkMagChange = 1;
				} else {
					otlkMagChange *= 10;
				}
			}
			otlkMagChange /= 2;
			let dbucket = Math.ceil(otlkMagChange / 100 * FORECAST_BUCKETS);
			f[Math.min(FORECAST_BUCKETS, i + dbucket)] += 0.5 * data[ticker].f[i];
			f[Math.max(0, i - dbucket)] += 0.5 * data[ticker].f[i];
		}
		data[ticker].f = f;
	}
}

function recondition_estimators(ns, data) {
	for (let ticker in data) {
		let sum = 0;
		for (let i=0; i<=FORECAST_BUCKETS; ++i)
			sum += data[ticker].f[i];
		for (let i=0; i<=FORECAST_BUCKETS; ++i)
			data[ticker].f[i] /= sum;
	}
}

function summarize_estimators(ns, data) {
	for (let ticker in data) {
		let Ef = 0, f2 = 0;
		for (let i=0; i<=FORECAST_BUCKETS; ++i)
			Ef += data[ticker].f[i] * i / FORECAST_BUCKETS;
		for (let i=0; i<=FORECAST_BUCKETS; ++i) {
			let x = i / FORECAST_BUCKETS - Ef;
			f2 += data[ticker].f[i] * x *x;
		}
		data[ticker].Ef = Ef;
		data[ticker].se_f = Math.sqrt(f2);
	}
}

function flip_forecast_estimators(ns, data) {
	for (let ticker in data) {
		let f = Array(FORECAST_BUCKETS+1).fill(0);
		for (let i=0; i<=FORECAST_BUCKETS; ++i) {
			f[i] += .55 * data[ticker].f[i];
			f[FORECAST_BUCKETS-i] += .45 * data[ticker].f[i];
		}
		data[ticker].f = f;
	}
}

function tick_occurred(ns, data) {
	for (let ticker in data)
		if (ns.stock.getPrice(ticker) != data[ticker].p) return true;
	return false;
}

/** @param {NS} ns */
export async function main(ns) {
	ns.disableLog("ALL");
	let data = { };
	for (let ticker in load_static_stock_data(ns)) {
		data[ticker] = {
			p : ns.stock.getPrice(ticker),
			av : [],
		}
	}
	init_forecast_estimators(ns, data);

	let tick=0, sync=0, dll0=0, dll1=0;
	while(true) {
		await ns.sleep(1000);
		if (!tick_occurred(ns, data)) continue;

		++tick;
		process_tick(ns, data, dll0 < STOP_FITTING_SYNC_DLL0);

		if (dll0 < STOP_FITTING_SYNC_DLL0 && tick > 75 && tick % 75 == 74) {
			let lls = fit_cycle(ns, data, tick);
			let max_sync = sync, max_ll = lls[max_sync];
			for (let i=0; i<lls.length; ++i)
				if (lls[i] > max_ll) {
					max_sync = i;
					max_ll = lls[i];
				}
			let ll0 = -1/0, ll1 = -1/0;
			for (let i=0; i<lls.length; ++i) {
				if (i != max_sync && lls[i] > ll0) ll0 = lls[i];
				if ((max_sync + 76 - i) % 75 > 2 && lls[i] > ll1) ll1 = lls[i];
			}
			dll0 = max_ll - ll0;
			dll1 = max_ll - ll1;
			if (sync != max_sync) {
				//ns.tprint("RESYNC");
				sync = max_sync;
				init_forecast_estimators(ns, data);
				for (let i=1; i<tick; ++i) {
					update_forecast_estimators(ns, data, tick-i);
					diffuse_forecast_estimators(ns, data, tick-i);
					if (i % 75 == sync)
						flip_forecast_estimators(ns, data);
					recondition_estimators(ns, data);
				}
			}
		}

		update_forecast_estimators(ns, data, 0);
		diffuse_forecast_estimators(ns, data, 0);
		if (tick % 75 == sync)
			flip_forecast_estimators(ns, data);
		recondition_estimators(ns, data);
		summarize_estimators(ns, data);

		let ttf = 75-(tick-sync)%75;

		let ret = {
			tick,
			ttf,
			sync,
			dll0,
			dll1, 
			S : {},
		};
		for (let ticker in data)
			ret.S[ticker] = {
				p : data[ticker].p,
				f : data[ticker].Ef,
				se_f : data[ticker].se_f,
			};
		ns.clearPort(STOCK_PORT);
		ns.writePort(STOCK_PORT, JSON.stringify(ret));
	}
}
