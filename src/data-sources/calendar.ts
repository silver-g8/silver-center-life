import { TFile } from "obsidian";
import type { App } from "obsidian";
import { CC_FOLDER } from "../persistence";

/* ------------------------------------------------------------------------- */
/* Day view calendar: command-center/calendar.md                              */
/*                                                                            */
/* LOCAL-ONLY, READ-ONLY (Hard rules). No sync, no external API, no save —    */
/* the app only ever reads this file, so, exactly like tweets in feeds.ts,    */
/* the vault watcher can reload it with no echo-suppression (nothing we write */
/* ever bounces back). Writing calendar.md is Phase 6c, not this file.        */
/* ------------------------------------------------------------------------- */

export const CALENDAR_PATH = `${CC_FOLDER}/calendar.md`;

export type CalEvent = {
	date: string; // "YYYY-MM-DD" — which day column this belongs to
	start: string; // raw "HH:MM"
	end: string | null; // raw "HH:MM", or null for a point event
	title: string;
	tag: string | null;
	startMin: number; // minutes from midnight — for layout math
	endMin: number | null; // minutes from midnight, or null for a point event
};

/* Local calendar date as "YYYY-MM-DD".
   NOT toISOString(): that converts to UTC first, so anywhere east of London
   (Asia/Bangkok is UTC+7) every evening would report tomorrow's date. */
export function toISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/* ISO dates are fixed-width and zero-padded, so lexical order IS date order
   and a range check needs no Date objects at all. */
export function eventsInRange(
	events: CalEvent[],
	fromISO: string,
	toISO: string
): CalEvent[] {
	return events.filter((ev) => ev.date >= fromISO && ev.date <= toISO);
}

/* The one filter both views use. A day is just a week of length one, so Day
   and Week can never drift apart on what "belongs to this view" means. */
export function eventsOnDay(events: CalEvent[], dayISO: string): CalEvent[] {
	return eventsInRange(events, dayISO, dayISO);
}

export function addDaysISO(iso: string, days: number): string {
	const [y, m, d] = iso.split("-").map(Number);
	/* Day-of-month arithmetic on a local Date rolls months and years for us. */
	return toISODate(new Date(y, m - 1, d + days));
}

/* The seven dates of the Monday-based week containing `iso`. */
export function weekDatesFor(iso: string): string[] {
	const [y, m, d] = iso.split("-").map(Number);
	const dow = new Date(y, m - 1, d).getDay(); // 0 = Sunday
	const backToMonday = (dow + 6) % 7; // Monday → 0, Sunday → 6
	const monday = addDaysISO(iso, -backToMonday);
	return Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i));
}

/* "## 2026-07-19" — any heading level, nothing else on the line. */
const DATE_HEADING = /^#{1,6}\s+(\d{4})-(\d{2})-(\d{2})\s*$/;

/* Rejects a heading like "## 2026-02-30": the numbers parse but the day does
   not exist, and Date would roll it forward to March 2 without complaining. */
function validISODate(y: string, m: string, d: string): string | null {
	const date = new Date(Number(y), Number(m) - 1, Number(d));
	if (
		date.getFullYear() !== Number(y) ||
		date.getMonth() !== Number(m) - 1 ||
		date.getDate() !== Number(d)
	) {
		return null;
	}
	return `${y}-${m}-${d}`;
}

/* "HH:MM" → minutes from midnight, or null if it is not a real time. Tolerant
   of a single-digit hour ("9:00"); rejects out-of-range values so a typo like
   "25:99" drops its line instead of positioning a block off the rail. */
function parseTimeToMin(raw: string): number | null {
	const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;

	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h < 0 || h > 23 || min < 0 || min > 59) return null;

	return h * 60 + min;
}

/* One event per line, splitting on the middle dot exactly like parseTweets:
     - HH:MM-HH:MM · title · optional-tag   (a block)
     - HH:MM · title · optional-tag         (a point event, end/endMin null)
   Lines are filed under the most recent "## YYYY-MM-DD" heading above them.

   `today` is passed in rather than read from the clock so the function stays
   pure and the floating-date rule below is testable without faking time.

   Three decisions this parser makes, each pinned by a test:

   1. FLOATING, not pinned. A line above the first heading belongs to `today`,
      re-resolved on every read — so yesterday's un-headed list shows up as
      today's plan tomorrow. That is the behaviour calendar.md already had
      before dates existed (the file WAS "today"), and pinning instead would
      mean writing a date back into the file, which is Phase 6c. Adding a
      heading is how you opt a line out of floating.
   2. DUPLICATE HEADINGS MERGE. The same date appearing twice contributes all
      of its events to that day rather than the later block replacing the
      earlier one — this file is hand-edited and appending a second "## today"
      further down is an easy thing to do; last-wins would silently eat the
      first block.
   3. AN INVALID DATE HEADING DROPS ITS SECTION. "## 2026-02-30" is not a day,
      so its events go nowhere until the next valid heading. Filing them under
      the previous date instead would put them on the wrong day silently;
      dropping them is visible, and the fix is to correct the heading.

   Tolerant by contract otherwise: a malformed line is dropped, never thrown.
   Result is sorted by date, then by start time ascending. */
export function parseCalendar(
	raw: string,
	today: string = toISODate(new Date())
): CalEvent[] {
	const events: CalEvent[] = [];

	/* null while inside a section whose heading named a date that does not
	   exist — see decision 3. */
	let current: string | null = today;

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();

		const heading = DATE_HEADING.exec(trimmed);
		if (heading) {
			current = validISODate(heading[1], heading[2], heading[3]);
			continue;
		}

		if (!trimmed.startsWith("-")) continue;
		if (current === null) continue; // inside a dead section

		const body = trimmed.replace(/^-\s*/, "");
		if (body === "") continue;

		const parts = body.split("·").map((p) => p.trim());
		const timeSpec = parts[0] ?? "";

		/* "HH:MM-HH:MM" (block) or "HH:MM" (point). The times contain no dash,
		   so the first dash — if any — separates start from end. */
		const dash = timeSpec.indexOf("-");
		const startRaw = dash === -1 ? timeSpec : timeSpec.slice(0, dash);
		const endRaw = dash === -1 ? null : timeSpec.slice(dash + 1);

		const startMin = parseTimeToMin(startRaw);
		if (startMin === null) continue; // unparseable start → drop the line

		let end: string | null = null;
		let endMin: number | null = null;
		if (endRaw !== null) {
			const parsedEnd = parseTimeToMin(endRaw);
			if (parsedEnd === null) continue; // malformed end → drop, never throw
			/* An end at or before the start can't be laid out — the height math
			   downstream would go zero or negative. Drop it here so the data
			   layer only ever hands the UI events it can actually draw. */
			if (parsedEnd <= startMin) continue;
			end = endRaw.trim();
			endMin = parsedEnd;
		}

		const title = parts[1] ?? "";
		if (title === "") continue; // empty title → drop the line

		const tag = parts[2] && parts[2] !== "" ? parts[2] : null;

		events.push({
			date: current,
			start: startRaw.trim(),
			end,
			title,
			tag,
			startMin,
			endMin,
		});
	}

	/* Date first, so a duplicate heading's events merge into their day in time
	   order rather than staying in file order. */
	events.sort((a, b) =>
		a.date === b.date
			? a.startMin - b.startMin
			: a.date < b.date
				? -1
				: 1
	);
	return events;
}

const CAL_SEED =
	"- 09:00-09:30 · Morning standup · work\n" +
	"- 12:30 · Lunch\n" +
	"- 14:00-15:30 · Deep work block · focus\n";

/* Local copy of persistence.ts's folder guard — this file must not touch that
   one, and it only needs the one-liner (same as feeds.ts's loadTweets). */
async function ensureFolder(app: App, path: string): Promise<void> {
	if (app.vault.getAbstractFileByPath(path)) return;
	try {
		await app.vault.createFolder(path);
	} catch {
		/* Raced with another create — the folder exists now either way. */
	}
}

export async function loadCalendar(app: App): Promise<CalEvent[]> {
	await ensureFolder(app, CC_FOLDER);

	const file = app.vault.getAbstractFileByPath(CALENDAR_PATH);

	if (!(file instanceof TFile)) {
		await app.vault.create(CALENDAR_PATH, CAL_SEED);
		return parseCalendar(CAL_SEED);
	}

	let raw: string;
	try {
		raw = await app.vault.read(file);
	} catch {
		return [];
	}

	return parseCalendar(raw);
}
