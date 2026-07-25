import type { RulesetId, Settings } from "./settings.js";

const ROUTES: ReadonlyArray<readonly [RulesetId, RegExp]> = [
  ["packages", /^\/package\//],
  ["search", /^\/search$/],
  ["users", /^\/~[^/]+/],
  ["organizations", /^\/org\//],
];

export function getRedirectUrl(value: string, settings: Readonly<Settings>): string | null {
  const url = new URL(value);

  if (
    !settings.enabled ||
    !["npmjs.com", "www.npmjs.com"].includes(url.hostname) ||
    !ROUTES.some(([setting, pattern]) => settings[setting] && pattern.test(url.pathname))
  ) {
    return null;
  }

  url.protocol = "https:";
  url.hostname = "npmx.dev";
  url.port = "";
  return url.href;
}

export function getOmniboxUrl(value: string): string {
  const query = value.trim();
  if (!query) return "https://npmx.dev/";

  const search = query.match(/^(?:(?:s|search)\s+|\?\s*)(.+)$/i);
  const searchQuery = search?.[1];
  if (searchQuery) {
    return `https://npmx.dev/search?q=${encodeURIComponent(searchQuery.trim())}`;
  }

  return `https://npmx.dev/package/${encodeURI(query)}`;
}

export function escapeOmniboxText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}
