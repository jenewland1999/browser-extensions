import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCaptureTabUnchanged,
  CaptureLock,
  captureWithVerification,
  createCaptureTiles,
  createFilename,
  getCaptureTilePhase,
  normalizeSettings,
  validateCanvasDimensions,
  validatePageMetrics,
} from "../dist/capture.js";
import {
  restoreViewportElements,
  setViewportElementsForCapture,
} from "../dist/viewport-elements.js";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));

test("build emits loadable extension files", async () => {
  const outputFiles = await readdir("dist", { recursive: true });
  assert.ok(outputFiles.includes("popup.js"));
  assert.ok(outputFiles.includes("manifest.json"));
  assert.ok(outputFiles.includes("viewport-elements.js"));
  assert.ok(outputFiles.every((path) => !path.endsWith(".ts")));
});

test("hides bottom overlays before the first scroll", async () => {
  const background = await readFile("dist/background.js", "utf8");
  const initialHide = background.indexOf('setViewportElementsForCapture, ["first"]');
  const firstScroll = background.indexOf("scrollPage, [tile.scrollX, tile.scrollY]");
  assert.ok(initialHide >= 0);
  assert.ok(firstScroll >= 0);
  assert.ok(initialHide < firstScroll);
});

test("uses only screenshot permissions", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "downloads", "scripting", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background.service_worker, "background.js");
});

test("creates full-page tiles including partial edges", () => {
  const tiles = createCaptureTiles({
    width: 1000,
    height: 1500,
    viewportWidth: 1000,
    viewportHeight: 700,
    scrollX: 0,
    scrollY: 0,
  });
  assert.deepEqual(
    tiles.map(({ y, height, scrollY, sourceY }) => ({ y, height, scrollY, sourceY })),
    [
      { y: 0, height: 700, scrollY: 0, sourceY: 0 },
      { y: 700, height: 700, scrollY: 700, sourceY: 0 },
      { y: 1400, height: 100, scrollY: 800, sourceY: 600 },
    ],
  );
});

test("assigns the correct visibility phase to each capture tile", () => {
  assert.equal(getCaptureTilePhase(0, 1), "single");
  assert.equal(getCaptureTilePhase(0, 3), "first");
  assert.equal(getCaptureTilePhase(1, 3), "middle");
  assert.equal(getCaptureTilePhase(2, 3), "last");
  assert.throws(() => getCaptureTilePhase(3, 3), /Invalid capture tile position/);
});

function createViewportElement({ position, top, bottom, left, right, rect, style = null }) {
  let styleAttribute = style;
  const attributes = new Set(style === null ? [] : ["style"]);
  const dataset = Object.create(null);
  const element = {
    dataset,
    computedStyle: { position, top, bottom, left, right },
    style: {
      setProperty(name, value, priority) {
        styleAttribute = `${styleAttribute ?? ""}${styleAttribute ? "; " : ""}${name}: ${value}${priority ? ` !${priority}` : ""}`;
        attributes.add("style");
      },
    },
    getAttribute(name) {
      return name === "style" ? styleAttribute : null;
    },
    setAttribute(name, value) {
      if (name === "style") {
        styleAttribute = value;
        attributes.add("style");
      }
    },
    removeAttribute(name) {
      if (name === "style") {
        styleAttribute = null;
        attributes.delete("style");
      }
    },
    hasAttribute(name) {
      if (name === "data-page-screenshot-hidden") return dataset.pageScreenshotHidden !== undefined;
      return attributes.has(name);
    },
    getBoundingClientRect() {
      return rect;
    },
  };
  return element;
}

test("handles viewport elements on all edges and restores their styles", () => {
  const top = createViewportElement({
    position: "fixed",
    top: "0px",
    bottom: "auto",
    left: "auto",
    right: "auto",
    rect: { top: 0, bottom: 48, left: 0, right: 1280, height: 48 },
    style: "color: red",
  });
  const stickyTop = createViewportElement({
    position: "sticky",
    top: "0px",
    bottom: "auto",
    left: "auto",
    right: "auto",
    rect: { top: 0, bottom: 56, left: 0, right: 1280, height: 56 },
  });
  const bottom = createViewportElement({
    position: "fixed",
    top: "760px",
    bottom: "0px",
    left: "0px",
    right: "0px",
    rect: { top: 760, bottom: 800, left: 0, right: 1280, height: 40 },
    style: "background: black",
  });
  const left = createViewportElement({
    position: "fixed",
    top: "0px",
    bottom: "0px",
    left: "0px",
    right: "auto",
    rect: { top: 0, bottom: 800, left: 0, right: 240, height: 800 },
  });
  const right = createViewportElement({
    position: "sticky",
    top: "0px",
    bottom: "0px",
    left: "auto",
    right: "0px",
    rect: { top: 0, bottom: 800, left: 1040, right: 1280, height: 800 },
  });
  const staticElement = createViewportElement({
    position: "static",
    top: "auto",
    bottom: "auto",
    left: "auto",
    right: "auto",
    rect: { top: 100, bottom: 200, left: 100, right: 200, height: 100 },
  });
  const elements = [top, stickyTop, bottom, left, right, staticElement];
  const originalStyles = elements.map((element) => element.getAttribute("style"));
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = {
    querySelectorAll: (selector) =>
      selector === "body *"
        ? elements
        : elements.filter((element) => element.hasAttribute("data-page-screenshot-hidden")),
  };
  globalThis.window = { innerWidth: 1280, innerHeight: 800 };
  globalThis.getComputedStyle = (element) => element.computedStyle;

  try {
    setViewportElementsForCapture("first");
    assert.equal(top.hasAttribute("data-page-screenshot-hidden"), false);
    assert.equal(stickyTop.hasAttribute("data-page-screenshot-hidden"), false);
    assert.equal(bottom.hasAttribute("data-page-screenshot-hidden"), true);
    assert.equal(left.hasAttribute("data-page-screenshot-hidden"), false);
    assert.equal(right.hasAttribute("data-page-screenshot-hidden"), false);
    assert.equal(staticElement.hasAttribute("data-page-screenshot-hidden"), false);

    setViewportElementsForCapture("middle");
    assert.equal(top.hasAttribute("data-page-screenshot-hidden"), true);
    assert.equal(stickyTop.hasAttribute("data-page-screenshot-hidden"), true);
    assert.equal(bottom.hasAttribute("data-page-screenshot-hidden"), true);
    assert.equal(left.hasAttribute("data-page-screenshot-hidden"), true);
    assert.equal(right.hasAttribute("data-page-screenshot-hidden"), true);

    setViewportElementsForCapture("last");
    assert.equal(top.hasAttribute("data-page-screenshot-hidden"), true);
    assert.equal(stickyTop.hasAttribute("data-page-screenshot-hidden"), true);
    assert.equal(bottom.hasAttribute("data-page-screenshot-hidden"), false);
    assert.equal(bottom.getAttribute("style"), "background: black");
    assert.equal(left.hasAttribute("data-page-screenshot-hidden"), true);
    assert.equal(right.hasAttribute("data-page-screenshot-hidden"), true);

    restoreViewportElements();
    assert.deepEqual(
      elements.map((element) => element.getAttribute("style")),
      originalStyles,
    );
    assert.equal(
      elements.some((element) => element.hasAttribute("data-page-screenshot-hidden")),
      false,
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test("rejects invalid page metrics before creating tiles", () => {
  const metrics = {
    width: 1000,
    height: 1500,
    viewportWidth: 0,
    viewportHeight: 700,
    scrollX: 0,
    scrollY: 0,
  };
  assert.throws(() => validatePageMetrics(metrics), /Invalid viewport width/);
  assert.throws(() => createCaptureTiles(metrics), /Invalid viewport width/);
});

test("enforces canvas dimensions and estimated memory limits", () => {
  const limits = { maxCanvasDimension: 10_000, maxCanvasBytes: 400 };
  assert.equal(validateCanvasDimensions(10, 10, limits), 400);
  assert.throws(() => validateCanvasDimensions(10_001, 1, limits), /dimension must be 10000px/);
  assert.throws(() => validateCanvasDimensions(11, 10, limits), /canvas memory limit/);
  assert.throws(() => validateCanvasDimensions(Number.NaN, 10, limits), /Invalid screenshot/);
});

test("capture lock permits only one operation until released", () => {
  const lock = new CaptureLock();
  const release = lock.tryAcquire();
  assert.equal(typeof release, "function");
  assert.equal(lock.tryAcquire(), undefined);
  release();
  release();
  assert.equal(typeof lock.tryAcquire(), "function");
});

test("detects active tab, window, and URL changes", () => {
  const original = { id: 1, windowId: 2, url: "https://example.com/page", active: true };
  assert.doesNotThrow(() => assertCaptureTabUnchanged(original, { ...original }));
  assert.throws(
    () => assertCaptureTabUnchanged(original, { ...original, active: false }),
    /not active/,
  );
  assert.throws(
    () => assertCaptureTabUnchanged(original, { ...original, windowId: 3 }),
    /changed windows/,
  );
  assert.throws(
    () => assertCaptureTabUnchanged(original, { ...original, url: "https://example.com/next" }),
    /URL changed/,
  );
});

test("verifies immediately before and after capturing data", async () => {
  const events = [];
  const result = await captureWithVerification(
    async () => events.push("verify"),
    async () => {
      events.push("capture");
      return "captured-data";
    },
  );
  assert.equal(result, "captured-data");
  assert.deepEqual(events, ["verify", "capture", "verify"]);
});

test("rejects captured data when post-capture verification fails", async () => {
  let verification = 0;
  await assert.rejects(
    captureWithVerification(
      async () => {
        verification += 1;
        if (verification === 2) throw new Error("tab changed");
      },
      async () => "untrusted-captured-data",
    ),
    /tab changed/,
  );
});

test("creates timestamped screenshot path", () => {
  assert.equal(
    createFilename(new Date(2026, 6, 25, 9, 8, 7), "png", "www.elanco.com", "viewport"),
    "elanco.com_viewport_2026-07-25_09-08-07.png",
  );
  assert.equal(
    createFilename(new Date(2026, 6, 25, 9, 8, 7), "jpeg", "docs.example.com", "full-page"),
    "docs.example.com_full-page_2026-07-25_09-08-07.jpg",
  );
  assert.equal(createFilename(new Date(2026, 6, 25, 9, 8, 7), "webp").endsWith(".webp"), true);
  assert.equal(
    createFilename(
      new Date(2026, 6, 25, 9, 8, 7),
      "png",
      "www.elanco.com",
      "full-page",
      "%date%--%domain%--%type%",
    ),
    "2026-07-25--elanco.com--full-page.png",
  );
});

test("normalizes screenshot settings", () => {
  assert.deepEqual(normalizeSettings({ format: "jpeg", quality: 120, askWhereToSave: true }), {
    format: "jpeg",
    quality: 100,
    askWhereToSave: true,
    filenameTemplate: "%domain%_%type%_%date%_%time%",
  });
  assert.deepEqual(normalizeSettings({ quality: 0 }), {
    format: "png",
    quality: 1,
    askWhereToSave: false,
    filenameTemplate: "%domain%_%type%_%date%_%time%",
  });
});

test("declares shortcuts for both capture types", () => {
  assert.equal(manifest.commands["capture-viewport"].suggested_key.mac, "Command+Shift+1");
  assert.equal(manifest.commands["capture-full-page"].suggested_key.mac, "Command+Shift+2");
});
