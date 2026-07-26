import { getOmniboxUrl, escapeOmniboxText, getRedirectUrl } from "./redirect.js";
import { applySettings, getSettings, saveSettings, type Settings } from "./settings.js";

async function synchronizeRulesets() {
  await applySettings(await getSettings());
}

let settingsQueue = Promise.resolve();

function queueSettings<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = settingsQueue.then(operation, operation);
  settingsQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

chrome.runtime.onInstalled.addListener(
  () => void queueSettings(synchronizeRulesets).catch(() => undefined),
);
chrome.runtime.onStartup.addListener(
  () => void queueSettings(synchronizeRulesets).catch(() => undefined),
);

chrome.runtime.onMessage.addListener(
  (message: { type?: string; settings?: Settings }, _sender, sendResponse) => {
    if (message.type === "health") {
      sendResponse({ ready: true });
      return false;
    }
    if (message.type !== "save-settings") return false;
    void queueSettings(() => saveSettings(message.settings))
      .then((settings) => sendResponse({ settings }))
      .catch((error: unknown) =>
        sendResponse({
          error: error instanceof Error ? error.message : "Could not save settings.",
        }),
      );
    return true;
  },
);

chrome.webNavigation.onHistoryStateUpdated.addListener(async ({ frameId, tabId, url }) => {
  if (frameId !== 0) return;

  const destination = getRedirectUrl(url, await getSettings());
  if (destination) {
    await chrome.tabs.sendMessage(tabId, { type: "redirect", url: destination }).catch(() => {});
  }
});

chrome.omnibox.setDefaultSuggestion({
  description: "Open npm packages on npmx. Prefix with search, s, or ? to search.",
});

chrome.omnibox.onInputChanged.addListener((value, suggest) => {
  const query = value.trim();
  if (!query) return suggest([]);

  const escaped = escapeOmniboxText(query);
  suggest([
    {
      content: query,
      description: `Open package <match>${escaped}</match> on npmx`,
    },
    {
      content: `search ${query}`,
      description: `Search npmx for <match>${escaped}</match>`,
    },
  ]);
});

chrome.omnibox.onInputEntered.addListener((value, disposition) => {
  const url = getOmniboxUrl(value);
  if (disposition === "currentTab") {
    chrome.tabs.update({ url });
  } else {
    chrome.tabs.create({ active: disposition !== "newBackgroundTab", url });
  }
});
