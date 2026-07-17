import { Notice } from "obsidian";
import { useEffect, useState } from "react";

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

type Mit = {
	title: string;
	project: string;
	est: number;
	startedAt: number | null;
};

type Timer = {
	totalSec: number;
	startedAt: number;
	pausedAt: number | null;
	pausedAccumSec: number;
	active: boolean;
};

const SEED_MIT = {
	title: "Pick your first task",
	project: "—",
	est: 25,
};

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
					<button
						className="cc-pill"
						onClick={onPause}
						disabled={!timer.active}
					>
						{paused ? "Resume" : "Pause"}
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

function TabPanel({ tab }: { tab: TabId }) {
	switch (tab) {
		case "client":
			return <div />;
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

export function App() {
	const [activeTab, setActiveTab] = useState<TabId>("client");

	const [mit] = useState<Mit>(() => ({
		...SEED_MIT,
		startedAt: Date.now(),
	}));

	const [timer, setTimer] = useState<Timer>(() => ({
		totalSec: SEED_MIT.est * 60,
		startedAt: Date.now(),
		pausedAt: null,
		pausedAccumSec: 0,
		active: true,
	}));

	const [now, setNow] = useState(() => Date.now());

	const running = timer.active && timer.pausedAt === null;

	/* Ticks only to force a re-render; the value it writes is read from the
	   clock, so a missed or late tick self-corrects on the next one. */
	useEffect(() => {
		if (!running) return;

		setNow(Date.now());
		const id = window.setInterval(() => setNow(Date.now()), 1000);

		return () => window.clearInterval(id);
	}, [running]);

	const remainingSec = remainingSecAt(timer, now);

	useEffect(() => {
		if (!timer.active || remainingSec > 0) return;

		setTimer((t) => ({ ...t, active: false }));
		new Notice(`Focus block finished — ${mit.title}`, 0);
	}, [timer.active, remainingSec, mit.title]);

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
				onPause={() =>
					setTimer((t) => {
						if (!t.active) return t;
						if (t.pausedAt === null) {
							return { ...t, pausedAt: Date.now() };
						}
						return {
							...t,
							pausedAt: null,
							pausedAccumSec:
								t.pausedAccumSec +
								(Date.now() - t.pausedAt) / 1000,
						};
					})
				}
				onAddFive={() =>
					setTimer((t) => ({ ...t, totalSec: t.totalSec + 5 * 60 }))
				}
				onDone={() => setTimer((t) => ({ ...t, active: false }))}
			/>

			<section className="cc-panel cc-card">
				<TabPanel tab={activeTab} />
			</section>
		</div>
	);
}
