export type ScreenshotFormat = "png" | "jpeg" | "webp";

export interface CaptureSettings {
  askWhereToSave: boolean;
  filenameTemplate: string;
  format: ScreenshotFormat;
  quality: number;
}

export const defaultSettings: CaptureSettings = {
  askWhereToSave: false,
  filenameTemplate: "%domain%_%type%_%date%_%time%",
  format: "png",
  quality: 90,
};

export function createFilename(
  date: Date,
  format: ScreenshotFormat = "png",
  hostname = "page",
  captureType: "viewport" | "full-page" = "viewport",
  template = defaultSettings.filenameTemplate,
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const extension = format === "jpeg" ? "jpg" : format;
  const safeHostname =
    hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page";
  const values = {
    domain: safeHostname,
    type: captureType,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  };
  const rendered = template
    .replace(/%(domain|type|date|time)%/g, (_, token: keyof typeof values) => values[token])
    .replace(/[\\/:*?"<>|]+/g, "-");
  const basename = [...rendered]
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/^\.+|[. ]+$/g, "")
    .trim();
  return `${basename || "screenshot"}.${extension}`;
}

export function normalizeSettings(value: Partial<CaptureSettings> = {}): CaptureSettings {
  const format = value.format;
  return {
    askWhereToSave:
      typeof value.askWhereToSave === "boolean"
        ? value.askWhereToSave
        : defaultSettings.askWhereToSave,
    filenameTemplate:
      typeof value.filenameTemplate === "string" && value.filenameTemplate.trim()
        ? value.filenameTemplate.trim()
        : defaultSettings.filenameTemplate,
    format: format === "jpeg" || format === "webp" ? format : "png",
    quality:
      typeof value.quality === "number"
        ? Math.min(100, Math.max(1, Math.round(value.quality)))
        : defaultSettings.quality,
  };
}

export function createCaptureTiles(metrics: PageMetrics): CaptureTile[] {
  const tiles: CaptureTile[] = [];

  for (let y = 0; y < metrics.height; y += metrics.viewportHeight) {
    for (let x = 0; x < metrics.width; x += metrics.viewportWidth) {
      const scrollX = Math.min(x, Math.max(0, metrics.width - metrics.viewportWidth));
      const scrollY = Math.min(y, Math.max(0, metrics.height - metrics.viewportHeight));
      tiles.push({
        x,
        y,
        width: Math.min(metrics.viewportWidth, metrics.width - x),
        height: Math.min(metrics.viewportHeight, metrics.height - y),
        scrollX,
        scrollY,
        sourceX: x - scrollX,
        sourceY: y - scrollY,
      });
    }
  }

  return tiles;
}
export interface PageMetrics {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
}

export interface CaptureTile {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  sourceX: number;
  sourceY: number;
}
