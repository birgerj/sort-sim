import { chownSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
// src/shifts/levels.ts
var LEVELS = /* @__PURE__ */ JSON.parse("[{\"id\":1,\"name\":\"First door\",\"shiftMinutes\":120,\"cities\":[{\"volume\":150.0,\"truck\":120,\"arrivals\":[{\"from\":0,\"to\":90,\"perMinute\":1.6666666666666667}]}],\"docks\":2,\"robotsMax\":0,\"bufferCap\":800,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"Plan one dock: start, end, and 1 or 2 people.\",\"setForYou\":[\"Unloading\",\"Robots are off\",\"Doors\"]},\"par\":177,\"badge\":{\"id\":\"lean\",\"text\":\"One person is enough\"}},{\"id\":2,\"name\":\"Two cities\",\"shiftMinutes\":180,\"cities\":[{\"volume\":400.0,\"truck\":180,\"arrivals\":[{\"from\":0,\"to\":150,\"perMinute\":2.6666666666666665}]},{\"volume\":120.0,\"truck\":120,\"arrivals\":[{\"from\":0,\"to\":90,\"perMinute\":1.3333333333333333}]}],\"docks\":4,\"robotsMax\":0,\"bufferCap\":800,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"A city too big for one trailer. Give it a second dock, or lose ten minutes at each trailer swap.\",\"setForYou\":[\"Unloading\",\"Robots are off\",\"Doors\"]},\"par\":621,\"badge\":{\"id\":\"lean3\",\"text\":\"Never more than 3 people at work\"}},{\"id\":3,\"name\":\"Robots\",\"shiftMinutes\":240,\"cities\":[{\"volume\":499.99999999999994,\"truck\":240,\"arrivals\":[{\"from\":0,\"to\":210,\"perMinute\":2.380952380952381}]},{\"volume\":60.0,\"truck\":150,\"arrivals\":[{\"from\":0,\"to\":120,\"perMinute\":0.5}]},{\"volume\":70.0,\"truck\":150,\"arrivals\":[{\"from\":0,\"to\":120,\"perMinute\":0.5833333333333334}]},{\"volume\":50.0,\"truck\":180,\"arrivals\":[{\"from\":30,\"to\":150,\"perMinute\":0.4166666666666667}]}],\"docks\":4,\"robotsMax\":6,\"bufferCap\":800,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"Put a city on robots and choose the fleet size. One price per robot for the whole shift.\",\"setForYou\":[\"Unloading\",\"Doors\"]},\"par\":779,\"badge\":{\"id\":\"fleet3\",\"text\":\"At most 3 robots\"}},{\"id\":4,\"name\":\"One door, two trucks\",\"shiftMinutes\":240,\"cities\":[{\"volume\":240.0,\"truck\":105,\"arrivals\":[{\"from\":0,\"to\":90,\"perMinute\":2.6666666666666665}]},{\"volume\":200.0,\"truck\":240,\"arrivals\":[{\"from\":0,\"to\":200,\"perMinute\":1.0}]},{\"volume\":89.99999999999999,\"truck\":180,\"arrivals\":[{\"from\":0,\"to\":150,\"perMinute\":0.6}]}],\"docks\":2,\"robotsMax\":0,\"bufferCap\":800,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"More cities than docks. A dock can switch city in 15 minutes; waiting parcels go to the buffer.\",\"setForYou\":[\"Unloading\",\"Robots are off\",\"Doors\"]},\"par\":596,\"badge\":{\"id\":\"lean3\",\"text\":\"Never more than 3 people at work\"}},{\"id\":5,\"name\":\"Staggered wave\",\"shiftMinutes\":300,\"cities\":[{\"volume\":420.0,\"truck\":270,\"arrivals\":[{\"from\":0,\"to\":240,\"perMinute\":1.75}]},{\"volume\":300.0,\"truck\":210,\"arrivals\":[{\"from\":0,\"to\":60,\"perMinute\":3.0},{\"from\":60,\"to\":180,\"perMinute\":1.0}]},{\"volume\":260.0,\"truck\":300,\"arrivals\":[{\"from\":60,\"to\":200,\"perMinute\":0.7428571428571429},{\"from\":200,\"to\":270,\"perMinute\":2.2285714285714286}]},{\"volume\":180.0,\"truck\":180,\"arrivals\":[{\"from\":0,\"to\":150,\"perMinute\":1.2}]},{\"volume\":140.0,\"truck\":270,\"arrivals\":[{\"from\":30,\"to\":240,\"perMinute\":0.6666666666666666}]},{\"volume\":100.0,\"truck\":300,\"arrivals\":[{\"from\":90,\"to\":217,\"perMinute\":0.31496062992125984},{\"from\":217,\"to\":280,\"perMinute\":0.9523809523809523}]}],\"docks\":6,\"robotsMax\":10,\"bufferCap\":800,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"Parcels come in peaks. Start blocks later and change the crew size during the night.\",\"setForYou\":[\"Unloading\",\"Doors\"]},\"par\":1601,\"badge\":{\"id\":\"smallFleet\",\"text\":\"At most 6 robots\"}},{\"id\":6,\"name\":\"Tight store\",\"shiftMinutes\":360,\"cities\":[{\"volume\":520.0000000000002,\"truck\":330,\"arrivals\":[{\"from\":0,\"to\":300,\"perMinute\":1.7333333333333334}]},{\"volume\":379.99999999999994,\"truck\":240,\"arrivals\":[{\"from\":0,\"to\":66,\"perMinute\":3.4545454545454546},{\"from\":66,\"to\":200,\"perMinute\":1.1343283582089552}]},{\"volume\":320.0,\"truck\":360,\"arrivals\":[{\"from\":90,\"to\":250,\"perMinute\":0.8},{\"from\":250,\"to\":330,\"perMinute\":2.4}]},{\"volume\":260.0,\"truck\":210,\"arrivals\":[{\"from\":0,\"to\":180,\"perMinute\":1.4444444444444444}]},{\"volume\":219.99999999999997,\"truck\":330,\"arrivals\":[{\"from\":60,\"to\":300,\"perMinute\":0.9166666666666666}]},{\"volume\":160.0,\"truck\":180,\"arrivals\":[{\"from\":0,\"to\":50,\"perMinute\":1.92},{\"from\":50,\"to\":150,\"perMinute\":0.64}]},{\"volume\":140.0,\"truck\":360,\"arrivals\":[{\"from\":120,\"to\":330,\"perMinute\":0.6666666666666666}]},{\"volume\":100.0,\"truck\":330,\"arrivals\":[{\"from\":100,\"to\":234,\"perMinute\":0.29850746268656714},{\"from\":234,\"to\":300,\"perMinute\":0.9090909090909091}]}],\"docks\":8,\"robotsMax\":14,\"bufferCap\":250,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"The buffer is small tonight. Choose what you let wait.\",\"setForYou\":[\"Unloading\",\"Doors\"]},\"par\":2398,\"badge\":{\"id\":\"lean6\",\"text\":\"Never more than 6 people at work\"}},{\"id\":7,\"name\":\"Robots down\",\"shiftMinutes\":360,\"cities\":[{\"volume\":1380.0000000000002,\"truck\":340,\"arrivals\":[{\"from\":0,\"to\":310,\"perMinute\":4.451612903225806}]},{\"volume\":1103.9999999999998,\"truck\":250,\"arrivals\":[{\"from\":0,\"to\":73,\"perMinute\":9.073972602739724},{\"from\":73,\"to\":220,\"perMinute\":3.004081632653061}]},{\"volume\":920.0,\"truck\":360,\"arrivals\":[{\"from\":60,\"to\":240,\"perMinute\":2.0444444444444443},{\"from\":240,\"to\":330,\"perMinute\":6.133333333333333}]},{\"volume\":782.0000000000001,\"truck\":150,\"arrivals\":[{\"from\":0,\"to\":130,\"perMinute\":6.015384615384615}]},{\"volume\":690.0,\"truck\":330,\"arrivals\":[{\"from\":30,\"to\":300,\"perMinute\":2.5555555555555554}]},{\"volume\":551.9999999999999,\"truck\":360,\"arrivals\":[{\"from\":120,\"to\":267,\"perMinute\":1.5020408163265304},{\"from\":267,\"to\":340,\"perMinute\":4.536986301369862}]},{\"volume\":414.00000000000006,\"truck\":270,\"arrivals\":[{\"from\":0,\"to\":240,\"perMinute\":1.7249999999999999}]},{\"volume\":322.0,\"truck\":210,\"arrivals\":[{\"from\":0,\"to\":60,\"perMinute\":3.2199999999999998},{\"from\":60,\"to\":180,\"perMinute\":1.0733333333333333}]},{\"volume\":275.9999999999999,\"truck\":350,\"arrivals\":[{\"from\":100,\"to\":320,\"perMinute\":1.2545454545454544}]}],\"docks\":10,\"robotsMax\":12,\"bufferCap\":800,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"Full hall: you need every dock. The robots are off from 01:00 to 02:00 and one truck leaves early.\",\"setForYou\":[\"Unloading\",\"Doors\"]},\"par\":7577,\"badge\":{\"id\":\"allOnTime\",\"text\":\"Every truck on time\"},\"robotOutage\":[180,240]},{\"id\":8,\"name\":\"Peak night\",\"shiftMinutes\":480,\"cities\":[{\"volume\":2239.9999999999995,\"truck\":450,\"arrivals\":[{\"from\":0,\"to\":420,\"perMinute\":5.333333333333333}]},{\"volume\":1736.0000000000002,\"truck\":330,\"arrivals\":[{\"from\":0,\"to\":100,\"perMinute\":10.416},{\"from\":100,\"to\":300,\"perMinute\":3.472}]},{\"volume\":2520.0,\"truck\":450,\"arrivals\":[{\"from\":0,\"to\":180,\"perMinute\":2.0999999999999996},{\"from\":180,\"to\":210,\"perMinute\":58.099999999999994},{\"from\":210,\"to\":400,\"perMinute\":2.0999999999999996}]},{\"volume\":1344.0,\"truck\":480,\"arrivals\":[{\"from\":120,\"to\":340,\"perMinute\":2.4436363636363634},{\"from\":340,\"to\":450,\"perMinute\":7.33090909090909}]},{\"volume\":1063.9999999999995,\"truck\":270,\"arrivals\":[{\"from\":0,\"to\":240,\"perMinute\":4.433333333333333}]},{\"volume\":895.9999999999998,\"truck\":450,\"arrivals\":[{\"from\":60,\"to\":420,\"perMinute\":2.4888888888888885}]},{\"volume\":727.9999999999999,\"truck\":240,\"arrivals\":[{\"from\":0,\"to\":66,\"perMinute\":6.618181818181818},{\"from\":66,\"to\":200,\"perMinute\":2.1731343283582087}]},{\"volume\":559.9999999999999,\"truck\":480,\"arrivals\":[{\"from\":200,\"to\":374,\"perMinute\":1.2873563218390804},{\"from\":374,\"to\":460,\"perMinute\":3.9069767441860463}]},{\"volume\":391.99999999999994,\"truck\":390,\"arrivals\":[{\"from\":0,\"to\":360,\"perMinute\":1.0888888888888888}]},{\"volume\":280.0,\"truck\":480,\"arrivals\":[{\"from\":150,\"to\":450,\"perMinute\":0.9333333333333332}]}],\"docks\":14,\"robotsMax\":24,\"bufferCap\":800,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"A large batch for one city at 01:00. Not everything fits tonight: choose what stays behind.\",\"setForYou\":[\"Unloading\",\"Doors\"]},\"par\":12655,\"badge\":{\"id\":\"onTime9\",\"text\":\"At least 9 trucks on time\"}},{\"id\":9,\"name\":\"Holiday rates\",\"shiftMinutes\":480,\"cities\":[{\"volume\":2050.0,\"truck\":450,\"arrivals\":[{\"from\":0,\"to\":420,\"perMinute\":4.8809523809523805}]},{\"volume\":1699.9999999999995,\"truck\":300,\"arrivals\":[{\"from\":0,\"to\":90,\"perMinute\":11.333333333333332},{\"from\":90,\"to\":270,\"perMinute\":3.7777777777777777}]},{\"volume\":1400.0,\"truck\":480,\"arrivals\":[{\"from\":30,\"to\":310,\"perMinute\":2.0},{\"from\":310,\"to\":450,\"perMinute\":6.0}]},{\"volume\":1249.9999999999995,\"truck\":240,\"arrivals\":[{\"from\":0,\"to\":210,\"perMinute\":5.9523809523809526}]},{\"volume\":1100.0000000000002,\"truck\":420,\"arrivals\":[{\"from\":60,\"to\":390,\"perMinute\":3.333333333333333}]},{\"volume\":1000.0,\"truck\":360,\"arrivals\":[{\"from\":0,\"to\":110,\"perMinute\":5.454545454545454},{\"from\":110,\"to\":330,\"perMinute\":1.8181818181818183}]},{\"volume\":900.0,\"truck\":480,\"arrivals\":[{\"from\":90,\"to\":330,\"perMinute\":1.5},{\"from\":330,\"to\":450,\"perMinute\":4.5}]},{\"volume\":799.9999999999999,\"truck\":330,\"arrivals\":[{\"from\":30,\"to\":300,\"perMinute\":2.962962962962963}]},{\"volume\":700.0,\"truck\":450,\"arrivals\":[{\"from\":120,\"to\":420,\"perMinute\":2.3333333333333335}]},{\"volume\":650.0,\"truck\":210,\"arrivals\":[{\"from\":0,\"to\":60,\"perMinute\":6.5},{\"from\":60,\"to\":180,\"perMinute\":2.166666666666667}]},{\"volume\":550.0,\"truck\":480,\"arrivals\":[{\"from\":150,\"to\":350,\"perMinute\":1.1},{\"from\":350,\"to\":450,\"perMinute\":3.3000000000000003}]},{\"volume\":399.99999999999994,\"truck\":390,\"arrivals\":[{\"from\":60,\"to\":360,\"perMinute\":1.3333333333333333}]}],\"docks\":16,\"robotsMax\":24,\"bufferCap\":800,\"wageFactor\":1.5,\"notes\":{\"fresh\":\"People cost 50% more tonight. Two on every dock is no longer the easy answer.\",\"setForYou\":[\"Unloading\",\"Doors\"]},\"par\":13066,\"badge\":{\"id\":\"lean16\",\"text\":\"Never more than 16 people at work\"},\"peopleCap\":32},{\"id\":10,\"name\":\"Full house\",\"shiftMinutes\":480,\"cities\":[{\"volume\":2092.2,\"truck\":450,\"arrivals\":[{\"from\":0,\"to\":300,\"perMinute\":4.714285714285714},{\"from\":300,\"to\":330,\"perMinute\":8.454285714285714},{\"from\":330,\"to\":420,\"perMinute\":4.714285714285714}]},{\"volume\":2974.4000000000005,\"truck\":420,\"arrivals\":[{\"from\":0,\"to\":150,\"perMinute\":4.4},{\"from\":150,\"to\":180,\"perMinute\":41.06666666666667},{\"from\":180,\"to\":300,\"perMinute\":4.4},{\"from\":300,\"to\":330,\"perMinute\":9.680000000000001},{\"from\":330,\"to\":390,\"perMinute\":4.4}]},{\"volume\":1579.6000000000004,\"truck\":480,\"arrivals\":[{\"from\":30,\"to\":300,\"perMinute\":2.1371428571428575},{\"from\":300,\"to\":310,\"perMinute\":4.923809523809524},{\"from\":310,\"to\":330,\"perMinute\":9.198095238095238},{\"from\":330,\"to\":450,\"perMinute\":6.411428571428572}]},{\"volume\":1320.0,\"truck\":270,\"arrivals\":[{\"from\":0,\"to\":80,\"perMinute\":9.9},{\"from\":80,\"to\":240,\"perMinute\":3.3000000000000003}]},{\"volume\":1253.9999999999998,\"truck\":450,\"arrivals\":[{\"from\":60,\"to\":300,\"perMinute\":3.3000000000000003},{\"from\":300,\"to\":330,\"perMinute\":5.5},{\"from\":330,\"to\":420,\"perMinute\":3.3000000000000003}]},{\"volume\":1056.0,\"truck\":330,\"arrivals\":[{\"from\":0,\"to\":100,\"perMinute\":6.336},{\"from\":100,\"to\":300,\"perMinute\":2.112}]},{\"volume\":1023.0000000000001,\"truck\":480,\"arrivals\":[{\"from\":90,\"to\":300,\"perMinute\":1.6133333333333333},{\"from\":300,\"to\":330,\"perMinute\":3.4466666666666668},{\"from\":330,\"to\":450,\"perMinute\":4.840000000000001}]},{\"volume\":930.6,\"truck\":390,\"arrivals\":[{\"from\":30,\"to\":300,\"perMinute\":2.666666666666667},{\"from\":300,\"to\":330,\"perMinute\":4.353333333333334},{\"from\":330,\"to\":360,\"perMinute\":2.666666666666667}]},{\"volume\":835.9999999999999,\"truck\":480,\"arrivals\":[{\"from\":120,\"to\":300,\"perMinute\":2.4},{\"from\":300,\"to\":330,\"perMinute\":3.8666666666666667},{\"from\":330,\"to\":450,\"perMinute\":2.4}]},{\"volume\":704.0000000000001,\"truck\":240,\"arrivals\":[{\"from\":0,\"to\":70,\"perMinute\":6.034285714285715},{\"from\":70,\"to\":210,\"perMinute\":2.0114285714285716}]},{\"volume\":697.4,\"truck\":450,\"arrivals\":[{\"from\":150,\"to\":300,\"perMinute\":1.4666666666666668},{\"from\":300,\"to\":330,\"perMinute\":2.713333333333334},{\"from\":330,\"to\":420,\"perMinute\":4.4}]},{\"volume\":572.0000000000002,\"truck\":360,\"arrivals\":[{\"from\":60,\"to\":330,\"perMinute\":2.1185185185185187}]},{\"volume\":483.99999999999994,\"truck\":300,\"arrivals\":[{\"from\":0,\"to\":90,\"perMinute\":3.2266666666666666},{\"from\":90,\"to\":270,\"perMinute\":1.0755555555555556}]},{\"volume\":418.0000000000001,\"truck\":480,\"arrivals\":[{\"from\":180,\"to\":300,\"perMinute\":0.8800000000000001},{\"from\":300,\"to\":330,\"perMinute\":1.6133333333333335},{\"from\":330,\"to\":360,\"perMinute\":0.8800000000000001},{\"from\":360,\"to\":450,\"perMinute\":2.64}]},{\"volume\":325.6000000000001,\"truck\":420,\"arrivals\":[{\"from\":30,\"to\":300,\"perMinute\":0.8555555555555556},{\"from\":300,\"to\":330,\"perMinute\":1.4422222222222223},{\"from\":330,\"to\":390,\"perMinute\":0.8555555555555556}]},{\"volume\":233.20000000000002,\"truck\":480,\"arrivals\":[{\"from\":210,\"to\":300,\"perMinute\":0.9166666666666667},{\"from\":300,\"to\":330,\"perMinute\":1.356666666666667},{\"from\":330,\"to\":450,\"perMinute\":0.9166666666666667}]}],\"docks\":20,\"robotsMax\":30,\"bufferCap\":400,\"wageFactor\":1.0,\"notes\":{\"fresh\":\"Everything at once: batch, late inbound, small buffer, a limit on people.\",\"setForYou\":[\"Unloading\",\"Doors\"]},\"par\":19584,\"badge\":{\"id\":\"allOnTime\",\"text\":\"Every truck on time\"},\"peopleCap\":40}]");
/** The minute a city's first parcel arrives (0 when it gets none). */
function firstParcel(level, city) {
	let first = Infinity;
	for (const a of level.cities[city]?.arrivals ?? []) if (a.perMinute > 0 && a.to > a.from) first = Math.min(first, a.from);
	return Number.isFinite(first) ? first : 0;
}
/** Robot lines a city opens: enough for its busiest minute (a line passes one parcel a minute), at most 4. */
function linesFor(level, city) {
	let busiest = 0;
	for (const a of level.cities[city]?.arrivals ?? []) if (a.to > a.from) busiest = Math.max(busiest, a.perMinute);
	return Math.max(1, Math.min(4, Math.ceil(busiest - 1e-9)));
}
/** The plan's robot cities, each once, in the order given. */
function robotCities(plan) {
	return [...new Set(plan.robotCities)];
}
/**
* Hands out doors. Blocks are taken by start, then city, people, docks and end (the end last, so
* that cutting a block in two never changes its turn). Blocks that start together for the same
* city are placed in two rounds. First every dock that can goes on with a door where a block of
* this city with the same crew ends this very minute: that is the same work carried on (same
* trailer, same belt). Then the docks still without a door take, in this order of preference: a
* door where this city ends this minute, a free door that last served this city, the door that has
* been free longest. A door that served another city is free 15 minutes after that block ended.
* `unplaced` lists the blocks (plan indices) that found no door for one of their docks.
*/
function assignDoors(level, plan) {
	const order = plan.blocks.map((b, block) => ({
		b,
		block
	}));
	order.sort((x, y) => x.b.start - y.b.start || x.b.city - y.b.city || x.b.people - y.b.people || x.b.docks - y.b.docks || x.b.end - y.b.end || x.block - y.block);
	const freeFrom = new Array(level.docks).fill(-999);
	const lastCity = new Array(level.docks).fill(-1);
	const lastPeople = new Array(level.docks).fill(0);
	const placed = [];
	const unplaced = [];
	const take = (k, b, block) => {
		freeFrom[k] = b.end;
		lastCity[k] = b.city;
		lastPeople[k] = b.people;
		placed.push({
			city: b.city,
			door: k,
			start: b.start,
			end: b.end,
			people: b.people,
			block
		});
	};
	for (let i = 0; i < order.length;) {
		let j = i;
		while (j < order.length && order[j].b.start === order[i].b.start && order[j].b.city === order[i].b.city) j++;
		const group = order.slice(i, j);
		i = j;
		const need = [];
		for (const { b, block } of group) {
			let n = b.docks;
			for (let k = 0; k < level.docks && n > 0; k++) if (lastCity[k] === b.city && freeFrom[k] === b.start && lastPeople[k] === b.people) {
				take(k, b, block);
				n--;
			}
			need.push(n);
		}
		group.forEach(({ b, block }, g) => {
			for (let n = need[g]; n > 0; n--) {
				let pick = -1;
				let rank = 0;
				for (let k = 0; k < level.docks; k++) {
					const last = lastCity[k];
					const free = freeFrom[k];
					if ((last === b.city || last === -1 ? free : free + 15) > b.start) continue;
					const r = last === b.city ? free === b.start ? 3 : 2 : 1;
					if (r > rank || r === 1 && rank === 1 && free < freeFrom[pick]) {
						pick = k;
						rank = r;
					}
				}
				if (pick < 0) {
					unplaced.push(block);
					break;
				}
				take(pick, b, block);
			}
		});
	}
	return {
		placed,
		unplaced
	};
}
var whole = (x) => Number.isInteger(x);
/**
* Everything that keeps a plan from starting; an empty list means it can run.
* A block that names no city of this level, or has a number of people or docks that does not
* exist, is reported as off the grid.
*/
function checkPlan(level, plan) {
	const problems = [];
	const lastMinute = level.shiftMinutes + 30;
	const sound = [];
	plan.blocks.forEach((b, block) => {
		const city = whole(b.city) ? level.cities[b.city] : void 0;
		if (!city || !whole(b.start) || !whole(b.end) || b.people !== 1 && b.people !== 2 || !whole(b.docks) || b.docks < 1) {
			problems.push({
				kind: "grid",
				block
			});
			sound.push(false);
			return;
		}
		const startOk = b.start >= 0 && (b.start % 30 === 0 || b.start === firstParcel(level, b.city));
		const endOk = b.end % 30 === 0 || b.end === city.truck;
		if (!startOk || !endOk) problems.push({
			kind: "grid",
			block
		});
		if (b.end - b.start < 60) problems.push({
			kind: "tooShort",
			block
		});
		if (b.end > Math.min(lastMinute, city.truck + 30)) problems.push({
			kind: "afterTruck",
			block
		});
		sound.push(b.start < b.end);
	});
	const usable = {
		...plan,
		blocks: plan.blocks.filter((_, i) => sound[i])
	};
	const planIndex = plan.blocks.map((_, i) => i).filter((i) => sound[i]);
	for (const i of assignDoors(level, usable).unplaced) problems.push({
		kind: "noDock",
		block: planIndex[i]
	});
	if (level.peopleCap !== void 0) {
		const changes = [];
		for (const b of usable.blocks) changes.push([b.start, b.people * b.docks], [b.end, -b.people * b.docks]);
		changes.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
		let atWork = 0;
		for (const [at, change] of changes) {
			atWork += change;
			if (atWork > level.peopleCap) {
				problems.push({
					kind: "tooManyPeople",
					at
				});
				break;
			}
		}
	}
	if (!whole(plan.robots) || plan.robots < 0 || plan.robots > level.robotsMax) problems.push({ kind: "tooManyRobots" });
	const cities = robotCities(plan);
	if (cities.length > 0 && (level.robotsMax <= 0 || cities.some((c) => !whole(c) || !level.cities[c]))) problems.push({ kind: "robotsOff" });
	return problems;
}
// src/shifts/model/simulate.ts
/** What things cost and earn, in Sorty. */
var PRICE = {
	parcel: 1.5,
	onTime: .3,
	latePerMinute: .03,
	leftBehind: 1.5,
	dockPerHour: 25,
	personPerHour: 30,
	robotPerShiftHour: 11,
	bufferPerParcel: .15
};
/** Parcels that can wait on a dock's roller belt. */
var BELT_ROOM = 40;
/** Parcels that can wait on a robot line's pickup table. */
var TABLE_ROOM = 20;
/** Parcels the buffer gives back per minute (150 an hour), shared by all docks and lines. */
var BUFFER_OUT_PER_MINUTE = 2.5;
/** Parcels per minute at a dock: one person picks and loads alone, two work as picker and loader. */
var ONE_PERSON_PER_MINUTE = 1.5;
var TWO_PEOPLE_PER_MINUTE = 170 / 60;
/** A trailer is full at this many parcels; swapping it keeps the dock idle for some minutes. */
var TRAILER = 220;
var TRAILER_SWAP_MINUTES = 10;
/** A robot loads 17 parcels an hour, so it takes 60/17 robots to move one parcel a minute; a line passes
*  one a minute at most. (The reference model divides by the same number.) */
var ROBOTS_PER_PARCEL_MINUTE = 60 / 17;
var LINE_PER_MINUTE = 1;
/** The shift is played on for this long after its end, for trucks that leave late. */
var OVERTIME_MINUTES = 30;
/** A truck missing less than this counts as complete (the model works in fractions of parcels). */
var COMPLETE_WITHIN = .5;
var STEP = 5;
/** Rounds to a whole number as the reference does: a value exactly halfway goes to the even side. */
function roundHalfEven(x) {
	const down = Math.floor(x);
	const rest = x - down;
	return (rest < .5 ? down : rest > .5 ? down + 1 : down % 2 === 0 ? down : down + 1) + 0;
}
/** Rounds to one decimal as the reference does: by the number's exact value, halfway to the even side. */
function roundTenth(x) {
	const quarters = x * 4;
	if (Number.isInteger(quarters) && quarters % 2 !== 0) return roundHalfEven(x * 10) / 10 + 0;
	return Number(x.toFixed(1)) + 0;
}
/** Parcels arriving per minute for one city, over the shift and its overtime. */
function arrivalsPerMinute(level, city, minutes) {
	const perMinute = new Float64Array(minutes);
	for (const a of level.cities[city].arrivals) for (let t = Math.max(0, a.from); t < Math.min(minutes, a.to); t++) perMinute[t] = perMinute[t] + a.perMinute;
	return perMinute;
}
/** Sorted by the city's truck time, keeping the given order among equals: earliest truck is served first. */
function byTruck(level, items) {
	return items.map((item, i) => ({
		item,
		i
	})).sort((x, y) => level.cities[x.item.city].truck - level.cities[y.item.city].truck || x.i - y.i).map((x) => x.item);
}
/** Docks in the order they are served: earliest truck first, then city, door and start. Nothing in
*  it changes when a block is cut in two. */
function docksInOrder(level, placed) {
	return [...placed].sort((x, y) => level.cities[x.city].truck - level.cities[y.city].truck || x.city - y.city || x.door - y.door || x.start - y.start);
}
/**
* A run is one door serving one city, block after block (gaps allowed). The belt, the trailer and
* its swap belong to the run, not to the block, so cutting a block in two changes nothing.
* `run[b]` is the run of block b; `handsBack[b]` is false when the run's next block starts the
* minute b ends: then the belt's parcels simply stay where they are.
*/
function runsOf(blocks) {
	const run = new Array(blocks.length).fill(0);
	const handsBack = new Array(blocks.length).fill(true);
	const byDoor = /* @__PURE__ */ new Map();
	blocks.forEach((b, j) => byDoor.set(b.door, [...byDoor.get(b.door) ?? [], j]));
	let count = 0;
	for (const door of [...byDoor.keys()].sort((a, b) => a - b)) {
		const js = byDoor.get(door).sort((a, b) => blocks[a].start - blocks[b].start);
		js.forEach((j, a) => {
			const before = a > 0 ? js[a - 1] : -1;
			if (before >= 0 && blocks[before].city === blocks[j].city) {
				run[j] = run[before];
				if (blocks[before].end === blocks[j].start) handsBack[before] = false;
			} else run[j] = count++;
		});
	}
	return {
		run,
		handsBack
	};
}
/** How many people and docks a plan has at work at the same moment, at most. */
function planPeaks(plan) {
	const peak = (weight) => {
		const changes = [];
		plan.blocks.forEach((b, i) => changes.push([b.start, weight(i)], [b.end, -weight(i)]));
		changes.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
		let now = 0;
		let most = 0;
		for (const [, change] of changes) most = Math.max(most, now += change);
		return most;
	};
	return {
		people: peak((i) => plan.blocks[i].people * plan.blocks[i].docks),
		docks: peak((i) => plan.blocks[i].docks)
	};
}
/** The level's extra goal, apart from the score it also needs. */
function badgeGoal(level, plan, statuses, bufferPeak) {
	const peaks = planPeaks(plan);
	switch (level.badge.id) {
		case "lean": return peaks.people <= 1;
		case "lean3": return peaks.people <= 3;
		case "lean12": return peaks.people <= 12;
		case "oneDock": return peaks.docks <= 2;
		case "noDockSmall": {
			let biggest = 0;
			level.cities.forEach((c, i) => {
				if (c.volume > level.cities[biggest].volume) biggest = i;
			});
			return plan.blocks.every((b) => b.city === biggest);
		}
		case "smallFleet": return plan.robots <= 6;
		case "halfBuffer": return bufferPeak <= level.bufferCap / 2;
		case "allOnTime": return statuses.every((s) => s === "onTime");
		default: {
			const atLeast = /^onTime(\d+)$/.exec(level.badge.id);
			if (atLeast !== null) return statuses.filter((s) => s === "onTime").length >= Number(atLeast[1]);
			const fleet = /^fleet(\d+)$/.exec(level.badge.id);
			if (fleet !== null) return plan.robots <= Number(fleet[1]);
			const lean = /^lean(\d+)$/.exec(level.badge.id);
			return lean !== null && peaks.people <= Number(lean[1]);
		}
	}
}
/**
* Plays the shift. The plan must be startable (see checkPlan); a plan whose blocks do not fit the
* docks cannot be played and throws.
*/
function simulate(level, given) {
	const plan = {
		blocks: [...given.blocks].sort((a, b) => a.city - b.city || a.start - b.start || a.people - b.people || a.docks - b.docks || a.end - b.end),
		robotCities: [...new Set(given.robotCities)].sort((a, b) => a - b),
		robots: given.robots
	};
	const { placed, unplaced } = assignDoors(level, plan);
	if (unplaced.length > 0) throw new Error("This plan needs more docks than the level has.");
	const cities = level.cities;
	const n = cities.length;
	const minutes = level.shiftMinutes + OVERTIME_MINUTES;
	const fleet = plan.robots;
	const [outFrom, outTo] = level.robotOutage ?? [0, 0];
	const openLines = [];
	for (const city of robotCities(plan)) {
		const line = {
			city,
			start: firstParcel(level, city),
			end: cities[city].truck
		};
		for (let k = linesFor(level, city); k > 0; k--) openLines.push(line);
	}
	const blocks = docksInOrder(level, placed);
	const { run, handsBack } = runsOf(blocks);
	const lines = byTruck(level, openLines);
	const nb = blocks.length;
	const nl = lines.length;
	const arrivals = [];
	for (let i = 0; i < n; i++) arrivals.push(arrivalsPerMinute(level, i, minutes));
	const upstream = new Float64Array(n);
	const stored = new Float64Array(n);
	const loaded = new Float64Array(n);
	const belt = new Float64Array(nb);
	const inTrailer = new Float64Array(nb);
	const swapUntil = new Float64Array(nb);
	let refused = 0;
	const table = new Float64Array(nl);
	const taken = new Float64Array(nl);
	let bufferFee = 0;
	let inBuffer = 0;
	let bufferPeak = 0;
	const cityLoaded = [];
	const bufferSeries = [];
	const robotsActive = [];
	const sample = (t) => {
		cityLoaded.push(Array.from(loaded, roundTenth));
		bufferSeries.push(roundTenth(inBuffer));
		robotsActive.push(outFrom <= t && t < outTo ? 0 : fleet);
	};
	sample(0);
	for (let t = 0; t < minutes; t++) {
		for (let i = 0; i < n; i++) upstream[i] = upstream[i] + arrivals[i][t];
		for (let b = 0; b < nb; b++) {
			const blk = blocks[b];
			if (blk.start <= t && t < blk.end) {
				const r = run[b];
				const x = Math.min(BELT_ROOM - belt[r], upstream[blk.city]);
				if (x > 0) {
					belt[r] = belt[r] + x;
					upstream[blk.city] = upstream[blk.city] - x;
				}
			}
		}
		for (let l = 0; l < nl; l++) {
			const line = lines[l];
			if (line.start <= t && t < line.end) {
				const x = Math.min(TABLE_ROOM - table[l], upstream[line.city]);
				if (x > 0) {
					table[l] = table[l] + x;
					upstream[line.city] = upstream[line.city] - x;
				}
			}
		}
		for (let i = 0; i < n; i++) if (upstream[i] > 1e-9) {
			const x = Math.min(upstream[i], level.bufferCap - inBuffer);
			if (x > 0) {
				stored[i] = stored[i] + x;
				inBuffer += x;
				upstream[i] = upstream[i] - x;
				bufferFee += x;
			}
			refused += upstream[i];
			upstream[i] = 0;
		}
		let budget = BUFFER_OUT_PER_MINUTE;
		for (let b = 0; b < nb && budget > 0; b++) {
			const blk = blocks[b];
			if (blk.start <= t && t < blk.end) {
				const r = run[b];
				const x = Math.min(BELT_ROOM - belt[r], stored[blk.city], budget);
				if (x > 0) {
					belt[r] = belt[r] + x;
					stored[blk.city] = stored[blk.city] - x;
					inBuffer -= x;
					budget -= x;
				}
			}
		}
		for (let l = 0; l < nl && budget > 0; l++) {
			const line = lines[l];
			if (line.start <= t && t < line.end) {
				const x = Math.min(TABLE_ROOM - table[l], stored[line.city], budget);
				if (x > 0) {
					table[l] = table[l] + x;
					stored[line.city] = stored[line.city] - x;
					inBuffer -= x;
					budget -= x;
				}
			}
		}
		for (let b = 0; b < nb; b++) {
			const blk = blocks[b];
			if (blk.start <= t && t < blk.end) {
				const r = run[b];
				if (t < swapUntil[r]) continue;
				const x = Math.min(belt[r], blk.people === 1 ? ONE_PERSON_PER_MINUTE : TWO_PEOPLE_PER_MINUTE);
				belt[r] = belt[r] - x;
				loaded[blk.city] = loaded[blk.city] + x;
				inTrailer[r] = inTrailer[r] + x;
				if (inTrailer[r] >= TRAILER) {
					inTrailer[r] = inTrailer[r] - TRAILER;
					swapUntil[r] = t + 1 + TRAILER_SWAP_MINUTES;
				}
			}
		}
		if (!(outFrom <= t && t < outTo) && fleet > 0) {
			const capacity = fleet / ROBOTS_PER_PARCEL_MINUTE;
			let waiting = 0;
			for (let l = 0; l < nl; l++) {
				const line = lines[l];
				taken[l] = 0;
				if (line.start <= t && t < line.end) waiting += table[l];
			}
			if (waiting > 0) {
				let spare = capacity;
				for (let l = 0; l < nl; l++) {
					const line = lines[l];
					if (line.start <= t && t < line.end) {
						const x = Math.min(table[l], capacity * table[l] / waiting, LINE_PER_MINUTE);
						table[l] = table[l] - x;
						loaded[line.city] = loaded[line.city] + x;
						taken[l] = x;
						spare -= x;
					}
				}
				if (spare > 1e-9) for (let l = 0; l < nl; l++) {
					const line = lines[l];
					if (line.start <= t && t < line.end) {
						const x = Math.min(table[l], spare, LINE_PER_MINUTE - taken[l]);
						if (x > 0) {
							table[l] = table[l] - x;
							loaded[line.city] = loaded[line.city] + x;
							spare -= x;
						}
					}
				}
			}
		}
		for (let b = 0; b < nb; b++) {
			const blk = blocks[b];
			if (t === blk.end - 1 && handsBack[b]) {
				upstream[blk.city] = upstream[blk.city] + belt[run[b]];
				belt[run[b]] = 0;
			}
		}
		for (let l = 0; l < nl; l++) {
			const line = lines[l];
			if (t === line.end - 1) {
				upstream[line.city] = upstream[line.city] + table[l];
				table[l] = 0;
			}
		}
		if (inBuffer > bufferPeak) bufferPeak = inBuffer;
		if ((t + 1) % STEP === 0) sample(t + 1);
	}
	const lastEnd = new Array(n).fill(void 0);
	for (const b of placed) lastEnd[b.city] = Math.max(lastEnd[b.city] ?? 0, b.end);
	for (const l of openLines) lastEnd[l.city] = Math.max(lastEnd[l.city] ?? 0, l.end);
	let revenue = 0;
	let bonus = 0;
	let late = 0;
	let left = 0;
	cities.forEach((c, i) => {
		let shipped = Math.min(c.volume, loaded[i]);
		let missing = c.volume - shipped;
		if (missing < COMPLETE_WITHIN) {
			shipped = c.volume;
			missing = 0;
		}
		const minutesLate = Math.max(0, (lastEnd[i] ?? 0) - c.truck);
		revenue += shipped * PRICE.parcel;
		if (missing === 0 && minutesLate === 0) bonus += shipped * PRICE.onTime;
		late += minutesLate * PRICE.latePerMinute * shipped;
		left += missing * PRICE.leftBehind;
	});
	let dockCost = 0;
	let peopleCost = 0;
	for (const b of placed) {
		dockCost += (b.end - b.start) / 60 * PRICE.dockPerHour;
		peopleCost += (b.end - b.start) / 60 * b.people * PRICE.personPerHour * level.wageFactor;
	}
	const robotCost = fleet * PRICE.robotPerShiftHour * level.shiftMinutes / 60;
	const bufferCost = bufferFee * PRICE.bufferPerParcel;
	const profit = revenue + bonus - late - left - dockCost - peopleCost - robotCost - bufferCost;
	const amounts = {
		revenue,
		bonus,
		late,
		left,
		docks: dockCost,
		people: peopleCost,
		robots: robotCost,
		buffer: bufferCost
	};
	const final = cityLoaded[cityLoaded.length - 1];
	const trucks = [];
	const departures = [];
	cities.forEach((c, i) => {
		const onTruck = Math.min(c.volume, final[i]);
		const leaves = lastEnd[i] ?? c.truck;
		const status = c.volume - onTruck >= COMPLETE_WITHIN ? "incomplete" : leaves > c.truck ? "late" : "onTime";
		trucks.push({
			city: i,
			loaded: roundHalfEven(onTruck),
			planned: c.truck,
			left: leaves,
			status
		});
		departures.push({
			city: i,
			at: leaves,
			status
		});
	});
	const cap = level.bufferCap;
	const fullRanges = [];
	let fullSince;
	bufferSeries.forEach((x, k) => {
		const full = x >= cap - COMPLETE_WITHIN;
		if (full && fullSince === void 0) fullSince = k * STEP;
		if (!full && fullSince !== void 0) {
			fullRanges.push([fullSince, k * STEP]);
			fullSince = void 0;
		}
	});
	if (fullSince !== void 0) fullRanges.push([fullSince, (bufferSeries.length - 1) * STEP]);
	const wholeProfit = roundHalfEven(profit);
	const score = Math.max(0, roundHalfEven(1e3 * wholeProfit / level.par));
	return {
		result: {
			profit: wholeProfit,
			score,
			stars: score >= 900 ? 3 : score >= 750 ? 2 : score >= 500 ? 1 : 0,
			badge: score >= 500 && badgeGoal(level, plan, trucks.map((x) => x.status), bufferPeak),
			lines: {
				revenue: roundHalfEven(amounts.revenue),
				bonus: roundHalfEven(amounts.bonus),
				late: roundHalfEven(amounts.late),
				left: roundHalfEven(amounts.left),
				docks: roundHalfEven(amounts.docks),
				people: roundHalfEven(amounts.people),
				robots: roundHalfEven(amounts.robots),
				buffer: roundHalfEven(amounts.buffer)
			},
			trucks,
			buffer: {
				series: bufferSeries,
				cap,
				fullRanges,
				refused: roundHalfEven(refused)
			}
		},
		timeline: {
			stepMinutes: 5,
			cityLoaded,
			buffer: [...bufferSeries],
			blocks: placed.map((b) => ({
				city: b.city,
				door: b.door,
				start: b.start,
				end: b.end,
				people: b.people
			})),
			robotsActive,
			departures
		},
		profit,
		amounts,
		bufferPeak
	};
}
// src/shifts/player.ts
/** Names are short and plain: letters, digits, spaces and a few marks. */
function cleanName(name) {
	return name.replace(/[^\p{L}\p{N} ._\-']/gu, "").replace(/\s+/g, " ").trim().slice(0, 20);
}
// server/app.ts
var KEY = /^[0-9a-f]{32}$/;
/** Is this a plan the model can take? Shape only; checkPlan judges the rest. */
function asPlan(v) {
	if (!v || typeof v !== "object") return null;
	const p = v;
	if (!Array.isArray(p.blocks) || !Array.isArray(p.robotCities) || !Number.isInteger(p.robots)) return null;
	if (p.blocks.length > 400 || p.robotCities.length > 64 || p.robots < 0 || p.robots > 1e3) return null;
	const blocks = [];
	for (const b of p.blocks) {
		if (!b || typeof b !== "object") return null;
		const { city, start, end, people, docks } = b;
		if (![
			city,
			start,
			end,
			docks
		].every((n) => Number.isInteger(n) && n >= 0 && n < 1e4)) return null;
		if (people !== 1 && people !== 2) return null;
		blocks.push({
			city,
			start,
			end,
			people,
			docks
		});
	}
	if (!p.robotCities.every((n) => Number.isInteger(n) && n >= 0 && n < 64)) return null;
	return {
		blocks,
		robotCities: p.robotCities,
		robots: p.robots
	};
}
var App = class {
	store;
	o;
	busy = /* @__PURE__ */ new Map();
	constructor(store, o) {
		this.store = store;
		this.o = o;
	}
	take(who) {
		const n = this.busy.get(who) ?? 0;
		if (n >= this.o.atOnce) return false;
		this.busy.set(who, n + 1);
		return true;
	}
	/** Call when a held-back answer has gone out. */
	release(who) {
		for (const w of who) {
			const n = (this.busy.get(w) ?? 1) - 1;
			if (n <= 0) this.busy.delete(w);
			else this.busy.set(w, n);
		}
	}
	/** Scores a plan. `held` names what to release once the answer is sent. */
	run(input, address) {
		const q = input ?? {};
		const level = LEVELS.find((l) => l.id === q.level);
		const key = typeof q.player?.key === "string" && KEY.test(q.player.key) ? q.player.key : null;
		const plan = asPlan(q.plan);
		if (!level || !key || !plan) return {
			status: 400,
			body: { error: "This is not a plan for a level of the game." },
			held: []
		};
		const problems = checkPlan(level, plan);
		if (problems.length) return {
			status: 422,
			body: { problems },
			held: []
		};
		const held = [`a:${address}`, `p:${key}`];
		if (!this.take(held[0])) return {
			status: 429,
			body: { error: "Too many plans at once from here. Wait for the last one to finish." },
			held: []
		};
		if (!this.take(held[1])) {
			this.release([held[0]]);
			return {
				status: 429,
				body: { error: "Your last plan is still being scored." },
				held: []
			};
		}
		const now = this.o.now();
		const name = cleanName(typeof q.player?.name === "string" ? q.player.name : "");
		const country = typeof q.player?.country === "string" ? q.player.country.replace(/[^a-z]/gi, "").slice(0, 3).toLowerCase() : "";
		const { result, timeline } = simulate(level, plan);
		this.store.seen(key, name, country, now);
		this.store.record(key, level.id, result, JSON.stringify(plan), now);
		return {
			status: 200,
			body: {
				result,
				timeline
			},
			wait: this.o.waitMs,
			held
		};
	}
	/** The ranking: one level, or the totals; with the asking player's own place when a key is given. */
	ranking(level, key) {
		if (level != null && !LEVELS.some((l) => l.id === level)) return {
			status: 400,
			body: { error: "There is no such level." }
		};
		const k = key && KEY.test(key) ? key : null;
		if (level == null) return {
			status: 200,
			body: {
				totals: this.store.totals(50).map(({ key: who, name, country, total, levels, stars, badges }) => ({
					name,
					country,
					total,
					levels,
					stars,
					badges,
					me: who === k
				})),
				rank: k ? this.store.rank(k) : 0
			}
		};
		return {
			status: 200,
			body: {
				level,
				entries: this.store.level(level, 50).map(({ key: who, ...rest }) => ({
					...rest,
					me: who === k
				}))
			}
		};
	}
	/** A player sets or changes the name shown in the ranking. */
	name(input) {
		const q = input ?? {};
		if (typeof q.key !== "string" || !KEY.test(q.key) || typeof q.name !== "string") return {
			status: 400,
			body: { error: "No player or no name." }
		};
		const name = cleanName(q.name);
		const country = typeof q.country === "string" ? q.country.replace(/[^a-z]/gi, "").slice(0, 3).toLowerCase() : "";
		this.store.seen(q.key, name, country, this.o.now());
		return {
			status: 200,
			body: { name }
		};
	}
	mine(key) {
		if (!key || !KEY.test(key)) return {
			status: 400,
			body: { error: "No player." }
		};
		return {
			status: 200,
			body: {
				best: this.store.mine(key),
				rank: this.store.rank(key)
			}
		};
	}
};
// server/store.ts
var Store = class {
	db;
	constructor(file) {
		this.db = new DatabaseSync(file);
		this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (key TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS best (key TEXT NOT NULL, level INTEGER NOT NULL, score INTEGER NOT NULL, profit REAL NOT NULL, stars INTEGER NOT NULL, badge INTEGER NOT NULL, plan TEXT NOT NULL, at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (key, level));
      CREATE INDEX IF NOT EXISTS best_level ON best (level, score DESC, at);
    `);
	}
	/** Remembers who played (the name and country may have changed since the last time). */
	seen(key, name, country, now) {
		this.db.prepare(`INSERT INTO players (key, name, country, seen) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET name = excluded.name, country = excluded.country, seen = excluded.seen`).run(key, name, country, now);
	}
	/** Keeps a result when it beats the player's best on that level; counts every try. A badge once earned stays. */
	record(key, level, r, plan, now) {
		const old = this.db.prepare(`SELECT score, badge, tries FROM best WHERE key = ? AND level = ?`).get(key, level);
		if (!old) this.db.prepare(`INSERT INTO best (key, level, score, profit, stars, badge, plan, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(key, level, r.score, r.profit, r.stars, r.badge ? 1 : 0, plan, now);
		else if (r.score > old.score) this.db.prepare(`UPDATE best SET score = ?, profit = ?, stars = ?, badge = ?, plan = ?, at = ?, tries = tries + 1 WHERE key = ? AND level = ?`).run(r.score, r.profit, r.stars, r.badge || old.badge ? 1 : 0, plan, now, key, level);
		else this.db.prepare(`UPDATE best SET badge = ?, tries = tries + 1 WHERE key = ? AND level = ?`).run(r.badge || old.badge ? 1 : 0, key, level);
	}
	/** The best scores on one level; an earlier result ranks above a later equal one. */
	level(level, limit) {
		return this.db.prepare(`SELECT b.key, p.name, p.country, b.score, b.stars, b.badge FROM best b JOIN players p ON p.key = b.key WHERE b.level = ? ORDER BY b.score DESC, b.at ASC LIMIT ?`).all(level, limit).map((r) => ({
			...r,
			badge: !!r.badge
		}));
	}
	/** The sum of each player's best per level. */
	totals(limit) {
		return this.db.prepare(`SELECT b.key, p.name, p.country, SUM(b.score) AS total, COUNT(*) AS levels, SUM(b.stars) AS stars, SUM(b.badge) AS badges, MAX(b.at) AS last FROM best b JOIN players p ON p.key = b.key GROUP BY b.key ORDER BY total DESC, last ASC LIMIT ?`).all(limit);
	}
	/** A player's own best per level, so another device with the same key gets its progress back. */
	mine(key) {
		return this.db.prepare(`SELECT level, score, stars, badge FROM best WHERE key = ? ORDER BY level`).all(key).map((r) => ({
			...r,
			badge: !!r.badge
		}));
	}
	/** A player's place among all totals (1 = first), or 0 without a result. */
	rank(key) {
		const mine = this.db.prepare(`SELECT SUM(score) AS total FROM best WHERE key = ?`).get(key);
		if (!mine || mine.total == null) return 0;
		return this.db.prepare(`SELECT COUNT(*) AS n FROM (SELECT SUM(score) AS total FROM best GROUP BY key) WHERE total > ?`).get(mine.total).n + 1;
	}
	close() {
		this.db.close();
	}
};
// server/index.ts
var PORT = Number(process.env.PORT ?? 8080);
var DATA = resolve(process.env.DATA ?? "data");
var SITE = resolve(process.env.SITE ?? "dist");
var WAIT_MS = Number(process.env.WAIT_MS ?? 5e3);
var TRUST_PROXY = process.env.TRUST_PROXY === "1";
mkdirSync(DATA, { recursive: true });
var RUN_AS = /^(\d+):(\d+)$/.exec(process.env.RUN_AS ?? "");
if (RUN_AS && process.getuid?.() === 0) {
	const [uid, gid] = [Number(RUN_AS[1]), Number(RUN_AS[2])];
	for (const f of [DATA, ...readdirSync(DATA).map((n) => join(DATA, n))]) chownSync(f, uid, gid);
	process.setgid(gid);
	process.setuid(uid);
}
var store = new Store(join(DATA, "scores.db"));
var app = new App(store, {
	waitMs: WAIT_MS,
	atOnce: 2,
	now: () => Date.now()
});
var TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".glb": "model/gltf-binary",
	".bin": "application/octet-stream",
	".woff2": "font/woff2",
	".mp3": "audio/mpeg",
	".wasm": "application/wasm"
};
function address(req) {
	return (TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "unknown";
}
function send(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(text)
	});
	res.end(text);
}
function readJson(req, limit) {
	return new Promise((done, fail) => {
		let size = 0;
		const parts = [];
		req.on("data", (c) => {
			size += c.length;
			if (size > limit) {
				fail(/* @__PURE__ */ new Error("too large"));
				req.destroy();
			} else parts.push(c);
		});
		req.on("end", () => {
			try {
				done(JSON.parse(Buffer.concat(parts).toString("utf8")));
			} catch (e) {
				fail(e);
			}
		});
		req.on("error", fail);
	});
}
function file(req, res, path) {
	const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
	let full = join(SITE, rel);
	if (!full.startsWith(SITE)) return send(res, 404, { error: "Not found." });
	if (existsSync(full) && statSync(full).isDirectory()) full = join(full, "index.html");
	if (!existsSync(full)) return send(res, 404, { error: "Not found." });
	const hashed = /[/\\]assets[/\\]/.test(full);
	res.writeHead(200, {
		"content-type": TYPES[extname(full)] ?? "application/octet-stream",
		"cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
		"content-length": statSync(full).size
	});
	if (req.method === "HEAD") res.end();
	else createReadStream(full).pipe(res);
}
var server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://x");
	const path = url.pathname;
	(async () => {
		if (path === "/api/health") return send(res, 200, { ok: true });
		if (path === "/api/run" && req.method === "POST") {
			let input;
			try {
				input = await readJson(req, 65536);
			} catch {
				return send(res, 400, { error: "This is not a plan for a level of the game." });
			}
			const reply = app.run(input, address(req));
			setTimeout(() => {
				app.release(reply.held);
				send(res, reply.status, reply.body);
			}, reply.wait ?? 0);
			return;
		}
		if (path === "/api/name" && req.method === "POST") {
			let input;
			try {
				input = await readJson(req, 1024);
			} catch {
				return send(res, 400, { error: "No player or no name." });
			}
			const reply = app.name(input);
			return send(res, reply.status, reply.body);
		}
		if (path === "/api/ranking" && req.method === "GET") {
			const level = url.searchParams.get("level");
			const reply = app.ranking(level == null ? null : Number(level), url.searchParams.get("key"));
			return send(res, reply.status, reply.body);
		}
		if (path === "/api/mine" && req.method === "GET") {
			const reply = app.mine(url.searchParams.get("key"));
			return send(res, reply.status, reply.body);
		}
		if (path.startsWith("/api/")) return send(res, 404, { error: "Not found." });
		if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Not allowed." });
		file(req, res, path);
	})().catch(() => send(res, 500, { error: "Something went wrong on the server." }));
});
server.listen(PORT, () => console.log(`Ten Shifts server on port ${PORT}, site ${SITE}, data ${DATA}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
	server.close(() => {
		store.close();
		process.exit(0);
	});
});
export {};
