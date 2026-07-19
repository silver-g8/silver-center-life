import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekView, DayView } from "./app";
import { parseCalendar, stepDate } from "./data-sources/calendar";

/* These render the real component, not a re-implementation of its maths, so a
   change that keeps laneAssign correct but wires it into the DOM wrongly still
   fails here. Wednesday 2026-05-27 12:00 local is the fixed "now". */
const NOW = new Date(2026, 4, 27, 12, 0).getTime();

/* anchorISO and todayISO are props now (6b.1): the component reads no clock of
   its own, so these tests pin a date without faking timers. Both default to the
   same Wednesday, which is the pre-navigation behaviour the old tests assumed;
   the navigation tests below pass them apart on purpose. */
const render = (raw: string, anchorISO = "2026-05-27", todayISO = "2026-05-27") =>
	renderToStaticMarkup(
		<WeekView
			events={parseCalendar(raw, "2026-05-27")}
			now={NOW}
			anchorISO={anchorISO}
			todayISO={todayISO}
		/>
	);

describe("WeekView — empty states", () => {
	it("shows the empty message when the whole week has nothing", () => {
		const html = render("");
		expect(html).toContain("Nothing this week");
		expect(html).not.toContain("cc-week__event-title");
	});

	it("shows the empty message when events exist but land in another week", () => {
		const html = render(["## 2026-08-10", "- 09:00 · Far away"].join("\n"));
		expect(html).toContain("Nothing this week");
	});

	it("renders a day with no events as an empty column, not a hole", () => {
		const html = render(["## 2026-05-27", "- 09:00 · Only Wednesday"].join("\n"));
		/* Seven columns always, however sparse the week. Counted via __lane,
		   which appears exactly once per column — matching on __col would also
		   catch the "--today" modifier and report eight. */
		expect(html.match(/cc-week__lane/g) ?? []).toHaveLength(7);
		expect(html.match(/cc-week__event-title/g) ?? []).toHaveLength(1);
	});
});

describe("WeekView — lane geometry reaches the DOM", () => {
	it("gives a lone event the full column width", () => {
		const html = render(["## 2026-05-27", "- 09:00-10:00 · Alone"].join("\n"));
		expect(html).toContain("width:100%");
		expect(html).toContain("left:0%");
	});

	it("splits two overlapping events into half-width lanes", () => {
		const html = render(
			[
				"## 2026-05-27",
				"- 09:00-11:00 · First",
				"- 10:00-12:00 · Second",
			].join("\n")
		);
		expect(html).toContain("width:50%");
		expect(html).toContain("left:0%");
		expect(html).toContain("left:50%");
		expect(html).not.toContain("width:100%");
	});

	it("keeps back-to-back events full width", () => {
		const html = render(
			[
				"## 2026-05-27",
				"- 09:00-10:00 · Before",
				"- 10:00-11:00 · After",
			].join("\n")
		);
		expect(html).toContain("width:100%");
		expect(html).not.toContain("width:50%");
	});

	it("does not let a busy day narrow a quiet one", () => {
		/* Three-way collision on Monday, a single event on Wednesday. If
		   laneAssign were called across the week instead of per column, the
		   Wednesday block would come out a third of a column wide. */
		const html = render(
			[
				"## 2026-05-25",
				"- 09:00-12:00 · A",
				"- 09:30-12:30 · B",
				"- 10:00-11:00 · C",
				"## 2026-05-27",
				"- 09:00-10:00 · Quiet",
			].join("\n")
		);
		expect(html).toContain("width:33.333333333333336%");
		expect(html).toContain("width:100%"); // Wednesday keeps its whole column
	});
});

describe("WeekView — the week it shows", () => {
	it("renders Monday to Sunday of the current week only", () => {
		const html = render(
			[
				"## 2026-05-24", // Sunday before
				"- 09:00 · Previous week",
				"## 2026-05-25",
				"- 09:00 · This Monday",
				"## 2026-05-31",
				"- 09:00 · This Sunday",
				"## 2026-06-01", // Monday after
				"- 09:00 · Next week",
			].join("\n")
		);
		expect(html).toContain("This Monday");
		expect(html).toContain("This Sunday");
		expect(html).not.toContain("Previous week");
		expect(html).not.toContain("Next week");
	});

	it("marks today's column", () => {
		const html = render("");
		expect(html).not.toContain("cc-week__col--today"); // empty week: no grid
		const withEvents = render(
			["## 2026-05-27", "- 09:00 · Today"].join("\n")
		);
		expect(withEvents.match(/cc-week__col--today/g) ?? []).toHaveLength(1);
	});
});

/* ---- Phase 6b.1: the anchor and today are separate inputs ---------------- *
   The click itself cannot be tested here — these render to static markup, with
   no DOM and no event loop (see the note in CLAUDE.md). What IS covered: the
   props the click handler sets actually steer what the child draws, so the
   only untested link is the onClick wiring, and the transition behind it is
   pinned by the nextPinned tests in calendar.test.ts.                        */

describe("WeekView — anchorISO steers the week", () => {
	it("shows the week containing the anchor, not the week containing today", () => {
		const raw = [
			"## 2026-05-27",
			"- 09:00 · This week",
			"## 2026-06-03",
			"- 09:00 · Next week",
		].join("\n");

		/* Anchor a week ahead of "today" — exactly the state after one › press. */
		const html = render(raw, "2026-06-03", "2026-05-27");

		expect(html).toContain("Next week");
		expect(html).not.toContain("This week");
	});

	it("moves the grid by exactly seven days when the anchor steps a week", () => {
		const raw = ["## 2026-06-03", "- 09:00 · Next week"].join("\n");

		expect(render(raw, "2026-05-27", "2026-05-27")).not.toContain("Next week");
		expect(
			render(raw, stepDate("2026-05-27", "week", 1), "2026-05-27")
		).toContain("Next week");
	});
});

describe("WeekView — today marking follows todayISO, not the anchor", () => {
	/* Every case here needs a real event in the week on screen: an empty week
	   renders the "Nothing this week" message and NO grid, so asserting that a
	   today-column is absent would pass without proving anything. */
	const bothWeeks = [
		"## 2026-05-27",
		"- 09:00 · This week",
		"## 2026-06-03",
		"- 09:00 · Next week",
	].join("\n");

	it("marks no column once the anchor leaves today's week", () => {
		const html = render(bothWeeks, "2026-06-03", "2026-05-27");
		expect(html).toContain("Next week"); // the grid really is drawn
		expect(html).not.toContain("cc-week__col--today");
	});

	it("still marks today's column when the anchor is today's week", () => {
		const html = render(bothWeeks, "2026-05-27", "2026-05-27");
		expect(html).toContain("cc-week__col--today");
	});

	it("marks exactly one column, never two", () => {
		const html = render(bothWeeks, "2026-05-27", "2026-05-27");
		expect(html.match(/cc-week__col--today/g) ?? []).toHaveLength(1);
	});
});

describe("DayView — dayISO steers the day", () => {
	const rawTwoDays = [
		"## 2026-05-27",
		"- 09:00 · Wednesday thing",
		"## 2026-05-28",
		"- 09:00 · Thursday thing",
	].join("\n");

	const renderDay = (dayISO: string, todayISO = "2026-05-27") =>
		renderToStaticMarkup(
			<DayView
				events={parseCalendar(rawTwoDays, "2026-05-27")}
				now={NOW}
				dayISO={dayISO}
				todayISO={todayISO}
			/>
		);

	it("shows the events of the day it is given", () => {
		expect(renderDay("2026-05-27")).toContain("Wednesday thing");
		expect(renderDay("2026-05-27")).not.toContain("Thursday thing");
	});

	it("shows the next day's events after one › step", () => {
		const next = stepDate("2026-05-27", "day", 1);
		expect(renderDay(next)).toContain("Thursday thing");
		expect(renderDay(next)).not.toContain("Wednesday thing");
	});

	it("draws the now-line only on today", () => {
		/* Navigating to another day must not paint a now-line there — it would
		   read as "you are here" on a day that is not now. */
		expect(renderDay("2026-05-27")).toContain("cc-day__now");
		expect(renderDay("2026-05-28")).not.toContain("cc-day__now");
	});
});
