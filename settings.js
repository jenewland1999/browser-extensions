export const RULESET_IDS = ["packages", "search", "users", "organizations"];

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  packages: true,
  search: true,
  users: true,
  organizations: true,
});

export function normalizeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }

  return Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [
      key,
      typeof value[key] === "boolean" ? value[key] : fallback,
    ]),
  );
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return normalizeSettings(settings);
}

export async function applySettings(settings) {
  const enabledRulesets = settings.enabled ? RULESET_IDS.filter((id) => settings[id]) : [];

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabledRulesets,
    disableRulesetIds: RULESET_IDS.filter((id) => !enabledRulesets.includes(id)),
  });
}

export async function saveSettings(value) {
  const settings = normalizeSettings(value);
  await chrome.storage.local.set({ settings });
  await applySettings(settings);
  return settings;
}
