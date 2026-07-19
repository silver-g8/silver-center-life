import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: {
		alias: {
			/* See test/obsidian-stub.ts — the real package ships types only. */
			obsidian: fileURLToPath(
				new URL("./test/obsidian-stub.ts", import.meta.url)
			),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
