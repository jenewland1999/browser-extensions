import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACCENTS,
  BACKGROUND_PATTERNS,
  applySkinTone,
  inferNameFromUrl,
  MAX_DEPTH,
  parseImport,
  THEMES,
} from "../dist/model.js";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));

test("build emits loadable new tab extension", async () => {
  const files = await readdir("dist", { recursive: true });
  assert.ok(files.includes("newtab.html"));
  assert.ok(files.includes("newtab.js"));
  assert.ok(files.includes("emoji-data.json"));
  assert.ok(files.includes("icons/icon-16.png"));
  assert.ok(files.includes("icons/icon-128.png"));
  assert.ok(files.includes("fonts/geist-latin-wght-normal.woff2"));
  assert.ok(files.every((path) => !path.endsWith(".ts")));
});

test("registers packaged extension icons", () => {
  assert.deepEqual(manifest.icons, {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  });
});

test("bundles full categorized Unicode emoji data", async () => {
  const groups = JSON.parse(await readFile("dist/emoji-data.json", "utf8"));
  assert.equal(groups.length, 9);
  assert.ok(groups.reduce((count, group) => count + group.emojis.length, 0) >= 1900);
  assert.ok(groups.some((group) => group.emojis.some(([emoji]) => emoji === "🫶")));
});

test("new tab exposes toolbar visibility controls", async () => {
  const html = await readFile("dist/newtab.html", "utf8");
  assert.match(html, /id="minimize-toolbar"/);
  assert.match(html, /id="hide-toolbar"/);
  assert.match(html, /id="toolbar-orb"/);
  assert.match(html, /id="expand-all"/);
  assert.match(html, /id="collapse-all"/);
  assert.match(html, /id="more-menu-button"/);
  assert.match(html, /id="help-dialog"/);
  assert.match(html, /id="reset-extension"/);
});

test("new tab exposes theme and background choices", async () => {
  const [html, css] = await Promise.all([
    readFile("dist/newtab.html", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  for (const theme of THEMES) assert.match(html, new RegExp(`value="${theme}"`));
  for (const pattern of BACKGROUND_PATTERNS) {
    assert.match(html, new RegExp(`value="${pattern}"`));
    if (pattern !== "plain") {
      assert.match(css, new RegExp(`data-background-pattern="${pattern}"`));
    }
  }
  assert.doesNotMatch(html, /value="offset-bricks"/);
  assert.doesNotMatch(html, /value="ripples"/);
  for (const removed of ["triangles", "triangle-lattice", "tetris", "maze", "temple", "jigsaw"]) {
    assert.doesNotMatch(html, new RegExp(`value="${removed}"`));
  }
  assert.match(html, /name="background-type"[^>]+value="blank"/);
  assert.match(html, /name="background-type"[^>]+value="pattern"/);
  assert.match(html, /name="background-type"[^>]+value="image"/);
  assert.match(html, /id="background-drop-zone"/);
  assert.match(html, /id="pattern-picker-list" role="listbox"/);
});

test("new tab persists onboarding and provides a returning empty state", async () => {
  const script = await readFile("dist/newtab.js", "utf8");
  assert.match(script, /structuredStartOnboardingComplete/);
  assert.match(script, /Nothing here yet/);
  assert.match(script, /data-empty="link"/);
  assert.match(script, /Add first link/);
  assert.match(script, /class="welcome-paths" \$\{welcomeChoicesOpen \? "hidden" : ""\}/);
  assert.match(script, /welcomeChoicesOpen = false/);
  assert.match(script, /toolbarActivationBlockedUntil/);
  assert.doesNotMatch(script, /data-empty="section"/);
  assert.match(script, /data-empty="import"/);
});

test("uses only local storage and favicon permissions", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["favicon", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.chrome_url_overrides.newtab, "newtab.html");
});

test("imports Structured Start Tab nested panels", () => {
  const imported = parseImport([
    {
      type: "sst-panel",
      ident: "outer",
      header: "Work",
      direction: "vertical",
      grow: "4",
      content: [
        { type: "link", ident: "docs", name: "Docs", url: "https://example.com/docs" },
        {
          type: "sst-panel",
          ident: "inner",
          header: "Repos",
          direction: "horizontal",
          content: [
            { type: "link", ident: "repo", name: "Repo", url: "https://github.com/example/repo" },
          ],
        },
      ],
    },
    { type: "section", id: "trash", header: "Trash", content: [] },
  ]);

  assert.equal(imported.sections.length, 1);
  assert.equal(imported.sections[0]?.name, "Work");
  assert.equal(imported.sections[0]?.direction, "vertical");
  assert.equal(imported.sections[0]?.grow, 4);
  assert.equal(imported.sections[0]?.children[1]?.type, "section");
  assert.equal(imported.sections[0]?.children[1]?.name, "Repos");
  assert.equal(imported.sections[0]?.children[0]?.openMode, "current");
  assert.equal(imported.itemGap, 0);
  assert.equal(imported.pagePadding, 18);
});

test("normalizes new appearance and link settings", () => {
  const imported = parseImport({
    version: 1,
    locked: false,
    theme: "light",
    density: "compact",
    itemGap: 12,
    sectionGap: 16,
    pagePadding: 30,
    backgroundPattern: "cubes",
    backgroundType: "pattern",
    backgroundColor: "#eff6ff",
    backgroundImage: "data:image/png;base64,abc",
    inspectorMode: "docked",
    inspectorSide: "left",
    showItemCounts: false,
    sections: [
      {
        id: "section",
        type: "section",
        name: "Links",
        direction: "horizontal",
        children: [
          {
            id: "link",
            type: "link",
            name: "Example",
            url: "https://example.com",
            openMode: "window",
            color: "fuchsia",
            faviconBackground: true,
            faviconPadding: 6,
            faviconRadius: 50,
          },
        ],
      },
    ],
  });
  assert.equal(imported.itemGap, 12);
  assert.equal(imported.sectionGap, 16);
  assert.equal(imported.pagePadding, 30);
  assert.equal(imported.backgroundPattern, "cubes");
  assert.equal(imported.backgroundType, "pattern");
  assert.equal(imported.backgroundColor, "#eff6ff");
  assert.match(imported.backgroundImage, /^data:image/);
  assert.equal(imported.inspectorMode, "docked");
  assert.equal(imported.inspectorSide, "left");
  assert.equal(imported.showItemCounts, false);
  assert.equal(imported.sections[0]?.children[0]?.openMode, "window");
  assert.equal(imported.sections[0]?.children[0]?.color, "fuchsia");
  assert.equal(imported.sections[0]?.children[0]?.faviconBackgroundLight, true);
  assert.equal(imported.sections[0]?.children[0]?.faviconBackgroundDark, true);
  assert.equal(imported.sections[0]?.children[0]?.faviconPadding, 6);
  assert.equal(imported.sections[0]?.children[0]?.faviconRadius, 50);
});

test("normalizes every supported theme, background, and accent", () => {
  for (const theme of THEMES) {
    assert.equal(parseImport({ version: 1, theme, sections: [] }).theme, theme);
  }
  for (const backgroundPattern of BACKGROUND_PATTERNS) {
    assert.equal(
      parseImport({ version: 1, backgroundPattern, sections: [] }).backgroundPattern,
      backgroundPattern,
    );
  }
  for (const color of ACCENTS) {
    const imported = parseImport({
      version: 1,
      sections: [{ id: "section", type: "section", name: "Section", color, children: [] }],
    });
    assert.equal(imported.sections[0]?.color, color);
  }

  const fallback = parseImport({
    version: 1,
    theme: "unknown",
    backgroundPattern: "unknown",
    sections: [{ id: "section", type: "section", name: "Section", color: "unknown" }],
  });
  assert.equal(fallback.theme, "system");
  assert.equal(fallback.backgroundPattern, "grid");
  assert.equal(fallback.sections[0]?.color, "slate");
});

test("migrates offset brickwork to brickwork", () => {
  const imported = parseImport({ version: 1, backgroundPattern: "offset-bricks", sections: [] });
  assert.equal(imported.backgroundPattern, "bricks");
});

test("removed patterns migrate to blank backgrounds", () => {
  for (const backgroundPattern of [
    "triangles",
    "triangle-lattice",
    "tetris",
    "maze",
    "temple",
    "jigsaw",
  ]) {
    const imported = parseImport({ version: 1, backgroundPattern, sections: [] });
    assert.equal(imported.backgroundType, "blank");
  }
});

test("new tab sections link actions", async () => {
  const script = await readFile("dist/newtab.js", "utf8");
  assert.match(script, /class="settings-group link-actions"/);
  assert.match(script, /class="settings-group inspector-actions"/);
  assert.match(script, /<h2>Actions<\/h2>/);
  assert.match(script, /<h2>Appearance<\/h2>/);
  assert.match(script, /<span>Flow<\/span><select name="direction">/);
  assert.match(script, /!node\.unmodifiedDuplicate/);
  assert.match(script, /unmodifiedDuplicate: true/);
});

test("preserves duplicate modification state", () => {
  const imported = parseImport({
    version: 1,
    sections: [
      {
        id: "section",
        type: "section",
        name: "Section",
        children: [
          {
            id: "copy",
            type: "link",
            name: "Link copy",
            url: "https://example.com",
            unmodifiedDuplicate: true,
          },
        ],
      },
    ],
  });
  assert.equal(imported.sections[0]?.children[0]?.unmodifiedDuplicate, true);
});

test("accent controls show swatches and preview choices", async () => {
  const [script, css] = await Promise.all([
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /control\.classList\.add\("accent-select"\)/);
  assert.match(script, /list\.classList\.add\("accent-list"\)/);
  assert.match(script, /previewAccent\(source\.value\)/);
  assert.match(css, /\.accent-select \.select-button::before/);
  assert.match(css, /\.accent-list button::before/);
});

test("imports and exports items separately from settings", async () => {
  const [html, script] = await Promise.all([
    readFile("dist/newtab.html", "utf8"),
    readFile("dist/newtab.js", "utf8"),
  ]);
  assert.match(html, /id="import-items"/);
  assert.match(html, /id="export-settings"/);
  assert.match(script, /type === "items"/);
  assert.match(script, /data\.sections = imported\.sections/);
  assert.match(script, /sections: data\.sections/);
  assert.match(script, /tessera-settings/);
});

test("new tab debounces favicon updates and uses emoji controls", async () => {
  const [script, css] = await Promise.all([
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /setTimeout\(\(\) => \{/);
  assert.match(script, /350\)/);
  assert.match(script, /class="tone-select"/);
  assert.match(script, /class="emoji-shelves"/);
  assert.match(script, /categoryIcons/);
  assert.match(script, /emojiGroupIndex = index/);
  assert.match(css, /\.emoji-shelf button \{[\s\S]+background: transparent/);
  assert.match(css, /\.tone-field \.select-button::after \{[\s\S]+display: none/);
  assert.doesNotMatch(script, /Frequently used/);
});

test("pattern picker previews options with pointer and keyboard", async () => {
  const script = await readFile("dist/newtab.js", "utf8");
  assert.match(script, /pointerenter/);
  assert.match(script, /previewBackgroundPattern/);
  assert.match(script, /"ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"/);
  assert.match(script, /closePatternPicker\(\)/);
  assert.match(script, /function placeListbox/);
  assert.match(script, /getBoundingClientRect/);
  assert.match(script, /window\.innerHeight/);
  assert.match(script, /document\.body\.append\(patternPickerList\)/);
});

test("favicons use theme-aware contrast treatment", async () => {
  const [script, css] = await Promise.all([
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /class="favicon"/);
  assert.match(script, /theme=\$\{faviconTheme\}/);
  assert.doesNotMatch(css, /\.favicon[^}]+drop-shadow/s);
  assert.match(css, /\.favicon-backed/);
  assert.match(css, /--favicon-background/);
  assert.match(css, /\.tile-icon\.favicon-backed \{[\s\S]+--favicon-padding/);
  assert.match(script, /faviconBackgroundEnabled/);
  assert.match(script, /faviconBackgroundLight/);
  assert.match(script, /faviconBackgroundDark/);
});

test("favicon backgrounds are independent by colour scheme", () => {
  const imported = parseImport({
    version: 1,
    sections: [
      {
        id: "section",
        type: "section",
        name: "Section",
        children: [
          {
            id: "link",
            type: "link",
            name: "Link",
            url: "example.com",
            faviconBackgroundLight: true,
            faviconBackgroundDark: false,
          },
        ],
      },
    ],
  });
  assert.equal(imported.sections[0]?.children[0]?.faviconBackgroundLight, true);
  assert.equal(imported.sections[0]?.children[0]?.faviconBackgroundDark, false);
});

test("collapsed sections do not retain an empty content area", async () => {
  const [script, css] = await Promise.all([
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /children\.hidden = node\.collapsed/);
  assert.match(script, /setSectionCollapsed\(child, collapsed\)/);
  assert.match(script, /setAllSectionsCollapsed\(false\)/);
  assert.match(script, /setAllSectionsCollapsed\(true\)/);
  assert.match(css, /\.section-content\[hidden\] \{[\s\S]+display: none/);
  assert.doesNotMatch(css, /\.section\.selected \{[\s\S]+box-shadow/);
});

test("overflow menu provides help, project links, and reset", async () => {
  const [html, script] = await Promise.all([
    readFile("dist/newtab.html", "utf8"),
    readFile("dist/newtab.js", "utf8"),
  ]);
  assert.match(html, /Repository/);
  assert.match(html, /Report a bug/);
  assert.match(html, /Request a feature/);
  assert.match(html, /What is a group\?/);
  assert.match(script, /chrome\.storage\.local\.clear\(\)/);
  assert.match(script, /Reset Tessera\?/);
  assert.match(script, /document\.body\.append\(moreMenu\)/);
  assert.match(script, /placeListbox\(moreMenuButton, moreMenu, 320, 190, 10\)/);
  assert.match(html, /id="fix-favicon-contrast"/);
  assert.match(script, /faviconNeedsBackground/);
  assert.match(script, /createImageBitmap/);
  assert.match(script, /tessera-no-favicon\.invalid/);
  assert.match(script, /colourful \/ visible < 0\.15/);
  assert.match(script, /lowContrast \/ visible >= 0\.85/);
  assert.match(script, /contrast-probe/);
});

test("select controls provide contextual icons and clearer inspector labels", async () => {
  const [html, script] = await Promise.all([
    readFile("dist/newtab.html", "utf8"),
    readFile("dist/newtab.js", "utf8"),
  ]);
  assert.match(html, /Inspector layout/);
  assert.match(html, /Inspector position/);
  assert.match(script, /SELECT_ICONS/);
  assert.match(script, /list\.classList\.add\("icon-list"\)/);
  assert.match(script, /setPatternButtonLabel/);
  assert.match(script, /"inspector-mode"/);
  assert.match(script, /"inspector-side"/);
  assert.match(script, /compact: "rows-4"/);
  assert.doesNotMatch(script, /option\.insertAdjacentHTML\("beforeend", icon\("grid"/);
});

test("favicon and emoji controls have spacious aligned layouts", async () => {
  const css = await readFile("dist/newtab.css", "utf8");
  assert.match(css, /\.favicon-panel \{[\s\S]+gap: 18px/);
  assert.match(css, /\.favicon-background-field \.switch-track \{[\s\S]+grid-column: 3/);
  assert.match(css, /\.emoji-picker-toolbar \{[\s\S]+margin-bottom: 14px/);
  assert.match(css, /\.tone-list button \{[\s\S]+place-items: center/);
});

test("normalizes protocol-free URLs and exposes favicon geometry", async () => {
  const [script, css] = await Promise.all([
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /function normalizeUrl/);
  assert.match(script, /name="faviconRadius"/);
  assert.match(script, /name="faviconPadding"/);
  assert.match(css, /--favicon-padding/);
  assert.match(css, /--favicon-radius/);
});

test("dragging uses centralized pointer sorting with an in-layout slot", async () => {
  const [script, css] = await Promise.all([
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /addEventListener\("pointerdown"/);
  assert.match(script, /function updateDragDestination/);
  assert.match(script, /function placeDragSlot/);
  assert.match(script, /function moveNode/);
  assert.match(script, /elementsFromPoint/);
  assert.match(css, /\.drag-slot \{[\s\S]+border: 2px dashed var\(--focus\)/);
  assert.match(css, /\.drag-preview \{[\s\S]+z-index: 10000/);
  assert.doesNotMatch(script, /function bindNodeDrop/);
  assert.doesNotMatch(script, /function bindDropZone/);
  assert.doesNotMatch(script, /function bindRootDrop/);
});

test("icon editor uses source tabs and favicon switch", async () => {
  const [script, css] = await Promise.all([
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /class="icon-heading"/);
  assert.match(script, /class="icon-source-tabs" role="tablist"/);
  assert.match(script, /role="tab" aria-selected=/);
  assert.match(script, /class="field switch-field favicon-background-field"/);
  assert.match(script, /class="switch-track"/);
  assert.match(css, /\.icon-source-tabs button\[aria-selected="true"\]/);
});

test("enhances native selects and exposes background colors", async () => {
  const [html, script, css] = await Promise.all([
    readFile("dist/newtab.html", "utf8"),
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /function enhanceSelects/);
  assert.match(script, /dispatchEvent\(new Event\("change"/);
  assert.match(css, /\.select-control/);
  assert.match(html, /id="background-color"[\s\S]+type="color"/);
  assert.match(script, /--page-background/);
});

test("minimized toolbar keeps logo and name", async () => {
  const html = await readFile("dist/newtab.html", "utf8");
  assert.doesNotMatch(html, /class="orb-grip"/);
  assert.match(html, /class="brand-mark" aria-hidden="true"/);
  assert.match(html, /class="orb-name">Tessera/);
});

test("anchored toolbar centers within docked canvas", async () => {
  const script = await readFile("dist/newtab.js", "utf8");
  assert.match(script, /const canvasRect = canvas\.getBoundingClientRect\(\)/);
  assert.match(script, /right - left - element\.offsetWidth/);
  assert.match(script, /repositionAnchoredToolbar/);
  assert.match(script, /addEventListener\("resize", repositionAnchoredToolbar\)/);
});

test("edit mode preserves the toolbar centre", async () => {
  const script = await readFile("dist/newtab.js", "utf8");
  assert.match(script, /const toolbarCenter =/);
  assert.match(script, /toolbarCenter\.x - toolbar\.offsetWidth \/ 2/);
  assert.match(script, /toolbarCenter\.y - toolbar\.offsetHeight \/ 2/);
});

test("docked inspector animates toolbar and canvas shifts", async () => {
  const css = await readFile("dist/newtab.css", "utf8");
  assert.match(css, /\.toolbar \{[\s\S]+left 220ms/);
  assert.match(css, /\.canvas \{[\s\S]+margin-left 220ms/);
});

test("section counter follows actions at far right", async () => {
  const script = await readFile("dist/newtab.js", "utf8");
  assert.match(script, /class="section-actions"[\s\S]+class="section-count"/);
});

test("composes emoji skin tones into valid sequences", () => {
  assert.equal(applySkinTone("👋", "🏽"), "👋🏽");
  assert.equal(applySkinTone("☝️", "🏽"), "☝🏽");
  assert.equal(applySkinTone("🏋️‍♀️", "🏽"), "🏋🏽‍♀️");
  assert.equal(applySkinTone("😀", "🏽"), "😀");
});

test("infers branded names from link hostnames", () => {
  assert.equal(inferNameFromUrl("https://github.com/example/repo"), "GitHub");
  assert.equal(inferNameFromUrl("https://docs.openai.com/"), "OpenAI");
  assert.equal(inferNameFromUrl("https://my-cool-tool.dev/path"), "My Cool Tool");
  assert.equal(inferNameFromUrl("https://service.example.co.uk"), "Example");
  assert.equal(inferNameFromUrl("not a url"), undefined);
});

test("returning empty state preserves toolbar and background", async () => {
  const [script, css] = await Promise.all([
    readFile("dist/newtab.js", "utf8"),
    readFile("dist/newtab.css", "utf8"),
  ]);
  assert.match(script, /className = "empty-canvas"/);
  assert.match(script, /toolbar\.hidden = toolbarMinimized/);
  assert.match(script, /welcome-mode", firstRun/);
  assert.match(css, /\.empty-canvas/);
});

test("rejects imports without sections", () => {
  assert.throws(() => parseImport({ hello: "world" }), /Unsupported JSON format/);
  assert.throws(() => parseImport([]), /No sections found/);
});

test("limits imported nesting depth", () => {
  let nested = { type: "link", ident: "leaf", name: "Leaf", url: "https://example.com" };
  for (let depth = 0; depth < MAX_DEPTH + 4; depth += 1) {
    nested = { type: "sst-panel", ident: `s-${depth}`, header: `S ${depth}`, content: [nested] };
  }
  const imported = parseImport([nested]);
  let node = imported.sections[0];
  let depth = 1;
  while (node?.children[0]?.type === "section") {
    node = node.children[0];
    depth += 1;
  }
  assert.ok(depth <= MAX_DEPTH);
});

test("help uses the enforced nesting limit", async () => {
  const [html, script] = await Promise.all([
    readFile("dist/newtab.html", "utf8"),
    readFile("dist/newtab.js", "utf8"),
  ]);
  assert.match(html, /id="help-max-depth"/);
  assert.match(script, /helpMaxDepth\.textContent = String\(MAX_DEPTH\)/);
  assert.doesNotMatch(html, /six levels/i);
});
