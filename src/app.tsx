import { Notice, TFile } from "obsidian";
import type { App as ObsidianApp } from "obsidian";
import { useEffect, useRef, useState } from "react";
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

function TabPanel({
	tab,
	todos,
	seatTitle,
	onToggle,
	onPromote,
}: {
	tab: TabId;
	todos: TodoItem[];
	seatTitle: string | null;
	onToggle: (item: TodoItem) => void;
	onPromote: (item: TodoItem) => void;
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
			return <div />;
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
			const [loaded, loadedTodos] = await Promise.all([
				loadMIT(app),
				loadTodos(app, "client"),
			]);
			if (cancelled) return;

			applyLoaded(loaded);
			setTodos(loadedTodos);
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
				/>
			</section>
		</div>
	);
}
