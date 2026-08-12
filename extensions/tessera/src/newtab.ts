import { icon } from "./icons.js";
import {
  ACCENTS,
  applySkinTone,
  containsNode,
  createLink,
  createSection,
  DEFAULT_DATA,
  findNode,
  findParentSection,
  inferNameFromUrl,
  MAX_BACKGROUND_DATA_URL_LENGTH,
  MAX_DEPTH,
  MAX_ICON_DATA_URL_LENGTH,
  nodeDepth,
  normalizeImageDataUrl,
  parseImport,
  removeNode,
  subtreeDepth,
  type BackgroundPattern,
  type BackgroundType,
  type Density,
  type Direction,
  type InspectorMode,
  type InspectorSide,
  type LinkNode,
  type Node,
  type OpenMode,
  type SectionNode,
  type StartPageData,
  type Theme,
} from "./model.js";
import { assertStorageFits, PersistenceCoordinator, type Revisioned } from "./persistence.js";

const STORAGE_KEY = "structuredStartData";
const STORAGE_LOCK = "structuredStartData-write";
const ONBOARDING_KEY = "structuredStartOnboardingComplete";
let initialized = false;
let hasDeferredInitialChange = false;
let deferredInitialValue: unknown;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing new tab element: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLElement>("#canvas");
const toolbar = requireElement<HTMLElement>("#toolbar");
const panel = requireElement<HTMLElement>("#panel");
const editor = requireElement<HTMLElement>("#editor");
const pageSettings = requireElement<HTMLElement>("#page-settings");
const panelTitle = requireElement<HTMLElement>("#panel-title");
const settingsButton = requireElement<HTMLButtonElement>("#settings");
const lockButton = requireElement<HTMLButtonElement>("#lock");
const importInput = requireElement<HTMLInputElement>("#import-file");
const toast = requireElement<HTMLElement>("#toast");
const themeSelect = requireElement<HTMLSelectElement>("#theme");
const densitySelect = requireElement<HTMLSelectElement>("#density");
const inspectorModeSelect = requireElement<HTMLSelectElement>("#inspector-mode");
const inspectorSideSelect = requireElement<HTMLSelectElement>("#inspector-side");
const showItemCountsInput = requireElement<HTMLInputElement>("#show-item-counts");
const customSpacing = requireElement<HTMLElement>("#custom-spacing");
const itemGapInput = requireElement<HTMLInputElement>("#item-gap");
const itemGapValue = requireElement<HTMLOutputElement>("#item-gap-value");
const sectionGapInput = requireElement<HTMLInputElement>("#section-gap");
const sectionGapValue = requireElement<HTMLOutputElement>("#section-gap-value");
const pagePaddingInput = requireElement<HTMLInputElement>("#page-padding");
const pagePaddingValue = requireElement<HTMLOutputElement>("#page-padding-value");
const backgroundInput = requireElement<HTMLInputElement>("#background-file");
const backgroundPatternSelect = requireElement<HTMLSelectElement>("#background-pattern");
const patternPickerButton = requireElement<HTMLButtonElement>("#pattern-picker-button");
const patternPickerList = requireElement<HTMLElement>("#pattern-picker-list");
const backgroundTypeInputs = document.querySelectorAll<HTMLInputElement>(
  "input[name='background-type']",
);
const patternControls = requireElement<HTMLElement>("#pattern-controls");
const imageControls = requireElement<HTMLElement>("#image-controls");
const backgroundDropZone = requireElement<HTMLElement>("#background-drop-zone");
const backgroundColorControls = requireElement<HTMLElement>("#background-color-controls");
const backgroundColorInput = requireElement<HTMLInputElement>("#background-color");
const selectButton = requireElement<HTMLButtonElement>("#select-items");
const expandAllMenuButton = requireElement<HTMLButtonElement>("#expand-all-menu");
const collapseAllMenuButton = requireElement<HTMLButtonElement>("#collapse-all-menu");
const deleteSelectedButton = requireElement<HTMLButtonElement>("#delete-selected");
const selectionCount = requireElement<HTMLElement>("#selection-count");
const moreMenuButton = requireElement<HTMLButtonElement>("#more-menu-button");
const moreMenu = requireElement<HTMLElement>("#more-menu");
const helpDialog = requireElement<HTMLDialogElement>("#help-dialog");
const helpMaxDepth = requireElement<HTMLElement>("#help-max-depth");

let data: StartPageData = structuredClone(DEFAULT_DATA);
let selectedId: string | undefined;
let toastTimer = 0;
interface ToolbarPosition {
  x: number;
  y: number;
}

interface StoredToolbarPosition extends ToolbarPosition {
  reference?: "center";
}

let toolbarPosition: ToolbarPosition | undefined;
let toolbarAnchor: string | undefined;
let lastSectionId: string | undefined;
let selectionMode = false;
const selectedIds = new Set<string>();
let faviconRevision = 0;
let importType: "items" | "settings" = "items";

interface StoredData {
  storageVersion: 1;
  revision: number;
  data: StartPageData;
}

interface EmojiGroup {
  name: string;
  emojis: [emoji: string, name: string, tone: 0 | 1][];
}

let emojiGroups: EmojiGroup[] | undefined;
let emojiSkinTone = "";
let emojiRecent: string[] = [];
let emojiGroupIndex = 0;
let guideStep = -1;
let welcomeChoicesOpen = false;
let onboardingComplete = false;
let toolbarActivationBlockedUntil = 0;

const SKIN_TONES = ["", "🏻", "🏼", "🏽", "🏾", "🏿"];

const DENSITY_SPACING: Record<
  Exclude<Density, "custom">,
  { item: number; section: number; page: number }
> = {
  compact: { item: 0, section: 0, page: 0 },
  comfortable: { item: 6, section: 10, page: 12 },
  spacious: { item: 12, section: 20, page: 24 },
};

const SELECT_ICONS: Record<string, Record<string, string>> = {
  theme: {
    system: "monitor",
    light: "sun",
    dark: "moon",
    "rose-pine": "moon",
    vercel: "moon",
    "github-light": "sun",
    "github-dark": "moon",
  },
  density: { compact: "rows-4", comfortable: "rows-3", spacious: "rows-2", custom: "settings" },
  direction: { horizontal: "columns", vertical: "rows" },
  openMode: { current: "monitor", tab: "panel-top", window: "external-link" },
  "inspector-mode": { floating: "panel-top", docked: "panel-right" },
  "inspector-side": { left: "panel-left", right: "panel-right" },
};

function setIcons(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const name = element.dataset["icon"];
    if (!name || element.querySelector("svg")) continue;
    element.insertAdjacentHTML("afterbegin", icon(name));
  }
}

document.addEventListener("pointerdown", (event) => {
  const target = event.target as Element;
  if (target.closest(".select-control, .select-list")) return;
  for (const select of document.querySelectorAll<HTMLSelectElement>("select[data-enhanced='true']"))
    select.dispatchEvent(new Event("select-close"));
});

function placeListbox(
  trigger: HTMLElement,
  list: HTMLElement,
  maxHeight = 260,
  minWidth = 180,
  gap = 5,
): void {
  const triggerRect = trigger.getBoundingClientRect();
  const width = Math.max(triggerRect.width, minWidth);
  const below = window.innerHeight - triggerRect.bottom - gap - 8;
  const above = triggerRect.top - gap - 8;
  const openBelow = below >= Math.min(maxHeight, list.scrollHeight) || below >= above;
  const available = Math.max(40, Math.min(maxHeight, openBelow ? below : above));
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, triggerRect.right - width));
  list.style.position = "fixed";
  list.style.width = `${width}px`;
  list.style.maxHeight = `${available}px`;
  list.style.left = `${left}px`;
  list.style.right = "auto";
  if (openBelow) {
    list.style.top = `${triggerRect.bottom + gap}px`;
    list.style.bottom = "auto";
  } else {
    list.style.top = "auto";
    list.style.bottom = `${window.innerHeight - triggerRect.top + gap}px`;
  }
}

function enhanceSelects(root: ParentNode = document): void {
  for (const select of root.querySelectorAll<HTMLSelectElement>(
    "select:not(#background-pattern)",
  )) {
    if (select.dataset["enhanced"] === "true") continue;
    select.dataset["enhanced"] = "true";
    select.classList.add("native-select");
    const control = document.createElement("div");
    control.className = "select-control";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const list = document.createElement("div");
    list.className = "select-list";
    const accentSelect = select.name === "color";
    const toneSelect = select.classList.contains("tone-select");
    const selectKey = select.name || select.id;
    const optionIcons = SELECT_ICONS[selectKey];
    if (accentSelect) {
      control.classList.add("accent-select");
      list.classList.add("accent-list");
    }
    if (toneSelect) list.classList.add("tone-list");
    if (optionIcons) list.classList.add("icon-list");
    list.setAttribute("role", "listbox");
    list.hidden = true;
    let activeIndex = select.selectedIndex;
    const sync = (): void => {
      button.replaceChildren();
      const selectedOption = select.selectedOptions[0];
      const selectedIcon = selectedOption ? optionIcons?.[selectedOption.value] : undefined;
      if (selectedIcon) button.insertAdjacentHTML("beforeend", icon(selectedIcon, 14));
      button.append(selectedOption?.textContent ?? "");
      if (accentSelect) {
        for (const className of button.classList) {
          if (className.startsWith("color-")) button.classList.remove(className);
        }
        button.classList.add(`color-${select.value}`);
      }
      activeIndex = Math.max(0, select.selectedIndex);
      for (const [index, option] of [...list.children].entries()) {
        option.classList.toggle("active", index === activeIndex);
        option.setAttribute("aria-selected", String(index === activeIndex));
      }
    };
    const close = (): void => {
      list.hidden = true;
      button.setAttribute("aria-expanded", "false");
      control.append(list);
      if (accentSelect) previewAccent(select.value);
    };
    const commit = (index: number): void => {
      const option = select.options[index];
      if (!option) return;
      select.value = option.value;
      sync();
      close();
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      button.focus();
    };
    list.replaceChildren(
      ...[...select.options].map((source, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "option");
        const optionIcon = optionIcons?.[source.value];
        if (optionIcon) option.insertAdjacentHTML("beforeend", icon(optionIcon, 14));
        option.append(source.textContent ?? "");
        if (accentSelect) option.classList.add(`color-${source.value}`);
        option.addEventListener("pointerenter", () => {
          activeIndex = index;
          for (const [candidateIndex, candidate] of [...list.children].entries())
            candidate.classList.toggle("active", candidateIndex === activeIndex);
          if (accentSelect) previewAccent(source.value);
        });
        option.addEventListener("focus", () => {
          if (accentSelect) previewAccent(source.value);
        });
        option.addEventListener("click", () => commit(index));
        return option;
      }),
    );
    const openList = (): void => {
      document.body.append(list);
      list.hidden = false;
      button.setAttribute("aria-expanded", "true");
      sync();
      placeListbox(button, list, 240, toneSelect ? 40 : 180);
    };
    const previewAccent = (accent: string): void => {
      if (!accentSelect || !selectedId) return;
      const selected = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`);
      for (const className of selected?.classList ?? []) {
        if (className.startsWith("color-")) selected?.classList.remove(className);
      }
      selected?.classList.add(`color-${accent}`);
    };
    button.addEventListener("click", () => {
      const opening = list.hidden;
      if (opening) {
        for (const other of document.querySelectorAll<HTMLSelectElement>(
          "select[data-enhanced='true']",
        )) {
          if (other !== select) other.dispatchEvent(new Event("select-close"));
        }
        openList();
      } else close();
    });
    const handleKeydown = (event: KeyboardEvent): void => {
      if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Escape") {
        close();
        button.focus();
        return;
      }
      if (list.hidden) {
        openList();
      }
      if (event.key === "Enter") {
        commit(activeIndex);
        return;
      }
      if (event.key === "Home") activeIndex = 0;
      else if (event.key === "End") activeIndex = select.options.length - 1;
      else
        activeIndex =
          (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + select.options.length) %
          select.options.length;
      for (const [index, option] of [...list.children].entries())
        option.classList.toggle("active", index === activeIndex);
      if (accentSelect) previewAccent(select.options[activeIndex]?.value ?? select.value);
    };
    control.addEventListener("keydown", handleKeydown);
    list.addEventListener("keydown", handleKeydown);
    select.addEventListener("change", sync);
    select.addEventListener("select-sync", sync);
    select.addEventListener("select-close", close);
    select.insertAdjacentElement("afterend", control);
    control.append(button, list);
    sync();
  }
}

function showToast(message: string, error = false): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function completeOnboarding(): void {
  if (onboardingComplete) return;
  onboardingComplete = true;
  void chrome.storage.local.set({ [ONBOARDING_KEY]: true });
}

function storedData(value: unknown): Revisioned<StartPageData> {
  if (
    value &&
    typeof value === "object" &&
    (value as Partial<StoredData>).storageVersion === 1 &&
    Number.isSafeInteger((value as Partial<StoredData>).revision) &&
    (value as Partial<StoredData>).data
  ) {
    return {
      revision: (value as StoredData).revision,
      data: parseImport((value as StoredData).data),
    };
  }
  return { revision: 0, data: parseImport(value) };
}

function applyStoredData(next: { revision: number; data: StartPageData }): void {
  data = next.data;
  if (selectedId && !findNode(data.sections, selectedId)) selectedId = undefined;
  applyAppearance();
  render();
}

const persistence = new PersistenceCoordinator<StartPageData>({
  revision: 0,
  read: async () => {
    const value = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    return value === undefined
      ? { revision: 0, data: structuredClone(DEFAULT_DATA) }
      : storedData(value);
  },
  write: async (next) => {
    const stored: StoredData = { storageVersion: 1, ...next };
    const allValues = await chrome.storage.local.get(null);
    assertStorageFits({ ...allValues, [STORAGE_KEY]: stored });
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  },
  clear: async () => chrome.storage.local.clear(),
  withLock: async (callback) => navigator.locks.request(STORAGE_LOCK, callback),
  applyExternal: (next) => {
    applyStoredData(next);
    showToast("Layout updated from another tab.");
  },
  reportConflict: () =>
    showToast("This layout changed in another tab. Refreshed without overwriting it.", true),
  reportError: (error) =>
    showToast(error instanceof Error ? error.message : "Could not save this change.", true),
});

async function save(): Promise<void> {
  await persistence.save(structuredClone(data));
}

function applyAppearance(): void {
  if (data.density !== "custom") {
    const spacing = DENSITY_SPACING[data.density];
    data.itemGap = spacing.item;
    data.sectionGap = spacing.section;
    data.pagePadding = spacing.page;
  }
  document.documentElement.dataset["theme"] = data.theme;
  document.body.dataset["backgroundPattern"] =
    data.backgroundType === "pattern" ? data.backgroundPattern : "plain";
  document.documentElement.dataset["density"] = data.density;
  themeSelect.value = data.theme;
  backgroundPatternSelect.value = data.backgroundPattern;
  setPatternButtonLabel();
  for (const input of backgroundTypeInputs) input.checked = input.value === data.backgroundType;
  patternControls.hidden = data.backgroundType !== "pattern";
  imageControls.hidden = data.backgroundType !== "image";
  backgroundColorControls.hidden = data.backgroundType === "image";
  document.documentElement.style.setProperty(
    "--page-background",
    resolvedBackgroundColor(data.backgroundColor),
  );
  if (data.backgroundColor) backgroundColorInput.value = data.backgroundColor;
  for (const swatch of backgroundColorControls.querySelectorAll<HTMLButtonElement>(
    "[data-background-color]",
  )) {
    swatch.style.setProperty(
      "--swatch",
      resolvedBackgroundColor(swatch.dataset["backgroundColor"] ?? ""),
    );
    swatch.classList.toggle("active", swatch.dataset["backgroundColor"] === data.backgroundColor);
  }
  backgroundDropZone.classList.toggle("has-image", Boolean(data.backgroundImage));
  backgroundDropZone.style.setProperty(
    "--drop-zone-image",
    data.backgroundImage ? `url("${data.backgroundImage}")` : "none",
  );
  densitySelect.value = data.density;
  inspectorModeSelect.value = data.inspectorMode;
  inspectorSideSelect.value = data.inspectorSide;
  for (const select of [themeSelect, densitySelect, inspectorModeSelect, inspectorSideSelect])
    select.dispatchEvent(new Event("select-sync"));
  showItemCountsInput.checked = data.showItemCounts;
  customSpacing.hidden = data.density !== "custom";
  document.body.classList.toggle("inspector-docked", data.inspectorMode === "docked");
  document.body.classList.toggle("inspector-left", data.inspectorSide === "left");
  itemGapInput.value = String(data.itemGap);
  itemGapValue.value = `${data.itemGap}px`;
  sectionGapInput.value = String(data.sectionGap);
  sectionGapValue.value = `${data.sectionGap}px`;
  pagePaddingInput.value = String(data.pagePadding);
  pagePaddingValue.value = `${data.pagePadding}px`;
  document.documentElement.style.setProperty("--item-gap", `${data.itemGap}px`);
  document.documentElement.style.setProperty("--section-gap", `${data.sectionGap}px`);
  document.documentElement.style.setProperty("--page-padding", `${data.pagePadding}px`);
  document.documentElement.classList.toggle("has-item-gap", data.itemGap > 0);
  document.documentElement.classList.toggle("has-section-gap", data.sectionGap > 0);
  document.documentElement.classList.toggle("has-page-padding", data.pagePadding > 0);
  document.body.classList.toggle(
    "custom-background",
    data.backgroundType === "image" && Boolean(data.backgroundImage),
  );
  document.body.style.setProperty(
    "--background-image",
    data.backgroundImage ? `url("${data.backgroundImage}")` : "none",
  );
}

function setPatternButtonLabel(): void {
  patternPickerButton.textContent =
    backgroundPatternSelect.selectedOptions[0]?.textContent ?? data.backgroundPattern;
}

function resolvedBackgroundColor(color: string): string {
  if (!color) return "var(--bg)";
  const darkTheme = ["dark", "rose-pine", "vercel", "github-dark"].includes(data.theme);
  const dark =
    data.theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : darkTheme;
  if (!dark) return color;
  const darkPresets: Record<string, string> = {
    "#ffffff": "#111110",
    "#f8fafc": "#111827",
    "#fff7ed": "#27170d",
    "#fefce8": "#25210b",
    "#f0fdf4": "#0d2415",
    "#eff6ff": "#0d1d33",
    "#faf5ff": "#21112d",
  };
  return darkPresets[color.toLowerCase()] ?? color;
}

function darkScheme(): boolean {
  return data.theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : ["dark", "rose-pine", "vercel", "github-dark"].includes(data.theme);
}

function faviconBackgroundEnabled(node: LinkNode): boolean {
  return darkScheme() ? node.faviconBackgroundDark : node.faviconBackgroundLight;
}

function setFaviconBackground(node: LinkNode, enabled: boolean): void {
  if (darkScheme()) node.faviconBackgroundDark = enabled;
  else node.faviconBackgroundLight = enabled;
}

function openPanel(id?: string): void {
  selectedId = id;
  if (id) {
    const node = findNode(data.sections, id);
    if (node?.type === "section") lastSectionId = node.id;
    else lastSectionId = findParentSection(data.sections, id)?.id ?? lastSectionId;
  }
  panel.classList.add("open");
  document.body.classList.add("inspector-open");
  panel.setAttribute("aria-hidden", "false");
  settingsButton.setAttribute("aria-expanded", "true");
  renderEditor();
  repositionAnchoredToolbar();
}

function closePanel(): void {
  panel.classList.remove("open");
  document.body.classList.remove("inspector-open");
  panel.setAttribute("aria-hidden", "true");
  settingsButton.setAttribute("aria-expanded", "false");
  selectedId = undefined;
  render(true);
  repositionAnchoredToolbar();
}

function faviconUrl(url: string): string {
  const darkTheme = ["dark", "rose-pine", "vercel", "github-dark"].includes(data.theme);
  const faviconTheme =
    data.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : darkTheme
        ? "dark"
        : "light";
  return chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32&theme=${faviconTheme}&v=${faviconRevision}`,
  );
}

function validHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(normalizeUrl(value)).protocol);
  } catch {
    return false;
  }
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function openLink(url: string, mode: OpenMode): void {
  try {
    const destination = new URL(normalizeUrl(url));
    if (!["http:", "https:"].includes(destination.protocol)) throw new Error();
    if (mode === "tab") void chrome.tabs.create({ url: destination.href });
    else if (mode === "window") void chrome.windows.create({ url: destination.href });
    else window.location.assign(destination.href);
  } catch {
    showToast("Enter a valid http or https URL.", true);
  }
}

function renderNode(node: Node, depth: number): HTMLElement {
  if (node.type === "link") return renderLink(node);
  const section = document.createElement("section");
  section.className = `section color-${node.color}`;
  section.dataset["id"] = node.id;
  section.dataset["type"] = "section";
  section.style.setProperty("--grow", String(node.grow));
  if (node.collapsed) section.classList.add("collapsed");
  if (selectedId === node.id) section.classList.add("selected");
  if (selectedIds.has(node.id)) section.classList.add("multi-selected");

  const header = document.createElement("header");
  header.className = "section-header";
  const state = selectionState(node);
  header.innerHTML = `
    <input class="selection-checkbox" type="checkbox" />
    <button class="collapse-button" type="button">${icon(node.collapsed ? "chevron-right" : "chevron-down", 15)}</button>
    <h2></h2>
    <div class="section-actions">
      <button class="node-action" type="button" data-action="edit">${icon("settings", 15)}</button>
      <button class="drag-handle" type="button">${icon("grip", 15)}</button>
    </div>
    ${data.showItemCounts ? `<span class="section-count">${node.children.length}</span>` : ""}`;
  const sectionCheckbox = header.querySelector<HTMLInputElement>(".selection-checkbox");
  if (sectionCheckbox) {
    sectionCheckbox.checked = state.checked;
    sectionCheckbox.setAttribute("aria-label", `Select ${node.name}`);
    sectionCheckbox.indeterminate = state.indeterminate;
    sectionCheckbox.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSelected(node.id);
    });
  }
  header
    .querySelector<HTMLButtonElement>(".collapse-button")
    ?.setAttribute("aria-label", `${node.collapsed ? "Expand" : "Collapse"} ${node.name}`);
  header.querySelector("h2")?.replaceChildren(node.name);
  header
    .querySelector<HTMLButtonElement>("[data-action='edit']")
    ?.setAttribute("aria-label", `Edit ${node.name}`);
  header
    .querySelector<HTMLButtonElement>(".drag-handle")
    ?.setAttribute("aria-label", `Drag ${node.name}`);
  header.querySelector<HTMLButtonElement>(".collapse-button")?.addEventListener("click", () => {
    setSectionCollapsed(node, !node.collapsed);
    void persistAndRender();
  });
  header.addEventListener("click", (event) => {
    if ((event.target as Element).closest("button")) return;
    lastSectionId = node.id;
    if (selectionMode) toggleSelected(node.id);
    else if (!data.locked) openPanel(node.id);
  });
  header
    .querySelector<HTMLButtonElement>("[data-action='edit']")
    ?.addEventListener("click", () => openPanel(node.id));
  bindDrag(header.querySelector<HTMLElement>(".drag-handle"), node.id);
  section.append(header);

  const children = document.createElement("div");
  children.className = `section-content direction-${node.direction}`;
  children.dataset["dropSection"] = node.id;
  children.hidden = node.collapsed;
  if (!node.collapsed) {
    for (const child of node.children) children.append(renderNode(child, depth + 1));
    if (node.children.length === 0 && !data.locked) {
      const empty = document.createElement("button");
      empty.className = "empty-drop";
      empty.type = "button";
      empty.innerHTML = `${icon("link", 16)} Add first link`;
      empty.addEventListener("click", () => addLink(node.id));
      children.append(empty);
    }
  }
  section.append(children);
  return section;
}

function setSectionCollapsed(section: SectionNode, collapsed: boolean): void {
  section.collapsed = collapsed;
  for (const child of section.children) {
    if (child.type === "section") setSectionCollapsed(child, collapsed);
  }
}

function setAllSectionsCollapsed(collapsed: boolean): void {
  for (const section of data.sections) setSectionCollapsed(section, collapsed);
  void persistAndRender();
}

function renderLink(node: LinkNode): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `link-wrap color-${node.color}`;
  wrapper.dataset["id"] = node.id;
  wrapper.dataset["type"] = "link";
  wrapper.style.setProperty("--grow", String(node.grow));
  if (selectedId === node.id) wrapper.classList.add("selected");
  if (selectedIds.has(node.id)) wrapper.classList.add("multi-selected");

  const link = document.createElement("button");
  link.className = "link-tile";
  link.type = "button";
  link.title = node.name;
  const tileIcon = document.createElement("span");
  tileIcon.className = `tile-icon${node.icon === "" && faviconBackgroundEnabled(node) ? " favicon-backed" : ""}`;
  tileIcon.style.setProperty("--favicon-padding", `${node.faviconPadding}px`);
  tileIcon.style.setProperty("--favicon-radius", `${node.faviconRadius}%`);
  tileIcon.append(createNodeIcon(node));
  const tileName = document.createElement("span");
  tileName.className = "tile-name";
  tileName.textContent = node.name;
  link.append(tileIcon, tileName);
  const linkCheckbox = document.createElement("input");
  linkCheckbox.className = "selection-checkbox link-checkbox";
  linkCheckbox.type = "checkbox";
  linkCheckbox.checked = selectedIds.has(node.id);
  linkCheckbox.setAttribute("aria-label", `Select ${node.name}`);
  linkCheckbox.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSelected(node.id);
  });
  link.addEventListener("click", () => {
    if (selectionMode) toggleSelected(node.id);
    else if (data.locked) openLink(node.url, node.openMode);
    else openPanel(node.id);
  });
  const actions = document.createElement("div");
  actions.className = "tile-actions";
  actions.hidden = data.locked;
  actions.innerHTML = `<button class="node-action" type="button">${icon("external-link", 14)}</button><button class="drag-handle" type="button">${icon("grip", 14)}</button>`;
  actions
    .querySelector<HTMLButtonElement>(".node-action")
    ?.setAttribute("aria-label", `Open ${node.name}`);
  actions
    .querySelector<HTMLButtonElement>(".drag-handle")
    ?.setAttribute("aria-label", `Drag ${node.name}`);
  actions.querySelector<HTMLButtonElement>(".node-action")?.addEventListener("click", () => {
    openLink(node.url, node.openMode);
  });
  wrapper.append(actions);
  wrapper.append(linkCheckbox, link);
  bindDrag(actions.querySelector<HTMLElement>(".drag-handle"), node.id);
  return wrapper;
}

function escapeHtml(value: string): string {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

function createNodeIcon(node: LinkNode): globalThis.Node {
  if (node.icon && !node.icon.startsWith("data:")) return document.createTextNode(node.icon);
  const image = document.createElement("img");
  image.alt = "";
  if (node.icon) image.src = node.icon;
  else {
    image.className = "favicon";
    image.src = faviconUrl(node.url);
  }
  return image;
}

function renderNodeIcon(_node: LinkNode): string {
  return '<span class="icon-dom-mount"></span>';
}

function faviconStyle(node: LinkNode): string {
  return `--favicon-padding:${node.faviconPadding}px;--favicon-radius:${node.faviconRadius}%`;
}

function toggleSelected(id: string): void {
  const node = findNode(data.sections, id);
  if (!node) return;
  const ids = subtreeIds(node);
  const allSelected = ids.every((nodeId) => selectedIds.has(nodeId));
  for (const nodeId of ids) {
    if (allSelected) selectedIds.delete(nodeId);
    else selectedIds.add(nodeId);
  }
  selectionCount.textContent = String(selectedIds.size);
  deleteSelectedButton.hidden = selectedIds.size === 0;
  render(true);
}

function subtreeIds(node: Node): string[] {
  return node.type === "link"
    ? [node.id]
    : [node.id, ...node.children.flatMap((child) => subtreeIds(child))];
}

function selectionState(node: SectionNode): { checked: boolean; indeterminate: boolean } {
  const ids = subtreeIds(node);
  const selected = ids.filter((id) => selectedIds.has(id)).length;
  return { checked: selected === ids.length, indeterminate: selected > 0 && selected < ids.length };
}

function setSelectionMode(enabled: boolean): void {
  const toolbarRect = toolbar.getBoundingClientRect();
  const toolbarCenter = {
    x: toolbarRect.left + toolbarRect.width / 2,
    y: toolbarRect.top + toolbarRect.height / 2,
  };
  selectionMode = enabled;
  toolbar.classList.toggle("selecting", enabled);
  requireElement<HTMLButtonElement>("#cancel-selection").hidden = !enabled;
  canvas.classList.toggle("selection-mode", enabled);
  selectButton.classList.toggle("active", enabled);
  selectButton.setAttribute("aria-pressed", String(enabled));
  if (!enabled) selectedIds.clear();
  selectionCount.textContent = String(selectedIds.size);
  deleteSelectedButton.hidden = selectedIds.size === 0;
  render(true);
  window.requestAnimationFrame(() => {
    if (toolbarAnchor) {
      repositionAnchoredToolbar();
      return;
    }
    if (!toolbarPosition) return;
    toolbarPosition = {
      x: toolbarCenter.x - toolbar.offsetWidth / 2,
      y: toolbarCenter.y - toolbar.offsetHeight / 2,
    };
    positionFloatingElement(toolbar, toolbarPosition);
    persistToolbarPosition();
  });
}

function render(skipEditor = false): void {
  const toolbarWasHidden = toolbar.hidden !== false;
  canvas.replaceChildren();
  const empty = data.sections.length === 0;
  const firstRun = empty && !onboardingComplete;
  document.body.classList.toggle("welcome-mode", firstRun);
  document.body.classList.toggle("returning-empty-mode", empty && onboardingComplete);
  panel.hidden = firstRun;
  canvas.classList.toggle("locked", data.locked);
  toolbar.classList.toggle("locked", data.locked);
  lockButton.dataset["icon"] = data.locked ? "lock" : "unlock";
  lockButton.title = data.locked ? "Unlock layout" : "Lock layout";
  lockButton.setAttribute("aria-label", lockButton.title);
  lockButton.innerHTML = icon(data.locked ? "lock" : "unlock");
  if (empty) {
    if (onboardingComplete) {
      toolbar.hidden = false;
      const emptyState = document.createElement("section");
      emptyState.className = "empty-canvas";
      emptyState.innerHTML = `
        <span class="empty-canvas-icon" aria-hidden="true">${icon("panel-top", 20)}</span>
        <strong>Nothing here yet</strong>
        <p>Add your first link to start building your workspace.</p>
        <div class="empty-state-actions">
          <button class="primary-button" data-empty="link" type="button">${icon("link", 16)} Add first link</button>
          <button class="secondary-button" data-empty="import" type="button">${icon("upload", 16)} Import</button>
        </div>`;
      emptyState
        .querySelector<HTMLButtonElement>("[data-empty='link']")
        ?.addEventListener("click", () => addLink());
      emptyState
        .querySelector<HTMLButtonElement>("[data-empty='import']")
        ?.addEventListener("click", () => importInput.click());
      canvas.append(emptyState);
      if (!skipEditor) renderEditor();
      finishToolbarReveal(toolbarWasHidden);
      return;
    }
    toolbar.hidden = true;
    const welcome = document.createElement("section");
    welcome.className = "welcome first-run";
    welcome.innerHTML = `
      <div class="welcome-visual" aria-hidden="true">
        <span class="mosaic-cell cell-one"></span><span class="mosaic-cell cell-two"></span>
        <span class="mosaic-cell cell-three"></span><span class="mosaic-cell cell-four"></span>
      </div>
      <div class="welcome-copy">
        <div class="welcome-brand"><span class="brand-mark"></span><span>Tessera</span></div>
        <h1>Put everything in its place.</h1>
        <p>Build a calm workspace from sections and links. Local, flexible, yours.</p>
        <div class="welcome-paths" ${welcomeChoicesOpen ? "hidden" : ""}>
          <button class="path-button path-primary" data-welcome="guide" type="button"><span class="path-icon">${icon("sparkles", 18)}</span><span><strong>I’m new, show me around</strong><small>Learn the basics in four quick steps</small></span>${icon("chevron-right", 16)}</button>
          <button class="path-button" data-welcome="choices" type="button"><span class="path-icon">${icon("arrow-right", 18)}</span><span><strong>I know what I’m doing</strong><small>Create from scratch or import a layout</small></span>${icon("chevron-right", 16)}</button>
        </div>
        <div class="welcome-choices" ${welcomeChoicesOpen ? "" : "hidden"}><button class="primary-button" data-welcome="create" type="button">${icon("panel-top", 16)} Create from scratch</button><button class="secondary-button" data-welcome="import" type="button">${icon("upload", 16)} Import JSON</button></div>
      </div>
      <div class="guide" ${guideStep < 0 ? "hidden" : ""}></div>`;
    welcome
      .querySelector<HTMLButtonElement>("[data-welcome='create']")
      ?.addEventListener("click", () => {
        toolbarActivationBlockedUntil = performance.now() + 300;
        welcomeChoicesOpen = false;
        guideStep = -1;
        closeMoreMenu();
        completeOnboarding();
        addSection();
      });
    welcome
      .querySelector<HTMLButtonElement>("[data-welcome='guide']")
      ?.addEventListener("click", () => {
        guideStep = 0;
        renderGuide(welcome);
      });
    welcome
      .querySelector<HTMLButtonElement>("[data-welcome='choices']")
      ?.addEventListener("click", () => {
        welcomeChoicesOpen = true;
        welcome.querySelector<HTMLElement>(".welcome-paths")!.hidden = true;
        welcome.querySelector<HTMLElement>(".welcome-choices")!.hidden = false;
      });
    welcome
      .querySelector<HTMLButtonElement>("[data-welcome='import']")
      ?.addEventListener("click", () => importInput.click());
    renderGuide(welcome);
    canvas.append(welcome);
  } else {
    toolbar.hidden = false;
    for (const section of data.sections) canvas.append(renderNode(section, 1));
  }
  if (!skipEditor) renderEditor();
  finishToolbarReveal(toolbarWasHidden);
}

const GUIDE_STEPS = [
  {
    icon: "panel-top",
    diagram: "sections",
    eyebrow: "Step 1 of 4",
    title: "Start with sections",
    body: "Sections organise your workspace. Nest them up to 16 levels and choose horizontal or vertical flow.",
  },
  {
    icon: "link",
    diagram: "links",
    eyebrow: "Step 2 of 4",
    title: "Add the links you use",
    body: "Each tile opens a URL. Tessera finds its favicon, or you can choose any emoji or upload an icon.",
  },
  {
    icon: "grip",
    diagram: "drag",
    eyebrow: "Step 3 of 4",
    title: "Shape it by dragging",
    body: "Reorder tiles and move whole sections. Size controls decide how available space is shared.",
  },
  {
    icon: "lock",
    diagram: "lock",
    eyebrow: "Step 4 of 4",
    title: "Lock it when it feels right",
    body: "Locking removes editing controls. Your layout stays local and can be exported whenever you like.",
  },
] as const;

function renderGuide(welcome: HTMLElement): void {
  const guide = welcome.querySelector<HTMLElement>(".guide");
  if (!guide || guideStep < 0) return;
  const step = GUIDE_STEPS[guideStep];
  if (!step) return;
  guide.hidden = false;
  guide.innerHTML = `
    <div class="guide-progress">${GUIDE_STEPS.map((_, index) => `<span class="${index <= guideStep ? "active" : ""}"></span>`).join("")}</div>
    <div class="guide-layout"><div class="guide-demo demo-${step.diagram}">${renderGuideDiagram(step.diagram)}</div><div class="guide-copy"><div class="guide-icon">${icon(step.icon, 20)}</div><p class="eyebrow">${step.eyebrow}</p><h2>${step.title}</h2><p>${step.body}</p></div></div>
    <div class="guide-actions"><button class="quiet-button" data-guide="skip" type="button">Skip guide</button><div><button class="secondary-button" data-guide="back" type="button"${guideStep === 0 ? " disabled" : ""}>Back</button><button class="primary-button" data-guide="next" type="button">${guideStep === GUIDE_STEPS.length - 1 ? "Start building" : "Next"}</button></div></div>`;
  guide.querySelector<HTMLButtonElement>("[data-guide='skip']")?.addEventListener("click", () => {
    completeOnboarding();
    guideStep = -1;
    render();
  });
  guide.querySelector<HTMLButtonElement>("[data-guide='back']")?.addEventListener("click", () => {
    guideStep -= 1;
    renderGuide(welcome);
  });
  guide.querySelector<HTMLButtonElement>("[data-guide='next']")?.addEventListener("click", () => {
    if (guideStep === GUIDE_STEPS.length - 1) {
      completeOnboarding();
      addSection();
    } else {
      guideStep += 1;
      renderGuide(welcome);
    }
  });
}

function renderGuideDiagram(kind: string): string {
  if (kind === "sections")
    return `<div class="demo-section outer"><span>Work</span><div class="demo-section inner"><span>Projects</span><div class="demo-tile"></div><div class="demo-tile short"></div></div></div>`;
  if (kind === "links")
    return `<div class="demo-link"><i>G</i><span>GitHub</span></div><div class="demo-link delay"><i>D</i><span>Docs</span></div><div class="demo-link delay-two"><i>F</i><span>Figma</span></div>`;
  if (kind === "drag")
    return `<div class="drag-list"><div class="drag-tile tile-a"><b>⠿</b><span>Design</span></div><div class="drag-tile tile-b"><b>⠿</b><span>Build</span></div><div class="drag-tile tile-c"><b>⠿</b><span>Ship</span></div></div><div class="demo-cursor">${icon("mouse-pointer", 20)}</div>`;
  return `<div class="lock-layout"><div class="lock-grid"><span></span><span></span><span></span><span></span></div><div class="lock-badge">${icon("lock", 22)}</div></div>`;
}

async function persistAndRender(): Promise<void> {
  render();
  await save();
}

function selectedSectionId(): string | undefined {
  if (!selectedId) return undefined;
  const selected = findNode(data.sections, selectedId);
  return selected?.type === "section" ? selected.id : undefined;
}

function addSection(parentId = selectedSectionId()): void {
  const section = createSection();
  if (parentId) {
    const parent = findNode(data.sections, parentId);
    const depth = nodeDepth(data.sections, parentId) ?? MAX_DEPTH;
    if (parent?.type !== "section" || depth >= MAX_DEPTH) {
      showToast(`Sections can nest ${MAX_DEPTH} levels deep.`, true);
      return;
    }
    parent.collapsed = false;
    parent.children.push(section);
  } else {
    data.sections.push(section);
  }
  openPanel(section.id);
  void persistAndRender();
}

function addLink(parentId = selectedSectionId()): void {
  parentId ??= lastSectionId;
  if (!parentId) {
    if (data.sections.length === 0) {
      const section = createSection("Links");
      data.sections.push(section);
      parentId = section.id;
    } else {
      showToast("Select a section before adding a link.", true);
      return;
    }
  }
  const parent = findNode(data.sections, parentId);
  if (parent?.type !== "section") return;
  const link = createLink();
  parent.collapsed = false;
  lastSectionId = parent.id;
  parent.children.push(link);
  openPanel(link.id);
  void persistAndRender();
}

interface DragDestination {
  parentId: string | undefined;
  beforeId: string | undefined;
}

function bindDrag(handle: HTMLElement | null, id: string): void {
  if (!handle || data.locked) return;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const source = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    const moving = findNode(data.sections, id);
    if (!source || !moving) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    let active = false;
    let destination: DragDestination | undefined;
    const slot = document.createElement("div");
    slot.className = `drag-slot drag-slot-${moving.type}`;
    slot.style.setProperty("--drag-width", `${source.getBoundingClientRect().width}px`);
    slot.style.setProperty("--drag-height", `${source.getBoundingClientRect().height}px`);
    const preview = source.cloneNode(true) as HTMLElement;
    preview.className = "drag-preview";
    preview.style.width = `${Math.min(source.offsetWidth, 360)}px`;
    const movePreview = (pointer: PointerEvent): void => {
      preview.style.left = `${pointer.clientX + 14}px`;
      preview.style.top = `${pointer.clientY + 14}px`;
    };
    const startDrag = (pointer: PointerEvent): void => {
      active = true;
      source.classList.add("drag-source");
      document.body.classList.add("sorting");
      document.body.append(preview);
      movePreview(pointer);
    };
    const move = (pointer: PointerEvent): void => {
      if (!active && Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y) < 5) return;
      if (!active) startDrag(pointer);
      movePreview(pointer);
      destination = updateDragDestination(pointer, moving, source, slot);
      const edge = 56;
      if (pointer.clientY < edge) window.scrollBy({ top: -12 });
      else if (pointer.clientY > window.innerHeight - edge) window.scrollBy({ top: 12 });
    };
    const finish = (commit: boolean): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", keydown);
      preview.remove();
      slot.remove();
      source.classList.remove("drag-source");
      document.body.classList.remove("sorting");
      document.querySelectorAll<HTMLElement>(".drag-nest-target").forEach((section) => {
        section.classList.remove("drag-nest-target");
        if (section.classList.contains("collapsed"))
          section.querySelector<HTMLElement>(".section-content")!.hidden = true;
      });
      if (commit && destination) moveNode(id, destination);
    };
    const up = (): void => finish(active);
    const cancel = (): void => finish(false);
    const keydown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === "Escape") finish(false);
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", keydown);
  });
}

function updateDragDestination(
  pointer: PointerEvent,
  moving: Node,
  source: HTMLElement,
  slot: HTMLElement,
): DragDestination | undefined {
  const elements = document.elementsFromPoint(pointer.clientX, pointer.clientY);
  const hoveredNode = elements
    .map((element) => element.closest<HTMLElement>("[data-id]"))
    .find((element) => element && element !== source && !source.contains(element));
  if (hoveredNode?.parentElement) {
    const parentContainer = hoveredNode.parentElement;
    const vertical =
      parentContainer === canvas || parentContainer.classList.contains("direction-vertical");
    const rect = hoveredNode.getBoundingClientRect();
    const coordinate = vertical ? pointer.clientY : pointer.clientX;
    const start = vertical ? rect.top : rect.left;
    const size = vertical ? rect.height : rect.width;
    const nearEdge = coordinate < start + size * 0.22 || coordinate > start + size * 0.78;
    if (nearEdge) {
      const parentId = parentContainer.dataset["dropSection"];
      const parent = parentId ? findNode(data.sections, parentId) : undefined;
      const siblings = parent?.type === "section" ? parent.children : data.sections;
      if ((!parent && moving.type === "section") || parent?.type === "section") {
        return placeDragSlot(parentContainer, siblings, pointer, source, slot, parentId);
      }
    }
  }
  const hoveredSection = elements
    .map((element) => element.closest<HTMLElement>(".section"))
    .find((element) => element && element !== source && !source.contains(element));
  let container = elements
    .map((element) => element.closest<HTMLElement>(".section-content"))
    .find((element) => element && !source.contains(element));
  if (!container && hoveredSection) {
    const target = findNode(data.sections, hoveredSection.dataset["id"] ?? "");
    if (target?.type === "section" && !containsNode(moving, target.id)) {
      if ((nodeDepth(data.sections, target.id) ?? MAX_DEPTH) + subtreeDepth(moving) <= MAX_DEPTH) {
        hoveredSection.classList.add("drag-nest-target");
        container = hoveredSection.querySelector<HTMLElement>(".section-content");
        if (container) container.hidden = false;
      }
    }
  }
  document.querySelectorAll(".drag-nest-target").forEach((element) => {
    if (element !== hoveredSection) element.classList.remove("drag-nest-target");
  });
  if (!container) {
    if (moving.type !== "section" || !elements.includes(canvas)) {
      slot.remove();
      return undefined;
    }
    return placeDragSlot(canvas, data.sections, pointer, source, slot, undefined);
  }
  const parentId = container.dataset["dropSection"];
  const parent = parentId ? findNode(data.sections, parentId) : undefined;
  if (parent?.type !== "section" || containsNode(moving, parent.id)) {
    slot.remove();
    return undefined;
  }
  if ((nodeDepth(data.sections, parent.id) ?? MAX_DEPTH) + subtreeDepth(moving) > MAX_DEPTH) {
    slot.remove();
    return undefined;
  }
  return placeDragSlot(container, parent.children, pointer, source, slot, parent.id);
}

function placeDragSlot(
  container: HTMLElement,
  siblings: Node[],
  pointer: PointerEvent,
  source: HTMLElement,
  slot: HTMLElement,
  parentId?: string,
): DragDestination {
  const vertical = container === canvas || container.classList.contains("direction-vertical");
  const elements = [...container.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child !== source &&
      child !== slot &&
      Boolean(child.dataset["id"]),
  );
  const coordinate = vertical ? pointer.clientY : pointer.clientX;
  const before = elements.find((element) => {
    const rect = element.getBoundingClientRect();
    return coordinate < (vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2);
  });
  container.insertBefore(slot, before ?? null);
  container.querySelector(".empty-drop")?.setAttribute("hidden", "");
  const beforeId = before?.dataset["id"];
  return {
    parentId,
    beforeId: siblings.some((node) => node.id === beforeId) ? beforeId : undefined,
  };
}

function moveNode(id: string, destination: DragDestination): void {
  const moving = findNode(data.sections, id);
  if (!moving) return;
  const target = destination.parentId ? findNode(data.sections, destination.parentId) : undefined;
  const siblings = target?.type === "section" ? target.children : data.sections;
  if (target?.type === "section" && containsNode(moving, target.id)) return;
  if (!target && moving.type !== "section") return;
  const removed = removeNode(data.sections, id);
  if (!removed) return;
  const index = destination.beforeId
    ? siblings.findIndex((node) => node.id === destination.beforeId)
    : siblings.length;
  siblings.splice(index < 0 ? siblings.length : index, 0, removed);
  if (target?.type === "section") target.collapsed = false;
  void persistAndRender();
}

function inputField(label: string, value: string, name: string, type = "text"): string {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeAttribute(value)}" /></label>`;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function renderEditor(): void {
  const node = selectedId ? findNode(data.sections, selectedId) : undefined;
  for (const select of editor.querySelectorAll<HTMLSelectElement>("select[data-enhanced='true']"))
    select.dispatchEvent(new Event("select-close"));
  editor.replaceChildren();
  pageSettings.hidden = Boolean(node);
  panelTitle.textContent = node
    ? node.type === "section"
      ? "Edit section"
      : "Edit link"
    : "Page settings";
  if (!node) return;
  const form = document.createElement("form");
  form.className = `node-form ${node.type}-form`;
  const commonBeforeSize = `
    ${inputField("Name", node.name, "name")}
    <label class="field"><span>Accent</span><select name="color">${ACCENTS.map((color) => `<option value="${color}"${node.color === color ? " selected" : ""}>${color[0]?.toUpperCase()}${color.slice(1)}</option>`).join("")}</select></label>`;
  const sizeField = `<label class="field"><span>Size</span><input name="grow" type="range" min="1" max="16" value="${node.grow}" /><output>${node.grow}</output></label>`;
  const iconSource =
    node.type === "link"
      ? node.icon === ""
        ? "favicon"
        : node.icon.startsWith("data:image/")
          ? "custom"
          : "emoji"
      : "favicon";
  form.innerHTML =
    node.type === "section"
      ? `<section class="node-fields"><h2>Appearance</h2>${commonBeforeSize}
        <label class="field"><span>Flow</span><select name="direction"><option value="horizontal"${node.direction === "horizontal" ? " selected" : ""}>Horizontal</option><option value="vertical"${node.direction === "vertical" ? " selected" : ""}>Vertical</option></select></label>
        ${sizeField}</section>
        <section class="settings-group inspector-actions"><h2>Actions</h2><div class="button-row"><button class="secondary-button" name="add-link" type="button">${icon("link", 15)} Add link</button><button class="secondary-button" name="add-section" type="button">${icon("panel-top", 15)} Nest section</button></div><button class="danger-button" name="delete" type="button">${icon("trash", 15)} Delete section</button></section>`
      : `<section class="node-fields"><h2>Appearance</h2>${commonBeforeSize}${sizeField}${inputField("URL", node.url, "url", "url")}
        <label class="field"><span>Open in</span><select name="openMode"><option value="current"${node.openMode === "current" ? " selected" : ""}>Current tab</option><option value="tab"${node.openMode === "tab" ? " selected" : ""}>New tab</option><option value="window"${node.openMode === "window" ? " selected" : ""}>New window</option></select></label>
        <fieldset class="icon-field"><div class="icon-heading"><legend>Icon</legend><span class="icon-preview${node.icon === "" && faviconBackgroundEnabled(node) ? " favicon-backed" : ""}" style="${faviconStyle(node)}">${renderNodeIcon(node)}</span></div><div class="icon-source-tabs" role="tablist" aria-label="Icon source"><button type="button" name="use-favicon" role="tab" aria-selected="${iconSource === "favicon"}">Favicon</button><button type="button" name="use-emoji" role="tab" aria-selected="${iconSource === "emoji"}">Emoji</button><button type="button" name="use-custom" role="tab" aria-selected="${iconSource === "custom"}">Icon</button></div><div class="icon-source-panel favicon-panel"${iconSource === "favicon" ? "" : " hidden"}><label class="field switch-field favicon-background-field"><span>Background (${darkScheme() ? "dark" : "light"} theme)</span><input name="faviconBackground" type="checkbox" role="switch"${faviconBackgroundEnabled(node) ? " checked" : ""} /><span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span></label><label class="field range-field"><span>Roundedness</span><input name="faviconRadius" type="range" min="0" max="50" value="${node.faviconRadius}" /><output>${node.faviconRadius}%</output></label><label class="field range-field"><span>Padding</span><input name="faviconPadding" type="range" min="0" max="8" value="${node.faviconPadding}" /><output>${node.faviconPadding}px</output></label></div><div class="emoji-picker"${iconSource === "emoji" ? "" : " hidden"}><div class="emoji-picker-toolbar"><input class="emoji-search" name="emoji-search" type="search" placeholder="Search all emojis" autocomplete="off" /><label class="tone-field"><span>Skin tone</span><select class="tone-select" aria-label="Default skin tone">${SKIN_TONES.map((tone) => `<option value="${tone}"${emojiSkinTone === tone ? " selected" : ""}>${applySkinTone("👋", tone)}</option>`).join("")}</select></label></div><div class="emoji-shelves"></div><div class="emoji-categories" role="tablist" aria-label="Emoji categories"></div><div class="emoji-grid" aria-live="polite"></div><p class="emoji-empty" hidden>No emojis found.</p></div><div class="icon-drop-zone" tabindex="0"${iconSource === "custom" ? "" : " hidden"}><strong>Drop, paste, or click</strong><span>PNG, JPEG, WebP, GIF, or SVG</span><input name="icon-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden /></div></fieldset></section>
        <section class="settings-group link-actions"><h2>Actions</h2><button class="secondary-button" name="duplicate" type="button">${icon("copy", 15)} Duplicate link</button><button class="danger-button" name="delete" type="button">${icon("trash", 15)} Delete link</button></section>`;
  if (node.type === "link")
    form.querySelector(".icon-preview")?.replaceChildren(createNodeIcon(node));
  form.addEventListener("input", (event) => {
    const target = event.target as Element;
    if (target.closest(".emoji-picker") || target.matches("input[name='url']")) return;
    if (node.type === "link" && target.matches("input[name='name']")) node.autoName = false;
    updateFromForm(node, form);
    if (node.type === "link" && target.matches("input[name='faviconBackground']"))
      form
        .querySelector(".icon-preview")
        ?.classList.toggle("favicon-backed", faviconBackgroundEnabled(node));
    if (node.type === "link")
      form.querySelector<HTMLElement>(".icon-preview")?.setAttribute("style", faviconStyle(node));
  });
  for (const input of form.querySelectorAll<HTMLInputElement>("input[type='range']"))
    input.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const suffix =
        input.name === "faviconRadius" ? "%" : input.name === "faviconPadding" ? "px" : "";
      input.parentElement?.querySelector("output")?.replaceChildren(`${input.value}${suffix}`);
    });
  form
    .querySelector<HTMLButtonElement>("button[name='add-link']")
    ?.addEventListener("click", () => addLink(node.id));
  form
    .querySelector<HTMLButtonElement>("button[name='add-section']")
    ?.addEventListener("click", () => addSection(node.id));
  if (node.type === "link") bindLinkEditor(form, node);
  form.querySelector<HTMLButtonElement>("button[name='delete']")?.addEventListener("click", () => {
    const needsConfirmation =
      node.type === "section" || (!isPristineLink(node) && !node.unmodifiedDuplicate);
    if (
      needsConfirmation &&
      !window.confirm(
        `Delete “${node.name}”${node.type === "section" ? " and everything inside it" : ""}?`,
      )
    )
      return;
    removeNode(data.sections, node.id);
    selectedId = undefined;
    void persistAndRender();
  });
  editor.append(form);
  enhanceSelects(form);
}

function isPristineLink(node: LinkNode): boolean {
  return (
    node.name === "New link" &&
    node.url === "https://" &&
    node.icon === "" &&
    node.openMode === "current" &&
    node.color === "slate" &&
    node.grow === 1
  );
}

function updateFromForm(node: Node, form: HTMLFormElement): void {
  const values = new FormData(form);
  node.name = String(values.get("name") ?? node.name).trimStart();
  node.color = String(values.get("color") ?? "slate") as (typeof ACCENTS)[number];
  node.grow = Number(values.get("grow") ?? 1);
  if (node.type === "section") node.direction = String(values.get("direction")) as Direction;
  else {
    node.unmodifiedDuplicate = false;
    node.url = String(values.get("url") ?? "");
    node.openMode = String(values.get("openMode") ?? "current") as OpenMode;
    setFaviconBackground(node, values.get("faviconBackground") === "on");
    node.faviconRadius = Number(values.get("faviconRadius") ?? 20);
    node.faviconPadding = Number(values.get("faviconPadding") ?? 3);
  }
  render(true);
  void save();
}

function bindLinkEditor(form: HTMLFormElement, node: LinkNode): void {
  const emojiPicker = form.querySelector<HTMLElement>(".emoji-picker");
  const dropZone = form.querySelector<HTMLElement>(".icon-drop-zone");
  const faviconPanel = form.querySelector<HTMLElement>(".favicon-panel");
  const iconInput = form.querySelector<HTMLInputElement>("input[name='icon-file']");
  const urlInput = form.querySelector<HTMLInputElement>("input[name='url']");
  let urlTimer = 0;
  urlInput?.addEventListener("input", () => {
    node.unmodifiedDuplicate = false;
    node.url = urlInput.value;
    window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      if (validHttpUrl(node.url)) {
        if (node.autoName) {
          const inferredName = inferNameFromUrl(normalizeUrl(node.url));
          if (inferredName) {
            node.name = inferredName;
            const nameInput = form.querySelector<HTMLInputElement>("input[name='name']");
            if (nameInput) nameInput.value = inferredName;
            const tile = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(node.id)}"]`);
            tile?.querySelector<HTMLElement>(".tile-name")?.replaceChildren(inferredName);
            tile?.querySelector<HTMLElement>(".link-tile")?.setAttribute("title", inferredName);
          }
        }
        if (node.icon === "") {
          const source = faviconUrl(normalizeUrl(node.url));
          form.querySelector<HTMLImageElement>(".icon-preview img")?.setAttribute("src", source);
          document
            .querySelector<HTMLImageElement>(`[data-id="${CSS.escape(node.id)}"] .tile-icon img`)
            ?.setAttribute("src", source);
        }
      }
      void save();
    }, 350);
  });
  urlInput?.addEventListener("blur", () => {
    if (!validHttpUrl(urlInput.value)) return;
    node.url = normalizeUrl(urlInput.value);
    urlInput.value = node.url;
    void save();
  });
  const showSource = (source: "favicon" | "emoji" | "custom"): void => {
    if (faviconPanel) faviconPanel.hidden = source !== "favicon";
    if (emojiPicker) emojiPicker.hidden = source !== "emoji";
    if (dropZone) dropZone.hidden = source !== "custom";
    for (const tab of form.querySelectorAll<HTMLButtonElement>(".icon-source-tabs button")) {
      const tabSource = tab.name.replace("use-", "");
      tab.setAttribute("aria-selected", String(tabSource === source));
    }
    if (source === "emoji") void initializeEmojiPicker(form, node);
  };
  form
    .querySelector<HTMLButtonElement>("button[name='use-favicon']")
    ?.addEventListener("click", () => {
      node.unmodifiedDuplicate = false;
      node.icon = "";
      faviconRevision += 1;
      showSource("favicon");
      const preview = form.querySelector<HTMLElement>(".icon-preview");
      preview?.replaceChildren();
      preview?.append(createNodeIcon(node));
      preview?.classList.toggle("favicon-backed", faviconBackgroundEnabled(node));
      void save();
      render(true);
    });
  form
    .querySelector<HTMLButtonElement>("button[name='use-emoji']")
    ?.addEventListener("click", () => showSource("emoji"));
  form
    .querySelector<HTMLButtonElement>("button[name='use-custom']")
    ?.addEventListener("click", () => showSource("custom"));
  if (!emojiPicker?.hidden) void initializeEmojiPicker(form, node);
  dropZone?.addEventListener("click", () => iconInput?.click());
  dropZone?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") iconInput?.click();
  });
  dropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = event.dataTransfer?.files[0];
    if (file) void setCustomIcon(node, file);
  });
  dropZone?.addEventListener("paste", (event) => {
    event.preventDefault();
    const file = event.clipboardData?.files[0];
    if (file) {
      void setCustomIcon(node, file);
      return;
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    try {
      node.icon = sanitizeSvg(text);
      node.unmodifiedDuplicate = false;
      void persistAndRender();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Clipboard has no supported icon.", true);
    }
  });
  iconInput?.addEventListener("change", async () => {
    const file = iconInput.files?.[0];
    iconInput.value = "";
    if (!file) return;
    await setCustomIcon(node, file);
  });
  form
    .querySelector<HTMLButtonElement>("button[name='duplicate']")
    ?.addEventListener("click", () => {
      const parent = findParentSection(data.sections, node.id);
      if (!parent) return;
      const index = parent.children.findIndex((child) => child.id === node.id);
      const duplicate: LinkNode = {
        ...node,
        id: crypto.randomUUID(),
        name: `${node.name} copy`,
        autoName: false,
        unmodifiedDuplicate: true,
      };
      parent.children.splice(index + 1, 0, duplicate);
      openPanel(duplicate.id);
      void persistAndRender();
    });
}

async function initializeEmojiPicker(form: HTMLFormElement, node: LinkNode): Promise<void> {
  const picker = form.querySelector<HTMLElement>(".emoji-picker");
  if (!picker || picker.dataset["ready"] === "true") return;
  picker.dataset["ready"] = "true";
  const grid = picker.querySelector<HTMLElement>(".emoji-grid");
  const categories = picker.querySelector<HTMLElement>(".emoji-categories");
  const search = picker.querySelector<HTMLInputElement>(".emoji-search");
  const empty = picker.querySelector<HTMLElement>(".emoji-empty");
  const shelves = picker.querySelector<HTMLElement>(".emoji-shelves");
  const toneSelect = picker.querySelector<HTMLSelectElement>(".tone-select");
  if (!grid || !categories || !search || !empty || !shelves || !toneSelect) return;
  try {
    emojiGroups ??= (await (
      await fetch(chrome.runtime.getURL("emoji-data.json"))
    ).json()) as EmojiGroup[];
  } catch {
    picker.dataset["ready"] = "false";
    showToast("Could not load emoji data.", true);
    return;
  }
  const findEntry = (emoji: string): EmojiGroup["emojis"][number] | undefined => {
    for (const group of emojiGroups!) {
      const entry = group.emojis.find(([candidate]) => candidate === emoji);
      if (entry) return entry;
    }
    return undefined;
  };
  const recentEntries = (): EmojiGroup["emojis"] =>
    emojiRecent.slice(0, 12).flatMap((emoji) => {
      const entry = findEntry(emoji);
      return entry ? [entry] : [];
    });
  const selectEmoji = async (
    emoji: string,
    supportsTone: EmojiGroup["emojis"][number][2],
  ): Promise<void> => {
    node.unmodifiedDuplicate = false;
    node.icon = supportsTone === 1 ? applySkinTone(emoji, emojiSkinTone) : emoji;
    emojiRecent = [emoji, ...emojiRecent.filter((candidate) => candidate !== emoji)].slice(0, 24);
    await chrome.storage.local.set({ emojiRecent });
    await persistAndRender();
  };
  const emojiButton = ([
    emoji,
    name,
    supportsTone,
  ]: EmojiGroup["emojis"][number]): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = supportsTone === 1 ? applySkinTone(emoji, emojiSkinTone) : emoji;
    button.title = name;
    button.setAttribute("aria-label", name);
    button.addEventListener("click", () => void selectEmoji(emoji, supportsTone));
    return button;
  };
  const renderShelves = (): void => {
    shelves.replaceChildren();
    const entries = recentEntries();
    const shelf = document.createElement("section");
    shelf.className = "emoji-shelf";
    shelf.innerHTML = `<h3>Recently used</h3><div>${entries.length === 0 ? '<span class="emoji-shelf-empty">None yet</span>' : ""}</div>`;
    shelf.querySelector("div")?.append(...entries.map(emojiButton));
    shelves.append(shelf);
  };
  const renderEmojis = (): void => {
    const query = search.value.trim().toLowerCase();
    const entries = query
      ? emojiGroups!.flatMap((group) => group.emojis).filter(([, name]) => name.includes(query))
      : (emojiGroups![emojiGroupIndex]?.emojis ?? []);
    grid.replaceChildren(...entries.map(emojiButton));
    empty.hidden = entries.length > 0;
    categories.hidden = Boolean(query);
    shelves.hidden = Boolean(query);
  };
  const categoryIcons = ["😀", "👋", "🐻", "🍎", "🚗", "⚽", "💡", "♥️", "🚩"];
  categories.replaceChildren(
    ...emojiGroups.map((group, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = categoryIcons[index] ?? "•";
      button.title = group.name;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-label", group.name);
      button.setAttribute("aria-selected", String(index === emojiGroupIndex));
      button.addEventListener("click", () => {
        emojiGroupIndex = index;
        for (const tab of categories.querySelectorAll("button"))
          tab.setAttribute("aria-selected", "false");
        button.setAttribute("aria-selected", "true");
        renderEmojis();
      });
      return button;
    }),
  );
  search.addEventListener("input", renderEmojis);
  toneSelect.addEventListener("change", () => {
    emojiSkinTone = toneSelect.value;
    void chrome.storage.local.set({ emojiSkinTone });
    renderShelves();
    renderEmojis();
  });
  renderShelves();
  renderEmojis();
  window.setTimeout(() => search.focus({ preventScroll: true }), 0);
}

async function setCustomIcon(node: LinkNode, file: File): Promise<void> {
  try {
    node.unmodifiedDuplicate = false;
    node.icon =
      file.type === "image/svg+xml"
        ? sanitizeSvg(await file.text(), MAX_ICON_DATA_URL_LENGTH)
        : await readImage(file, MAX_ICON_DATA_URL_LENGTH);
    await persistAndRender();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Icon upload failed.", true);
  }
}

async function setBackgroundImage(file: File): Promise<void> {
  try {
    data.backgroundImage =
      file.type === "image/svg+xml"
        ? sanitizeSvg(await file.text(), MAX_BACKGROUND_DATA_URL_LENGTH)
        : await readImage(file, MAX_BACKGROUND_DATA_URL_LENGTH);
    data.backgroundType = "image";
    applyAppearance();
    await save();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Background upload failed.", true);
  }
}

function sanitizeSvg(source: string, maxDataUrlLength = MAX_ICON_DATA_URL_LENGTH): string {
  if (source.length > 250_000) throw new Error("SVG must be smaller than 250 KB.");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || document.querySelector("parsererror"))
    throw new Error("Paste a valid SVG.");
  for (const element of svg.querySelectorAll("script, style, foreignObject")) element.remove();
  for (const element of svg.querySelectorAll("*")) {
    for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
      const attribute = element.attributes[index];
      if (!attribute) continue;
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        ((name === "href" || name.endsWith(":href")) && !attribute.value.startsWith("#"))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  const serialized = new XMLSerializer().serializeToString(svg);
  const normalized = normalizeImageDataUrl(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`,
    maxDataUrlLength,
  );
  if (!normalized) throw new Error("SVG contains unsupported or unsafe content.");
  return normalized;
}

async function readImage(file: File, maxDataUrlLength: number): Promise<string> {
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPG, GIF, WebP, or SVG image.");
  if (file.size > maxDataUrlLength) throw new Error("Image is too large to store.");
  const value = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("Could not read image.")));
    reader.readAsDataURL(file);
  });
  const normalized = normalizeImageDataUrl(value, maxDataUrlLength);
  if (!normalized) throw new Error("Image is invalid or too large to store.");
  return normalized;
}

function positionFloatingElement(element: HTMLElement, position: ToolbarPosition): void {
  const x = Math.min(window.innerWidth - element.offsetWidth - 8, Math.max(8, position.x));
  const y = Math.min(window.innerHeight - element.offsetHeight - 8, Math.max(8, position.y));
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
  element.style.transform = "none";
}

function positionToolbarAtCenter(center: ToolbarPosition): void {
  toolbarPosition = {
    x: center.x - toolbar.offsetWidth / 2,
    y: center.y - toolbar.offsetHeight / 2,
  };
  positionFloatingElement(toolbar, toolbarPosition);
}

function animateToolbarEntrance(): void {
  if (toolbar.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = toolbar.getBoundingClientRect();
  toolbar.style.setProperty("--toolbar-enter-y", `${window.innerHeight - rect.top}px`);
  toolbar.classList.add("entering");
  toolbar.addEventListener(
    "animationend",
    () => {
      toolbar.classList.remove("entering");
      toolbar.style.removeProperty("--toolbar-enter-y");
    },
    { once: true },
  );
}

function finishToolbarReveal(wasHidden: boolean): void {
  if (toolbar.hidden) return;
  if (!wasHidden) {
    repositionAnchoredToolbar();
    return;
  }
  toolbar.classList.add("initializing");
  if (toolbarAnchor) {
    toolbarPosition = anchorPosition(toolbar, toolbarAnchor);
    positionFloatingElement(toolbar, toolbarPosition);
  } else if (toolbarPosition) {
    positionFloatingElement(toolbar, toolbarPosition);
  }
  window.requestAnimationFrame(() => {
    toolbar.classList.remove("initializing");
    animateToolbarEntrance();
  });
}

function persistToolbarPosition(): void {
  if (!toolbarPosition) return;
  const rect = toolbar.getBoundingClientRect();
  const position: StoredToolbarPosition = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    reference: "center",
  };
  void chrome.storage.local.set({ toolbarPosition: position, toolbarAnchor });
}

function setDefaultToolbarPosition(): void {
  toolbarAnchor = "south";
  toolbarPosition = undefined;
  toolbar.style.removeProperty("left");
  toolbar.style.removeProperty("top");
  toolbar.style.removeProperty("right");
  toolbar.style.removeProperty("bottom");
  toolbar.style.removeProperty("transform");
  if (toolbar.hidden) {
    void chrome.storage.local.set({ toolbarAnchor });
    return;
  }
  toolbarPosition = anchorPosition(toolbar, toolbarAnchor);
  positionFloatingElement(toolbar, toolbarPosition);
  persistToolbarPosition();
}

function enableToolbarDrag(): void {
  toolbar.addEventListener("pointerdown", (event) => {
    if (!(event.target as Element).closest(".toolbar-grip")) return;
    const rect = toolbar.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    toolbar.setPointerCapture(event.pointerId);
    toolbar.classList.add("moving");
    const move = (moveEvent: PointerEvent): void => {
      let next = {
        x: moveEvent.clientX - offsetX,
        y: moveEvent.clientY - offsetY,
      };
      if (moveEvent.shiftKey) next = snapPosition(toolbar, next);
      else toolbarAnchor = undefined;
      toolbarPosition = next;
      positionFloatingElement(toolbar, toolbarPosition);
    };
    const stop = (): void => {
      toolbar.classList.remove("moving");
      toolbar.removeEventListener("pointermove", move);
      toolbar.removeEventListener("pointerup", stop);
      toolbar.removeEventListener("pointercancel", stop);
      persistToolbarPosition();
    };
    toolbar.addEventListener("pointermove", move);
    toolbar.addEventListener("pointerup", stop);
    toolbar.addEventListener("pointercancel", stop);
  });
}

function snapPosition(
  element: HTMLElement,
  position: { x: number; y: number },
): { x: number; y: number } {
  const names = [
    "northwest",
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
  ];
  const anchors = names.map((name) => anchorPosition(element, name));
  const closest = anchors.reduce((best, anchor) =>
    Math.hypot(anchor.x - position.x, anchor.y - position.y) <
    Math.hypot(best.x - position.x, best.y - position.y)
      ? anchor
      : best,
  );
  toolbarAnchor = names[anchors.indexOf(closest)];
  return closest;
}

function anchorPosition(element: HTMLElement, name: string): { x: number; y: number } {
  const margin = 12;
  const canvasRect = canvas.getBoundingClientRect();
  const useCanvasBounds = document.body.classList.contains("inspector-docked");
  const left = useCanvasBounds ? canvasRect.left : 0;
  const right = useCanvasBounds ? canvasRect.right : window.innerWidth;
  const minX = left + margin;
  const maxX = right - element.offsetWidth - margin;
  const maxY = window.innerHeight - element.offsetHeight - margin;
  const centerX = left + (right - left - element.offsetWidth) / 2;
  const centerY = maxY / 2;
  const x = name.includes("west") ? minX : name.includes("east") ? maxX : centerX;
  const y = name.includes("north") ? margin : name.includes("south") ? maxY : centerY;
  return { x, y };
}

function repositionAnchoredToolbar(): void {
  if (!toolbarAnchor || toolbar.hidden) return;
  window.requestAnimationFrame(() => {
    if (!toolbarAnchor || toolbar.hidden) return;
    toolbarPosition = anchorPosition(toolbar, toolbarAnchor);
    positionFloatingElement(toolbar, toolbarPosition);
  });
}

async function importJson(file: File, type: "items" | "settings"): Promise<void> {
  const input = JSON.parse(await file.text()) as unknown;
  if (type === "items") {
    const imported = parseImport(input);
    data.sections = imported.sections;
    showToast(`Imported ${data.sections.length} groups.`);
  } else {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Choose a Tessera settings or full export file.");
    const source = "settings" in input ? (input as { settings?: unknown }).settings : input;
    if (!source || typeof source !== "object" || Array.isArray(source))
      throw new Error("Choose a Tessera settings or full export file.");
    const imported = parseImport({ ...source, version: 1, sections: data.sections });
    data = imported;
    showToast("Imported app settings.");
  }
  completeOnboarding();
  selectedId = undefined;
  applyAppearance();
  render();
  await save();
}

function exportJson(type: "items" | "settings"): void {
  const { sections, ...settings } = data;
  const payload =
    type === "items"
      ? { type: "tessera-items", version: 1, sections }
      : { type: "tessera-settings", version: 1, settings };
  const blobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `tessera-${type}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
}

function closeMoreMenu(): void {
  moreMenu.hidden = true;
  moreMenuButton.setAttribute("aria-expanded", "false");
  moreMenu.removeAttribute("style");
  toolbar.append(moreMenu);
}

function placeMoreMenu(): void {
  if (moreMenu.hidden) return;
  const toolbarRect = toolbar.getBoundingClientRect();
  const moreMenuButtonRect = moreMenuButton.getBoundingClientRect();
  const width = moreMenu.offsetWidth;
  const gap = 14;
  const maximumHeight = 480;
  const below = window.innerHeight - toolbarRect.bottom - gap - 8;
  const above = toolbarRect.top - gap - 8;
  const preferredHeight = Math.min(maximumHeight, moreMenu.scrollHeight);
  const openBelow = below >= preferredHeight || below >= above;
  const available = Math.max(40, Math.min(maximumHeight, openBelow ? below : above));
  const requestedLeft = toolbar.classList.contains("locked")
    ? toolbarRect.left + (toolbarRect.width - width) / 2
    : moreMenuButtonRect.right - width;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, requestedLeft));
  moreMenu.style.position = "fixed";
  moreMenu.style.maxHeight = `${available}px`;
  moreMenu.style.left = `${left}px`;
  moreMenu.style.right = "auto";
  if (openBelow) {
    moreMenu.style.top = `${toolbarRect.bottom + gap}px`;
    moreMenu.style.bottom = "auto";
  } else {
    moreMenu.style.top = "auto";
    moreMenu.style.bottom = `${window.innerHeight - toolbarRect.top + gap}px`;
  }
}

function linksIn(nodes: Node[]): LinkNode[] {
  return nodes.flatMap((node) => (node.type === "link" ? [node] : linksIn(node.children)));
}

function rgb(value: string): [number, number, number] | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return red === undefined || green === undefined || blue === undefined
    ? undefined
    : [red, green, blue];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

async function faviconNeedsBackground(link: LinkNode): Promise<boolean> {
  const probe = document.createElement("div");
  probe.className = `link-tile color-${link.color} contrast-probe`;
  document.body.append(probe);
  const background = rgb(getComputedStyle(probe).backgroundColor);
  probe.remove();
  if (!background) return false;
  const image = await createImageBitmap(await (await fetch(faviconUrl(link.url))).blob());
  const canvas = new OffscreenCanvas(32, 32);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(image, 0, 0, 32, 32);
  image.close();
  const pixels = context.getImageData(0, 0, 32, 32).data;
  const fallbackImage = await createImageBitmap(
    await (await fetch(faviconUrl("https://tessera-no-favicon.invalid"))).blob(),
  );
  const fallbackCanvas = new OffscreenCanvas(32, 32);
  const fallbackContext = fallbackCanvas.getContext("2d", { willReadFrequently: true });
  if (!fallbackContext) return false;
  fallbackContext.drawImage(fallbackImage, 0, 0, 32, 32);
  fallbackImage.close();
  const fallbackPixels = fallbackContext.getImageData(0, 0, 32, 32).data;
  if (pixels.every((channel, index) => Math.abs(channel - fallbackPixels[index]!) <= 2))
    return false;
  const backgroundLuminance = luminance(background);
  let visible = 0;
  let lowContrast = 0;
  let colourful = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]! / 255;
    if (alpha < 0.5) continue;
    const iconLuminance = luminance([pixels[index]!, pixels[index + 1]!, pixels[index + 2]!]);
    const contrast =
      (Math.max(iconLuminance, backgroundLuminance) + 0.05) /
      (Math.min(iconLuminance, backgroundLuminance) + 0.05);
    visible += 1;
    if (contrast < 3) lowContrast += 1;
    if (
      Math.max(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) -
        Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) >
      40
    )
      colourful += 1;
  }
  return visible > 0 && colourful / visible < 0.15 && lowContrast / visible >= 0.85;
}

async function fixFaviconContrast(): Promise<void> {
  closeMoreMenu();
  const links = linksIn(data.sections).filter((link) => link.icon === "");
  const results = await Promise.allSettled(
    links.map(async (link) => {
      const previous = faviconBackgroundEnabled(link);
      setFaviconBackground(link, await faviconNeedsBackground(link));
      return previous !== faviconBackgroundEnabled(link);
    }),
  );
  const changed = results.filter((result) => result.status === "fulfilled" && result.value).length;
  await persistAndRender();
  showToast(
    changed === 0
      ? "Favicon contrast was already correct."
      : `Updated ${changed} favicon background${changed === 1 ? "" : "s"}.`,
  );
}

async function resetExtension(): Promise<void> {
  if (!window.confirm("Reset Tessera? This permanently deletes all groups, links, and settings."))
    return;
  if (!(await persistence.reset())) return;
  data = structuredClone(DEFAULT_DATA);
  selectedId = undefined;
  lastSectionId = undefined;
  selectedIds.clear();
  selectionMode = false;
  onboardingComplete = false;
  guideStep = -1;
  welcomeChoicesOpen = false;
  toolbarActivationBlockedUntil = performance.now() + 300;
  toolbarPosition = undefined;
  toolbarAnchor = undefined;
  emojiSkinTone = "";
  emojiRecent = [];
  helpDialog.close();
  closeMoreMenu();
  closePanel();
  toolbar.removeAttribute("style");
  applyAppearance();
  render();
  setDefaultToolbarPosition();
}

requireElement<HTMLButtonElement>("#add-section").addEventListener("click", () => addSection());
requireElement<HTMLButtonElement>("#add-link").addEventListener("click", () => addLink());
selectButton.addEventListener("click", () => setSelectionMode(!selectionMode));
expandAllMenuButton.addEventListener("click", () => {
  closeMoreMenu();
  setAllSectionsCollapsed(false);
});
collapseAllMenuButton.addEventListener("click", () => {
  closeMoreMenu();
  setAllSectionsCollapsed(true);
});
requireElement<HTMLButtonElement>("#cancel-selection").addEventListener("click", () =>
  setSelectionMode(false),
);
deleteSelectedButton.addEventListener("click", () => {
  if (selectedIds.size === 0 || !window.confirm(`Delete ${selectedIds.size} selected items?`))
    return;
  for (const id of selectedIds) removeNode(data.sections, id);
  setSelectionMode(false);
  void persistAndRender();
});
requireElement<HTMLButtonElement>("#close-panel").addEventListener("click", closePanel);
canvas.addEventListener("click", (event) => {
  if (!panel.classList.contains("open") || document.body.classList.contains("inspector-docked"))
    return;
  if (!(event.target as Element).closest(".section, .link-wrap")) closePanel();
});
settingsButton.addEventListener("click", () => {
  if (panel.classList.contains("open") && selectedId === undefined) closePanel();
  else openPanel();
});
lockButton.addEventListener("click", () => {
  const rect = toolbar.getBoundingClientRect();
  const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  if (!data.locked && selectionMode) setSelectionMode(false);
  data.locked = !data.locked;
  selectedId = undefined;
  closePanel();
  if (toolbarAnchor) repositionAnchoredToolbar();
  else if (toolbarPosition) {
    positionToolbarAtCenter(center);
    persistToolbarPosition();
  }
  void persistAndRender();
});
requireElement<HTMLButtonElement>("#import-items").addEventListener("click", () => {
  importType = "items";
  importInput.click();
});
requireElement<HTMLButtonElement>("#import-settings").addEventListener("click", () => {
  importType = "settings";
  importInput.click();
});
requireElement<HTMLButtonElement>("#export-items").addEventListener("click", () =>
  exportJson("items"),
);
requireElement<HTMLButtonElement>("#export-settings").addEventListener("click", () =>
  exportJson("settings"),
);
requireElement<HTMLButtonElement>("#hide-toolbar").addEventListener("click", () => {
  closeMoreMenu();
  toolbar.hidden = true;
  showToast("Toolbar hidden until next new tab.");
});
importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  importInput.value = "";
  if (!file) return;
  try {
    await importJson(file, importType);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Import failed.", true);
  }
});
moreMenuButton.addEventListener("click", () => {
  if (performance.now() < toolbarActivationBlockedUntil) return;
  const opening = moreMenu.hidden;
  if (!opening) {
    closeMoreMenu();
    return;
  }
  document.body.append(moreMenu);
  moreMenu.hidden = false;
  moreMenuButton.setAttribute("aria-expanded", "true");
  placeMoreMenu();
  moreMenu.querySelector<HTMLElement>("[role='menuitem']")?.focus();
});
requireElement<HTMLButtonElement>("#open-help").addEventListener("click", () => {
  closeMoreMenu();
  helpDialog.showModal();
});
requireElement<HTMLButtonElement>("#fix-favicon-contrast").addEventListener(
  "click",
  () => void fixFaviconContrast(),
);
requireElement<HTMLButtonElement>("#close-help").addEventListener("click", () =>
  helpDialog.close(),
);
requireElement<HTMLButtonElement>("#reset-extension").addEventListener(
  "click",
  () => void resetExtension(),
);
helpDialog.addEventListener("click", (event) => {
  if (event.target === helpDialog) helpDialog.close();
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Element;
  if (!moreMenu.hidden && !moreMenu.contains(target) && !moreMenuButton.contains(target))
    closeMoreMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeMoreMenu();
  if (selectedId !== undefined) closePanel();
});
themeSelect.addEventListener("change", () => {
  data.theme = themeSelect.value as Theme;
  faviconRevision += 1;
  applyAppearance();
  render();
  void save();
});
let previewPattern = data.backgroundPattern;
let patternIndex = 0;
const patternOptions = [...backgroundPatternSelect.options].map((option) => ({
  label: option.textContent,
  value: option.value as BackgroundPattern,
}));
const previewBackgroundPattern = (pattern: BackgroundPattern): void => {
  previewPattern = pattern;
  patternIndex = patternOptions.findIndex(({ value }) => value === pattern);
  document.body.dataset["backgroundPattern"] = pattern;
  for (const option of patternPickerList.querySelectorAll<HTMLElement>("[role='option']")) {
    option.classList.toggle("active", option.dataset["value"] === pattern);
    option.setAttribute("aria-selected", String(option.dataset["value"] === pattern));
  }
};
const closePatternPicker = (restore = true): void => {
  patternPickerList.hidden = true;
  patternPickerButton.setAttribute("aria-expanded", "false");
  patternPickerButton.parentElement?.append(patternPickerList);
  if (restore) previewBackgroundPattern(data.backgroundPattern);
};
const commitBackgroundPattern = (pattern: BackgroundPattern): void => {
  data.backgroundPattern = pattern;
  backgroundPatternSelect.value = pattern;
  setPatternButtonLabel();
  closePatternPicker(false);
  previewBackgroundPattern(pattern);
  patternPickerButton.focus();
  void save();
};
patternPickerList.replaceChildren(
  ...patternOptions.map(({ label, value }) => {
    const option = document.createElement("button");
    option.type = "button";
    option.dataset["value"] = value;
    option.setAttribute("role", "option");
    option.textContent = label;
    option.addEventListener("pointerenter", () => previewBackgroundPattern(value));
    option.addEventListener("focus", () => previewBackgroundPattern(value));
    option.addEventListener("click", () => commitBackgroundPattern(value));
    return option;
  }),
);
patternPickerButton.addEventListener("click", () => {
  if (!patternPickerList.hidden) {
    closePatternPicker();
    return;
  }
  previewPattern = data.backgroundPattern;
  patternIndex = patternOptions.findIndex(({ value }) => value === previewPattern);
  document.body.append(patternPickerList);
  patternPickerList.hidden = false;
  patternPickerButton.setAttribute("aria-expanded", "true");
  placeListbox(patternPickerButton, patternPickerList, 260, 210);
  previewBackgroundPattern(previewPattern);
  patternPickerList.querySelectorAll<HTMLButtonElement>("[role='option']")[patternIndex]?.focus();
});
patternPickerButton.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key) || !patternPickerList.hidden) return;
  event.preventDefault();
  patternPickerButton.click();
});
patternPickerList.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Escape") {
    closePatternPicker();
    patternPickerButton.focus();
    return;
  }
  if (event.key === "Enter") {
    commitBackgroundPattern(previewPattern);
    return;
  }
  if (event.key === "Home") patternIndex = 0;
  else if (event.key === "End") patternIndex = patternOptions.length - 1;
  else
    patternIndex =
      (patternIndex + (event.key === "ArrowDown" ? 1 : -1) + patternOptions.length) %
      patternOptions.length;
  const option =
    patternPickerList.querySelectorAll<HTMLButtonElement>("[role='option']")[patternIndex];
  option?.focus();
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Element;
  if (
    !target.closest(".pattern-picker") &&
    !patternPickerList.contains(target) &&
    !patternPickerList.hidden
  )
    closePatternPicker();
});
for (const input of backgroundTypeInputs) {
  input.addEventListener("change", () => {
    data.backgroundType = input.value as BackgroundType;
    applyAppearance();
    void save();
  });
}
for (const swatch of backgroundColorControls.querySelectorAll<HTMLButtonElement>(
  "[data-background-color]",
)) {
  swatch.addEventListener("click", () => {
    data.backgroundColor = swatch.dataset["backgroundColor"] ?? "";
    applyAppearance();
    void save();
  });
}
backgroundColorInput.addEventListener("input", () => {
  data.backgroundColor = backgroundColorInput.value;
  applyAppearance();
  void save();
});
densitySelect.addEventListener("change", () => {
  data.density = densitySelect.value as Density;
  applyAppearance();
  void save();
});
inspectorModeSelect.addEventListener("change", () => {
  data.inspectorMode = inspectorModeSelect.value as InspectorMode;
  panel.style.removeProperty("left");
  panel.style.removeProperty("top");
  panel.style.removeProperty("right");
  applyAppearance();
  repositionAnchoredToolbar();
  void chrome.storage.local.remove("panelPosition");
  void save();
});
inspectorSideSelect.addEventListener("change", () => {
  data.inspectorSide = inspectorSideSelect.value as InspectorSide;
  panel.style.removeProperty("left");
  panel.style.removeProperty("right");
  applyAppearance();
  repositionAnchoredToolbar();
  void chrome.storage.local.remove("panelPosition");
  void save();
});
showItemCountsInput.addEventListener("change", () => {
  data.showItemCounts = showItemCountsInput.checked;
  render(true);
  void save();
});
itemGapInput.addEventListener("input", () => {
  data.itemGap = Number(itemGapInput.value);
  applyAppearance();
  void save();
});
sectionGapInput.addEventListener("input", () => {
  data.sectionGap = Number(sectionGapInput.value);
  applyAppearance();
  void save();
});
pagePaddingInput.addEventListener("input", () => {
  data.pagePadding = Number(pagePaddingInput.value);
  applyAppearance();
  void save();
});
backgroundDropZone.addEventListener("click", () => backgroundInput.click());
backgroundDropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") backgroundInput.click();
});
backgroundDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  backgroundDropZone.classList.add("drag-over");
});
backgroundDropZone.addEventListener("dragleave", () =>
  backgroundDropZone.classList.remove("drag-over"),
);
backgroundDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  backgroundDropZone.classList.remove("drag-over");
  const file = event.dataTransfer?.files[0];
  if (file) void setBackgroundImage(file);
});
backgroundDropZone.addEventListener("paste", (event) => {
  event.preventDefault();
  const file = event.clipboardData?.files[0];
  if (file) {
    void setBackgroundImage(file);
    return;
  }
  const text = event.clipboardData?.getData("text/plain") ?? "";
  try {
    data.backgroundImage = sanitizeSvg(text, MAX_BACKGROUND_DATA_URL_LENGTH);
    data.backgroundType = "image";
    applyAppearance();
    void save();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Clipboard has no supported image.", true);
  }
});
requireElement<HTMLButtonElement>("#clear-grid").addEventListener("click", () => {
  if (!window.confirm("Clear the entire grid? This permanently deletes every section and link."))
    return;
  data.sections = [];
  selectedId = undefined;
  lastSectionId = undefined;
  closePanel();
  void persistAndRender();
});
backgroundInput.addEventListener("change", async () => {
  const file = backgroundInput.files?.[0];
  backgroundInput.value = "";
  if (!file) return;
  await setBackgroundImage(file);
});
window.addEventListener("resize", repositionAnchoredToolbar);
window.addEventListener("resize", placeMoreMenu);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (data.theme !== "system") return;
  faviconRevision += 1;
  applyAppearance();
  render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const change = changes[STORAGE_KEY];
  if (!change) return;
  if (!initialized) {
    hasDeferredInitialChange = true;
    deferredInitialValue = change.newValue;
    return;
  }
  try {
    const next =
      change.newValue === undefined
        ? { revision: 0, data: structuredClone(DEFAULT_DATA) }
        : storedData(change.newValue);
    persistence.receiveExternal(next);
  } catch {
    showToast("Another tab saved an invalid layout. Kept this tab unchanged.", true);
  }
});

async function initialize(): Promise<void> {
  helpMaxDepth.textContent = String(MAX_DEPTH);
  setIcons();
  enhanceSelects();
  enableToolbarDrag();
  toolbar.classList.add("initializing");
  const stored = await chrome.storage.local.get([
    STORAGE_KEY,
    "toolbarPosition",
    "toolbarAnchor",
    "emojiSkinTone",
    "emojiRecent",
    ONBOARDING_KEY,
  ]);
  const value = stored[STORAGE_KEY];
  void chrome.storage.local.remove("panelPosition");
  const savedToolbarPosition = stored["toolbarPosition"] as
    | { x?: unknown; y?: unknown; reference?: unknown }
    | undefined;
  let savedToolbarCenter: ToolbarPosition | undefined;
  if (typeof savedToolbarPosition?.x === "number" && typeof savedToolbarPosition.y === "number") {
    if (savedToolbarPosition.reference === "center")
      savedToolbarCenter = { x: savedToolbarPosition.x, y: savedToolbarPosition.y };
    else toolbarPosition = { x: savedToolbarPosition.x, y: savedToolbarPosition.y };
  }
  toolbarAnchor = typeof stored["toolbarAnchor"] === "string" ? stored["toolbarAnchor"] : undefined;
  emojiSkinTone = SKIN_TONES.includes(String(stored["emojiSkinTone"] ?? ""))
    ? String(stored["emojiSkinTone"] ?? "")
    : "";
  emojiRecent = Array.isArray(stored["emojiRecent"])
    ? stored["emojiRecent"]
        .filter((emoji): emoji is string => typeof emoji === "string")
        .slice(0, 24)
    : [];
  toolbar.hidden = false;
  if (value !== undefined) {
    try {
      const storedDataValue = storedData(value);
      data = storedDataValue.data;
      persistence.setRevision(storedDataValue.revision);
    } catch {
      data = structuredClone(DEFAULT_DATA);
      showToast("Stored layout was invalid. Started with blank canvas.", true);
    }
  }
  onboardingComplete = stored[ONBOARDING_KEY] === true;
  if (value !== undefined) completeOnboarding();
  initialized = true;
  if (hasDeferredInitialChange) {
    const next =
      deferredInitialValue === undefined
        ? { revision: 0, data: structuredClone(DEFAULT_DATA) }
        : storedData(deferredInitialValue);
    persistence.receiveExternal(next);
  }
  applyAppearance();
  render();
  if (toolbarAnchor) repositionAnchoredToolbar();
  else if (savedToolbarCenter) {
    positionToolbarAtCenter(savedToolbarCenter);
    persistToolbarPosition();
  } else if (toolbarPosition) {
    positionFloatingElement(toolbar, toolbarPosition);
    persistToolbarPosition();
  } else {
    setDefaultToolbarPosition();
  }
  window.requestAnimationFrame(() => {
    toolbar.classList.remove("initializing");
    animateToolbarEntrance();
  });
  document.documentElement.dataset["extensionReady"] = "true";
}

void initialize();
