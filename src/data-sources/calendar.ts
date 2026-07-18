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
	start: string; // raw "HH:MM"
	end: string | null; // raw "HH:MM", or null for a point event
	title: string;
	tag: string | null;
	startMin: number; // minutes from midnight — for layout math
	endMin: number | null; // minutes from midnight, or null for a point event
};

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
   Tolerant by contract: a malformed line is dropped, never thrown. Result is
   sorted by start time ascending so the UI can lay it out top-to-bottom. */
export function parseCalendar(raw: string): CalEvent[] {
	const events: CalEvent[] = [];

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("-")) continue;

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
			start: startRaw.trim(),
			end,
			title,
			tag,
			startMin,
			endMin,
		});
	}

	events.sort((a, b) => a.startMin - b.startMin);
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
