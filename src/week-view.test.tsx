import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekView } from "./app";
import { parseCalendar } from "./data-sources/calendar";

/* These render the real component, not a re-implementation of its maths, so a
   change that keeps laneAssign correct but wires it into the DOM wrongly still
   fails here. Wednesday 2026-05-27 12:00 local is the fixed "now". */
const NOW = new Date(2026, 4, 27, 12, 0).getTime();

const render = (raw: string) =>
	renderToStaticMarkup(<WeekView events={parseCalendar(raw, "2026-05-27")} now={NOW} />);

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
