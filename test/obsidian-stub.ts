/* The `obsidian` package is types-only (package.json main is ""), so anything
   importing it explodes outside Obsidian itself. vitest.config.ts aliases the
   module to this file so the pure functions under test can be imported.

   Nothing here is exercised: every test targets a pure parser or injects its
   own fake fetcher into createFeed, so requestUrl is never called. These are
   just enough shape for the imports to resolve. */

export class TFile {
	path = "";
}

export function requestUrl(): never {
	throw new Error(
		"requestUrl was called in a test — feeds tests must inject a fake raw fetcher"
	);
}

export function parseYaml(): Record<string, unknown> {
	return {};
}

export function stringifyYaml(): string {
	return "";
}
