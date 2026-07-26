export const RULESET_IDS = ["packages", "search", "users", "organizations"] as const;

export type RulesetId = (typeof RULESET_IDS)[number];

export interface Settings extends Record<RulesetId, boolean> {
  enabled: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  enabled: true,
  packages: true,
  search: true,
  users: true,
  organizations: true,
});

export function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }

  const candidate = value as Record<string, unknown>;
  return {
    enabled:
      typeof candidate["enabled"] === "boolean" ? candidate["enabled"] : DEFAULT_SETTINGS.enabled,
    packages:
      typeof candidate["packages"] === "boolean"
        ? candidate["packages"]
        : DEFAULT_SETTINGS.packages,
    search:
      typeof candidate["search"] === "boolean" ? candidate["search"] : DEFAULT_SETTINGS.search,
    users: typeof candidate["users"] === "boolean" ? candidate["users"] : DEFAULT_SETTINGS.users,
    organizations:
      typeof candidate["organizations"] === "boolean"
        ? candidate["organizations"]
        : DEFAULT_SETTINGS.organizations,
  };
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return normalizeSettings(settings);
}

export async function applySettings(settings: Settings): Promise<void> {
  const enabledRulesets = settings.enabled ? RULESET_IDS.filter((id) => settings[id]) : [];

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabledRulesets,
    disableRulesetIds: RULESET_IDS.filter((id) => !enabledRulesets.includes(id)),
  });
}

export async function saveSettings(value: unknown): Promise<Settings> {
  const settings = normalizeSettings(value);
  const previousSettings = await getSettings();

  try {
    await applySettings(settings);
    await chrome.storage.local.set({ settings });
  } catch (error) {
    const rollback = await Promise.allSettled([
      applySettings(previousSettings),
      chrome.storage.local.set({ settings: previousSettings }),
    ]);
    const rollbackErrors = rollback.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Could not save settings or fully restore the previous settings.",
      );
    }
    throw error;
  }

  return settings;
}
