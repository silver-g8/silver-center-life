import { TFile, requestUrl } from "obsidian";
import type { App } from "obsidian";
import { CC_FOLDER } from "../persistence";

/* ------------------------------------------------------------------------- */
/* Live feeds for the Build tab.                                              */
/*                                                                            */
/* Everything here is READ-ONLY network data, never vault state — so the      */
/* cache lives in memory (not localStorage; Hard rule) and this file never    */
/* imports a save function. requestUrl (not fetch) is used for every request: */
/* it is a native Obsidian call that bypasses CORS, so public JSON endpoints  */
/* that a browser fetch would refuse just work. It is marked external in      */
/* esbuild, so importing it adds nothing to the bundle.                       */
/* ------------------------------------------------------------------------- */

export type HnItem = {
	id: number;
	title: string;
	/* External article for a story; the HN discussion page for an Ask/Show
	   post that has no url of its own — so a row always opens something. */
	url: string;
	score: number;
	by: string;
	time: number; // unix seconds, as HN reports it
};

export type RedditItem = {
	id: string;
	title: string;
	permalink: string; // absolute https URL
	subreddit: string;
	score: number;
	num_comments: number;
};

/* What a cached source hands back. `data` is always present (empty on a cold
   failure); `stale` means it is the last good data served after a failed
   refresh; `error` carries the reason when a refresh did not land. */
export type FeedResult<T> = {
	data: T[];
	fetchedAt: number; // epoch ms of the fetch that produced `data`
	stale: boolean;
	error: string | null;
};

const TTL_MS = 10 * 60 * 1000; // 10 minutes, same as the refresh interval

/* --- raw network fetchers (no caching; the wrapper below owns that) ------- */

const HN_BASE = "https://hacker-news.firebaseio.com/v0";
const HN_TAKE = 12;

async function hackerNewsRaw(): Promise<HnItem[]> {
	/* requestUrl throws on a >= 400 status by default, so a bad top-stories
	   response propagates straight to the cache wrapper as an error. */
	const top = await requestUrl({ url: `${HN_BASE}/topstories.json` });
	const ids = (top.json as number[]).slice(0, HN_TAKE);

	/* All 12 items in parallel. One flaky item must not sink the batch, so each
	   fetch is guarded on its own and simply drops out (null → filtered). */
	const settled = await Promise.all(
		ids.map(async (id): Promise<HnItem | null> => {
			try {
				const res = await requestUrl({ url: `${HN_BASE}/item/${id}.json` });
				const it = res.json as Record<string, unknown> | null;
				if (!it) return null;

				const title =
					typeof it.title === "string" ? it.title.trim() : "";
				if (title === "") return null; // skip items with no title

				return {
					id: typeof it.id === "number" ? it.id : id,
					title,
					url:
						typeof it.url === "string" && it.url !== ""
							? it.url
							: `https://news.ycombinator.com/item?id=${id}`,
					score: typeof it.score === "number" ? it.score : 0,
					by: typeof it.by === "string" ? it.by : "",
					time: typeof it.time === "number" ? it.time : 0,
				};
			} catch {
				return null;
			}
		})
	);

	return settled.filter((x): x is HnItem => x !== null);
}

const REDDIT_URL =
	"https://www.reddit.com/r/LocalLLaMA+MachineLearning+ClaudeAI/hot.json?limit=15&raw_json=1";

async function redditRaw(): Promise<RedditItem[]> {
	/* Reddit rejects requests with no User-Agent (429/403), so send an explicit
	   one. No API key — this is the public JSON endpoint (Hard rule). */
	const res = await requestUrl({
		url: REDDIT_URL,
		headers: {
			"User-Agent": "obsidian-command-center/0.1 (personal dashboard)",
		},
	});

	const json = res.json as { data?: { children?: unknown[] } } | null;
	const children = json?.data?.children;
	if (!Array.isArray(children)) {
		throw new Error("Reddit: unexpected response shape");
	}

	const items: RedditItem[] = [];
	for (const child of children) {
		const d = (child as { data?: Record<string, unknown> })?.data;
		if (!d || typeof d.title !== "string" || d.title.trim() === "") continue;

		items.push({
			id: typeof d.id === "string" ? d.id : String(d.id ?? ""),
			title: d.title,
			permalink:
				typeof d.permalink === "string"
					? `https://www.reddit.com${d.permalink}`
					: "https://www.reddit.com",
			subreddit: typeof d.subreddit === "string" ? d.subreddit : "",
			score: typeof d.score === "number" ? d.score : 0,
			num_comments:
				typeof d.num_comments === "number" ? d.num_comments : 0,
		});
	}

	return items;
}

/* --- caching wrapper: TTL + single in-flight promise per source ----------- */

/* One factory per source. It closes over that source's cache and its own
   in-flight promise, so the two sources never share either — a Reddit refresh
   can be running while Hacker News is served straight from cache. */
/* Exported for tests only — they build their own feed over a fake fetcher.
   fetchHackerNews / fetchReddit below stay the app's entry points, unchanged. */
export function createFeed<T>(
	raw: () => Promise<T[]>
): () => Promise<FeedResult<T>> {
	let cache: { data: T[]; fetchedAt: number } | null = null;
	let inFlight: Promise<FeedResult<T>> | null = null;

	return function fetchCached(): Promise<FeedResult<T>> {
		const now = Date.now();

		/* Fresh enough — serve the cache, no network at all. */
		if (cache && now - cache.fetchedAt < TTL_MS) {
			return Promise.resolve({
				data: cache.data,
				fetchedAt: cache.fetchedAt,
				stale: false,
				error: null,
			});
		}

		/* A request for this source is already running: hand back the very same
		   promise so two callers never fire two concurrent requests. */
		if (inFlight) return inFlight;

		inFlight = (async (): Promise<FeedResult<T>> => {
			try {
				const data = await raw();
				cache = { data, fetchedAt: Date.now() };
				return {
					data,
					fetchedAt: cache.fetchedAt,
					stale: false,
					error: null,
				};
			} catch (e) {
				const error = e instanceof Error ? e.message : String(e);

				/* Serve the last good data marked stale; its fetchedAt is left
				   untouched so it stays past-TTL and the next scheduled refresh
				   retries. No retry loop here — the interval is the retry. */
				if (cache) {
					return {
						data: cache.data,
						fetchedAt: cache.fetchedAt,
						stale: true,
						error,
					};
				}
				return { data: [], fetchedAt: now, stale: false, error };
			} finally {
				inFlight = null;
			}
		})();

		return inFlight;
	};
}

export const fetchHackerNews = createFeed(hackerNewsRaw);
export const fetchReddit = createFeed(redditRaw);

/* ------------------------------------------------------------------------- */
/* Curated tweets: command-center/tweets.md                                   */
/*                                                                            */
/* One entry per line: "- text · @handle · optional-url". Read-only from the  */
/* app's side — there is no save function, so the vault watcher can reload it  */
/* without any echo-suppression (nothing we write ever bounces back).         */
/* ------------------------------------------------------------------------- */

export const TWEETS_PATH = `${CC_FOLDER}/tweets.md`;

export type TweetItem = {
	text: string;
	handle: string;
	url: string | null;
};

const TWEETS_SEED =
	"- Build the smallest thing that could possibly work, then grow it · @naval\n" +
	"- Ship every day. Momentum compounds faster than polish. · @levelsio · https://twitter.com/levelsio\n";

/* Splits on the middle-dot separator. Missing trailing fields are fine: a
   line with just text is a valid tweet with an empty handle and no url. */
export function parseTweets(raw: string): TweetItem[] {
	const items: TweetItem[] = [];

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("-")) continue;

		const body = trimmed.replace(/^-\s*/, "");
		if (body === "") continue;

		const parts = body.split("·").map((p) => p.trim());
		const text = parts[0] ?? "";
		if (text === "") continue;

		const handle = parts[1] ?? "";
		const url = parts[2] && parts[2] !== "" ? parts[2] : null;
		items.push({ text, handle, url });
	}

	return items;
}

/* Local copy of persistence.ts's folder guard — feeds.ts must not touch that
   file, and this only needs the one-liner. */
async function ensureFolder(app: App, path: string): Promise<void> {
	if (app.vault.getAbstractFileByPath(path)) return;
	try {
		await app.vault.createFolder(path);
	} catch {
		/* Raced with another create — the folder exists now either way. */
	}
}

export async function loadTweets(app: App): Promise<TweetItem[]> {
	await ensureFolder(app, CC_FOLDER);

	const file = app.vault.getAbstractFileByPath(TWEETS_PATH);

	if (!(file instanceof TFile)) {
		await app.vault.create(TWEETS_PATH, TWEETS_SEED);
		return parseTweets(TWEETS_SEED);
	}

	let raw: string;
	try {
		raw = await app.vault.read(file);
	} catch {
		return [];
	}

	return parseTweets(raw);
}
