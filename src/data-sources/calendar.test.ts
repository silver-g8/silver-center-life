import { describe, it, expect } from "vitest";
import { parseCalendar } from "./calendar";

/* parseCalendar is tolerant by contract: a malformed line is dropped, never
   thrown. Each test below pins one way a line can be dropped, so a future
   "cleanup" that loosens the parser fails here instead of in the Day view. */

describe("parseCalendar — events it keeps", () => {
	it("parses a block event with a tag", () => {
		expect(parseCalendar("- 09:00-10:30 · Deep work · build")).toEqual([
			{
				start: "09:00",
				end: "10:30",
				title: "Deep work",
				tag: "build",
				startMin: 540,
				endMin: 630,
			},
		]);
	});

	it("parses a point event with null end and endMin", () => {
		expect(parseCalendar("- 14:00 · Coffee")).toEqual([
			{
				start: "14:00",
				end: null,
				title: "Coffee",
				tag: null,
				startMin: 840,
				endMin: null,
			},
		]);
	});

	it("accepts a single-digit hour", () => {
		const [ev] = parseCalendar("- 9:05 · Early");
		expect(ev.startMin).toBe(545);
	});
});

describe("parseCalendar — lines it drops", () => {
	it("drops an event that ends before it starts", () => {
		/* The Day view derives block height from endMin - startMin; a backwards
		   range would go negative, CSS would throw the declaration away, and the
		   block would flash full-height. Guarded at the parser instead. */
		expect(parseCalendar("- 15:00-09:00 · Backwards · work")).toEqual([]);
	});

	it("drops a zero-length event", () => {
		expect(parseCalendar("- 10:00-10:00 · Instant · work")).toEqual([]);
	});

	it("drops an out-of-range time", () => {
		expect(parseCalendar("- 25:99 · Impossible")).toEqual([]);
	});

	it("drops a malformed end while keeping a valid neighbour", () => {
		const out = parseCalendar(
			["- 09:00-bogus · Broken end", "- 11:00 · Fine"].join("\n")
		);
		expect(out.map((e) => e.title)).toEqual(["Fine"]);
	});

	it("drops a line with an empty title", () => {
		expect(parseCalendar("- 09:00 ·  · work")).toEqual([]);
	});

	it("ignores lines that are not list items", () => {
		const out = parseCalendar(
			["# Today", "", "just prose", "- 08:00 · Real"].join("\n")
		);
		expect(out.map((e) => e.title)).toEqual(["Real"]);
	});
});

describe("parseCalendar — ordering", () => {
	it("sorts by start time ascending regardless of file order", () => {
		const out = parseCalendar(
			[
				"- 17:00 · Evening",
				"- 08:30-09:00 · Morning",
				"- 12:00 · Noon",
			].join("\n")
		);
		expect(out.map((e) => e.title)).toEqual(["Morning", "Noon", "Evening"]);
		expect(out.map((e) => e.startMin)).toEqual([510, 720, 1020]);
	});
});
