import { getOmniboxUrl, escapeOmniboxText, getRedirectUrl } from "./redirect.js";
import { applySettings, getSettings } from "./settings.js";

async function synchronizeRulesets() {
  await applySettings(await getSettings());
}

chrome.runtime.onInstalled.addListener(synchronizeRulesets);
chrome.runtime.onStartup.addListener(synchronizeRulesets);

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
