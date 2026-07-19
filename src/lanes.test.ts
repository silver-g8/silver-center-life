import { describe, it, expect } from "vitest";
import { laneAssign, POINT_MIN, type Spanned } from "./lanes";

/* Shorthand: block(9, 0, 10, 30) === 09:00-10:30 */
function block(h1: number, m1: number, h2: number, m2: number): Spanned {
	return { startMin: h1 * 60 + m1, endMin: h2 * 60 + m2 };
}

function point(h: number, m: number): Spanned {
	return { startMin: h * 60 + m, endMin: null };
}

const lanes = (r: { lane: number }[]) => r.map((x) => x.lane);
const counts = (r: { laneCount: number }[]) => r.map((x) => x.laneCount);

describe("laneAssign — trivial inputs", () => {
	it("returns nothing for no events", () => {
		expect(laneAssign([])).toEqual([]);
	});

	it("puts a lone event in the only column", () => {
		expect(laneAssign([block(9, 0, 10, 0)])).toEqual([
			{ lane: 0, laneCount: 1 },
		]);
	});
});

describe("laneAssign — what counts as a collision", () => {
	it("keeps touching events in one column", () => {
		/* 09:00-10:00 then 10:00-11:00 do not overlap: the first has finished
		   the instant the second begins. Splitting them would waste half the
		   day's width on back-to-back meetings. */
		const out = laneAssign([block(9, 0, 10, 0), block(10, 0, 11, 0)]);
		expect(lanes(out)).toEqual([0, 0]);
		expect(counts(out)).toEqual([1, 1]);
	});

	it("splits events that overlap by even a minute", () => {
		const out = laneAssign([block(9, 0, 10, 0), block(9, 59, 11, 0)]);
		expect(lanes(out)).toEqual([0, 1]);
		expect(counts(out)).toEqual([2, 2]);
	});

	it("gives a fully nested event its own column", () => {
		const out = laneAssign([block(9, 0, 12, 0), block(10, 0, 11, 0)]);
		expect(lanes(out)).toEqual([0, 1]);
		expect(counts(out)).toEqual([2, 2]);
	});

	it("stacks three mutually overlapping events into three columns", () => {
		const out = laneAssign([
			block(9, 0, 12, 0),
			block(9, 30, 12, 30),
			block(10, 0, 11, 0),
		]);
		expect(lanes(out)).toEqual([0, 1, 2]);
		expect(counts(out)).toEqual([3, 3, 3]);
	});
});

describe("laneAssign — clusters", () => {
	it("shares one width across a transitively linked chain", () => {
		/* A and C never touch each other, but B overlaps both, so all three
		   belong to one cluster and must be laid out on the same grid. */
		const a = block(9, 0, 10, 0);
		const b = block(9, 30, 10, 30);
		const c = block(10, 0, 11, 0);

		const out = laneAssign([a, b, c]);
		expect(counts(out)).toEqual([2, 2, 2]);
		/* A ends when C starts, so C reuses A's column rather than opening a
		   third one. */
		expect(lanes(out)).toEqual([0, 1, 0]);
	});

	it("lets a later, unrelated cluster be narrower", () => {
		const out = laneAssign([
			block(9, 0, 10, 0), // cluster 1 ─ overlapping pair
			block(9, 30, 10, 30),
			block(14, 0, 15, 0), // cluster 2 ─ alone
		]);
		expect(counts(out)).toEqual([2, 2, 1]);
		expect(lanes(out)).toEqual([0, 1, 0]);
	});

	it("reuses freed columns after a cluster closes", () => {
		const out = laneAssign([
			block(9, 0, 11, 0),
			block(9, 30, 10, 0),
			block(13, 0, 14, 0),
			block(15, 0, 16, 0),
		]);
		expect(lanes(out)).toEqual([0, 1, 0, 0]);
		expect(counts(out)).toEqual([2, 2, 1, 1]);
	});
});

describe("laneAssign — point events", () => {
	it("treats a point event as occupying POINT_MIN minutes", () => {
		/* The point sits at 09:00 and so runs to 09:30 for collision purposes;
		   a block starting at 09:15 therefore collides with it. */
		const out = laneAssign([point(9, 0), block(9, 15, 10, 0)]);
		expect(lanes(out)).toEqual([0, 1]);
		expect(counts(out)).toEqual([2, 2]);
	});

	it("does not collide with a block starting exactly POINT_MIN later", () => {
		const out = laneAssign([point(9, 0), block(9, POINT_MIN, 10, 0)]);
		expect(lanes(out)).toEqual([0, 0]);
		expect(counts(out)).toEqual([1, 1]);
	});

	it("honours a custom pointMin", () => {
		/* At 15 minutes the same pair no longer collides. */
		const out = laneAssign([point(9, 0), block(9, 15, 10, 0)], 15);
		expect(lanes(out)).toEqual([0, 0]);
		expect(counts(out)).toEqual([1, 1]);
	});
});

describe("laneAssign — result shape", () => {
	it("returns results in input order, not sorted order", () => {
		/* Deliberately unsorted input: the late event is listed first. */
		const out = laneAssign([block(17, 0, 18, 0), block(9, 0, 10, 0)]);
		expect(out).toHaveLength(2);
		/* Each is alone in its own cluster, so both are column 0 of 1 — the
		   point is that the array lines up with the input. */
		expect(out).toEqual([
			{ lane: 0, laneCount: 1 },
			{ lane: 0, laneCount: 1 },
		]);
	});

	it("keeps the longer event in column 0 when two start together", () => {
		const out = laneAssign([block(9, 0, 9, 30), block(9, 0, 11, 0)]);
		expect(lanes(out)).toEqual([1, 0]);
		expect(counts(out)).toEqual([2, 2]);
	});
});
