import {
  assertCaptureTabUnchanged,
  CaptureLock,
  captureWithVerification,
  createCaptureTiles,
  createFilename,
  defaultSettings,
  getCaptureTilePhase,
  getScaledCaptureTile,
  limitPageMetricsForCapture,
  normalizeSettings,
  validateCanvasDimensions,
  validatePageMetrics,
  type CaptureSettings,
  type CaptureTabIdentity,
  type PageMetrics,
} from "./capture.js";
import { restoreViewportElements, setViewportElementsForCapture } from "./viewport-elements.js";

type CaptureType = "viewport" | "full-page";
interface CaptureResult {
  error?: string;
  saved?: boolean;
}

let captureResult: CaptureResult | undefined;
const captureLock = new CaptureLock();
const captureInProgressMessage = "A screenshot capture is already in progress.";

async function getActiveTab(): Promise<chrome.tabs.Tab & CaptureTabIdentity> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.windowId === undefined || !tab.url)
    throw new Error("No active browser tab found.");
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://")) {
    throw new Error("Browser pages cannot be captured. Open a website first.");
  }
  return tab as chrome.tabs.Tab & CaptureTabIdentity;
}

async function verifyCaptureTab(tab: CaptureTabIdentity): Promise<void> {
  const current = await chrome.tabs.get(tab.id).catch(() => undefined);
  assertCaptureTabUnchanged(
    tab,
    current?.id === undefined || current.windowId === undefined || !current.url
      ? undefined
      : {
          id: current.id,
          windowId: current.windowId,
          url: current.url,
          active: current.active,
        },
  );
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
  const dataUrl = await captureWithVerification(
    () => verifyCaptureTab(tab),
    () => chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
  );
  const image = await dataUrlToImage(dataUrl);
  let canvas: OffscreenCanvas;
  try {
    validateCanvasDimensions(image.width, image.height);
    canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create screenshot canvas.");
    context.drawImage(image, 0, 0);
  } finally {
    image.close();
  }
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
  let canvas: OffscreenCanvas | undefined;
  let context: OffscreenCanvasRenderingContext2D | null = null;

  try {
    const measuredMetrics = await executeOnTab<PageMetrics>(tabId, readPageMetrics);
    validatePageMetrics(measuredMetrics);
    // Keep captures bounded so an infinite feed cannot turn the capture pass into an
    // ever-growing scroll-and-load loop. The measured height is still used for ordinary pages.
    const metrics = limitPageMetricsForCapture(measuredMetrics);
    validateCanvasDimensions(metrics.width, metrics.height);
    const tiles = createCaptureTiles(metrics);
    let scale = 1;
    let lastCaptureTime = 0;

    if (tiles.length > 1) {
      // Hide bottom-attached viewport elements before the initial scroll and capture pass.
      await executeOnTab(tabId, setViewportElementsForCapture, ["first"] as never[]);
    }

    for (const [index, tile] of tiles.entries()) {
      await executeOnTab(tabId, scrollPage, [tile.scrollX, tile.scrollY] as never[]);
      const phase = getCaptureTilePhase(index, tiles.length);
      await executeOnTab(tabId, setViewportElementsForCapture, [phase] as never[]);
      await wait(Math.max(0, 600 - (Date.now() - lastCaptureTime)));
      const dataUrl = await captureWithVerification(
        () => verifyCaptureTab(tab),
        () => chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
      );
      const image = await dataUrlToImage(dataUrl);
      lastCaptureTime = Date.now();

      try {
        if (!canvas) {
          scale = image.width / metrics.viewportWidth;
          if (!Number.isFinite(scale) || scale <= 0) {
            throw new Error("The browser returned an invalid screenshot scale.");
          }
          const canvasWidth = Math.round(metrics.width * scale);
          const canvasHeight = Math.round(metrics.height * scale);
          validateCanvasDimensions(canvasWidth, canvasHeight);
          canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
          context = canvas.getContext("2d");
          if (!context) throw new Error("Could not create screenshot canvas.");
        }

        const scaledTile = getScaledCaptureTile(tile, scale);
        const sourceWidth = Math.min(image.width - scaledTile.sourceX, scaledTile.sourceWidth);
        const sourceHeight = Math.min(image.height - scaledTile.sourceY, scaledTile.sourceHeight);
        if (
          sourceWidth <= 0 ||
          sourceHeight <= 0 ||
          scaledTile.destinationWidth <= 0 ||
          scaledTile.destinationHeight <= 0
        ) {
          throw new Error("The browser returned an invalid screenshot tile.");
        }
        context?.drawImage(
          image,
          scaledTile.sourceX,
          scaledTile.sourceY,
          sourceWidth,
          sourceHeight,
          scaledTile.destinationX,
          scaledTile.destinationY,
          scaledTile.destinationWidth,
          scaledTile.destinationHeight,
        );
      } finally {
        image.close();
      }
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

async function performCapture(
  captureType: CaptureType,
  settings?: CaptureSettings,
): Promise<CaptureResult> {
  const release = captureLock.tryAcquire();
  if (!release) return { error: captureInProgressMessage };
  try {
    await runCapture(captureType, settings ?? (await getSettings()));
    return { saved: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Screenshot failed." };
  } finally {
    release();
  }
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
    const captureType = message.captureType === "full-page" ? "full-page" : "viewport";
    void performCapture(captureType, settings).then(sendResponse);
    return true;
  },
);

chrome.commands.onCommand.addListener((command) => {
  if (command !== "capture-viewport" && command !== "capture-full-page") return;
  const captureType = command === "capture-full-page" ? "full-page" : "viewport";
  void performCapture(captureType).then((result) => {
    captureResult = result;
    void chrome.action.openPopup().catch(() => undefined);
  });
});
