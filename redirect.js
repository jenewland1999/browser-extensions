const ROUTES = [
  ["packages", /^\/package\//],
  ["search", /^\/search$/],
  ["users", /^\/~[^/]+/],
  ["organizations", /^\/org\//],
];

export function getRedirectUrl(value, settings) {
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

export function getOmniboxUrl(value) {
  const query = value.trim();
  if (!query) return "https://npmx.dev/";

  const search = query.match(/^(?:(?:s|search)\s+|\?\s*)(.+)$/i);
  if (search) {
    return `https://npmx.dev/search?q=${encodeURIComponent(search[1].trim())}`;
  }

  return `https://npmx.dev/package/${encodeURI(query)}`;
}

export function escapeOmniboxText(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}
