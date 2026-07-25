import {
  createCaptureTiles,
  createFilename,
  defaultSettings,
  normalizeSettings,
  type CaptureSettings,
  type PageMetrics,
} from "./capture.js";

type CaptureType = "viewport" | "full-page";
interface CaptureResult {
  error?: string;
  saved?: boolean;
}

let captureResult: CaptureResult | undefined;

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.windowId === undefined)
    throw new Error("No active browser tab found.");
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://")) {
    throw new Error("Browser pages cannot be captured. Open a website first.");
  }
  return tab;
}

async function download(
  dataUrl: string,
  settings: CaptureSettings,
  tab: chrome.tabs.Tab,
  captureType: CaptureType,
): Promise<void> {
  let hostname = "page";
  try {
    if (tab.url) hostname = new URL(tab.url).hostname;
  } catch {
    // Keep the generic fallback for URLs without a standard hostname.
  }
  await chrome.downloads.download({
    url: dataUrl,
    filename: createFilename(
      new Date(),
      settings.format,
      hostname,
      captureType,
      settings.filenameTemplate,
    ),
    saveAs: settings.askWhereToSave,
  });
}

interface PageState {
  x: number;
  y: number;
  scrollBehavior: string;
  scrollBehaviorPriority: string;
}

function preparePageForCapture(): PageState {
  const root = document.documentElement;
  const state = {
    x: window.scrollX,
    y: window.scrollY,
    scrollBehavior: root.style.getPropertyValue("scroll-behavior"),
    scrollBehaviorPriority: root.style.getPropertyPriority("scroll-behavior"),
  };
  root.style.setProperty("scroll-behavior", "auto", "important");
  return state;
}

function restorePageState(state: PageState): void {
  const root = document.documentElement;
  window.scrollTo(state.x, state.y);
  if (state.scrollBehavior) {
    root.style.setProperty("scroll-behavior", state.scrollBehavior, state.scrollBehaviorPriority);
  } else {
    root.style.removeProperty("scroll-behavior");
  }
}

function readPageMetrics(): PageMetrics {
  const root = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth ?? 0),
    height: Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight ?? 0),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

async function scrollPage(x: number, y: number): Promise<void> {
  window.scrollTo(x, y);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250))),
  );
}

function hideViewportElements(): void {
  for (const element of document.querySelectorAll<HTMLElement>("body *")) {
    if (element.hasAttribute("data-page-screenshot-hidden")) continue;
    const position = getComputedStyle(element).position;
    if (position !== "fixed" && position !== "sticky") continue;
    element.dataset["pageScreenshotStyle"] = element.getAttribute("style") ?? "";
    element.dataset["pageScreenshotHadStyle"] = String(element.hasAttribute("style"));
    element.dataset["pageScreenshotHidden"] = "";
    element.style.setProperty("opacity", "0", "important");
    element.style.setProperty("pointer-events", "none", "important");
  }
}

function restoreViewportElements(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-page-screenshot-hidden]")) {
    const style = element.dataset["pageScreenshotStyle"] ?? "";
    const hadStyle = element.dataset["pageScreenshotHadStyle"] === "true";
    delete element.dataset["pageScreenshotStyle"];
    delete element.dataset["pageScreenshotHadStyle"];
    delete element.dataset["pageScreenshotHidden"];
    if (hadStyle) element.setAttribute("style", style);
    else element.removeAttribute("style");
  }
}

async function executeOnTab<T>(
  tabId: number,
  func: (...args: never[]) => T | Promise<T>,
  args: never[] = [],
): Promise<T> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!result) throw new Error("Could not access page content.");
  return result.result as T;
}

async function captureViewport(settings: CaptureSettings): Promise<void> {
  const tab = await getActiveTab();
  const canvas = new OffscreenCanvas(1, 1);
  const image = await dataUrlToImage(
    await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
  );
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.drawImage(image, 0, 0);
  image.close();
  await download(await canvasToDataUrl(canvas, settings), settings, tab, "viewport");
}

async function dataUrlToImage(dataUrl: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return `data:${blob.type};base64,${btoa(chunks.join(""))}`;
}

async function canvasToDataUrl(
  canvas: OffscreenCanvas,
  settings: CaptureSettings,
): Promise<string> {
  const type = `image/${settings.format}`;
  const options: ImageEncodeOptions = { type };
  if (settings.format !== "png") options.quality = settings.quality / 100;
  return blobToDataUrl(await canvas.convertToBlob(options));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureFullPage(settings: CaptureSettings): Promise<void> {
  const tab = await getActiveTab();
  const tabId = tab.id as number;
  const pageState = await executeOnTab<PageState>(tabId, preparePageForCapture);
  const metrics = await executeOnTab<PageMetrics>(tabId, readPageMetrics);
  const tiles = createCaptureTiles(metrics);
  let canvas: OffscreenCanvas | undefined;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  let scale = 1;
  let lastCaptureTime = 0;

  try {
    for (const [index, tile] of tiles.entries()) {
      await executeOnTab(tabId, scrollPage, [tile.scrollX, tile.scrollY] as never[]);
      if (index > 0) await executeOnTab(tabId, hideViewportElements);
      await wait(Math.max(0, 600 - (Date.now() - lastCaptureTime)));
      const image = await dataUrlToImage(
        await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
      );
      lastCaptureTime = Date.now();

      if (!canvas) {
        scale = image.width / metrics.viewportWidth;
        canvas = new OffscreenCanvas(
          Math.round(metrics.width * scale),
          Math.round(metrics.height * scale),
        );
        context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create screenshot canvas.");
      }

      const width = Math.min(image.width, Math.round(tile.width * scale));
      const height = Math.min(image.height, Math.round(tile.height * scale));
      context?.drawImage(
        image,
        Math.round(tile.sourceX * scale),
        Math.round(tile.sourceY * scale),
        width,
        height,
        Math.round(tile.x * scale),
        Math.round(tile.y * scale),
        width,
        height,
      );
      image.close();
    }
  } finally {
    await executeOnTab(tabId, restoreViewportElements).catch(() => undefined);
    await executeOnTab(tabId, restorePageState, [pageState] as never[]).catch(() => undefined);
  }

  if (!canvas) throw new Error("Page produced no screenshot data.");
  await download(await canvasToDataUrl(canvas, settings), settings, tab, "full-page");
}

async function getSettings(): Promise<CaptureSettings> {
  return normalizeSettings((await chrome.storage.local.get(defaultSettings)) as CaptureSettings);
}

async function runCapture(captureType: CaptureType, settings: CaptureSettings): Promise<void> {
  if (captureType === "full-page") await captureFullPage(settings);
  else await captureViewport(settings);
}

function trackCapture(operation: Promise<void>): void {
  void operation
    .then(() => {
      captureResult = { saved: true };
    })
    .catch((error: unknown) => {
      captureResult = { error: error instanceof Error ? error.message : "Screenshot failed." };
    })
    .finally(() => {
      void chrome.action.openPopup().catch(() => undefined);
    });
}

chrome.runtime.onMessage.addListener(
  (
    message: { type?: string; captureType?: CaptureType; settings?: CaptureSettings },
    _sender,
    sendResponse,
  ) => {
    if (message.type === "capture-result") {
      sendResponse(captureResult ?? {});
      captureResult = undefined;
      return false;
    }
    if (message.type !== "capture") return false;
    const settings = normalizeSettings(message.settings);
    sendResponse({});
    trackCapture(runCapture(message.captureType ?? "viewport", settings));
    return false;
  },
);

chrome.commands.onCommand.addListener((command) => {
  if (command !== "capture-viewport" && command !== "capture-full-page") return;
  const captureType = command === "capture-full-page" ? "full-page" : "viewport";
  trackCapture(getSettings().then((settings) => runCapture(captureType, settings)));
});
