import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFeed, parseTweets } from "./feeds";

const TTL_MS = 10 * 60 * 1000; // must match feeds.ts

/* Only Date is faked. Faking the whole timer set would also freeze the
   microtask queue, and the in-flight test below deliberately leaves a promise
   pending across an await — with a frozen event loop it would hang instead of
   proving anything. We want to move the clock, not stop the world. */
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-07-19T09:00:00Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

/* A promise we resolve by hand, so a fetch can be held open on purpose. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("createFeed — TTL caching", () => {
	it("serves the cache without calling raw again inside the TTL", async () => {
		const raw = vi.fn().mockResolvedValue([{ id: 1 }]);
		const feed = createFeed(raw);

		const first = await feed();
		vi.setSystemTime(Date.now() + TTL_MS - 1000); // still fresh
		const second = await feed();

		expect(raw).toHaveBeenCalledTimes(1);
		expect(second.data).toEqual([{ id: 1 }]);
		expect(second.stale).toBe(false);
		expect(second.error).toBeNull();
		expect(second.fetchedAt).toBe(first.fetchedAt); // cache, not a refetch
	});

	it("refetches once the TTL has expired", async () => {
		const raw = vi
			.fn()
			.mockResolvedValueOnce([{ id: 1 }])
			.mockResolvedValueOnce([{ id: 2 }]);
		const feed = createFeed(raw);

		const first = await feed();
		vi.setSystemTime(Date.now() + TTL_MS + 1000);
		const second = await feed();

		expect(raw).toHaveBeenCalledTimes(2);
		expect(second.data).toEqual([{ id: 2 }]);
		expect(second.stale).toBe(false);
		expect(second.error).toBeNull();
		expect(second.fetchedAt).toBeGreaterThan(first.fetchedAt);
	});
});

describe("createFeed — in-flight dedup", () => {
	it("hands two concurrent callers the same in-flight promise", async () => {
		/* The raw fetch is held open on purpose. If we awaited the first call
		   before making the second, the second would hit the fresh cache and the
		   test would pass without ever touching `if (inFlight) return inFlight`
		   — green for the wrong reason. Both calls must be made while the first
		   request is still unresolved. */
		const d = deferred<{ id: number }[]>();
		const raw = vi.fn().mockReturnValue(d.promise);
		const feed = createFeed(raw);

		const a = feed();
		const b = feed(); // no await in between — first request still open

		expect(raw).toHaveBeenCalledTimes(1);
		expect(a).toBe(b); // the very same promise object, not just equal data

		d.resolve([{ id: 1 }]);
		const [ra, rb] = await Promise.all([a, b]);

		expect(raw).toHaveBeenCalledTimes(1);
		expect(ra).toEqual(rb);
		expect(ra.data).toEqual([{ id: 1 }]);
		expect(ra.stale).toBe(false);
		expect(ra.error).toBeNull();
	});
});

describe("createFeed — failure paths", () => {
	it("serves the last good data as stale when a refresh fails", async () => {
		const raw = vi
			.fn()
			.mockResolvedValueOnce([{ id: 1 }])
			.mockRejectedValueOnce(new Error("offline"));
		const feed = createFeed(raw);

		const good = await feed();
		vi.setSystemTime(Date.now() + TTL_MS + 1000);
		const stale = await feed();

		expect(stale.data).toEqual([{ id: 1 }]); // last good data, not empty
		expect(stale.stale).toBe(true);
		expect(stale.error).toBe("offline");
		/* fetchedAt is deliberately left at the last SUCCESSFUL fetch, which
		   keeps the entry past-TTL so the next refresh retries. */
		expect(stale.fetchedAt).toBe(good.fetchedAt);
	});

	it("returns empty non-stale data when the very first fetch fails", async () => {
		const raw = vi.fn().mockRejectedValue(new Error("cold failure"));
		const feed = createFeed(raw);

		const res = await feed();

		expect(res.data).toEqual([]);
		/* Not stale: there is no previous good data being served, so the UI must
		   not badge this as stale content. */
		expect(res.stale).toBe(false);
		expect(res.error).toBe("cold failure");
	});

	it("retries on the next call after serving stale data", async () => {
		const raw = vi
			.fn()
			.mockResolvedValueOnce([{ id: 1 }])
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce([{ id: 2 }]);
		const feed = createFeed(raw);

		await feed();
		vi.setSystemTime(Date.now() + TTL_MS + 1000);
		const stale = await feed();
		expect(stale.stale).toBe(true);

		/* No clock move here: the stale result kept the old fetchedAt, so the
		   entry is still past-TTL and this call must go back to the network. */
		const recovered = await feed();

		expect(raw).toHaveBeenCalledTimes(3);
		expect(recovered.data).toEqual([{ id: 2 }]);
		expect(recovered.stale).toBe(false);
		expect(recovered.error).toBeNull();
	});
});

describe("parseTweets", () => {
	it("parses text, handle and url", () => {
		expect(parseTweets("- Ship daily · @levelsio · https://x.com/l")).toEqual([
			{
				text: "Ship daily",
				handle: "@levelsio",
				url: "https://x.com/l",
			},
		]);
	});

	it("treats a missing url as null and a missing handle as empty", () => {
		expect(parseTweets("- Just a thought")).toEqual([
			{ text: "Just a thought", handle: "", url: null },
		]);
	});

	it("skips non-list lines and empty bodies", () => {
		const out = parseTweets(["# Tweets", "-", "- Real one · @me"].join("\n"));
		expect(out).toEqual([{ text: "Real one", handle: "@me", url: null }]);
	});
});
