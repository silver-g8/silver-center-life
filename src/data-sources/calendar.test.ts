import { describe, it, expect } from "vitest";
import {
	parseCalendar,
	toISODate,
	eventsOnDay,
	eventsInRange,
	weekDatesFor,
	addDaysISO,
} from "./calendar";

/* Every test passes `today` explicitly: the floating-date rule below is the
   whole point, and it must be observable without faking the clock. */
const TODAY = "2026-07-19";
const parse = (raw: string, today = TODAY) => parseCalendar(raw, today);

/* parseCalendar is tolerant by contract: a malformed line is dropped, never
   thrown. Each test below pins one way a line can be dropped, so a future
   "cleanup" that loosens the parser fails here instead of in the Day view. */

describe("parseCalendar — events it keeps", () => {
	it("parses a block event with a tag", () => {
		expect(parse("- 09:00-10:30 · Deep work · build")).toEqual([
			{
				date: TODAY,
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
		expect(parse("- 14:00 · Coffee")).toEqual([
			{
				date: TODAY,
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
		const [ev] = parse("- 9:05 · Early");
		expect(ev.startMin).toBe(545);
	});
});

describe("parseCalendar — lines it drops", () => {
	it("drops an event that ends before it starts", () => {
		/* The Day view derives block height from endMin - startMin; a backwards
		   range would go negative, CSS would throw the declaration away, and the
		   block would flash full-height. Guarded at the parser instead. */
		expect(parse("- 15:00-09:00 · Backwards · work")).toEqual([]);
	});

	it("drops a zero-length event", () => {
		expect(parse("- 10:00-10:00 · Instant · work")).toEqual([]);
	});

	it("drops an out-of-range time", () => {
		expect(parse("- 25:99 · Impossible")).toEqual([]);
	});

	it("drops a malformed end while keeping a valid neighbour", () => {
		const out = parse(
			["- 09:00-bogus · Broken end", "- 11:00 · Fine"].join("\n")
		);
		expect(out.map((e) => e.title)).toEqual(["Fine"]);
	});

	it("drops a line with an empty title", () => {
		expect(parse("- 09:00 ·  · work")).toEqual([]);
	});

	it("ignores lines that are not list items", () => {
		const out = parse(
			["# Today", "", "just prose", "- 08:00 · Real"].join("\n")
		);
		expect(out.map((e) => e.title)).toEqual(["Real"]);
	});
});

describe("parseCalendar — ordering", () => {
	it("sorts by start time ascending regardless of file order", () => {
		const out = parse(
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

/* ------------------------------------------------------------------------- */
/* Date headings — the three decisions the parser makes, each pinned here.    */
/* ------------------------------------------------------------------------- */

describe("parseCalendar — floating dates (decision 1)", () => {
	it("files a line above the first heading under today", () => {
		const out = parse("- 09:00 · Untagged");
		expect(out.map((e) => e.date)).toEqual([TODAY]);
	});

	it("re-resolves those lines when today changes — they float", () => {
		/* The same file read on two different days puts the un-headed line on
		   whichever day it is read. This is what calendar.md already did before
		   dates existed, and it is why an event only stops moving once it has a
		   heading of its own. */
		const raw = "- 09:00 · Untagged";
		expect(parse(raw, "2026-07-19")[0].date).toBe("2026-07-19");
		expect(parse(raw, "2026-07-20")[0].date).toBe("2026-07-20");
	});

	it("does not float a line that sits under a heading", () => {
		const raw = ["## 2026-05-24", "- 09:00 · Pinned"].join("\n");
		expect(parse(raw, "2026-07-19")[0].date).toBe("2026-05-24");
		expect(parse(raw, "2026-07-20")[0].date).toBe("2026-05-24");
	});

	it("keeps floating and headed lines apart in one file", () => {
		const out = parse(
			["- 08:00 · Floats", "## 2026-05-24", "- 09:00 · Pinned"].join("\n")
		);
		expect(out.map((e) => [e.date, e.title])).toEqual([
			["2026-05-24", "Pinned"],
			[TODAY, "Floats"],
		]);
	});
});

describe("parseCalendar — heading forms", () => {
	it("accepts any heading level", () => {
		const out = parse(
			["###### 2026-05-24", "- 09:00 · Deep heading"].join("\n")
		);
		expect(out[0].date).toBe("2026-05-24");
	});

	it("ignores a heading that is not a bare date", () => {
		/* "## Monday 2026-05-24" is prose, not a section marker, so the line
		   below it keeps whatever date was already in force. */
		const out = parse(
			["## Monday 2026-05-24", "- 09:00 · Still floating"].join("\n")
		);
		expect(out[0].date).toBe(TODAY);
	});

	it("switches sections across several headings", () => {
		const out = parse(
			[
				"## 2026-05-24",
				"- 09:00 · A",
				"## 2026-05-25",
				"- 09:00 · B",
				"## 2026-05-26",
				"- 09:00 · C",
			].join("\n")
		);
		expect(out.map((e) => [e.date, e.title])).toEqual([
			["2026-05-24", "A"],
			["2026-05-25", "B"],
			["2026-05-26", "C"],
		]);
	});
});

describe("parseCalendar — duplicate headings merge (decision 2)", () => {
	it("keeps events from both blocks of a repeated date", () => {
		const out = parse(
			[
				"## 2026-05-24",
				"- 09:00 · First block",
				"## 2026-05-25",
				"- 09:00 · Other day",
				"## 2026-05-24",
				"- 15:00 · Second block",
			].join("\n")
		);
		/* Last-wins would have dropped "First block" — appending a second
		   heading for the same day is an easy hand-edit to make. */
		expect(out.map((e) => [e.date, e.title])).toEqual([
			["2026-05-24", "First block"],
			["2026-05-24", "Second block"],
			["2026-05-25", "Other day"],
		]);
	});
});

describe("parseCalendar — invalid date headings (decision 3)", () => {
	it("drops the section under a date that does not exist", () => {
		/* new Date(2026, 1, 30) silently rolls to March 2; filing the events
		   there — or under the previous heading — would be a silent wrong
		   answer, so the section is dropped instead. */
		const out = parse(
			[
				"## 2026-05-24",
				"- 09:00 · Real",
				"## 2026-02-30",
				"- 09:00 · Impossible day",
			].join("\n")
		);
		expect(out.map((e) => e.title)).toEqual(["Real"]);
	});

	it("recovers at the next valid heading", () => {
		const out = parse(
			[
				"## 2026-02-30",
				"- 09:00 · Lost",
				"## 2026-05-24",
				"- 09:00 · Found",
			].join("\n")
		);
		expect(out.map((e) => e.title)).toEqual(["Found"]);
	});

	it("rejects a month out of range", () => {
		const out = parse(["## 2026-13-01", "- 09:00 · Nope"].join("\n"));
		expect(out).toEqual([]);
	});
});

describe("parseCalendar — guards still fire per section", () => {
	it("drops a backwards range under every heading, not just the first", () => {
		/* The ends-before-start rule is evaluated per event against its own
		   day. Because an event's start and end always live under one heading,
		   a "backwards" range can never mean "overnight" — there is no way to
		   spell that in this format, so minutes and full dates agree. */
		const out = parse(
			[
				"## 2026-05-24",
				"- 15:00-09:00 · Backwards A",
				"## 2026-05-25",
				"- 15:00-09:00 · Backwards B",
				"## 2026-05-26",
				"- 09:00-10:00 · Fine",
			].join("\n")
		);
		expect(out.map((e) => e.title)).toEqual(["Fine"]);
	});

	it("drops a zero-length event under a heading", () => {
		const out = parse(
			["## 2026-05-24", "- 10:00-10:00 · Instant"].join("\n")
		);
		expect(out).toEqual([]);
	});

	it("sorts across days by date, then by time within a day", () => {
		const out = parse(
			[
				"## 2026-05-25",
				"- 17:00 · Late on day 2",
				"- 08:00 · Early on day 2",
				"## 2026-05-24",
				"- 12:00 · Day 1",
			].join("\n")
		);
		expect(out.map((e) => [e.date, e.title])).toEqual([
			["2026-05-24", "Day 1"],
			["2026-05-25", "Early on day 2"],
			["2026-05-25", "Late on day 2"],
		]);
	});
});

describe("toISODate", () => {
	it("uses local calendar fields, not UTC", () => {
		/* Asia/Bangkok is UTC+7, so 23:30 local on the 19th is already the 20th
		   in UTC. toISOString would report the wrong day every evening. */
		const late = new Date(2026, 6, 19, 23, 30);
		expect(toISODate(late)).toBe("2026-07-19");
	});

	it("zero-pads month and day", () => {
		expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
	});
});

/* ------------------------------------------------------------------------- */
/* View filtering — ONE rule shared by Day and Week. A day is a range of one, */
/* so the two views cannot drift apart on what belongs on screen.            */
/* ------------------------------------------------------------------------- */

const week = [
	"## 2026-05-24", // Sunday — previous week
	"- 09:00 · Sun",
	"## 2026-05-25", // Monday
	"- 09:00 · Mon",
	"## 2026-05-27", // Wednesday
	"- 09:00 · Wed",
	"## 2026-05-31", // Sunday — end of that week
	"- 09:00 · Sun end",
	"## 2026-06-01", // Monday — next week
	"- 09:00 · Next Mon",
].join("\n");

describe("eventsOnDay", () => {
	it("keeps only the named day", () => {
		const out = eventsOnDay(parse(week), "2026-05-27");
		expect(out.map((e) => e.title)).toEqual(["Wed"]);
	});

	it("returns nothing for a day with no events", () => {
		expect(eventsOnDay(parse(week), "2026-05-26")).toEqual([]);
	});

	it("does not leak the neighbouring days", () => {
		/* The regression this guards: a filter loosened to >= or a range that
		   forgets its upper bound would drag the rest of the file onto one
		   rail. */
		const out = eventsOnDay(parse(week), "2026-05-25");
		expect(out.map((e) => e.title)).toEqual(["Mon"]);
	});
});

describe("eventsInRange", () => {
	it("is inclusive at both ends", () => {
		const out = eventsInRange(parse(week), "2026-05-25", "2026-05-31");
		expect(out.map((e) => e.title)).toEqual(["Mon", "Wed", "Sun end"]);
	});

	it("excludes the days either side of the range", () => {
		const out = eventsInRange(parse(week), "2026-05-25", "2026-05-31");
		expect(out.map((e) => e.title)).not.toContain("Sun");
		expect(out.map((e) => e.title)).not.toContain("Next Mon");
	});

	it("returns nothing for an empty week", () => {
		expect(eventsInRange(parse(week), "2026-08-03", "2026-08-09")).toEqual([]);
	});
});

describe("weekDatesFor", () => {
	it("returns seven consecutive days starting Monday", () => {
		expect(weekDatesFor("2026-05-27")).toEqual([
			"2026-05-25",
			"2026-05-26",
			"2026-05-27",
			"2026-05-28",
			"2026-05-29",
			"2026-05-30",
			"2026-05-31",
		]);
	});

	it("treats Sunday as the END of its week, not the start", () => {
		/* getDay() calls Sunday 0; a Monday-based grid has to map it to 6 or
		   every Sunday jumps a week forward. */
		expect(weekDatesFor("2026-05-31")[0]).toBe("2026-05-25");
		expect(weekDatesFor("2026-05-31")[6]).toBe("2026-05-31");
	});

	it("is stable for every day of one week", () => {
		const expected = weekDatesFor("2026-05-25");
		for (const d of expected) {
			expect(weekDatesFor(d)).toEqual(expected);
		}
	});

	it("crosses a month boundary", () => {
		expect(weekDatesFor("2026-06-01")).toEqual([
			"2026-06-01",
			"2026-06-02",
			"2026-06-03",
			"2026-06-04",
			"2026-06-05",
			"2026-06-06",
			"2026-06-07",
		]);
	});
});

describe("addDaysISO", () => {
	it("rolls over a month end", () => {
		expect(addDaysISO("2026-05-31", 1)).toBe("2026-06-01");
	});

	it("rolls over a year end backwards", () => {
		expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
	});

	it("handles a leap day", () => {
		expect(addDaysISO("2028-02-28", 1)).toBe("2028-02-29");
	});
});
