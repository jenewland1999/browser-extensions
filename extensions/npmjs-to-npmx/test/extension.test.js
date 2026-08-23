import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { escapeOmniboxText, getOmniboxUrl, getRedirectUrl } from "../dist/redirect.js";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  RULESET_IDS,
  saveSettings,
} from "../dist/settings.js";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const ruleResources = manifest.declarative_net_request.rule_resources;
const rules = await Promise.all(
  ruleResources.map(async ({ path }) => JSON.parse(await readFile(`dist/${path}`, "utf8"))),
);

test("build emits loadable JavaScript without TypeScript source", async () => {
  const outputFiles = await readdir("dist", { recursive: true });
  const background = await readFile("dist/background.js", "utf8");
  const contentScript = await readFile("dist/content.js", "utf8");
  const popup = await readFile("dist/popup.html", "utf8");
  assert.ok(outputFiles.includes("background.js"));
  assert.ok(outputFiles.includes("manifest.json"));
  assert.ok(outputFiles.every((path) => !path.endsWith(".ts")));
  assert.doesNotMatch(contentScript, /\b(?:export|import)\b/);
  assert.match(background, /queueSettings/);
  assert.match(background, /type !== "save-settings"/);
  assert.match(popup, /id="settings-status"[^>]*role="status"/);
});

test("includes third-party notices in the build", async () => {
  await readFile("dist/THIRD_PARTY_NOTICES.md", "utf8");
});

test("uses exact hosts and only required Manifest V3 permissions", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, [
    "declarativeNetRequestWithHostAccess",
    "storage",
    "webNavigation",
  ]);
  assert.deepEqual(manifest.host_permissions, ["*://npmjs.com/*", "*://www.npmjs.com/*"]);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});

test("declares one static main-frame ruleset per supported route", () => {
  assert.deepEqual(
    ruleResources.map(({ id }) => id),
    RULESET_IDS,
  );
  assert.ok(ruleResources.every(({ enabled }) => enabled));
  assert.ok(rules.every(([rule]) => rule.condition.resourceTypes[0] === "main_frame"));
  assert.ok(rules.every(([rule]) => rule.action.redirect.transform.host === "npmx.dev"));
});

test("redirects supported routes and preserves URL components", () => {
  for (const [source, destination] of [
    [
      "https://www.npmjs.com/package/@scope/name?activeTab=versions#readme",
      "https://npmx.dev/package/@scope/name?activeTab=versions#readme",
    ],
    ["http://npmjs.com/search?q=web components", "https://npmx.dev/search?q=web%20components"],
    ["https://npmjs.com/~sindresorhus", "https://npmx.dev/~sindresorhus"],
    ["https://npmjs.com/org/npm", "https://npmx.dev/org/npm"],
  ]) {
    assert.equal(getRedirectUrl(source, DEFAULT_SETTINGS), destination);
  }
});

test("does not redirect unsupported paths or lookalike hosts", () => {
  for (const url of [
    "https://npmjs.com/",
    "https://npmjs.com/settings/profile",
    "https://npmjs.com.example/package/react",
    "https://registry.npmjs.com/package/react",
    "https://npmx.dev/package/react",
  ]) {
    assert.equal(getRedirectUrl(url, DEFAULT_SETTINGS), null);
  }
});

test("respects master and route switches", () => {
  assert.equal(
    getRedirectUrl("https://npmjs.com/package/react", { ...DEFAULT_SETTINGS, enabled: false }),
    null,
  );
  assert.equal(
    getRedirectUrl("https://npmjs.com/package/react", { ...DEFAULT_SETTINGS, packages: false }),
    null,
  );
  assert.equal(normalizeSettings({ packages: false }).packages, false);
  assert.equal(normalizeSettings({ enabled: "yes" }).enabled, true);
});

test("restores storage and rulesets when saving fails", async () => {
  const previousSettings = { ...DEFAULT_SETTINGS, search: false };
  const nextSettings = { ...previousSettings, packages: false };
  let storedSettings = previousSettings;
  let failNextStorageWrite = true;
  const rulesetUpdates = [];
  const storageWrites = [];
  globalThis.chrome = {
    declarativeNetRequest: {
      async updateEnabledRulesets(update) {
        rulesetUpdates.push(update);
      },
    },
    storage: {
      local: {
        async get() {
          return { settings: storedSettings };
        },
        async set({ settings }) {
          storageWrites.push(settings);
          if (failNextStorageWrite) {
            failNextStorageWrite = false;
            throw new Error("storage unavailable");
          }
          storedSettings = settings;
        },
      },
    },
  };

  await assert.rejects(() => saveSettings(nextSettings), /storage unavailable/);
  assert.deepEqual(storedSettings, previousSettings);
  assert.deepEqual(storageWrites, [nextSettings, previousSettings]);
  assert.equal(rulesetUpdates.length, 2);
  assert.deepEqual(rulesetUpdates.at(-1), {
    enableRulesetIds: ["packages", "users", "organizations"],
    disableRulesetIds: ["search"],
  });
});

test("builds safe omnibox package and search URLs", () => {
  assert.equal(getOmniboxUrl("react"), "https://npmx.dev/package/react");
  assert.equal(getOmniboxUrl("@babel/core"), "https://npmx.dev/package/%40babel/core");
  assert.equal(getOmniboxUrl("name?tab=code"), "https://npmx.dev/package/name%3Ftab%3Dcode");
  assert.equal(getOmniboxUrl("name#readme"), "https://npmx.dev/package/name%23readme");
  assert.equal(getOmniboxUrl("name%2Fother"), "https://npmx.dev/package/name%252Fother");
  assert.equal(getOmniboxUrl("name/other"), "https://npmx.dev/package/name%2Fother");
  assert.equal(
    getOmniboxUrl("@scope/name?tab=code"),
    "https://npmx.dev/package/%40scope/name%3Ftab%3Dcode",
  );
  assert.equal(getOmniboxUrl("search react router"), "https://npmx.dev/search?q=react%20router");
  assert.equal(getOmniboxUrl(" "), "https://npmx.dev/");
  assert.equal(escapeOmniboxText("<react&test>"), "&lt;react&amp;test&gt;");
});
