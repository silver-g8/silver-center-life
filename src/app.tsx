import { useEffect, useState } from "react";

const TABS = ["Client", "Build", "Inbox", "Learn", "Inspired"] as const;

type TabName = (typeof TABS)[number];

type Mit = {
	title: string;
	project: string;
	est: number;
	startedAt: number | null;
};

type Timer = {
	totalSec: number;
	remainingSec: number;
	active: boolean;
	paused: boolean;
};

const SEED_MIT = {
	title: "Pick your first task",
	project: "—",
	est: 25,
};

function formatClock(seconds: number) {
	const safe = Math.max(0, Math.floor(seconds));
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
	onPause,
	onAddFive,
	onDone,
}: {
	mit: Mit;
	timer: Timer;
	onPause: () => void;
	onAddFive: () => void;
	onDone: () => void;
}) {
	const status = !timer.active ? "idle" : timer.paused ? "paused" : "running";
	const elapsed = timer.totalSec - timer.remainingSec;
	const pct = timer.totalSec > 0 ? (elapsed / timer.totalSec) * 100 : 0;

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
					{formatClock(timer.remainingSec)}
				</div>

				<div className="cc-mit__actions">
					<button
						className="cc-pill"
						onClick={onPause}
						disabled={!timer.active}
					>
						{timer.paused ? "Resume" : "Pause"}
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

function TabPanel({ tab }: { tab: TabName }) {
	switch (tab) {
		case "Client":
			return <div />;
		case "Build":
			return <div />;
		case "Inbox":
			return <div />;
		case "Learn":
			return <div />;
		case "Inspired":
			return <div />;
	}
}

export function App() {
	const [activeTab, setActiveTab] = useState<TabName>("Client");

	const [mit] = useState<Mit>(() => ({
		...SEED_MIT,
		startedAt: Date.now(),
	}));

	const [timer, setTimer] = useState<Timer>(() => ({
		totalSec: SEED_MIT.est * 60,
		remainingSec: SEED_MIT.est * 60,
		active: true,
		paused: false,
	}));

	useEffect(() => {
		if (!timer.active || timer.paused) return;

		const id = window.setInterval(() => {
			setTimer((t) => {
				if (t.remainingSec <= 1) {
					return { ...t, remainingSec: 0, active: false };
				}
				return { ...t, remainingSec: t.remainingSec - 1 };
			});
		}, 1000);

		return () => window.clearInterval(id);
	}, [timer.active, timer.paused]);

	return (
		<div className="cc-root">
			<nav className="cc-topbar cc-card">
				{TABS.map((tab) => (
					<button
						key={tab}
						className={
							tab === activeTab ? "cc-tab cc-tab--active" : "cc-tab"
						}
						onClick={() => setActiveTab(tab)}
					>
						{tab}
					</button>
				))}
			</nav>

			<MitBanner
				mit={mit}
				timer={timer}
				onPause={() => setTimer((t) => ({ ...t, paused: !t.paused }))}
				onAddFive={() =>
					setTimer((t) => ({
						...t,
						remainingSec: Math.min(
							t.remainingSec + 5 * 60,
							t.totalSec,
						),
					}))
				}
				onDone={() =>
					setTimer((t) => ({ ...t, active: false, remainingSec: 0 }))
				}
			/>

			<section className="cc-panel cc-card">
				<TabPanel tab={activeTab} />
			</section>
		</div>
	);
}
