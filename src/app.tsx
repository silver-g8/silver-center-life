import { Notice, TFile } from "obsidian";
import type { App as ObsidianApp } from "obsidian";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
	MIT_PATH,
	defaultState,
	isCommandCenterPath,
	isEcho,
	loadMIT,
	loadTodos,
	saveMIT,
	saveTodos,
	todosPath,
} from "./persistence";
import type { Mit, MitState, Timer, TodoItem } from "./persistence";
import {
	TWEETS_PATH,
	fetchHackerNews,
	fetchReddit,
	loadTweets,
} from "./data-sources/feeds";
import type {
	FeedResult,
	HnItem,
	RedditItem,
	TweetItem,
} from "./data-sources/feeds";
import {
	CALENDAR_PATH,
	loadCalendar,
	toISODate,
	eventsOnDay,
	weekDatesFor,
} from "./data-sources/calendar";
import { laneAssign } from "./lanes";
import type { CalEvent } from "./data-sources/calendar";

/* `id` is the storage key — phase 5 writes command-center/todos/{id}.md.
   Renaming a tab must never move a file, so nothing outside this table may
   read `label`. */
const TABS = [
	{ id: "client", label: "Client" },
	{ id: "build", label: "Build" },
	{ id: "inbox", label: "Inbox" },
	{ id: "learn", label: "Learn" },
	{ id: "inspired", label: "Inspired" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/* The clock's only source of truth is wall time, never a tick count, so a
   throttled or suspended interval costs re-renders but never drifts. */
function remainingSecAt(timer: Timer, now: number) {
	if (!timer.active) return 0;

	const wallSec = (now - timer.startedAt) / 1000;
	const pausedSec =
		timer.pausedAccumSec +
		(timer.pausedAt === null ? 0 : (now - timer.pausedAt) / 1000);

	return Math.max(0, timer.totalSec - (wallSec - pausedSec));
}

/* A block that ran out while Obsidian was closed is finished, but it is not
   news — silently retire it so the Notice effect never sees it. That alert is
   for a block ending in front of you, not for yesterday's. */
function withStaleGuard(loaded: MitState): MitState {
	if (!loaded.timer.active) return loaded;
	if (remainingSecAt(loaded.timer, Date.now()) > 0) return loaded;

	return { ...loaded, timer: { ...loaded.timer, active: false } };
}

function formatClock(seconds: number) {
	const safe = Math.max(0, Math.ceil(seconds));
	const mm = Math.floor(safe / 60);
	const ss = safe % 60;
	return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function formatStarted(startedAt: number | null) {
	if (startedAt === null) return "not started";
	const at = new Date(startedAt).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
	return `started ${at}`;
}

function MitBanner({
	mit,
	timer,
	remainingSec,
	onPause,
	onAddFive,
	onDone,
}: {
	mit: Mit;
	timer: Timer;
	remainingSec: number;
	onPause: () => void;
	onAddFive: () => void;
	onDone: () => void;
}) {
	const paused = timer.pausedAt !== null;
	const status = !timer.active ? "idle" : paused ? "paused" : "running";
	const primaryLabel = !timer.active ? "Start" : paused ? "Resume" : "Pause";
	const pct =
		timer.totalSec > 0
			? ((timer.totalSec - remainingSec) / timer.totalSec) * 100
			: 0;

	return (
		<header className="cc-mit cc-card">
			<div className="cc-mit__main">
				<div className="cc-mit__label">
					<span className={`cc-mit__dot cc-mit__dot--${status}`} />
					Front Seat
				</div>

				<h1 className="cc-mit__title">{mit.title}</h1>

				<div
					className="cc-mit__progress"
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(pct)}
				>
					<div
						className="cc-mit__progress-fill"
						style={{ width: `${pct}%` }}
					/>
				</div>

				<div className="cc-mit__meta">
					<span className="cc-mit__tag">{mit.project}</span>
					<span className="cc-mit__sep">·</span>
					<span>{mit.est} min</span>
					<span className="cc-mit__sep">·</span>
					<span>{formatStarted(mit.startedAt)}</span>
				</div>
			</div>

			<div className="cc-mit__timer">
				<div className={`cc-mit__clock cc-mit__clock--${status}`}>
					{formatClock(remainingSec)}
				</div>

				<div className="cc-mit__actions">
					{/* Never disabled: this is the only way back from a finished
					    block, which now survives a reload. */}
					<button className="cc-pill" onClick={onPause}>
						{primaryLabel}
					</button>
					<button
						className="cc-pill"
						onClick={onAddFive}
						disabled={!timer.active}
					>
						+5m
					</button>
					<button
						className="cc-pill"
						onClick={onDone}
						disabled={!timer.active}
					>
						Done
					</button>
				</div>
			</div>
		</header>
	);
}

function TodoList({
	todos,
	seatTitle,
	onToggle,
	onPromote,
}: {
	todos: TodoItem[];
	/* Title of the todo currently in the front seat, or null when the seat
	   belongs to another tab — pure derived state, nothing extra on disk. */
	seatTitle: string | null;
	onToggle: (item: TodoItem) => void;
	onPromote: (item: TodoItem) => void;
}) {
	if (todos.length === 0) {
		return (
			<p className="cc-todos__empty">
				No todos yet — add checkboxes in {todosPath("client")}
			</p>
		);
	}

	return (
		<ul className="cc-todos">
			{todos.map((item) => (
				<li key={item.lineIndex}>
					{/* A row, not a <label>: label semantics would make a text
					    click tick the checkbox, and the text click is promote. */}
					<div
						className={
							item.text === seatTitle
								? "cc-todo cc-todo--seat"
								: "cc-todo"
						}
						onClick={() => onPromote(item)}
					>
						<input
							type="checkbox"
							className="cc-todo__box"
							checked={item.done}
							onClick={(e) => e.stopPropagation()}
							onChange={() => onToggle(item)}
						/>
						<span
							className={
								item.done
									? "cc-todo__text cc-todo__text--done"
									: "cc-todo__text"
							}
						>
							{item.text}
						</span>
					</div>
				</li>
			))}
		</ul>
	);
}

/* "7m ago" from a fetch timestamp. `now` is the shared clock the timer already
   drives, so this needs no interval of its own — and a refresh resets fetchedAt
   every 10 min, so the age is never far off even between clock ticks. */
function formatAge(fetchedAt: number, now: number): string {
	if (!fetchedAt) return "";

	const sec = Math.max(0, Math.floor((now - fetchedAt) / 1000));
	if (sec < 60) return `${sec}s ago`;

	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;

	return `${Math.floor(min / 60)}h ago`;
}

const openLink = (url: string) => window.open(url, "_blank");

function FeedCard({
	title,
	count,
	age,
	stale,
	loading,
	error,
	children,
}: {
	title: string;
	count: number;
	age: string;
	stale: boolean;
	loading: boolean;
	error: string | null;
	children: ReactNode;
}) {
	return (
		<div className="cc-feed cc-card">
			<div className="cc-feed__head">
				<span className="cc-feed__title">{title}</span>
				<span className="cc-feed__meta">
					{stale && <span className="cc-feed__badge">stale</span>}
					<span className="cc-feed__count">{count}</span>
					{age && <span className="cc-feed__age">{age}</span>}
				</span>
			</div>

			<div className="cc-feed__list">
				{/* Only fall back to a message with nothing to show — a stale
				    cache still renders its rows, with the badge above. */}
				{count === 0 && loading ? (
					<p className="cc-feed__empty">Loading…</p>
				) : count === 0 && error ? (
					<p className="cc-feed__empty">Couldn't load — {error}</p>
				) : count === 0 ? (
					<p className="cc-feed__empty">Nothing here yet</p>
				) : (
					children
				)}
			</div>
		</div>
	);
}

/* --- Day view (calendar) ------------------------------------------------- */
/* The rail is a fixed grid: every minute maps to the SAME number of pixels, so
   a block's vertical position is pure arithmetic — no per-event measuring. */
const RAIL_START_MIN = 7 * 60; // 07:00
const RAIL_END_MIN = 22 * 60; // 22:00
const HOUR_PX = 44; // one hour = 44px of rail height
const POINT_PX = 22; // fixed height for a point event (no end time)

/* minutes-from-midnight → pixels down from the top of the rail. This one line
   is the whole layout: (min - railStart) / 60 hours × 44px per hour. */
function minToTop(min: number): number {
	return ((min - RAIL_START_MIN) / 60) * HOUR_PX;
}

function DayView({
	events: allEvents,
	now,
}: {
	events: CalEvent[];
	now: number;
}) {
	const railPx = minToTop(RAIL_END_MIN); // total rail height in px

	/* calendar.md can now hold several days under "## YYYY-MM-DD" headings, so
	   this rail — which is one day tall — has to take its own slice. Derived
	   from `now`, so crossing midnight with the view open rolls it over on the
	   next tick instead of stranding yesterday on screen. */
	const today = toISODate(new Date(now));
	const events = eventsOnDay(allEvents, today);

	const hours: number[] = [];
	for (let h = RAIL_START_MIN / 60; h <= RAIL_END_MIN / 60; h++) hours.push(h);

	/* The now-line rides the timer's existing `now` — no interval of its own.
	   While a focus block runs, `now` ticks each second and the line glides;
	   when idle it simply sits at the last `now`, which is fine for a hint. */
	const nowDate = new Date(now);
	const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
	const nowInRange = nowMin >= RAIL_START_MIN && nowMin <= RAIL_END_MIN;

	/* The card shell and the header live in CalendarPanel, which owns the
	   Day/Week switch; this component renders only the rail itself. */
	return (
		<div className="cc-day__scroll">
			{events.length === 0 ? (
				<p className="cc-feed__empty">
					No events — add lines in {CALENDAR_PATH}
				</p>
				) : (
					<div className="cc-day__rail" style={{ height: `${railPx}px` }}>
						{hours.map((h) => (
							<div
								key={h}
								className="cc-day__hour"
								style={{ top: `${minToTop(h * 60)}px` }}
							>
								<span className="cc-day__hour-label">
									{String(h).padStart(2, "0")}:00
								</span>
							</div>
						))}

						{events.map((ev) => {
							const top = minToTop(ev.startMin);
							const isPoint = ev.endMin === null;
							const height =
								ev.endMin === null
									? POINT_PX
									: Math.max(
											POINT_PX,
											((ev.endMin - ev.startMin) / 60) *
												HOUR_PX
									  );

							const timeLabel = ev.end
								? `${ev.start}–${ev.end}`
								: ev.start;
							/* Full text on hover — a short block clips the time
							   line (and a long title ellipsizes), so the tooltip
							   is where you read the whole thing. */
							const tooltip = ev.tag
								? `${timeLabel} · ${ev.title} · ${ev.tag}`
								: `${timeLabel} · ${ev.title}`;

							return (
								<div
									key={ev.lineIndex}
									className={
										isPoint
											? "cc-day__event cc-day__event--point"
											: "cc-day__event"
									}
									style={{ top: `${top}px`, height: `${height}px` }}
									title={tooltip}
								>
									{isPoint ? (
										/* One row: dot · time · title. Point events
										   are 22px, so everything sits inline. */
										<>
											<span className="cc-day__event-time">
												{timeLabel}
											</span>
											<span className="cc-day__event-title">
												{ev.title}
											</span>
										</>
									) : (
										/* Title-first so it always survives a short
										   block; time drops to the second line and
										   is the first thing clipped when cramped. */
										<>
											<div className="cc-day__event-head">
												<span className="cc-day__event-title">
													{ev.title}
												</span>
												{ev.tag && (
													<span className="cc-day__event-tag">
														{ev.tag}
													</span>
												)}
											</div>
											<span className="cc-day__event-time">
												{timeLabel}
											</span>
										</>
									)}
								</div>
							);
						})}

						{nowInRange && (
							<div
								className="cc-day__now"
								style={{ top: `${minToTop(nowMin)}px` }}
							/>
						)}
					</div>
				)}
		</div>
	);
}

/* Weekday initials for the column heads; index 0 is Monday, matching
   weekDatesFor(). */
const DOW_LABEL = ["M", "T", "W", "T", "F", "S", "S"];

/* One day column of the week grid: the same rail as the Day view, but events
   are packed into columns by laneAssign so collisions sit side by side. */
function WeekColumn({
	dayISO,
	events,
	isToday,
	nowMin,
	dowIndex,
}: {
	dayISO: string;
	events: CalEvent[];
	isToday: boolean;
	nowMin: number;
	dowIndex: number;
}) {
	/* laneAssign is called PER COLUMN, never across the week: each day is its
	   own collision space, so a busy Monday must not narrow a quiet Thursday. */
	const placed = laneAssign(events);

	const nowInRange = nowMin >= RAIL_START_MIN && nowMin <= RAIL_END_MIN;
	const dayNum = Number(dayISO.slice(8, 10));

	return (
		<div className={isToday ? "cc-week__col cc-week__col--today" : "cc-week__col"}>
			<div className="cc-week__colhead">
				<span className="cc-week__dow">{DOW_LABEL[dowIndex]}</span>
				<span className="cc-week__daynum">{dayNum}</span>
			</div>

			<div className="cc-week__lane">
				{events.map((ev, i) => {
					const { lane, laneCount } = placed[i];
					const top = minToTop(ev.startMin);
					const isPoint = ev.endMin === null;
					const height =
						ev.endMin === null
							? POINT_PX
							: Math.max(
									POINT_PX,
									((ev.endMin - ev.startMin) / 60) * HOUR_PX
							  );

					/* laneCount is always >= 1 for a placed event, but a stray 0
					   would divide by zero and hand CSS "Infinity%", which it
					   drops — taking the width declaration with it and letting
					   the block span the whole column. Clamp instead. */
					const columns = Math.max(1, laneCount);
					const widthPct = 100 / columns;

					const timeLabel = ev.end ? `${ev.start}–${ev.end}` : ev.start;
					const tooltip = ev.tag
						? `${timeLabel} · ${ev.title} · ${ev.tag}`
						: `${timeLabel} · ${ev.title}`;

					return (
						<div
							key={ev.lineIndex}
							className={
								isPoint
									? "cc-week__event cc-week__event--point"
									: "cc-week__event"
							}
							style={{
								top: `${top}px`,
								height: `${height}px`,
								left: `${lane * widthPct}%`,
								width: `${widthPct}%`,
							}}
							title={tooltip}
						>
							<span className="cc-week__event-title">{ev.title}</span>
						</div>
					);
				})}

				{isToday && nowInRange && (
					<div
						className="cc-day__now"
						style={{ top: `${minToTop(nowMin)}px` }}
					/>
				)}
			</div>
		</div>
	);
}

/* Exported for the render test below app.tsx; nothing else imports it. */
export function WeekView({
	events: allEvents,
	now,
}: {
	events: CalEvent[];
	now: number;
}) {
	const railPx = minToTop(RAIL_END_MIN);
	const today = toISODate(new Date(now));
	const days = weekDatesFor(today);

	const nowDate = new Date(now);
	const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

	const hours: number[] = [];
	for (let h = RAIL_START_MIN / 60; h <= RAIL_END_MIN / 60; h++) hours.push(h);

	/* Same filter the Day view uses, applied seven times — one shared rule, so
	   the two views can never disagree about what belongs on screen. */
	const perDay = days.map((d) => eventsOnDay(allEvents, d));
	const total = perDay.reduce((n, list) => n + list.length, 0);

	return (
		<div className="cc-week">
			<div className="cc-week__scroll">
				{total === 0 ? (
					<p className="cc-feed__empty">
						Nothing this week — add lines in {CALENDAR_PATH}
					</p>
				) : (
					<div className="cc-week__grid" style={{ height: `${railPx}px` }}>
						<div className="cc-week__hours">
							{hours.map((h) => (
								<div
									key={h}
									className="cc-day__hour"
									style={{ top: `${minToTop(h * 60)}px` }}
								>
									<span className="cc-day__hour-label">
										{String(h).padStart(2, "0")}:00
									</span>
								</div>
							))}
						</div>

						{days.map((d, i) => (
							<WeekColumn
								key={d}
								dayISO={d}
								events={perDay[i]}
								isToday={d === today}
								nowMin={nowMin}
								dowIndex={i}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

/* Holds the Day/Week switch. The mode is component state, not a vault file:
   writing it would need the save + echo-suppression machinery, and that is
   Phase 6c. Switching tabs away and back resets to Day, which is fine. */
function CalendarPanel({ events, now }: { events: CalEvent[]; now: number }) {
	const [mode, setMode] = useState<"day" | "week">("day");

	const todayCount = eventsOnDay(events, toISODate(new Date(now))).length;

	return (
		<div className="cc-day cc-card">
			<div className="cc-feed__head">
				<span className="cc-feed__title">
					{mode === "day" ? "Today" : "This week"}
				</span>
				<span className="cc-feed__meta">
					{mode === "day" && (
						<span className="cc-feed__count">{todayCount}</span>
					)}
					<span className="cc-week__switch">
						<button
							type="button"
							className={
								mode === "day"
									? "cc-week__switch-btn is-on"
									: "cc-week__switch-btn"
							}
							onClick={() => setMode("day")}
						>
							Day
						</button>
						<button
							type="button"
							className={
								mode === "week"
									? "cc-week__switch-btn is-on"
									: "cc-week__switch-btn"
							}
							onClick={() => setMode("week")}
						>
							Week
						</button>
					</span>
				</span>
			</div>

			{mode === "day" ? (
				<DayView events={events} now={now} />
			) : (
				<WeekView events={events} now={now} />
			)}
		</div>
	);
}

function BuildFeeds({
	hn,
	reddit,
	tweets,
	hnLoading,
	redditLoading,
	now,
}: {
	hn: FeedResult<HnItem>;
	reddit: FeedResult<RedditItem>;
	tweets: TweetItem[];
	hnLoading: boolean;
	redditLoading: boolean;
	now: number;
}) {
	return (
		<div className="cc-feeds">
			<FeedCard
				title="Hacker News"
				count={hn.data.length}
				age={formatAge(hn.fetchedAt, now)}
				stale={hn.stale}
				loading={hnLoading}
				error={hn.error}
			>
				{hn.data.map((it) => (
					<button
						key={it.id}
						className="cc-feed__row"
						onClick={() => openLink(it.url)}
					>
						<span className="cc-feed__row-title">{it.title}</span>
						<span className="cc-feed__row-sub">
							{it.score} pts · {it.by}
						</span>
					</button>
				))}
			</FeedCard>

			<FeedCard
				title="Reddit"
				count={reddit.data.length}
				age={formatAge(reddit.fetchedAt, now)}
				stale={reddit.stale}
				loading={redditLoading}
				error={reddit.error}
			>
				{reddit.data.map((it) => (
					<button
						key={it.id}
						className="cc-feed__row"
						onClick={() => openLink(it.permalink)}
					>
						<span className="cc-feed__row-title">{it.title}</span>
						<span className="cc-feed__row-sub">
							r/{it.subreddit} · {it.score} · {it.num_comments} comments
						</span>
					</button>
				))}
			</FeedCard>

			<FeedCard
				title="Tweets"
				count={tweets.length}
				age=""
				stale={false}
				loading={false}
				error={null}
			>
				{tweets.map((t, i) => {
					const href =
						t.url ??
						(t.handle
							? `https://twitter.com/${t.handle.replace(/^@/, "")}`
							: null);

					return (
						<button
							key={i}
							className="cc-feed__row"
							onClick={() => href && openLink(href)}
							disabled={href === null}
						>
							<span className="cc-feed__row-title">{t.text}</span>
							{t.handle && (
								<span className="cc-feed__row-sub">
									{t.handle}
								</span>
							)}
						</button>
					);
				})}
			</FeedCard>
		</div>
	);
}

function TabPanel({
	tab,
	todos,
	seatTitle,
	onToggle,
	onPromote,
	hn,
	reddit,
	tweets,
	events,
	hnLoading,
	redditLoading,
	now,
}: {
	tab: TabId;
	todos: TodoItem[];
	seatTitle: string | null;
	onToggle: (item: TodoItem) => void;
	onPromote: (item: TodoItem) => void;
	hn: FeedResult<HnItem>;
	reddit: FeedResult<RedditItem>;
	tweets: TweetItem[];
	events: CalEvent[];
	hnLoading: boolean;
	redditLoading: boolean;
	now: number;
}) {
	switch (tab) {
		case "client":
			return (
				<TodoList
					todos={todos}
					seatTitle={seatTitle}
					onToggle={onToggle}
					onPromote={onPromote}
				/>
			);
		case "build":
			return (
				<div className="cc-build">
					<CalendarPanel events={events} now={now} />
					<BuildFeeds
						hn={hn}
						reddit={reddit}
						tweets={tweets}
						hnLoading={hnLoading}
						redditLoading={redditLoading}
						now={now}
					/>
				</div>
			);
		case "inbox":
			return <div />;
		case "learn":
			return <div />;
		case "inspired":
			return <div />;
	}
}

export function App({ app }: { app: ObsidianApp }) {
	const [activeTab, setActiveTab] = useState<TabId>("client");

	const [initial] = useState(() => defaultState());
	const [mit, setMit] = useState<Mit>(initial.mit);
	const [timer, setTimer] = useState<Timer>(initial.timer);

	const [todos, setTodos] = useState<TodoItem[]>([]);

	/* Build-tab feeds. `error`/`stale`/`fetchedAt` ride inside the FeedResult;
	   the loading flags are separate because they are UI-only. */
	const [hn, setHn] = useState<FeedResult<HnItem>>({
		data: [],
		fetchedAt: 0,
		stale: false,
		error: null,
	});
	const [reddit, setReddit] = useState<FeedResult<RedditItem>>({
		data: [],
		fetchedAt: 0,
		stale: false,
		error: null,
	});
	const [hnLoading, setHnLoading] = useState(false);
	const [redditLoading, setRedditLoading] = useState(false);
	const [tweets, setTweets] = useState<TweetItem[]>([]);

	/* Day-view calendar events (command-center/calendar.md). Read-only, so like
	   tweets it is loaded on mount and re-read by the watcher — never written. */
	const [events, setEvents] = useState<CalEvent[]>([]);

	const [now, setNow] = useState(() => Date.now());
	const [hydrated, setHydrated] = useState(false);

	/* Set whenever state arrives *from* the file, so the save effect that fires
	   right after does not immediately write it back. */
	const skipSave = useRef(false);

	const applyLoaded = (loaded: MitState) => {
		const next = withStaleGuard(loaded);

		skipSave.current = true;
		setMit(next.mit);
		setTimer(next.timer);
		setNow(Date.now());
	};

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			const [loaded, loadedTodos, loadedTweets, loadedEvents] =
				await Promise.all([
					loadMIT(app),
					loadTodos(app, "client"),
					loadTweets(app),
					loadCalendar(app),
				]);
			if (cancelled) return;

			applyLoaded(loaded);
			setTodos(loadedTodos);
			setTweets(loadedTweets);
			setEvents(loadedEvents);
			setHydrated(true);
		})();

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [app]);

	/* `now` is deliberately absent: it changes every second and would turn this
	   into a once-a-second write. mit and timer only get new identities when a
	   button is pressed, which is exactly when the file should change. */
	useEffect(() => {
		if (!hydrated) return;

		if (skipSave.current) {
			skipSave.current = false;
			return;
		}

		void saveMIT(app, mit, timer);
	}, [app, mit, timer, hydrated]);

	const running = timer.active && timer.pausedAt === null;

	/* Ticks only to force a re-render; the value it writes is read from the
	   clock, so a missed or late tick self-corrects on the next one. */
	useEffect(() => {
		if (!running) return;

		setNow(Date.now());
		const id = window.setInterval(() => setNow(Date.now()), 1000);

		return () => window.clearInterval(id);
	}, [running]);

	/* Feeds: fetch once on mount, then refresh every 10 minutes. This is its OWN
	   interval, separate from the 1-second timer above — it owns a different id
	   and clears only that id in its cleanup. The two must never be merged: one
	   ticks per second to move the clock, this one wakes twice an hour to pull
	   the network, and refresh only refreshes — it writes no vault file. */
	useEffect(() => {
		let cancelled = false;

		const refresh = () => {
			/* พับ Obsidian / minimize ทิ้งไว้ — ข้ามรอบนี้ ไม่ยิง API ฟรีของ
			   HN/Reddit ทิ้ง. รอบถัดไปใน 10 นาทีค่อยว่ากันใหม่ ถ้าตอนนั้นจอกลับมา
			   visible แล้ว. cache เดิมยังค้างอยู่บนการ์ด ไม่กระพริบ */
			if (document.hidden) return;

			setHnLoading(true);
			void fetchHackerNews().then((r) => {
				if (cancelled) return;
				setHn(r);
				setHnLoading(false);
			});

			setRedditLoading(true);
			void fetchReddit().then((r) => {
				if (cancelled) return;
				setReddit(r);
				setRedditLoading(false);
			});
		};

		refresh();
		const id = window.setInterval(refresh, 10 * 60 * 1000);

		return () => {
			cancelled = true;
			window.clearInterval(id);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/* The seated todo is identified by value, not by reference: the same
	   (title, project) pair the banner already shows. Nothing new on disk. */
	const seatTitle = mit.project === "client" ? mit.title : null;

	/* No optimistic flip: saveTodos verifies against a fresh read and may
	   refuse (stale lineIndex), so the file stays the source of truth — state
	   follows from re-reading it either way. */
	const toggleTodo = async (item: TodoItem) => {
		const nextDone = !item.done;
		const ok = await saveTodos(app, "client", [{ ...item, done: nextDone }]);

		const fresh = await loadTodos(app, "client");
		setTodos(fresh);

		/* Checking off the seated todo finishes its block. Only on a write
		   that really landed — a refused save means the file (and therefore
		   the todo) did not actually change. Title stays so the banner shows
		   what just got finished; the button turns into Start by itself. */
		if (ok && nextDone && item.text === seatTitle && timer.active) {
			setTimer((t) => ({ ...t, active: false }));
		}
	};

	const remainingSec = remainingSecAt(timer, now);

	const promoteTodo = (item: TodoItem) => {
		/* Already in the front seat — clicking it again is a no-op. Bail before
		   the confirm so we don't ask, reset the timer, or rewrite mit.md just
		   to reseat the same (title, project) pair. seatTitle is null unless the
		   banner is showing a client todo, so a non-client seat never matches. */
		if (item.text === seatTitle) return;

		/* Only a running block loses data worth asking about — a finished or
		   expired one has nothing left. (Paused blocks skip the confirm per
		   spec, though their remaining time is lost the same way.) */
		if (timer.active && timer.pausedAt === null && remainingSec > 0) {
			const replace = window.confirm(
				`มี block กำลังวิ่งอยู่ — "${mit.title}"\nเริ่ม block ใหม่ทับเลยไหม?`
			);
			if (!replace) return;
		}

		/* Third bite of the stale-`now` trap (see CLAUDE.md): this is a new
		   handler that flips pausedAt back to null, so it must refresh `now`
		   with the same timestamp it writes into state. */
		const at = Date.now();
		setNow(at);

		const fresh = defaultState();
		setMit({
			title: item.text,
			project: "client",
			est: fresh.mit.est,
			startedAt: at,
		});
		setTimer({
			totalSec: fresh.timer.totalSec,
			startedAt: at,
			pausedAt: null,
			pausedAccumSec: 0,
			active: true,
		});
	};

	useEffect(() => {
		if (!timer.active || remainingSec > 0) return;

		setTimer((t) => ({ ...t, active: false }));
		new Notice(`Focus block finished — ${mit.title}`, 0);
	}, [timer.active, remainingSec, mit.title]);

	useEffect(() => {
		let cancelled = false;
		/* Debounce per path — one shared timeout would let an edit to mit.md
		   swallow a pending todos reload (or vice versa) inside the same 300ms. */
		const timeouts = new Map<string, number>();

		const reload = async (file: TFile) => {
			let raw: string;
			try {
				raw = await app.vault.read(file);
			} catch {
				return;
			}
			if (cancelled) return;

			/* Our own save bouncing back. Re-reading here is what turns
			   save → modify → re-read → save into a loop. */
			if (isEcho(file.path, raw)) return;

			if (file.path === MIT_PATH) {
				const loaded = await loadMIT(app);
				if (cancelled) return;

				applyLoaded(loaded);
			} else if (file.path === todosPath("client")) {
				const fresh = await loadTodos(app, "client");
				if (cancelled) return;

				setTodos(fresh);
			} else if (file.path === TWEETS_PATH) {
				/* Read-only: no save, so isEcho above never matches (nothing was
				   ever written for this path) and this simply re-reads. */
				const fresh = await loadTweets(app);
				if (cancelled) return;

				setTweets(fresh);
			} else if (file.path === CALENDAR_PATH) {
				/* Read-only, same as tweets above — re-read on any edit, no echo
				   to suppress because nothing is ever written back. */
				const fresh = await loadCalendar(app);
				if (cancelled) return;

				setEvents(fresh);
			}
		};

		const ref = app.vault.on("modify", (file) => {
			if (!isCommandCenterPath(file.path)) return;
			if (!(file instanceof TFile)) return;

			const pending = timeouts.get(file.path);
			if (pending !== undefined) window.clearTimeout(pending);

			timeouts.set(
				file.path,
				window.setTimeout(() => {
					void reload(file);
				}, 300)
			);
		});

		return () => {
			cancelled = true;
			for (const id of timeouts.values()) window.clearTimeout(id);
			app.vault.offref(ref);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [app]);

	return (
		<div className="cc-root">
			<nav className="cc-topbar cc-card">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						className={
							tab.id === activeTab ? "cc-tab cc-tab--active" : "cc-tab"
						}
						onClick={() => setActiveTab(tab.id)}
					>
						{tab.label}
					</button>
				))}
			</nav>

			<MitBanner
				mit={mit}
				timer={timer}
				remainingSec={remainingSec}
				onPause={() => {
					const at = Date.now();

					/* `now` stops updating whenever the interval does — every pause,
					   every finished block. Both branches that hand control back to
					   the clock would otherwise measure this fresh timestamp against
					   a stale one and read high for a frame. Harmless on the pause
					   branch, where `now` cancels out of remainingSecAt anyway. */
					setNow(at);

					/* One `at` for every branch: a second Date.now() here would put
					   a few ms of skew back between the clock and the state. */
					setTimer((t) => {
						if (!t.active) {
							return {
								...t,
								active: true,
								startedAt: at,
								pausedAt: null,
								pausedAccumSec: 0,
							};
						}
						if (t.pausedAt === null) {
							return { ...t, pausedAt: at };
						}
						return {
							...t,
							pausedAt: null,
							pausedAccumSec:
								t.pausedAccumSec + (at - t.pausedAt) / 1000,
						};
					});
				}}
				onAddFive={() =>
					setTimer((t) => ({ ...t, totalSec: t.totalSec + 5 * 60 }))
				}
				onDone={() => setTimer((t) => ({ ...t, active: false }))}
			/>

			<section className="cc-panel cc-card">
				<TabPanel
					tab={activeTab}
					todos={todos}
					seatTitle={seatTitle}
					onToggle={(item) => void toggleTodo(item)}
					onPromote={promoteTodo}
					hn={hn}
					reddit={reddit}
					tweets={tweets}
					events={events}
					hnLoading={hnLoading}
					redditLoading={redditLoading}
					now={now}
				/>
			</section>
		</div>
	);
}
