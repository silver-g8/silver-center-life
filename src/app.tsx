import { useState } from "react";

const TABS = ["Client", "Build", "Inbox", "Learn", "Inspired"] as const;

type TabName = (typeof TABS)[number];

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

			<section className="cc-panel cc-card">
				<TabPanel tab={activeTab} />
			</section>
		</div>
	);
}
