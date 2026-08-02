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

export const captureLimits = {
  maxCanvasDimension: 32_767,
  maxCanvasBytes: 256 * 1024 * 1024,
  maxFullPageHeight: 10_000,
} as const;

export interface CaptureTabIdentity {
  id: number;
  windowId: number;
  url: string;
  active: boolean;
}

const pad = (value: number): string => String(value).padStart(2, "0");

export class CaptureLock {
  private locked = false;

  tryAcquire(): (() => void) | undefined {
    if (this.locked) return undefined;
    this.locked = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locked = false;
    };
  }
}

export function assertCaptureTabUnchanged(
  expected: CaptureTabIdentity,
  actual: CaptureTabIdentity | undefined,
): void {
  if (!actual || actual.id !== expected.id) {
    throw new Error("Capture stopped because the original tab is no longer active.");
  }
  if (!actual.active || actual.windowId !== expected.windowId) {
    throw new Error("Capture stopped because the original tab changed windows or is not active.");
  }
  if (actual.url !== expected.url) {
    throw new Error("Capture stopped because the original page URL changed.");
  }
}

export async function captureWithVerification<T>(
  verify: () => Promise<void>,
  capture: () => Promise<T>,
): Promise<T> {
  await verify();
  const result = await capture();
  await verify();
  return result;
}

export function validatePageMetrics(metrics: PageMetrics): void {
  for (const [name, value] of [
    ["page width", metrics.width],
    ["page height", metrics.height],
    ["viewport width", metrics.viewportWidth],
    ["viewport height", metrics.viewportHeight],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid ${name} reported by the page: ${String(value)}.`);
    }
  }
  if (!Number.isFinite(metrics.scrollX) || !Number.isFinite(metrics.scrollY)) {
    throw new Error("Invalid scroll position reported by the page.");
  }
}

export function limitPageMetricsForCapture(metrics: PageMetrics): PageMetrics {
  validatePageMetrics(metrics);
  const maximumHeight = Math.max(metrics.viewportHeight, captureLimits.maxFullPageHeight);
  return {
    ...metrics,
    height: Math.min(metrics.height, maximumHeight),
  };
}

export function validateCanvasDimensions(
  width: number,
  height: number,
  limits: { maxCanvasDimension: number; maxCanvasBytes: number } = captureLimits,
): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid screenshot canvas dimensions: ${width} x ${height}.`);
  }
  if (width > limits.maxCanvasDimension || height > limits.maxCanvasDimension) {
    throw new Error(
      `Screenshot is too large (${width} x ${height}px). Each canvas dimension must be ${limits.maxCanvasDimension}px or less.`,
    );
  }
  const estimatedBytes = width * height * 4;
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > limits.maxCanvasBytes) {
    const estimatedMiB = Math.ceil(estimatedBytes / (1024 * 1024));
    const maximumMiB = Math.floor(limits.maxCanvasBytes / (1024 * 1024));
    throw new Error(
      `Screenshot is too large (${width} x ${height}px, about ${estimatedMiB} MiB). The canvas memory limit is ${maximumMiB} MiB.`,
    );
  }
  return estimatedBytes;
}

export function createFilename(
  date: Date,
  format: ScreenshotFormat = "png",
  hostname = "page",
  captureType: "viewport" | "full-page" = "viewport",
  template = defaultSettings.filenameTemplate,
): string {
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
  validatePageMetrics(metrics);
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

export type CaptureTilePhase = "single" | "first" | "middle" | "last";

export function getCaptureTilePhase(index: number, tileCount: number): CaptureTilePhase {
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(tileCount) ||
    tileCount <= 0 ||
    index < 0 ||
    index >= tileCount
  ) {
    throw new Error(`Invalid capture tile position: ${index} of ${tileCount}.`);
  }
  if (tileCount === 1) return "single";
  if (index === 0) return "first";
  if (index === tileCount - 1) return "last";
  return "middle";
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
