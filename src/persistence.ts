import { TFile, parseYaml, stringifyYaml } from "obsidian";
import type { App } from "obsidian";

export const CC_FOLDER = "command-center";
export const MIT_PATH = `${CC_FOLDER}/mit.md`;

export type Mit = {
	title: string;
	project: string;
	est: number;
	startedAt: number | null;
};

export type Timer = {
	totalSec: number;
	startedAt: number;
	pausedAt: number | null;
	pausedAccumSec: number;
	active: boolean;
};

export type MitState = {
	mit: Mit;
	timer: Timer;
};

const DEFAULT_TITLE = "Pick your first task";
const DEFAULT_PROJECT = "—";
const DEFAULT_EST = 25;

export function defaultState(): MitState {
	const startedAt = Date.now();

	return {
		mit: {
			title: DEFAULT_TITLE,
			project: DEFAULT_PROJECT,
			est: DEFAULT_EST,
			startedAt,
		},
		timer: {
			totalSec: DEFAULT_EST * 60,
			startedAt,
			pausedAt: null,
			pausedAccumSec: 0,
			active: true,
		},
	};
}

export function isCommandCenterPath(path: string): boolean {
	return path === CC_FOLDER || path.startsWith(`${CC_FOLDER}/`);
}

/* Everything below treats the frontmatter as hostile: it is plain markdown in
   the vault and hand-editing it is expected, so anything missing, mistyped or
   out of range falls back instead of reaching the clock as NaN. */

function readString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function readPositive(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

function readNonNegative(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

const pad = (n: number) => String(n).padStart(2, "0");

/* Local wall time with an offset: 2026-07-17T07:58:58+07:00. toISOString would
   write 00:58Z for that same instant, which matches nothing the banner shows —
   and a file you cannot read at a glance is the reason to use a DB, not
   markdown. Milliseconds are dropped; see readTimestamp for why that is free. */
function formatTimestamp(epochMs: number): string {
	const d = new Date(epochMs);

	const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

	/* getTimezoneOffset counts minutes *behind* UTC, so Bangkok reports -420
	   and the sign has to be flipped to render +07:00. */
	const offsetMin = -d.getTimezoneOffset();
	const abs = Math.abs(offsetMin);
	const offset = `${offsetMin < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(
		abs % 60
	)}`;

	return `${date}T${time}${offset}`;
}

function toEpochMs(value: unknown): number | null {
	/* Files written before this format existed hold raw epoch ms. Reading them
	   is the whole migration: the next save rewrites them as local ISO. */
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}

	/* An unquoted ISO timestamp never reaches us as a string — js-yaml has
	   already turned it into a Date. Miss this branch and every hand-edited
	   file falls back to defaults. */
	if (value instanceof Date) {
		const ms = value.getTime();
		return Number.isFinite(ms) ? ms : null;
	}

	if (typeof value === "string") {
		const ms = Date.parse(value);
		return Number.isFinite(ms) ? ms : null;
	}

	return null;
}

/* A start in the future would make remainingSecAt read above totalSec, so it
   is corrupt by definition rather than merely odd. */
function readTimestamp(value: unknown, now: number, fallback: number): number {
	const ms = toEpochMs(value);
	return ms !== null && ms > 0 && ms <= now ? ms : fallback;
}

function parseState(raw: unknown, now: number): MitState {
	const fallback = defaultState();
	if (raw === null || typeof raw !== "object") return fallback;

	const fm = raw as Record<string, unknown>;

	const est = readPositive(fm.est, DEFAULT_EST);
	const startedAt = readTimestamp(fm.startedAt, now, fallback.timer.startedAt);
	const totalSec = readPositive(fm.totalSec, est * 60);

	const pausedAtRaw = readTimestamp(fm.pausedAt, now, 0);
	const pausedAt = pausedAtRaw >= startedAt && pausedAtRaw > 0 ? pausedAtRaw : null;

	/* Paused time can never exceed the wall time the block has existed for, or
	   the clock reads above totalSec and the progress bar goes negative. */
	const wallSec = Math.max(0, (now - startedAt) / 1000);
	const openPauseSec = pausedAt === null ? 0 : (now - pausedAt) / 1000;
	const pausedAccumSec = Math.min(
		readNonNegative(fm.pausedAccumSec, 0),
		Math.max(0, wallSec - openPauseSec)
	);

	return {
		mit: {
			title: readString(fm.title, DEFAULT_TITLE),
			project: readString(fm.project, DEFAULT_PROJECT),
			est,
			startedAt,
		},
		timer: {
			totalSec,
			startedAt,
			pausedAt,
			pausedAccumSec,
			active: readBool(fm.active, true),
		},
	};
}

/* Only the --- fences are located here; the YAML between them always goes
   through parseYaml. */
function splitFrontmatter(raw: string): { yaml: string; body: string } {
	const lines = raw.split("\n");
	if (lines[0]?.trim() !== "---") return { yaml: "", body: raw };

	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			return {
				yaml: lines.slice(1, i).join("\n"),
				body: lines.slice(i + 1).join("\n"),
			};
		}
	}

	return { yaml: "", body: raw };
}

/* FNV-1a. This only has to recognise our own write coming back as a modify
   event, so a cryptographic digest would be wasted work. */
function hashContent(content: string): string {
	let hash = 0x811c9dc5;

	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(16);
}

const lastWritten = new Map<string, string>();

export function isEcho(path: string, content: string): boolean {
	return lastWritten.get(path) === hashContent(content);
}

async function ensureFolder(app: App): Promise<void> {
	if (app.vault.getAbstractFileByPath(CC_FOLDER)) return;

	try {
		await app.vault.createFolder(CC_FOLDER);
	} catch {
		/* Someone else created it between the check and the call. */
	}
}

async function writeState(
	app: App,
	mit: Mit,
	timer: Timer,
	body: string
): Promise<void> {
	const frontmatter = {
		title: mit.title,
		project: mit.project,
		est: mit.est,
		totalSec: timer.totalSec,
		startedAt: formatTimestamp(timer.startedAt),
		pausedAt: timer.pausedAt === null ? null : formatTimestamp(timer.pausedAt),
		/* Rounded on the way out only — memory keeps the fractional seconds, so
		   this never feeds back on itself. */
		pausedAccumSec: Math.round(timer.pausedAccumSec),
		active: timer.active,
	};

	/* stringifyYaml is expected to end with a newline; if it ever does not the
	   closing fence would weld onto the last field and corrupt the file. */
	const yaml = stringifyYaml(frontmatter);
	const content = `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${body}`;

	lastWritten.set(MIT_PATH, hashContent(content));

	const file = app.vault.getAbstractFileByPath(MIT_PATH);
	if (file instanceof TFile) {
		await app.vault.modify(file, content);
	} else {
		await app.vault.create(MIT_PATH, content);
	}
}

export async function loadMIT(app: App): Promise<MitState> {
	await ensureFolder(app);

	const file = app.vault.getAbstractFileByPath(MIT_PATH);

	if (!(file instanceof TFile)) {
		const state = defaultState();
		await writeState(app, state.mit, state.timer, "");
		return state;
	}

	let raw: string;
	try {
		raw = await app.vault.read(file);
	} catch {
		return defaultState();
	}

	const { yaml } = splitFrontmatter(raw);
	if (yaml.trim() === "") return defaultState();

	let parsed: unknown;
	try {
		parsed = parseYaml(yaml);
	} catch {
		/* Hand-edited into invalid YAML — fall back rather than kill the view. */
		return defaultState();
	}

	return parseState(parsed, Date.now());
}

export async function saveMIT(app: App, mit: Mit, timer: Timer): Promise<void> {
	await ensureFolder(app);

	const file = app.vault.getAbstractFileByPath(MIT_PATH);
	let body = "";

	/* Anything the user typed under the frontmatter is theirs — read it back
	   out and put it straight back. */
	if (file instanceof TFile) {
		try {
			body = splitFrontmatter(await app.vault.read(file)).body;
		} catch {
			body = "";
		}
	}

	await writeState(app, mit, timer, body);
}
