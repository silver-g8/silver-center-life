import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { App } from "./src/app";

export const VIEW_TYPE_DASHBOARD = "command-center-dashboard";

class DashboardView extends ItemView {
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}

	getDisplayText(): string {
		return "Command Center";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		this.root = createRoot(this.contentEl);
		this.root.render(createElement(App));
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}

export default class CommandCenterPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(
			VIEW_TYPE_DASHBOARD,
			(leaf) => new DashboardView(leaf)
		);

		this.addRibbonIcon("layout-dashboard", "Open Command Center", () => {
			this.activateView();
		});
	}

	private async activateView(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		workspace.revealLeaf(leaf);
	}
}
