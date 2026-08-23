export const MAX_DEPTH = 16;
export const MAX_ICON_DATA_URL_LENGTH = 1_000_000;
export const MAX_BACKGROUND_DATA_URL_LENGTH = 8_000_000;

export type Direction = "horizontal" | "vertical";
export const THEMES = [
  "system",
  "light",
  "dark",
  "rose-pine",
  "vercel",
  "github-light",
  "github-dark",
] as const;
export type Theme = (typeof THEMES)[number];
export type BackgroundType = "blank" | "pattern" | "image";
export const BACKGROUND_PATTERNS = [
  "grid",
  "dots",
  "horizontal",
  "vertical",
  "diagonal",
  "crosshatch",
  "waves",
  "cubes",
  "checkerboard",
  "diamonds",
  "zigzag",
  "scales",
  "rings",
  "plus",
  "bricks",
  "hexagons",
  "blueprint",
  "tic-tac-toe",
  "overlapping-circles",
  "four-point-stars",
  "falling-triangles",
] as const;
export type BackgroundPattern = (typeof BACKGROUND_PATTERNS)[number];
export const ACCENTS = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;
export type Accent = (typeof ACCENTS)[number];
export type Density = "compact" | "comfortable" | "spacious" | "custom";
export type OpenMode = "current" | "tab" | "window";
export type InspectorMode = "floating" | "docked";
export type InspectorSide = "left" | "right";

export interface LinkNode {
  id: string;
  type: "link";
  name: string;
  autoName: boolean;
  unmodifiedDuplicate: boolean;
  url: string;
  icon: string;
  faviconBackgroundLight: boolean;
  faviconBackgroundDark: boolean;
  faviconPadding: number;
  faviconRadius: number;
  openMode: OpenMode;
  color: Accent;
  grow: number;
}

export interface SectionNode {
  id: string;
  type: "section";
  name: string;
  direction: Direction;
  collapsed: boolean;
  color: Accent;
  grow: number;
  children: Node[];
}

export type Node = LinkNode | SectionNode;

export interface StartPageData {
  version: 1;
  locked: boolean;
  theme: Theme;
  density: Density;
  itemGap: number;
  sectionGap: number;
  pagePadding: number;
  backgroundType: BackgroundType;
  backgroundPattern: BackgroundPattern;
  backgroundImage: string;
  backgroundColor: string;
  inspectorMode: InspectorMode;
  inspectorSide: InspectorSide;
  showItemCounts: boolean;
  sections: SectionNode[];
}

interface LegacyNode {
  type?: unknown;
  ident?: unknown;
  header?: unknown;
  name?: unknown;
  url?: unknown;
  direction?: unknown;
  folded?: unknown;
  grow?: unknown;
  backgroundColour?: unknown;
  content?: unknown;
  id?: unknown;
}

export const DEFAULT_DATA: StartPageData = {
  version: 1,
  locked: false,
  theme: "system",
  density: "comfortable",
  itemGap: 0,
  sectionGap: 12,
  pagePadding: 18,
  backgroundType: "pattern",
  backgroundPattern: "grid",
  backgroundImage: "",
  backgroundColor: "",
  inspectorMode: "floating",
  inspectorSide: "right",
  showItemCounts: true,
  sections: [],
};

const THEME_SET = new Set<string>(THEMES);
const BACKGROUND_PATTERN_SET = new Set<string>(BACKGROUND_PATTERNS);
const ACCENT_SET = new Set<string>(ACCENTS);

export function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `node-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function createSection(name = "Untitled section"): SectionNode {
  return {
    id: createId(),
    type: "section",
    name,
    direction: "horizontal",
    collapsed: false,
    color: "slate",
    grow: 1,
    children: [],
  };
}

export function createLink(): LinkNode {
  return {
    id: createId(),
    type: "link",
    name: "New link",
    autoName: true,
    unmodifiedDuplicate: false,
    url: "https://",
    icon: "",
    faviconBackgroundLight: false,
    faviconBackgroundDark: false,
    faviconPadding: 3,
    faviconRadius: 20,
    openMode: "current",
    color: "slate",
    grow: 1,
  };
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : fallback;
}

function grow(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(6, Math.max(1, Math.round(parsed))) : 1;
}

function boundedNumber(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, Math.round(parsed))) : fallback;
}

function spacing(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(48, Math.max(0, Math.round(parsed))) : fallback;
}

function hasImageSignature(mime: string, binary: string): boolean {
  const bytes = Array.from(binary.slice(0, 12), (character) => character.charCodeAt(0));
  if (mime === "png") {
    return (
      bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10" &&
      binary.endsWith("\0\0\0\0IEND\xaeB\x60\x82")
    );
  }
  if (mime === "jpeg") {
    return (
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && binary.endsWith("\xff\xd9")
    );
  }
  if (mime === "gif") {
    return (binary.startsWith("GIF87a") || binary.startsWith("GIF89a")) && binary.endsWith(";");
  }
  if (!binary.startsWith("RIFF") || binary.slice(8, 12) !== "WEBP") return false;
  const declaredSize = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | ((bytes[7]! << 24) >>> 0);
  return declaredSize === binary.length - 8;
}

function hasUnsafeControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

export function normalizeImageDataUrl(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) return "";
  const raster = /^data:image\/(png|jpeg|gif|webp);base64,([a-z\d+/]+={0,2})$/i.exec(value);
  if (raster) {
    const mime = raster[1]?.toLowerCase();
    const payload = raster[2];
    if (!mime || !payload || payload.length % 4 !== 0) return "";
    try {
      const binary = atob(payload);
      if (!hasImageSignature(mime, binary)) return "";
      const normalized = `data:image/${mime};base64,${btoa(binary)}`;
      return normalized.length <= maxLength ? normalized : "";
    } catch {
      return "";
    }
  }

  const prefix = "data:image/svg+xml;charset=utf-8,";
  if (!value.toLowerCase().startsWith(prefix)) return "";
  try {
    const source = decodeURIComponent(value.slice(prefix.length)).trim();
    if (
      !/^<svg(?:\s|>)/i.test(source) ||
      !/<\/svg>$/i.test(source) ||
      hasUnsafeControl(source) ||
      /<!doctype|<!entity|<\/?(?:script|style|foreignobject|iframe|object|embed)(?:\s|>)/i.test(
        source,
      ) ||
      /\son[a-z\d_-]+\s*=|(?:href|xlink:href)\s*=\s*["'](?!#)|url\(\s*(?!["']?#)/i.test(source)
    )
      return "";
    const normalized = `${prefix}${encodeURIComponent(source)}`;
    return normalized.length <= maxLength ? normalized : "";
  } catch {
    return "";
  }
}

function hexColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "";
}

function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "https://";
  try {
    const trimmed = value.trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "https://";
  } catch {
    return "https://";
  }
}

const HOST_BRANDS: Record<string, string> = {
  "amazon.com": "Amazon",
  "apple.com": "Apple",
  "discord.com": "Discord",
  "dropbox.com": "Dropbox",
  "facebook.com": "Facebook",
  "figma.com": "Figma",
  "github.com": "GitHub",
  "gitlab.com": "GitLab",
  "google.com": "Google",
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "microsoft.com": "Microsoft",
  "netflix.com": "Netflix",
  "notion.so": "Notion",
  "npmjs.com": "npm",
  "openai.com": "OpenAI",
  "pinterest.com": "Pinterest",
  "reddit.com": "Reddit",
  "slack.com": "Slack",
  "spotify.com": "Spotify",
  "stackoverflow.com": "Stack Overflow",
  "tiktok.com": "TikTok",
  "twitch.tv": "Twitch",
  "vercel.com": "Vercel",
  "wikipedia.org": "Wikipedia",
  "x.com": "X",
  "youtube.com": "YouTube",
};

export function inferNameFromUrl(value: string): string | undefined {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname) return undefined;
    for (const [domain, brand] of Object.entries(HOST_BRANDS)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return brand;
    }
    const parts = hostname.split(".");
    const countrySuffix =
      parts.at(-1)?.length === 2 && ["co", "com", "org", "net"].includes(parts.at(-2) ?? "");
    const label = parts.at(countrySuffix ? -3 : -2) ?? parts[0];
    if (!label) return undefined;
    return label
      .split("-")
      .filter(Boolean)
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" ");
  } catch {
    return undefined;
  }
}

export function applySkinTone(emoji: string, tone: string): string {
  if (!tone) return emoji;
  const codePoints = [...emoji];
  const modifierBases = codePoints.flatMap((codePoint, index) =>
    /\p{Emoji_Modifier_Base}/u.test(codePoint) ? [index] : [],
  );
  if (modifierBases.length !== 1) return emoji;
  const baseIndex = modifierBases[0];
  if (baseIndex === undefined) return emoji;
  if (codePoints[baseIndex + 1] === "️") codePoints.splice(baseIndex + 1, 1);
  codePoints.splice(baseIndex + 1, 0, tone);
  return codePoints.join("");
}

function normalizeNode(value: unknown, depth: number): Node | undefined {
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return undefined;
  const input = value as Partial<Node>;
  if (input.type === "link") {
    const legacyFaviconBackground = (input as { faviconBackground?: unknown }).faviconBackground;
    return {
      id: text(input.id, createId()),
      type: "link",
      name: text(input.name, "Untitled link"),
      autoName: input.autoName === true || input.name === "New link",
      unmodifiedDuplicate: input.unmodifiedDuplicate === true,
      url: safeUrl(input.url),
      icon:
        normalizeImageDataUrl(input.icon, MAX_ICON_DATA_URL_LENGTH) ||
        (typeof input.icon === "string" && !input.icon.toLowerCase().startsWith("data:")
          ? input.icon.slice(0, 32)
          : ""),
      faviconBackgroundLight:
        input.faviconBackgroundLight === true || legacyFaviconBackground === true,
      faviconBackgroundDark:
        input.faviconBackgroundDark === true || legacyFaviconBackground === true,
      faviconPadding: boundedNumber(input.faviconPadding, 3, 8),
      faviconRadius: boundedNumber(input.faviconRadius, 20, 50),
      openMode: ["current", "tab", "window"].includes(input.openMode ?? "")
        ? (input.openMode as OpenMode)
        : "current",
      color:
        typeof input.color === "string" && ACCENT_SET.has(input.color)
          ? (input.color as Accent)
          : "slate",
      grow: grow(input.grow),
    };
  }
  if (input.type !== "section") return undefined;
  const children = Array.isArray(input.children)
    ? input.children.flatMap((child) => {
        const normalized = normalizeNode(child, depth + 1);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    id: text(input.id, createId()),
    type: "section",
    name: text(input.name, "Untitled section"),
    direction: input.direction === "vertical" ? "vertical" : "horizontal",
    collapsed: input.collapsed === true,
    color:
      typeof input.color === "string" && ACCENT_SET.has(input.color)
        ? (input.color as Accent)
        : "slate",
    grow: grow(input.grow),
    children,
  };
}

function normalizeCurrent(value: unknown): StartPageData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<StartPageData>;
  const backgroundPattern = (value as { backgroundPattern?: unknown }).backgroundPattern;
  const backgroundImage = normalizeImageDataUrl(
    input.backgroundImage,
    MAX_BACKGROUND_DATA_URL_LENGTH,
  );
  const removedPatterns = new Set([
    "plain",
    "triangles",
    "triangle-lattice",
    "tetris",
    "maze",
    "temple",
    "jigsaw",
  ]);
  if (input.version !== 1 || !Array.isArray(input.sections)) return undefined;
  return {
    version: 1,
    locked: input.locked === true,
    theme:
      typeof input.theme === "string" && THEME_SET.has(input.theme)
        ? (input.theme as Theme)
        : "system",
    density: ["compact", "comfortable", "spacious", "custom"].includes(input.density ?? "")
      ? (input.density as Density)
      : "comfortable",
    itemGap: spacing(input.itemGap, 0),
    sectionGap: spacing(input.sectionGap, 12),
    pagePadding: spacing(input.pagePadding, 18),
    backgroundType: ["blank", "pattern", "image"].includes(input.backgroundType ?? "")
      ? (input.backgroundType as BackgroundType)
      : backgroundImage
        ? "image"
        : removedPatterns.has(String(backgroundPattern))
          ? "blank"
          : "pattern",
    backgroundPattern:
      backgroundPattern === "offset-bricks"
        ? "bricks"
        : typeof backgroundPattern === "string" && BACKGROUND_PATTERN_SET.has(backgroundPattern)
          ? (backgroundPattern as BackgroundPattern)
          : "grid",
    backgroundImage,
    backgroundColor: hexColor(input.backgroundColor),
    inspectorMode: input.inspectorMode === "docked" ? "docked" : "floating",
    inspectorSide: input.inspectorSide === "left" ? "left" : "right",
    showItemCounts: input.showItemCounts !== false,
    sections: input.sections.flatMap((section) => {
      const normalized = normalizeNode(section, 1);
      return normalized?.type === "section" ? [normalized] : [];
    }),
  };
}

function legacyColor(value: unknown): Accent {
  if (typeof value !== "string") return "slate";
  const clean = value.replace("!", "").toLowerCase();
  if (clean.includes("ff") && clean.includes("00")) return "rose";
  return "slate";
}

function convertLegacyNode(value: unknown, depth: number): Node | undefined {
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return undefined;
  const input = value as LegacyNode;
  if (input.type === "link") {
    return {
      id: text(input.ident, createId()),
      type: "link",
      name: text(input.name, "Untitled link"),
      autoName: false,
      unmodifiedDuplicate: false,
      url: safeUrl(input.url),
      icon: "",
      faviconBackgroundLight: false,
      faviconBackgroundDark: false,
      faviconPadding: 3,
      faviconRadius: 20,
      openMode: "current",
      color: legacyColor(input.backgroundColour),
      grow: grow(input.grow),
    };
  }
  if (input.type !== "sst-panel" && input.type !== "section") return undefined;
  const children = Array.isArray(input.content)
    ? input.content.flatMap((child) => {
        const converted = convertLegacyNode(child, depth + 1);
        return converted ? [converted] : [];
      })
    : [];
  return {
    id: text(input.ident, createId()),
    type: "section",
    name: text(input.header, "Untitled section"),
    direction: input.direction === "vertical" ? "vertical" : "horizontal",
    collapsed: input.folded === true,
    color: legacyColor(input.backgroundColour),
    grow: grow(input.grow),
    children,
  };
}

export function parseImport(value: unknown): StartPageData {
  const current = normalizeCurrent(value);
  if (current) return current;
  if (!Array.isArray(value)) throw new Error("Unsupported JSON format.");
  const sections = value.flatMap((item) => {
    const converted = convertLegacyNode(item, 1);
    if (converted?.type !== "section" || (item as LegacyNode).id === "trash") return [];
    return [converted];
  });
  if (sections.length === 0) throw new Error("No sections found in JSON.");
  return { ...DEFAULT_DATA, sections };
}

export function findNode(nodes: Node[], id: string): Node | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "section") {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function findParentSection(nodes: SectionNode[], id: string): SectionNode | undefined {
  for (const section of nodes) {
    if (section.children.some((child) => child.id === id)) return section;
    for (const child of section.children) {
      if (child.type !== "section") continue;
      const found = findParentSection([child], id);
      if (found) return found;
    }
  }
  return undefined;
}

export function nodeDepth(nodes: Node[], id: string, depth = 1): number | undefined {
  for (const node of nodes) {
    if (node.id === id) return depth;
    if (node.type === "section") {
      const found = nodeDepth(node.children, id, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function subtreeDepth(node: Node): number {
  if (node.type === "link" || node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(subtreeDepth));
}

export function removeNode(nodes: Node[], id: string): Node | undefined {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) return nodes.splice(index, 1)[0];
  for (const node of nodes) {
    if (node.type === "section") {
      const removed = removeNode(node.children, id);
      if (removed) return removed;
    }
  }
  return undefined;
}

export function containsNode(node: Node, id: string): boolean {
  return (
    node.id === id ||
    (node.type === "section" && node.children.some((child) => containsNode(child, id)))
  );
}
